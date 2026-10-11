
const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { DecideAsync } = require('./ai-decision');
const { MaxContextBytes } = require('./context-file-classifier');
const endpoint = 'https://pmf.neochro.me/mcp/token';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {string} ArgCode */
function failure(ArgCode) { return Object.assign(new Error(ArgCode), { code: ArgCode }); }
/** @param {any} ArgValue @param {number} ArgLimit */
function CheckSize(ArgValue, ArgLimit) {
  if(Buffer.byteLength(typeof ArgValue === 'string' ? ArgValue : JSON.stringify(ArgValue), 'utf8') > ArgLimit) throw failure('too-large');
}
/** @param {string|undefined} ArgJson @returns {Record<string, {TeamId:string, CredentialName:string}>} */
function ParseChannels(ArgJson) {
  if(ArgJson === undefined) return {};
  try {
    if(typeof ArgJson !== 'string') throw failure('configuration');
    const map = JSON.parse(ArgJson);
    if(!map || Array.isArray(map) || typeof map !== 'object') throw failure('configuration');
    for(const [Channel, Entry] of Object.entries(map)) {
      if(!/^[CG][A-Z0-9]+$/.test(Channel) || !Entry || Object.keys(Entry).sort().join(',') !== 'CredentialName,TeamId'
        || !uuid.test(Entry.TeamId) || typeof Entry.CredentialName !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(Entry.CredentialName)) throw failure('configuration');
    }
    return map;
  } catch(error) { throw failure('configuration'); }
}
/** @param {any} ArgWorkspace @param {string} ArgChannel */
function GetMapping(ArgWorkspace, ArgChannel) { return ParseChannels(ArgWorkspace.PRODUCT_COMPASS_CHANNELS)[ArgChannel] || null; }
/** @param {any} ArgWorkspace @param {string} ArgName */
async function ReadCredentialAsync(ArgWorkspace, ArgName) {
  // encode workspace names injectively so distinct tenants cannot share a credential reference.
  const name = `pc-${Buffer.from(ArgWorkspace.WORKSPACE_NAME, 'utf8').toString('hex')}-${ArgName}`;
  try {
    let CredentialValue;
    if(process.platform === 'darwin') {
      const result = await promisify(execFile)('/usr/bin/security', ['find-generic-password', '-s', 'sleuth.product-compass', '-a', name, '-w'], { timeout: 5000, maxBuffer: 4096 });
      CredentialValue = result.stdout.trim();
    } else if(process.platform === 'linux' && process.env.CREDENTIALS_DIRECTORY) {
      CredentialValue = (await fs.readFile(path.join(process.env.CREDENTIALS_DIRECTORY, name), 'utf8')).trim();
    } else throw failure('credentials');
    if(!/^pc_live_[A-Za-z0-9_-]+$/.test(CredentialValue) || CredentialValue.length > 2048) throw failure('credentials');
    return CredentialValue;
  } catch(error) { throw failure('credentials'); }
}
/** @param {string} ArgToken @param {AbortSignal} ArgSignal @returns {typeof fetch} */
function MakeFetch(ArgToken, ArgSignal) {
  return async (ArgUrl, ArgInit) => {
    if(String(ArgUrl) !== endpoint) throw failure('transport');
    const HeadersValue = new Headers(ArgInit?.headers);
    HeadersValue.set('Authorization', `Bearer ${ArgToken}`);
    const ResponseValue = await fetch(ArgUrl, { ...ArgInit, headers: HeadersValue, redirect: 'error', signal: ArgSignal });
    if(ResponseValue.status === 401 || ResponseValue.status === 403) throw failure('auth');
    if(!ResponseValue.body) return ResponseValue;
    const reader = ResponseValue.body.getReader();
    let bytes = 0;
    const body = new ReadableStream({
      async pull(ArgController) {
        try {
          const result = await reader.read();
          if(result.done) {
            ArgController.close();
            return;
          }
          bytes += result.value.byteLength;
          if(bytes > 256 * 1024) {
            await reader.cancel();
            throw failure('too-large');
          }
          ArgController.enqueue(result.value);
        } catch(error) { ArgController.error(error); }
      },
      cancel() { return reader.cancel(); },
    });
    return new Response(body, { status: ResponseValue.status, statusText: ResponseValue.statusText, headers: ResponseValue.headers });
  };
}
/** @param {any} ArgResult */
function unwrap(ArgResult) {
  if(ArgResult?.isError || !ArgResult?.structuredContent || typeof ArgResult.structuredContent !== 'object') throw failure('response');
  return ArgResult.structuredContent;
}
/** @param {any} ArgTool @param {string[]} ArgFields */
function compatible(ArgTool, ArgFields) {
  const schema = ArgTool?.inputSchema;
  return schema?.type === 'object' && ArgFields.every(ArgField => schema.properties?.[ArgField]?.type === 'string')
    && (schema.required || []).every((/** @type {string} */ ArgField) => ArgFields.includes(ArgField) || ArgField === 'query');
}
/**
 * Bounded, channel-scoped evidence workflow. No token, corpus or conversation cache.
 * @param {any} ArgWorkspace
 * @param {string} ArgChannel
 * @param {string} ArgQuestion
 * @param {string} ArgContext
 * @param {import('./workspace-ai')} ArgAI
 * @param {string|undefined} ArgModel
 * @returns {Promise<string>}
 */
