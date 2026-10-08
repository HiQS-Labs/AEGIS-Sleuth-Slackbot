const fs = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { DecideAsync } = require('./ai-decision');
const { MaxContextBytes } = require('./context-file-classifier');
const Endpoint = 'https://pmf.neochro.me/mcp/token';
const Uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {string} ArgCode */
function Failure(ArgCode) { return Object.assign(new Error(ArgCode), { code: ArgCode }); }
/** @param {any} ArgValue @param {number} ArgLimit */
function CheckSize(ArgValue, ArgLimit) {
  if(Buffer.byteLength(typeof ArgValue === 'string' ? ArgValue : JSON.stringify(ArgValue), 'utf8') > ArgLimit) throw Failure('too-large');
}
/** @param {string|undefined} ArgJson @returns {Record<string, {TeamId:string, CredentialName:string}>} */
function ParseChannels(ArgJson) {
  if(ArgJson === undefined) return {};
  try {
    if(typeof ArgJson !== 'string') throw Failure('configuration');
    const Map = JSON.parse(ArgJson);
    if(!Map || Array.isArray(Map) || typeof Map !== 'object') throw Failure('configuration');
    for(const [Channel, Entry] of Object.entries(Map)) {
      if(!/^[CG][A-Z0-9]+$/.test(Channel) || !Entry || Object.keys(Entry).sort().join(',') !== 'CredentialName,TeamId'
        || !Uuid.test(Entry.TeamId) || typeof Entry.CredentialName !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(Entry.CredentialName)) throw Failure('configuration');
    }
    return Map;
  } catch(error) { throw Failure('configuration'); }
}
/** @param {any} ArgWorkspace @param {string} ArgChannel */
function GetMapping(ArgWorkspace, ArgChannel) { return ParseChannels(ArgWorkspace.PRODUCT_COMPASS_CHANNELS)[ArgChannel] || null; }
/** @param {any} ArgWorkspace @param {string} ArgName */
async function ReadCredentialAsync(ArgWorkspace, ArgName) {
  // encode workspace names injectively so distinct tenants cannot share a credential reference.
  const Name = `pc-${Buffer.from(ArgWorkspace.WORKSPACE_NAME, 'utf8').toString('hex')}-${ArgName}`;
  try {
    let Token;
    if(process.platform === 'darwin') {
      const Result = await promisify(execFile)('/usr/bin/security', ['find-generic-password', '-s', 'sleuth.product-compass', '-a', Name, '-w'], { timeout: 5000, maxBuffer: 4096 });
      Token = Result.stdout.trim();
    } else if(process.platform === 'linux' && process.env.CREDENTIALS_DIRECTORY) {
      Token = (await fs.readFile(path.join(process.env.CREDENTIALS_DIRECTORY, Name), 'utf8')).trim();
    } else throw Failure('credentials');
    if(!/^pc_live_[A-Za-z0-9_-]+$/.test(Token) || Token.length > 2048) throw Failure('credentials');
    return Token;
  } catch(error) { throw Failure('credentials'); }
}
/** @param {string} ArgToken @param {AbortSignal} ArgSignal @returns {typeof fetch} */
function MakeFetch(ArgToken, ArgSignal) {
  return async (ArgUrl, ArgInit) => {
    if(String(ArgUrl) !== Endpoint) throw Failure('transport');
    const HeadersValue = new Headers(ArgInit?.headers);
    HeadersValue.set('Authorization', `Bearer ${ArgToken}`);
    const ResponseValue = await fetch(ArgUrl, { ...ArgInit, headers: HeadersValue, redirect: 'error', signal: ArgSignal });
    if(ResponseValue.status === 401 || ResponseValue.status === 403) throw Failure('auth');
    if(!ResponseValue.body) return ResponseValue;
    const Reader = ResponseValue.body.getReader();
    let Bytes = 0;
    const Body = new ReadableStream({
      async pull(ArgController) {
        try {
          const Result = await Reader.read();
          if(Result.done) { ArgController.close(); return; }
          Bytes += Result.value.byteLength;
          if(Bytes > 256 * 1024) { await Reader.cancel(); throw Failure('too-large'); }
          ArgController.enqueue(Result.value);
        } catch(error) { ArgController.error(error); }
      },
      cancel() { return Reader.cancel(); },
    });
    return new Response(Body, { status: ResponseValue.status, statusText: ResponseValue.statusText, headers: ResponseValue.headers });
  };
}
/** @param {any} ArgResult */
function Unwrap(ArgResult) {
  if(ArgResult?.isError || !ArgResult?.structuredContent || typeof ArgResult.structuredContent !== 'object') throw Failure('response');
  return ArgResult.structuredContent;
}
/** @param {any} ArgTool @param {string[]} ArgFields */
function Compatible(ArgTool, ArgFields) {
  const Schema = ArgTool?.inputSchema;
  return Schema?.type === 'object' && ArgFields.every(ArgField => Schema.properties?.[ArgField]?.type === 'string')
    && (Schema.required || []).every((/** @type {string} */ ArgField) => ArgFields.includes(ArgField) || ArgField === 'query');
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
  const Mapping = GetMapping(ArgWorkspace, ArgChannel);
  if(!Mapping) throw Failure('not-mapped');
  if(!ArgQuestion.trim() || ArgQuestion.length > 4000) throw Failure('question');
  CheckSize(ArgContext, MaxContextBytes);
  const Controller = new AbortController();
  const WorkflowTimer = setTimeout(() => Controller.abort(), 120000);
  const ClientValue = new Client({ name: 'sleuth-product-compass', version: '1.0.0' });
  /** @type {any[]} */
  const Evidence = [];
  /** @type {string[]} */
  const Notices = [];
  /** @param {() => Promise<any>} ArgAction @param {number} ArgMs */
  async function TimedAsync(ArgAction, ArgMs) {
    if(Controller.signal.aborted) throw Failure('timeout');
    let Timer;
    /** @type {() => void} */ let OnAbort;
    try {
      return await Promise.race([ArgAction(), new Promise((_, ArgReject) => {
        OnAbort = () => ArgReject(Failure('timeout'));
        Controller.signal.addEventListener('abort', OnAbort, { once: true });
        Timer = setTimeout(() => Controller.abort(), ArgMs);
      })]);
    } finally { clearTimeout(Timer); Controller.signal.removeEventListener('abort', OnAbort); }
  }
  try {
    const Token = await TimedAsync(() => ReadCredentialAsync(ArgWorkspace, Mapping.CredentialName), 5000);
    const Transport = new StreamableHTTPClientTransport(new URL(Endpoint), {
      fetch: MakeFetch(Token, Controller.signal), reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    });
    await TimedAsync(() => ClientValue.connect(Transport), 15000);
    const Discovery = await TimedAsync(() => ClientValue.listTools({}, { signal: Controller.signal, timeout: 15000 }), 15000);
    if(Discovery.nextCursor || !Array.isArray(Discovery.tools)) throw Failure('contract');
    const Tools = new Map(Discovery.tools.map((/** @type {any} */ ArgTool) => [ArgTool.name, ArgTool]));
    if(!Compatible(Tools.get('list_products'), ['team_id'])) throw Failure('contract');
    /** @param {string} ArgName @param {any} ArgArguments */
    const CallAsync = async (ArgName, ArgArguments) => Unwrap(await TimedAsync(() => ClientValue.callTool({ name: ArgName, arguments: ArgArguments }, undefined, { signal: Controller.signal, timeout: 15000 }), 15000));
    const Catalog = await CallAsync('list_products', { team_id: Mapping.TeamId });
    CheckSize(Catalog, 64 * 1024);
    if(!Array.isArray(Catalog.products) || Catalog.products.length > 200) throw Failure('response');
    const Products = new Set();
    const Releases = new Map();
    for(const Product of Catalog.products) {
      if(!Uuid.test(Product.id) || Products.has(Product.id) || !Array.isArray(Product.releases)) throw Failure('response');
      Products.add(Product.id);
      for(const Release of Product.releases) {
        if(!Uuid.test(Release.id) || Releases.has(Release.id)) throw Failure('response');
        Releases.set(Release.id, Product.id);
      }
    }
    if(Releases.size > 1000) throw Failure('too-large');
    const Search = Tools.get('search_documents');
    if(Search && (!Compatible(Search, ['team_id', 'query', 'product_id', 'release_id']) || Search.inputSchema.properties.limit?.type !== 'integer')) throw Failure('contract');
    if(!Search) Notices.push('Document search is unavailable; only structured briefs/arcs can be consulted.');
    const Instructions = await fs.readFile(path.join(__dirname, '../data/static/ai/compass-instructions.md'), 'utf8');
    for(let Turn = 0; Turn <= 4; Turn++) {
      const Input = { Question: ArgQuestion, Context: ArgContext, Catalog, Evidence, Notices, CallsRemaining: 4 - Turn,
        Tools: ['get_release_brief', 'get_product_arc', ...(Search ? ['search_documents'] : [])] };
      CheckSize(Instructions + JSON.stringify(Input, null, 2), MaxContextBytes);
      const Decision = await TimedAsync(() => DecideAsync(ArgAI, {
        Name: 'compass', InstructionsFile: 'compass-instructions.md', SchemaFile: 'compass-schema.json',
        ModelName: ArgModel, RequiredFields: ['Action'],
      }, Input, { RequestOptions: { signal: Controller.signal, timeout: 45000, maxRetries: 0 } }), 45000);
      if(Controller.signal.aborted) throw Failure('timeout');
      if(Decision.Action === 'answer') {
        if(typeof Decision.Answer !== 'string' || Decision.Answer.length > 12000 || !Array.isArray(Decision.Citations)) throw Failure('response');
        const Sources = Evidence.flatMap(ArgItem => ArgItem.Sources);
        const Selected = Decision.Citations.map((/** @type {string} */ ArgId) => {
          const Source = Sources.find(ArgSource => ArgSource.Id === ArgId);
          if(!Source) throw Failure('citations');
          return Source;
        });
        if([...Decision.Answer.matchAll(/\[([0-9]+(?:\.[0-9]+)?)\]/g)].some(ArgMatch => !Decision.Citations.includes(ArgMatch[1]))) throw Failure('citations');
        if(Evidence.length && Sources.length && !Selected.length) throw Failure('citations');
        // model text cannot introduce URLs or Slack mentions; links come only from checked evidence.
        const Safe = (/** @type {string} */ ArgText) => ArgText.replace(/https?:\/\/\S+/gi, '[link omitted]').replace(/[<>&]/g, ArgChar => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ArgChar]));
        return Safe(Decision.Answer) + (Selected.length ? '\n\nSources:\n' + [...new Set(Selected)].map(ArgSource => `[${ArgSource.Id}] ${Safe(ArgSource.Title)}${ArgSource.Link ? ` <${ArgSource.Link}|open>` : ''}\n> ${Safe(ArgSource.Excerpt)}`).join('\n') : '\n\n_No retrieved source evidence; please clarify the product or release._')
          + (Notices.length ? '\n\n_' + [...new Set(Notices)].join(' ') + '_' : '');
      }
      if(Turn === 4) throw Failure('tool-limit');
      const ProductId = Decision.ProductId || '';
      const ReleaseId = Decision.ReleaseId || '';
      if((ProductId && !Products.has(ProductId)) || (ReleaseId && !Releases.has(ReleaseId)) || (ProductId && ReleaseId && Releases.get(ReleaseId) !== ProductId)) throw Failure('scope');
      /** @type {any} */ let Args;
      if(Decision.Action === 'search_documents' && Search) {
        if(typeof Decision.Query !== 'string' || Decision.Query.length < 2 || Decision.Query.length > 1000) throw Failure('question');
        Args = { team_id: Mapping.TeamId, query: Decision.Query, limit: 12, ...(ProductId ? { product_id: ProductId } : {}), ...(ReleaseId ? { release_id: ReleaseId } : {}) };
      } else if(Decision.Action === 'get_release_brief' && ReleaseId && Compatible(Tools.get(Decision.Action), ['release_id'])) Args = { release_id: ReleaseId };
      else if(Decision.Action === 'get_product_arc' && ProductId && Compatible(Tools.get(Decision.Action), ['product_id'])) Args = { product_id: ProductId };
      else throw Failure('contract');
      const Result = await CallAsync(Decision.Action, Args);
      CheckSize(Result, 32 * 1024);
      /** @type {any[]} */ let Sources;
      if(Decision.Action === 'search_documents') {
        if(!Array.isArray(Result.passages) || Result.passages.length > 12) throw Failure('response');
        if(Result.documents_still_indexing || Result.documents_not_indexed || Object.entries(Result.index_status || {}).some(([ArgKey, ArgValue]) => ['pending', 'indexing', 'failed', 'blocked'].includes(ArgKey) && Number(ArgValue) > 0)) Notices.push('Some documents are pending, failed or blocked; this evidence is incomplete.');
        Sources = Result.passages.map((/** @type {any} */ ArgPassage, /** @type {number} */ ArgIndex) => {
          if(!Products.has(ArgPassage.product_id) || (ArgPassage.release_id && Releases.get(ArgPassage.release_id) !== ArgPassage.product_id)
            || (ProductId && ProductId !== ArgPassage.product_id) || (ReleaseId && ReleaseId !== ArgPassage.release_id)
            || !Uuid.test(ArgPassage.document_id) || typeof ArgPassage.excerpt !== 'string' || typeof ArgPassage.file_name !== 'string') throw Failure('scope');
          const Expected = `/t/${Mapping.TeamId}/library?doc=${ArgPassage.document_id}`;
          if(ArgPassage.link !== Expected) throw Failure('citations');
          return { Id: `${Turn + 1}.${ArgIndex + 1}`, Title: `${ArgPassage.file_name} (${ArgPassage.release || 'product'}; ${ArgPassage.lines || ''})`, Link: new URL(Expected, Endpoint).href, Excerpt: ArgPassage.excerpt.slice(0, 350), Passage: ArgPassage };
        });
      } else {
        if(!Result[Decision.Action === 'get_release_brief' ? 'brief' : 'arc']) throw Failure('response');
        Sources = [{ Id: `${Turn + 1}.1`, Title: `${Decision.Action} ${ReleaseId || ProductId}`, Link: '', Excerpt: JSON.stringify(Result).slice(0, 350) }];
      }
      Evidence.push({ Tool: Decision.Action, Result, Sources });
    }
    throw Failure('tool-limit');
  } catch(error) {
    if(Controller.signal.aborted) throw Failure('timeout');
    throw Failure(['credentials', 'not-mapped', 'question', 'too-large', 'auth', 'contract', 'response', 'scope', 'citations', 'tool-limit'].includes(error.code) ? error.code : 'unavailable');
  } finally {
    clearTimeout(WorkflowTimer);
    Controller.abort();
    await ClientValue.close().catch(() => {});
  }
}
module.exports = { ParseChannels, GetMapping, AskAsync };
