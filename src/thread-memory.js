'use strict';

// Thread-memory store — powers the `remember above` capture and `recall` fuzzy-search features.
//
// Storage is its own sqlite file, deliberately separate from any bulk-rebuilt index: such an index is
// the wrong home for runtime-captured user memories — they would be wiped on the next ingest and
// leaked into the repo. Thread memories therefore live in their own durable, gitignored file
// (data/rag/thread-memories.sqlite) that ingest never touches. Same embedding stack (Gemini
// gemini-embedding-001) and the same better-sqlite3 + sqlite-vec engine as the RAG module.
//
// Multi-tenant isolation: every read path filters by workspace_id. Memories never cross workspaces.

const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { ExtractGitHubUrls } = require('./github-url-utils');
const { ResolveMentionsForExternalDisplayAsync } = require('./slack-message-pipeline');

const REPO_ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(REPO_ROOT, 'data', 'rag', 'thread-memories.sqlite');

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
const SUMMARY_LENGTH = 500;
const EXPORT_PREVIEW_LENGTH = 200;
const DEFAULT_TOP_N = 5;
const DEFAULT_SIMILARITY_THRESHOLD = 0.65; // cosine similarity; vec0 returns distance = 1 - similarity.
const KNN_CANDIDATE_MULTIPLIER = 20;        // over-fetch before workspace/threshold filtering.
const MIN_KEYWORD_MATCH_LENGTH = 2;         // skip the literal keyword leg for 1-char queries (too broad).
const KEYWORD_MATCH_LIMIT = 50;             // cap literal keyword candidates before the TopN slice.

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
 *   close: () => void,
 *   exec: (sql: string) => void,
 *   prepare: <Result = unknown>(sql: string) => BetterSqlite3Statement<Result>
 * }} BetterSqlite3Database
 */
/**
 * @typedef {{
 *   new (path: string, options?: { readonly?: boolean }): BetterSqlite3Database
 * }} BetterSqlite3Constructor
 */
/**
 * One extracted GitHub reference: the canonical URL plus a short human label.
 * @typedef {{ url: string, ref: string }} GitHubRef
 */
/**
 * A captured thread memory, ready to persist.
 * @typedef {Object} ThreadMemoryRecord
 * @property {string} MemoryId
 * @property {string} WorkspaceId
 * @property {string} WorkspaceName Human-readable workspace slug (e.g. "neochrome"). Used for publisher queries.
 * @property {string} ChannelId
 * @property {string} ChannelName Resolved Slack channel name (empty string when unavailable).
 * @property {string} ThreadTs
 * @property {string} CapturedAt ISO timestamp.
 * @property {string} CapturedBy User ID who triggered the capture.
 * @property {string[]} Participants Unique participant user IDs.
 * @property {GitHubRef[]} GitHubRefs
 * @property {number} MessageCount
 * @property {string} RawText Full thread as "DisplayName (timestamp): message" lines.
 * @property {string} SummaryText First 500 chars of RawText, for previews.
 */
/**
 * A recall search hit (memory metadata plus a similarity score).
 * @typedef {Object} ThreadMemoryHit
 * @property {string} MemoryId
 * @property {string} ChannelId
 * @property {string} ChannelName
 * @property {string} ThreadTs
 * @property {string} CapturedAt
 * @property {string} CapturedBy
 * @property {string[]} Participants
 * @property {GitHubRef[]} GitHubRefs
 * @property {number} MessageCount
 * @property {string} RawText
 * @property {string} SummaryText
 * @property {number} Similarity Cosine similarity in [0, 1]; higher is closer.
 */
/**
 * Optional injection seam — lets tests supply a deterministic embedder instead of calling Gemini.
 * @typedef {(ArgText: string, ArgTaskType: string, ArgApiKey: string) => Promise<Uint8Array>} EmbedFn
 */

/** @type {BetterSqlite3Database|null} */
let _db = null;

/**
 * Lazily open the thread-memory database (read-write) and ensure its schema exists. Native modules
 * are required lazily so a broken install never poisons Sleuth startup for workspaces that never
 * capture a memory. Uses a lazy-singleton pattern, opening read-write
 * against the separate, durable thread-memories file.
 * @returns {BetterSqlite3Database}
 */