async function AskAsync(ArgWorkspace, ArgChannel, ArgQuestion, ArgContext, ArgAI, ArgModel) {
  const mapping = GetMapping(ArgWorkspace, ArgChannel);
  if(!mapping) throw failure('not-mapped');
  if(!ArgQuestion.trim() || ArgQuestion.length > 4000) throw failure('question');
  CheckSize(ArgContext, MaxContextBytes);
  // load the optional MCP runtime only for mapped queries, not workspace validation or ordinary chat.
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const controller = new AbortController();
  const WorkflowTimer = setTimeout(() => controller.abort(), 120000);
  const ClientValue = new Client({ name: 'sleuth-product-compass', version: '1.0.0' });
  /** @type {any[]} */
  const evidence = [];
  /** @type {string[]} */
  const notices = [];
  /** @param {() => Promise<any>} ArgAction @param {number} ArgMs */
  async function TimedAsync(ArgAction, ArgMs) {
    if(controller.signal.aborted) throw failure('timeout');
    let timer;
    /** @type {() => void} */ let OnAbort;
    try {
      return await Promise.race([ArgAction(), new Promise((Arg_, ArgReject) => {
        OnAbort = () => ArgReject(failure('timeout'));
        controller.signal.addEventListener('abort', OnAbort, { once: true });
        timer = setTimeout(() => controller.abort(), ArgMs);
      })]);
    } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', OnAbort); }
  }
  try {
    const token = await TimedAsync(() => ReadCredentialAsync(ArgWorkspace, mapping.CredentialName), 5000);
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      fetch: MakeFetch(token, controller.signal), reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    await TimedAsync(() => ClientValue.connect(transport), 15000);
    const discovery = await TimedAsync(() => ClientValue.listTools({}, { signal: controller.signal, timeout: 15000 }), 15000);
    if(discovery.nextCursor || !Array.isArray(discovery.tools)) throw failure('contract');
    const tools = new Map(discovery.tools.map((/** @type {any} */ ArgTool) => [ArgTool.name, ArgTool]));
    if(!compatible(tools.get('list_products'), ['team_id'])) throw failure('contract');
    /** @param {string} ArgName @param {any} ArgArguments */
    const CallAsync = async (ArgName, ArgArguments) => unwrap(await TimedAsync(() => ClientValue.callTool({ name: ArgName, arguments: ArgArguments }, undefined, { signal: controller.signal, timeout: 15000 }), 15000));
    const catalog = await CallAsync('list_products', { team_id: mapping.TeamId });
    CheckSize(catalog, 64 * 1024);
    if(!Array.isArray(catalog.products) || catalog.products.length > 200) throw failure('response');
    const products = new Set();
    const releases = new Map();
    for(const product of catalog.products) {
      if(!uuid.test(product.id) || products.has(product.id) || !Array.isArray(product.releases)) throw failure('response');
      products.add(product.id);
      for(const release of product.releases) {
        if(!uuid.test(release.id) || releases.has(release.id)) throw failure('response');
        releases.set(release.id, product.id);
      }
    }
    if(releases.size > 1000) throw failure('too-large');
    const search = tools.get('search_documents');
    if(search && (!compatible(search, ['team_id', 'query', 'product_id', 'release_id']) || search.inputSchema.properties.limit?.type !== 'integer')) throw failure('contract');
    const AvailableTools = [
      ...(compatible(tools.get('get_release_brief'), ['release_id']) ? ['get_release_brief'] : []),
      ...(compatible(tools.get('get_product_arc'), ['product_id']) ? ['get_product_arc'] : []),
      ...(search ? ['search_documents'] : []),
    ];
    if(!search) notices.push('Document search is unavailable; only structured briefs/arcs can be consulted.');
    const instructions = await fs.readFile(path.join(__dirname, '../data/static/ai/compass-instructions.md'), 'utf8');
    for(let turn = 0; turn <= 4; turn++) {
      const input = { Question: ArgQuestion, Context: ArgContext, Catalog: catalog, Evidence: evidence, Notices: notices, CallsRemaining: 4 - turn,
        Tools: AvailableTools };
      CheckSize(instructions + JSON.stringify(input, null, 2), MaxContextBytes);
      const decision = await TimedAsync(() => DecideAsync(ArgAI, {
        Name: 'compass', InstructionsFile: 'compass-instructions.md', SchemaFile: 'compass-schema.json',
        ModelName: ArgModel, RequiredFields: ['Action'],
      }, input, { RequestOptions: { signal: controller.signal, timeout: 45000, maxRetries: 0 } }), 45000);
      if(controller.signal.aborted) throw failure('timeout');
      if(decision.Action === 'answer') {
        if(typeof decision.Answer !== 'string' || decision.Answer.length > 12000 || !Array.isArray(decision.Citations)) throw failure('response');
        const sources = evidence.flatMap(ArgItem => ArgItem.Sources);
        const selected = decision.Citations.map((/** @type {string} */ ArgId) => {
          const source = sources.find(ArgSource => ArgSource.Id === ArgId);
          if(!source) throw failure('citations');
          return source;
        });
        // an inline [n.n] that names a retrieved source is rendered even if Citations omitted it; any
        // other bracketed number is prose (e.g. "release [1.65]"), not a citation to reject.
        for(const [, Id] of decision.Answer.matchAll(/\[([0-9]+\.[0-9]+)\]/g)) {
          const source = sources.find(ArgSource => ArgSource.Id === Id);
          if(source) selected.push(source);
        }
        // no uncited-answer check: when retrieved passages miss the question, the instructions tell
        // the model to ask a clarifying question, which legitimately cites nothing.
        // model text cannot introduce URLs or Slack mentions; links come only from checked evidence.
        const safe = (/** @type {string} */ ArgText) => ArgText.replace(/https?:\/\/\S+/gi, '[link omitted]').replace(/[<>&]/g, ArgChar => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ArgChar]));
        return safe(decision.Answer) + (selected.length ? '\n\nSources:\n' + [...new Set(selected)].map(ArgSource => `[${ArgSource.Id}] ${safe(ArgSource.Title)}${ArgSource.Link ? ` <${ArgSource.Link}|open>` : ''}\n> ${safe(ArgSource.Excerpt)}`).join('\n') : '\n\n_No retrieved source evidence; please clarify the product or release._')
          + (notices.length ? '\n\n_' + [...new Set(notices)].join(' ') + '_' : '');
      }
      if(turn === 4) throw failure('tool-limit');
      const ProductId = decision.ProductId || '';
      const ReleaseId = decision.ReleaseId || '';
      if((ProductId && !products.has(ProductId)) || (ReleaseId && !releases.has(ReleaseId)) || (ProductId && ReleaseId && releases.get(ReleaseId) !== ProductId)) throw failure('scope');
      /** @type {any} */ let args;
      if(decision.Action === 'search_documents' && search) {
        if(typeof decision.Query !== 'string' || decision.Query.length < 2 || decision.Query.length > 1000) throw failure('response'); // the model's query, not the user's question
        args = { team_id: mapping.TeamId, query: decision.Query, limit: 12, ...(ProductId ? { product_id: ProductId } : {}), ...(ReleaseId ? { release_id: ReleaseId } : {}) };
      } else if(decision.Action === 'get_release_brief' && ReleaseId && compatible(tools.get(decision.Action), ['release_id'])) args = { release_id: ReleaseId };
      else if(decision.Action === 'get_product_arc' && ProductId && compatible(tools.get(decision.Action), ['product_id'])) args = { product_id: ProductId };
      else throw failure('contract');
      const result = await CallAsync(decision.Action, args);
      CheckSize(result, 32 * 1024);
      /** @type {any[]} */ let sources;
      if(decision.Action === 'search_documents') {
        if(!Array.isArray(result.passages) || result.passages.length > 12) throw failure('response');
        if(result.documents_still_indexing || result.documents_not_indexed || Object.entries(result.index_status || {}).some(([ArgKey, ArgValue]) => ['pending', 'indexing', 'failed', 'blocked'].includes(ArgKey) && Number(ArgValue) > 0)) notices.push('Some documents are pending, failed or blocked; this evidence is incomplete.');
        sources = result.passages.map((/** @type {any} */ ArgPassage, /** @type {number} */ ArgIndex) => {
          if(!products.has(ArgPassage.product_id) || (ArgPassage.release_id && releases.get(ArgPassage.release_id) !== ArgPassage.product_id)
            || (ProductId && ProductId !== ArgPassage.product_id) || (ReleaseId && ReleaseId !== ArgPassage.release_id)
            || !uuid.test(ArgPassage.document_id) || typeof ArgPassage.excerpt !== 'string' || typeof ArgPassage.file_name !== 'string') throw failure('scope');
          const expected = `/t/${mapping.TeamId}/library?doc=${ArgPassage.document_id}`;
          if(ArgPassage.link !== expected) throw failure('citations');
          return { Id: `${turn + 1}.${ArgIndex + 1}`, Title: `${ArgPassage.file_name} (${ArgPassage.release || 'product'}; ${ArgPassage.lines || ''})`, Link: new URL(expected, endpoint).href, Excerpt: ArgPassage.excerpt.slice(0, 350) };
        });
      } else {
        if(!result[decision.Action === 'get_release_brief' ? 'brief' : 'arc']) throw failure('response');
        sources = [{ Id: `${turn + 1}.1`, Title: `${decision.Action} ${ReleaseId || ProductId}`, Link: '', Excerpt: JSON.stringify(result).slice(0, 350) }];
      }
      evidence.push({ Tool: decision.Action, Result: result, Sources: sources });
    }
    throw failure('tool-limit');
  } catch(error) {
    if(controller.signal.aborted) throw failure('timeout');
    throw failure(['credentials', 'not-mapped', 'question', 'too-large', 'auth', 'contract', 'response', 'scope', 'citations', 'tool-limit'].includes(error.code) ? error.code : 'unavailable');
  } finally {
    clearTimeout(WorkflowTimer);
    controller.abort();
    await ClientValue.close().catch(() => {});
  }
}
module.exports = { ParseChannels, GetMapping, AskAsync };
