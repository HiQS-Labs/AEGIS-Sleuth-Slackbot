// Sleuth Code RAG — query module.
// Exports askSelf(query, teamId) used by chat-module for the `ask-self` command.
// Tenancy gate is layer 2 (module-level) per PROJECT/2-WORKING/P1-CODE-RAG.md.

const path = require('node:path');
const fs = require('node:fs');
const { formatContext } = require('./helpers.js');

const MODULE_DIR = __dirname;
const REPO_ROOT = path.join(MODULE_DIR, '..', '..');
const DB_PATH = path.join(REPO_ROOT, 'data', 'rag', 'sleuth-rag.sqlite');
const PROMPTS_PATH = path.join(MODULE_DIR, 'prompts.json');

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
const SYNTHESIS_MODEL = 'gemini-pro-latest'; // rolling alias — always newest Gemini Pro
const TOP_K = 20;                 // retrieve generously, trust Gemini to sort
const PRIORITY_BOOST = 0.02;      // small nudge — doesn't override clear semantic wins
const MAX_CONTEXT_CHARS = 80000;  // ~20k tokens — spike showed 18k works well

/**
 * @typedef {{
 *   all: (...params: unknown[]) => Result[],
 *   get: (...params: unknown[]) => Result|undefined,
 *   run: (...params: unknown[]) => { changes: number, lastInsertRowid: number|bigint }
 * }} BetterSqlite3Statement
 * @template Result
 */
/**
 * @typedef {{
 *   loadExtension: (path: string) => void,
 *   prepare: <Result = unknown>(sql: string) => BetterSqlite3Statement<Result>
 * }} BetterSqlite3Database
 */
/**
 * @typedef {{
 *   new (path: string, options?: { readonly?: boolean }): BetterSqlite3Database
 * }} BetterSqlite3Constructor
 */
/**
 * @typedef {{
 *   orchestrator_system: string
 * }} RagPrompts
 */
/**
 * @typedef {{
 *   rowid: number,
 *   distance: number
 * }} KnnHit
 */
/**
 * @typedef {{
 *   id: number,
 *   source: string,
 *   path?: string|null,
 *   pr_number?: number|null,
 *   version?: string|null,
 *   priority?: number|null,
 *   content: string
 * }} ChunkRow
 */
/**
 * @typedef {ChunkRow & {
 *   distance: number,
 *   score: number
 * }} RankedHit
 */
/**
 * @typedef {{
 *   query: string,
 *   hits: RankedHit[],
 *   context: string,
 *   answer: string|null,
 *   sources: string[]
 * }} RagQueryResult
 */

class TenancyError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'TenancyError';
  }
}

// Lazy-loaded singletons so a missing env var at boot doesn't kill the process.
// They throw on first askSelf() call instead, which chat-module catches silently.
/** @type {BetterSqlite3Database|null} */
let _db = null;
/** @type {RagPrompts|null} */
let _prompts = null;

/**
 * @returns {BetterSqlite3Database}
 */
function getDb() {
  if (_db) return _db;
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`RAG index missing at ${DB_PATH}. Run: npm run rag:ingest`);
  }
  // Lazy-require native modules so a broken install doesn't poison Sleuth startup
  // for workspaces that never touch ask-self.
  const Database = /** @type {BetterSqlite3Constructor} */ (require('better-sqlite3'));
  const sqliteVec = require('sqlite-vec');
  _db = new Database(DB_PATH, { readonly: true });
  sqliteVec.load(_db);
  return _db;
}

/**
 * @returns {RagPrompts}
 */
function getPrompts() {
  if (_prompts) return _prompts;
  _prompts = /** @type {RagPrompts} */ (JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf8')));
  return _prompts;
}

/**
 * @param {string} teamId
 * @returns {void}
 */
function assertTenancy(teamId) {
  const allowed = process.env.NEOCHROME_TEAM_ID;
  if (typeof allowed !== 'string' || allowed.length === 0) {
    throw new TenancyError('NEOCHROME_TEAM_ID not configured');
  }
  if (typeof teamId !== 'string' || teamId.length === 0) {
    throw new TenancyError('teamId argument required');
  }
  if (teamId !== allowed) {
    throw new TenancyError('teamId does not match allowlist');
  }
}

/**
 * @param {string} query
 * @returns {Promise<Uint8Array>}
 */
async function embedQuery(query) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: query }] },
      taskType: 'RETRIEVAL_QUERY',
      outputDimensionality: EMBED_DIM,
    }),
  });
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIM) {
    throw new Error(`Gemini embed: unexpected shape, got ${values?.length} dims`);
  }
  return new Uint8Array(new Float32Array(values).buffer);
}

/**
 * @param {BetterSqlite3Database} db
 * @param {Uint8Array} queryVec
 * @param {number} [k]
 * @returns {RankedHit[]}
 */