function GetThreadMemoryDb() {
  if(_db) return _db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const Database = /** @type {BetterSqlite3Constructor} */ (require('better-sqlite3'));
  const SqliteVec = require('sqlite-vec');
  const Db = new Database(DB_PATH);
  SqliteVec.load(Db);
  EnsureThreadMemorySchema(Db);
  _db = Db;
  return _db;
}

/**
 * Create the thread-memory tables if they do not already exist. Idempotent.
 * @param {BetterSqlite3Database} ArgDb
 * @returns {void}
 */
function EnsureThreadMemorySchema(ArgDb) {
  ArgDb.exec(`
    CREATE TABLE IF NOT EXISTS thread_memories (
      memory_id      TEXT PRIMARY KEY,
      workspace_id   TEXT NOT NULL,
      workspace_name TEXT NOT NULL DEFAULT '',
      channel_id     TEXT NOT NULL,
      channel_name   TEXT NOT NULL DEFAULT '',
      thread_ts      TEXT NOT NULL,
      captured_at    TEXT NOT NULL,
      captured_by    TEXT NOT NULL,
      participants   TEXT NOT NULL,
      github_refs    TEXT NOT NULL,
      message_count  INTEGER NOT NULL,
      raw_text       TEXT NOT NULL,
      summary_text   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tm_workspace      ON thread_memories(workspace_id);
    CREATE INDEX IF NOT EXISTS idx_tm_workspace_name ON thread_memories(workspace_name);
    CREATE INDEX IF NOT EXISTS idx_tm_thread         ON thread_memories(workspace_id, thread_ts);
  `);
  // Migration: add columns that didn't exist in earlier schema versions.
  // ALTER TABLE ADD COLUMN throws if the column already exists — that's expected on fresh DBs.
  for(const ColDef of [
    "workspace_name TEXT NOT NULL DEFAULT ''",
    "channel_name   TEXT NOT NULL DEFAULT ''",
  ]) {
    try { ArgDb.exec(`ALTER TABLE thread_memories ADD COLUMN ${ColDef}`); } catch { /* already present */ }
  }
  // vec0 virtual table — same engine as the RAG embedding table, keyed by the TEXT memory_id and
  // using cosine distance so the recall similarity threshold is meaningful.
  ArgDb.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS thread_memory_embeddings USING vec0(` +
    `memory_id TEXT PRIMARY KEY, embedding float[${EMBED_DIM}] distance_metric=cosine)`
  );
}

/**
 * Embed text with Gemini gemini-embedding-001. Embedding dimensions must stay consistent so
 * features share one model and dimensionality.
 * @param {string} ArgText Text to embed.
 * @param {string} [ArgTaskType] Gemini task type (RETRIEVAL_DOCUMENT for capture, RETRIEVAL_QUERY for search).
 * @param {string} [ArgApiKey] Google API key; defaults to process.env.GOOGLE_API_KEY.
 * @returns {Promise<Uint8Array>}
 */
async function EmbedTextAsync(ArgText, ArgTaskType = 'RETRIEVAL_DOCUMENT', ArgApiKey = process.env.GOOGLE_API_KEY) {
  if(!ArgApiKey) throw new Error('GOOGLE_API_KEY not set');
  const Endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${ArgApiKey}`;
  const Response = await fetch(Endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBED_MODEL}`,
      content: { parts: [{ text: ArgText }] },
      taskType: ArgTaskType,
      outputDimensionality: EMBED_DIM,
    }),
  });
  if(!Response.ok) throw new Error(`Gemini embed ${Response.status}: ${(await Response.text()).slice(0, 300)}`);
  const Data = await Response.json();
  const Values = Data?.embedding?.values;
  if(!Array.isArray(Values) || Values.length !== EMBED_DIM)
    throw new Error(`Gemini embed: unexpected shape, got ${Values?.length} dims`);
  return new Uint8Array(new Float32Array(Values).buffer);
}

/**
 * Extract GitHub issue/PR references from text. Reuses the canonical URL extractor and derives a
 * short label per URL: pull requests render as `PR #47`, issues as `#52`.
 * @param {string} ArgText
 * @returns {GitHubRef[]}
 */
function ExtractGitHubRefs(ArgText) {
  return ExtractGitHubUrls(ArgText).map(ArgUrl => {
    const Match = ArgUrl.match(/\/(issues|pull)\/(\d+)/i);
    const IsPull = !!Match && Match[1].toLowerCase() === 'pull';
    const Number = Match ? Match[2] : null;
    const Ref = Number ? (IsPull ? `PR #${Number}` : `#${Number}`) : ArgUrl;
    return { url: ArgUrl, ref: Ref };
  });
}

/**
 * Convert a Slack message timestamp (e.g. "1719000000.000100") to an ISO string. Falls back to the
 * raw value when it is not a parseable Slack ts.
 * @param {string} ArgTs
 * @returns {string}
 */
function SlackTsToIso(ArgTs) {
  const Seconds = Number.parseFloat(ArgTs);
  if(!Number.isFinite(Seconds)) return String(ArgTs ?? '');
  return new Date(Seconds * 1000).toISOString();
}

/**
 * Fetch a Slack thread and assemble it into a ThreadMemoryRecord (without persisting). Resolves
 * author display names, resolves inline `<@U...>` mentions within each message body to display
 * names too (GH-428 — this transcript can end up in a GitHub issue body, which won't resolve raw
 * mention tokens the way Slack's own client does), collects participant IDs, and extracts GitHub
 * references across all messages.
 * @param {import('./slack-app')} ArgSlackApp
 * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Must be inside a thread (thread_ts set).
 * @param {{ excludeMessageTs?: string }} [ArgOptions] When set, omit that message ts from the capture.
 * @returns {Promise<ThreadMemoryRecord>}
 */
async function CaptureThreadAsync(ArgSlackApp, ArgEventInfo, ArgOptions = {}) {
  const ThreadTs = ArgEventInfo.thread_ts || ArgEventInfo.ts;
  const AllMessages = /** @type {any[]} */ (
    await ArgSlackApp.GetConversationMessagesAsync(ArgEventInfo.channel, ThreadTs)
  );
  const Messages = ArgOptions.excludeMessageTs
    ? AllMessages.filter(ArgMessage => ArgMessage?.ts !== ArgOptions.excludeMessageTs)
    : AllMessages;

  /** @type {Map<string, string>} */
  const DisplayNameCache = new Map();
  /** @type {string[]} */
  const Participants = [];
  /** @type {string[]} */
  const Lines = [];

  for(const Message of Messages) {
    const UserId = Message?.user || null;
    let DisplayName = 'Unknown';
    if(UserId) {
      if(!Participants.includes(UserId)) Participants.push(UserId);
      if(DisplayNameCache.has(UserId)) {
        DisplayName = /** @type {string} */ (DisplayNameCache.get(UserId));
      } else {
        DisplayName = (await ArgSlackApp.GetUserDisplayNameAsync(UserId)) || UserId;
        DisplayNameCache.set(UserId, DisplayName);
      }
    }
    const RawText = typeof Message?.text === 'string' ? Message.text : '';
    // GH-428: the sender's own DisplayName above only fixes "who said this" — a message that
    // @-mentions someone else still carries a raw `<@U...>` token that Slack's client would resolve
    // but this transcript (destined for a GitHub issue body) will not, so resolve it here too.
    // GH-429: pass the loop's own DisplayNameCache through so a user mentioned in several messages
    // is resolved once per capture, not once per message — same cache already used just above for
    // each message's sender, since both are the same "user id → display name" lookup.
    const Text = await ResolveMentionsForExternalDisplayAsync(ArgSlackApp, RawText, DisplayNameCache);
    Lines.push(`${DisplayName} (${SlackTsToIso(Message?.ts)}): ${Text}`);
  }

  const RawText = Lines.join('\n');
  const GitHubRefs = ExtractGitHubRefs(Messages.map(ArgMessage => ArgMessage?.text || '').join('\n'));
  const ChannelName = (await ArgSlackApp.GetChannelNameAsync(ArgEventInfo.channel)) || '';

  return {
    MemoryId: crypto.randomUUID(),
    WorkspaceId: ArgSlackApp.TeamId || 'unknown',
    WorkspaceName: ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME || '',
    ChannelId: ArgEventInfo.channel,
    ChannelName,
    ThreadTs,
    CapturedAt: new Date().toISOString(),
    CapturedBy: ArgEventInfo.user,
    Participants,
    GitHubRefs,
    MessageCount: Messages.length,
    RawText,
    SummaryText: RawText.slice(0, SUMMARY_LENGTH),
  };
}

/**
 * Persist a captured memory and (when an API key/embedder is available) its embedding. When no key
 * is configured the row is still stored so nothing is lost — it is simply not yet searchable. Safe
 * to call repeatedly for the same memory_id (delete-then-insert on the vec row).
 * @param {BetterSqlite3Database} ArgDb
 * @param {ThreadMemoryRecord} ArgRecord
 * @param {string} [ArgApiKey] Google API key; defaults to process.env.GOOGLE_API_KEY.
 * @param {{ EmbedAsync?: EmbedFn }} [ArgOptions] Test seam for a deterministic embedder.
 * @returns {Promise<{ Embedded: boolean }>}
 */
async function SaveThreadMemoryAsync(ArgDb, ArgRecord, ArgApiKey = process.env.GOOGLE_API_KEY, ArgOptions = {}) {
  ArgDb.prepare(
    `INSERT OR REPLACE INTO thread_memories
       (memory_id, workspace_id, workspace_name, channel_id, channel_name, thread_ts,
        captured_at, captured_by, participants, github_refs, message_count, raw_text, summary_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ArgRecord.MemoryId,
    ArgRecord.WorkspaceId,
    ArgRecord.WorkspaceName || '',
    ArgRecord.ChannelId,
    ArgRecord.ChannelName || '',
    ArgRecord.ThreadTs,
    ArgRecord.CapturedAt,
    ArgRecord.CapturedBy,
    JSON.stringify(ArgRecord.Participants),
    JSON.stringify(ArgRecord.GitHubRefs),
    ArgRecord.MessageCount,
    ArgRecord.RawText,
    ArgRecord.SummaryText
  );

  const Embed = ArgOptions.EmbedAsync || EmbedTextAsync;
  // embed only when we can — capture must succeed without GOOGLE_API_KEY (search degrades gracefully).
  if(!ArgApiKey && !ArgOptions.EmbedAsync) return { Embedded: false };

  const Vector = await Embed(ArgRecord.RawText, 'RETRIEVAL_DOCUMENT', ArgApiKey || '');
  ArgDb.prepare('DELETE FROM thread_memory_embeddings WHERE memory_id = ?').run(ArgRecord.MemoryId);
  ArgDb.prepare('INSERT INTO thread_memory_embeddings(memory_id, embedding) VALUES (?, ?)')
    .run(ArgRecord.MemoryId, Vector);
  return { Embedded: true };
}

/**
 * Map a thread_memories row to a hit object (parsing JSON columns).
 * @param {any} ArgRow
 * @param {number} ArgSimilarity
 * @returns {ThreadMemoryHit}
 */
function RowToHit(ArgRow, ArgSimilarity) {
  return {
    MemoryId: ArgRow.memory_id,
    ChannelId: ArgRow.channel_id,
    ChannelName: ArgRow.channel_name || '',
    ThreadTs: ArgRow.thread_ts,
    CapturedAt: ArgRow.captured_at,
    CapturedBy: ArgRow.captured_by,
    Participants: SafeJsonArray(ArgRow.participants),
    GitHubRefs: SafeJsonArray(ArgRow.github_refs),
    MessageCount: ArgRow.message_count,
    RawText: ArgRow.raw_text,
    SummaryText: ArgRow.summary_text,
    Similarity: ArgSimilarity,
  };
}

/**
 * Parse a JSON-array column, returning [] on any malformed value.
 * @param {unknown} ArgValue
 * @returns {any[]}
 */
function SafeJsonArray(ArgValue) {
  if(typeof ArgValue !== 'string') return [];
  try {
    const Parsed = JSON.parse(ArgValue);
    return Array.isArray(Parsed) ? Parsed : [];
  } catch {
    return [];
  }
}

/**
 * Hybrid search over a workspace's thread memories, combining two legs:
 *   1. Semantic — embed the query and run a cosine k-NN over the embeddings, keeping hits at/above
 *      the similarity threshold.
 *   2. Channel keyword — a case-insensitive literal substring match against the CHANNEL NAME. The
 *      channel a thread was captured in is the strongest topical signal for short entity queries:
 *      "Client B" should surface every thread in #client-a-client-b — including ones whose message text
 *      never spells the entity out — while NOT dragging in a #…-devops thread that merely name-drops
 *      an "ClientB-Analytics" repo in passing. This also makes recall reliably case-insensitive, since
 *      such entity embeddings straddle the 0.65 cutoff (a single character of case flips whether they
 *      pass). Matching message text instead would invert both: miss the in-channel thread and admit
 *      the tangential one. Channel matches rank ahead of semantic-only hits, then by similarity.
 *
 * Workspace isolation: both legs filter by workspace_id, so a search in one workspace can never
 * surface another workspace's memories.
 * @param {BetterSqlite3Database} ArgDb
 * @param {string} ArgWorkspaceId
 * @param {string} ArgQuery
 * @param {string} [ArgApiKey] Google API key; defaults to process.env.GOOGLE_API_KEY.
 * @param {{ TopN?: number, Threshold?: number, EmbedAsync?: EmbedFn }} [ArgOptions]
 * @returns {Promise<ThreadMemoryHit[]>}
 */
async function SearchThreadMemoriesAsync(ArgDb, ArgWorkspaceId, ArgQuery, ArgApiKey = process.env.GOOGLE_API_KEY, ArgOptions = {}) {
  const TopN = ArgOptions.TopN ?? DEFAULT_TOP_N;
  const Threshold = ArgOptions.Threshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const Embed = ArgOptions.EmbedAsync || EmbedTextAsync;

  // Semantic leg: embed the query and pull the nearest candidates by cosine distance. Over-fetch
  // because the global k-NN is filtered down by workspace + threshold afterward.
  const QueryVector = await Embed(ArgQuery, 'RETRIEVAL_QUERY', ArgApiKey || '');
  const CandidateCount = Math.max(TopN * KNN_CANDIDATE_MULTIPLIER, TopN);
  const Candidates = /** @type {{ memory_id: string, distance: number }[]} */ (
    ArgDb.prepare(
      'SELECT memory_id, distance FROM thread_memory_embeddings WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
    ).all(QueryVector, CandidateCount)
  );

  /** @type {Map<string, number>} */
  const SimilarityById = new Map();
  for(const Candidate of Candidates)
    SimilarityById.set(Candidate.memory_id, 1 - Candidate.distance);

  // Channel keyword leg: instr() is a literal substring search, so query wildcards (% _) are matched
  // literally rather than treated as LIKE patterns. lower() on both sides makes it case-insensitive.
  // Strip a leading '#' so a Slack-style "#client-a-client-b" query still matches the stored channel
  // name (which omits the '#'), rather than missing it on the extra leading character.
  const KeywordQuery = (ArgQuery || '').trim().replace(/^#/, '');
  /** @type {Set<string>} */
  const ChannelMatchIds = new Set();
  if(KeywordQuery.length >= MIN_KEYWORD_MATCH_LENGTH) {
    const ChannelRows = /** @type {{ memory_id: string }[]} */ (
      ArgDb.prepare(
        `SELECT memory_id FROM thread_memories
          WHERE workspace_id = ? AND instr(lower(channel_name), lower(?)) > 0
          LIMIT ?`
      ).all(ArgWorkspaceId, KeywordQuery, KEYWORD_MATCH_LIMIT)
    );
    for(const Row of ChannelRows) ChannelMatchIds.add(Row.memory_id);
  }

  const Ids = [...new Set([...SimilarityById.keys(), ...ChannelMatchIds])];
  if(Ids.length === 0) return [];

  const Placeholders = Ids.map(() => '?').join(',');
  const Rows = /** @type {any[]} */ (
    ArgDb.prepare(
      `SELECT memory_id, channel_id, channel_name, thread_ts, captured_at, captured_by, participants,
              github_refs, message_count, raw_text, summary_text
         FROM thread_memories
        WHERE workspace_id = ? AND memory_id IN (${Placeholders})`
    ).all(ArgWorkspaceId, ...Ids)
  );

  return Rows
    .map(ArgRow => ({
      Hit: RowToHit(ArgRow, SimilarityById.get(ArgRow.memory_id) ?? 0),
      IsChannelMatch: ChannelMatchIds.has(ArgRow.memory_id),
    }))
    .filter(ArgEntry => ArgEntry.IsChannelMatch || ArgEntry.Hit.Similarity >= Threshold)
    // channel-name matches first (strongest topical signal), then by semantic similarity.
    .sort((ArgA, ArgB) =>
      ArgA.IsChannelMatch === ArgB.IsChannelMatch
        ? ArgB.Hit.Similarity - ArgA.Hit.Similarity
        : (ArgB.IsChannelMatch ? 1 : 0) - (ArgA.IsChannelMatch ? 1 : 0))
    .slice(0, TopN)
    .map(ArgEntry => ArgEntry.Hit);
}

/**
 * Run a production-safe end-to-end probe of the thread-memory Gemini pipeline. Uses an in-memory
 * sqlite store so the diagnostic proves `remember above` / `recall` plumbing without mutating the
 * durable thread-memory database.
 *
 * @param {string} ArgWorkspaceId
 * @param {string} [ArgApiKey]
 * @returns {Promise<{ ok: boolean, error?: string, similarity?: number }>}
 */
async function TestThreadMemoryPipelineAsync(ArgWorkspaceId, ArgApiKey = process.env.GOOGLE_API_KEY) {
  if(!ArgApiKey) return { ok: false, error: 'GOOGLE_API_KEY not set' };

  const Database = /** @type {BetterSqlite3Constructor} */ (require('better-sqlite3'));
  const SqliteVec = require('sqlite-vec');
  /** @type {BetterSqlite3Database|null} */
  let Db = null;

  try {
    Db = new Database(':memory:');
    SqliteVec.load(Db);
    EnsureThreadMemorySchema(Db);

    const ProbeText = 'Sleuth thread memory diagnostics probe for Gemini embeddings and recall.';
    /** @type {ThreadMemoryRecord} */
    const Record = {
      MemoryId: 'diag-memory-1',
      WorkspaceId: ArgWorkspaceId || 'diagnostics-workspace',
      WorkspaceName: 'diagnostics-workspace',
      ChannelId: 'C_DIAGNOSTICS',
      ChannelName: 'diagnostics-channel',
      ThreadTs: 'diag-thread-1',
      CapturedAt: new Date().toISOString(),
      CapturedBy: 'U_DIAGNOSTICS',
      Participants: ['U_DIAGNOSTICS'],
      GitHubRefs: [],
      MessageCount: 1,
      RawText: ProbeText,
      SummaryText: ProbeText,
    };

    const SaveResult = await SaveThreadMemoryAsync(Db, Record, ArgApiKey);
    if(!SaveResult.Embedded)
      throw new Error('synthetic capture saved without an embedding');

    const Hits = await SearchThreadMemoriesAsync(Db, Record.WorkspaceId, ProbeText, ArgApiKey, {
      TopN: 1,
      Threshold: 0,
    });
    const TopHit = Hits[0];
    if(!TopHit || TopHit.MemoryId !== Record.MemoryId)
      throw new Error('synthetic memory did not round-trip through recall');

    return { ok: true, similarity: TopHit.Similarity };
  } catch(error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    Db?.close();
  }
}

/**
 * Rule-based lookup: memories in this workspace that reference any of the given GitHub URLs. Exact
 * URL match, no embedding required. Used by connection-surfacing at reminder-creation time.
 * @param {BetterSqlite3Database} ArgDb
 * @param {string} ArgWorkspaceId
 * @param {string[]} ArgGitHubUrls
 * @returns {ThreadMemoryHit[]}
 */
function FindRelatedMemories(ArgDb, ArgWorkspaceId, ArgGitHubUrls) {
  if(!Array.isArray(ArgGitHubUrls) || ArgGitHubUrls.length === 0) return [];
  const UrlSet = new Set(ArgGitHubUrls);
  const Rows = /** @type {any[]} */ (
    ArgDb.prepare(
      `SELECT memory_id, channel_id, channel_name, thread_ts, captured_at, captured_by, participants,
              github_refs, message_count, raw_text, summary_text
         FROM thread_memories WHERE workspace_id = ? AND github_refs != '[]'`
    ).all(ArgWorkspaceId)
  );
  /** @type {ThreadMemoryHit[]} */
  const Matches = [];
  for(const Row of Rows) {
    const Refs = /** @type {GitHubRef[]} */ (SafeJsonArray(Row.github_refs));
    if(Refs.some(ArgRef => UrlSet.has(ArgRef.url))) Matches.push(RowToHit(Row, 1));
  }
  return Matches;
}

/**
 * Idempotency guard: whether this workspace has already remembered the given thread.
 * @param {BetterSqlite3Database} ArgDb
 * @param {string} ArgWorkspaceId
 * @param {string} ArgThreadTs
 * @returns {boolean}
 */
function ThreadAlreadyRemembered(ArgDb, ArgWorkspaceId, ArgThreadTs) {
  const Row = ArgDb.prepare(
    'SELECT 1 AS hit FROM thread_memories WHERE workspace_id = ? AND thread_ts = ? LIMIT 1'
  ).get(ArgWorkspaceId, ArgThreadTs);
  return !!Row;
}

/**
 * @typedef {{
 *   memoryId: string,
 *   channelId: string,
 *   channelName: string,
 *   capturedAt: string,
 *   capturedBy: string,
 *   participantIds: string[],
 *   messageCount: number,
 *   preview: string,
 *   githubRefs: string[],
 *   threadUrl: string,
 * }} MemoryExportRecord
 */

/**
 * List all memories for a workspace in the export shape (no embeddings, no raw text). Intended
 * for the reminders-export publisher, which queries by workspace_name (the human slug, e.g.
 * "neochrome") rather than the Slack team ID — the publisher knows only the name.
 *
 * Opens a fresh read-only connection to the DB file so the publisher can call this without
 * interfering with the main process's read-write singleton. Returns [] when the DB file does not
 * exist yet (no memories captured) or when the table is missing (pre-migration DB that hasn't
 * been started yet).
 *
 * threadUrl is built as `https://{workspaceName}.slack.com/archives/{channelId}/p{tsNumeric}` when
 * workspace_name is available; falls back to the domain-less `/archives/…` form otherwise.
 *
 * @param {string} ArgWorkspaceName Workspace slug (value of `WORKSPACE_NAME` in workspace config).
 * @param {string} [ArgDbPath] Path to the thread-memory SQLite file; defaults to the production path.
 * @returns {MemoryExportRecord[]}
 */
function ListThreadMemoriesForExport(ArgWorkspaceName, ArgDbPath = DB_PATH) {
  if(!fs.existsSync(ArgDbPath)) return [];

  const Database = /** @type {BetterSqlite3Constructor} */ (require('better-sqlite3'));
  const SqliteVec = require('sqlite-vec');
  const Db = new Database(ArgDbPath, { readonly: true });
  SqliteVec.load(Db);

  try {
    const Rows = /** @type {any[]} */ (
      Db.prepare(
        `SELECT memory_id, channel_id, channel_name, thread_ts, captured_at, captured_by,
                workspace_name, participants, github_refs, message_count, summary_text
           FROM thread_memories WHERE workspace_name = ? ORDER BY captured_at DESC`
      ).all(ArgWorkspaceName)
    );
    return Rows.map(ArgRow => {
      const TsNumeric = String(ArgRow.thread_ts).replace('.', '');
      const WsSlug = ArgRow.workspace_name || '';
      const ThreadUrl = WsSlug
        ? `https://${WsSlug}.slack.com/archives/${ArgRow.channel_id}/p${TsNumeric}`
        : `https://slack.com/archives/${ArgRow.channel_id}/p${TsNumeric}`;
      return {
        memoryId: ArgRow.memory_id,
        channelId: ArgRow.channel_id,
        channelName: ArgRow.channel_name || '',
        capturedAt: ArgRow.captured_at,
        capturedBy: ArgRow.captured_by,
        participantIds: SafeJsonArray(ArgRow.participants),
        messageCount: ArgRow.message_count,
        preview: String(ArgRow.summary_text || '').slice(0, EXPORT_PREVIEW_LENGTH),
        githubRefs: SafeJsonArray(ArgRow.github_refs).map(ArgRef => ArgRef.url).filter(Boolean),
        threadUrl: ThreadUrl,
      };
    });
  } catch {
    // table doesn't exist on a DB that pre-dates this schema version.
    return [];
  } finally {
    Db.close();
  }
}

/**
 * Inject a database for testing (e.g. an in-memory better-sqlite3 instance). Pass null to reset.
 * @param {BetterSqlite3Database|null} ArgDb
 * @returns {void}
 */
function _setDbForTesting(ArgDb) {
  _db = ArgDb;
}

module.exports = {
  GetThreadMemoryDb,
  EnsureThreadMemorySchema,
  EmbedTextAsync,
  ExtractGitHubRefs,
  CaptureThreadAsync,
  SaveThreadMemoryAsync,
  SearchThreadMemoriesAsync,
  TestThreadMemoryPipelineAsync,
  FindRelatedMemories,
  ThreadAlreadyRemembered,
  ListThreadMemoriesForExport,
  _setDbForTesting,
  DEFAULT_SIMILARITY_THRESHOLD,
};