function knnSearch(db, queryVec, k = TOP_K) {
  const hits = /** @type {KnnHit[]} */ (db.prepare(
    'SELECT rowid, distance FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
  ).all(queryVec, k));
  if (hits.length === 0) return [];
  const ids = hits.map((h) => Number(h.rowid));
  const placeholders = ids.map(() => '?').join(',');
  const rows = /** @type {ChunkRow[]} */ (db.prepare(
    `SELECT id, source, path, pr_number, version, priority, content FROM chunks WHERE id IN (${placeholders})`
  ).all(...ids));
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  // Re-rank with priority boost: lower score is better.
  // Drop hits whose metadata row is missing (e.g., partial/corrupt index) rather
  // than spreading undefined into the result and throwing. Missing rows are logged
  // once so an operator notices the drift instead of debugging silent gaps.
  /** @type {number[]} */
  const dropped = [];
  /** @type {RankedHit[]} */
  const ranked = [];
  for (const h of hits) {
    const row = byId.get(Number(h.rowid));
    if (!row) {
      dropped.push(h.rowid);
      continue;
    }
    const score = h.distance - (row.priority ?? 1) * PRIORITY_BOOST;
    ranked.push({ ...row, distance: h.distance, score });
  }
  if (dropped.length > 0) {
    console.warn(`[rag] knnSearch: dropped ${dropped.length} hit(s) with missing metadata rows (rowids: ${dropped.join(', ')}). Rebuild the index with: npm run rag:ingest`);
  }
  return ranked.sort((a, b) => a.score - b.score);
}

/**
 * @param {string} query
 * @param {string} context
 * @param {string} systemPrompt
 * @returns {Promise<string>}
 */
async function synthesize(query, context, systemPrompt) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${SYNTHESIS_MODEL}:generateContent?key=${apiKey}`;
  const userMessage = `CONTEXT (retrieved from Sleuth's own corpus):\n\n${context}\n\n---\n\nQUESTION: ${query}`;
  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2500 },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini synthesis ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini synthesis: empty response');
  return text;
}

/**
 * Read the most recent N version entries from CHANGELOG.md for live injection into synthesis.
 * Keeps context current without waiting for a full rag:ingest cycle.
 * @param {number} [maxEntries=50]
 * @returns {string}
 */
function readRecentChangelog(maxEntries = 50) {
  try {
    const raw = fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
    const entries = raw.split(/\n(?=## )/).filter(e => /^## \d+\.\d+/.test(e));
    return entries.slice(0, maxEntries).join('\n').trim();
  } catch {
    return '';
  }
}

/**
 * Answer a question about Sleuth itself, grounded in the local RAG index.
 * Strictly gated to the Neochrome workspace via NEOCHROME_TEAM_ID.
 *
 * @param {string} query - The question from the user.
 * @param {string} teamId - The Slack team ID of the workspace the question came from.
 * @returns {Promise<string>} - Formatted answer text to post back in Slack.
 * @throws {TenancyError} - If teamId does not match NEOCHROME_TEAM_ID.
 */
async function askSelf(query, teamId) {
  assertTenancy(teamId);
  const result = await queryRagAsync(query, { includeAnswer: true, topK: TOP_K });
  if (result.hits.length === 0 || !result.answer) {
    return "I couldn't find anything in my index for that question. Try `npm run rag:ingest` or rephrase.";
  }
  return `${result.answer}\n\n_Sources consulted: ${result.sources.join(', ')}_`;
}

/**
 * Query the local Sleuth RAG index directly without the Slack/tenancy wrapper.
 * Intended for local operator and VS Code agent workflows.
 *
 * @param {string} query
 * @param {{includeAnswer?: boolean, topK?: number, maxContextChars?: number}} [options]
 * @returns {Promise<RagQueryResult>}
 */
async function queryRagAsync(query, options = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('query must be a non-empty string');
  }
  const normalizedQuery = query.trim();
  const requestedTopK = options.topK;
  const topK = Number.isInteger(requestedTopK) && requestedTopK > 0 ? requestedTopK : TOP_K;
  const requestedMaxContextChars = options.maxContextChars;
  const maxContextChars = Number.isInteger(requestedMaxContextChars) && requestedMaxContextChars > 0
    ? requestedMaxContextChars
    : MAX_CONTEXT_CHARS;

  const db = getDb();
  const queryVec = await embedQuery(normalizedQuery);
  const hits = knnSearch(db, queryVec, topK);
  const context = hits.length > 0 ? formatContext(hits, maxContextChars) : '';
  const sources = [...new Set(hits.slice(0, 8).map((h) =>
    h.source === 'pr' ? `PR #${h.pr_number}` : h.path || h.source
  ))];

  const changelogSection = readRecentChangelog(50);
  const synthesisContext = changelogSection
    ? `${context}\n\n=== [CHANGELOG.md — live, most recent 50 entries] ===\n${changelogSection}`
    : context;

  /** @type {string|null} */
  let answer = null;
  if (options.includeAnswer === true && hits.length > 0) {
    const prompts = getPrompts();
    answer = await synthesize(normalizedQuery, synthesisContext, prompts.orchestrator_system);
  }

  return {
    query: normalizedQuery,
    hits,
    context,
    answer,
    sources
  };
}

/**
 * Reset lazy-loaded singletons for testing. Allows tests to inject a fixture DB
 * and/or custom prompts without touching the filesystem or Gemini API.
 * @param {{db?: BetterSqlite3Database|null, prompts?: RagPrompts|null}} [overrides]
 */
function _resetForTesting(overrides = {}) {
  _db = overrides.db ?? null;
  _prompts = overrides.prompts ?? null;
}

module.exports = { askSelf, queryRagAsync, TenancyError, _resetForTesting };
