// Pure-function helpers for the RAG module. No I/O, no global state — safe to
// import from either the CJS query module (src/rag/index.js) or the ESM ingest
// script (src/rag/ingest.mjs). Every function here is designed to be unit-tested
// without mocks, network access, or a filesystem.

const CHUNK_TARGET_CHARS = 4800;  // ~1200 tokens
const CHUNK_OVERLAP_CHARS = 600;  // ~150 tokens
const MAX_CODE_FILE_BYTES = 150 * 1024; // hard stop before one source file bloats the corpus
const MAX_CODE_CHUNKS_PER_FILE = 36;    // keeps large modules from dominating retrieval (raised with the byte guard so a 150KB file isn't blocked here instead)
// Ceiling for adaptive coarsening. gemini-embedding-001 accepts ~2048 input tokens and `embedOne`
// does NOT truncate — it posts the chunk verbatim — so a chunk above roughly this size would be
// rejected or silently degraded by the API. ~1800 tokens leaves headroom for the path header line.
const MAX_CHUNK_TARGET_CHARS = 7200;

// Priority boosts applied during retrieval re-rank. Higher priority wins at
// near-equal distance. See the spike learning in PROJECT/2-WORKING/P1-CODE-RAG.md
// for why strategy/changelog beat regular docs.
const PRIORITY = {
  feature_map: 10,
  strategy: 5,
  changelog_entry: 5,
  doc: 1,
  pr: 1,
  code: 0,
};

const EXCLUDE_PATHS = [
  /^node_modules\//,
  /^\.git\//,
  /^data\//,
  /^tests\//,
  /^src\/rag\//,
  /^scratch\//,
  /^changelog\.md$/,
];

/**
 * Split text into overlapping chunks sized for embedding. Returns the original
 * text as a single-element array if it's already short enough.
 *
 * @param {string} text
 * @param {{targetChars?: number, overlap?: number}} [options]
 * @returns {string[]}
 */
function chunkText(text, { targetChars = CHUNK_TARGET_CHARS, overlap = CHUNK_OVERLAP_CHARS } = {}) {
  if (typeof text !== 'string') throw new TypeError('chunkText: text must be a string');
  if (targetChars <= 0) throw new RangeError('chunkText: targetChars must be > 0');
  if (overlap < 0 || overlap >= targetChars) throw new RangeError('chunkText: overlap must be >= 0 and < targetChars');
  if (text.length === 0) return [];
  if (text.length <= targetChars) return [text];
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + targetChars, text.length);
    chunks.push(text.slice(i, end));
    if (end >= text.length) break;
    i = end - overlap;
  }
  return chunks;
}

/**
 * Split a CHANGELOG.md into one chunk per version entry. Version headers are
 * expected to match `## 1.2.3` at the start of a line. The returned version
 * string is the `1.2.3` capture from the header, or null if the chunk didn't
 * start with a version header (e.g., a preamble paragraph).
 *
 * @param {string} text
 * @returns {Array<{version: string|null, content: string}>}
 */
function chunkChangelog(text) {
  if (typeof text !== 'string') throw new TypeError('chunkChangelog: text must be a string');
  const parts = text.split(/(?=^##\s+\d+\.\d+\.\d+)/m).map((s) => s.trim()).filter(Boolean);
  return parts.map((entry) => {
    const versionMatch = entry.match(/^##\s+(\d+\.\d+\.\d+)/);
    return { version: versionMatch ? versionMatch[1] : null, content: entry };
  });
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function isCanonicalChangelogPath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new TypeError('isCanonicalChangelogPath: relPath must be a non-empty string');
  }
  return relPath === 'CHANGELOG.md';
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function shouldExcludeRepoPath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new TypeError('shouldExcludeRepoPath: relPath must be a non-empty string');
  }
  return EXCLUDE_PATHS.some((re) => re.test(relPath));
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function shouldIncludeDocPath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new TypeError('shouldIncludeDocPath: relPath must be a non-empty string');
  }
  if (shouldExcludeRepoPath(relPath)) return false;
  return isCanonicalChangelogPath(relPath) || /^[^/]+\.md$/.test(relPath) || /^PROJECT\/.+\.md$/.test(relPath);
}

/**
 * @param {string} relPath
 * @returns {boolean}
 */
function shouldIncludeCodePath(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new TypeError('shouldIncludeCodePath: relPath must be a non-empty string');
  }
  if (shouldExcludeRepoPath(relPath)) return false;
  return /^src\/.+\.(js|mjs)$/.test(relPath);
}

/**
 * @param {{byteSize?: number, chunkCount?: number}} metrics
 * @param {{maxFileBytes?: number, maxChunksPerFile?: number}} [options]
 * @returns {string|null}
 */
function getCodeIngestSkipReason(
  metrics,
  { maxFileBytes = MAX_CODE_FILE_BYTES, maxChunksPerFile = MAX_CODE_CHUNKS_PER_FILE } = {}
) {
  if (!metrics || typeof metrics !== 'object') {
    throw new TypeError('getCodeIngestSkipReason: metrics must be an object');
  }
  const { byteSize, chunkCount } = metrics;
  if (byteSize !== undefined) {
    if (!Number.isFinite(byteSize) || byteSize < 0) {
      throw new TypeError('getCodeIngestSkipReason: byteSize must be a finite non-negative number');
    }
    if (byteSize > maxFileBytes) {
      return `size ${byteSize}B exceeds ${maxFileBytes}B guard`;
    }
  }
  if (chunkCount !== undefined) {
    if (!Number.isInteger(chunkCount) || chunkCount < 0) {
      throw new TypeError('getCodeIngestSkipReason: chunkCount must be a non-negative integer');
    }
    if (chunkCount > maxChunksPerFile) {
      return `chunk count ${chunkCount} exceeds ${maxChunksPerFile} guard`;
    }
  }
  return null;
}

/**
 * Chunk `text` so it fits within `maxChunks`, coarsening the chunk size rather than dropping the
 * file.
 *
 * The previous behaviour skipped any source file over a byte guard outright, which meant
 * `src/reminders-module.js` — the reminder FSM, and the single most-asked-about file in the repo —
 * was absent from the index entirely. Ask-self then answered FSM questions from docs and changelog
 * entries, which is exactly the shape of a confident wrong answer.
 *
 * Coarsening preserves the property the chunk cap was protecting (one module cannot flood
 * retrieval) while keeping every line of the file reachable. It is bounded by the embedding model's
 * input limit, so a pathological file can still exceed the budget — in which case it is indexed in
 * full anyway and the caller is told, because silently indexing part of a file is worse than
 * indexing all of it and saying so.
 *
 * @param {string} text
 * @param {number} maxChunks
 * @param {{targetChars?: number, overlap?: number}} [opts]
 * @returns {{chunks: string[], targetChars: number, coarsened: boolean, overBudget: boolean}}
 */
function chunkTextWithinBudget(text, maxChunks, opts = {}) {
  if (!Number.isInteger(maxChunks) || maxChunks < 1) {
    throw new TypeError('chunkTextWithinBudget: maxChunks must be a positive integer');
  }
  const overlap = opts.overlap ?? CHUNK_OVERLAP_CHARS;
  const startTarget = opts.targetChars ?? CHUNK_TARGET_CHARS;
  let targetChars = startTarget;
  let chunks = chunkText(text, { targetChars, overlap });

  while (chunks.length > maxChunks && targetChars < MAX_CHUNK_TARGET_CHARS) {
    // Jump straight to the size that would fit rather than creeping, then clamp. Creeping would
    // re-chunk a 180KB file a dozen times for no benefit.
    const needed = Math.ceil((targetChars * chunks.length) / maxChunks);
    const next = Math.min(MAX_CHUNK_TARGET_CHARS, Math.max(targetChars + 1, needed));
    if (next === targetChars) break;
    targetChars = next;
    chunks = chunkText(text, { targetChars, overlap });
  }

  return {
    chunks,
    targetChars,
    coarsened: targetChars > startTarget,
    overBudget: chunks.length > maxChunks,
  };
}

/**
 * Classify a doc by its repo-relative path. Strategy/PMF/positioning docs and
 * the CHANGELOG get a priority boost so retrieval surfaces them for marketing
 * questions even when semantic distance is close.
 *
 * @param {string} relPath - repo-relative path (forward slashes)
 * @returns {{source: 'changelog'|'strategy'|'doc'|'code', priority: number}}
 */
function classifyDoc(relPath) {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new TypeError('classifyDoc: relPath must be a non-empty string');
  }
  if (isCanonicalChangelogPath(relPath)) {
    return { source: 'changelog', priority: PRIORITY.changelog_entry };
  }
  if (/strategy|product.*brief|moat|pmf|positioning/i.test(relPath)) {
    return { source: 'strategy', priority: PRIORITY.strategy };
  }
  if (/\.(js|mjs|ts|tsx)$/i.test(relPath)) {
    return { source: 'code', priority: PRIORITY.code };
  }
  return { source: 'doc', priority: PRIORITY.doc };
}

/**
 * Format retrieved chunks into a single context string for the synthesis model,
 * budget-capped by total character count. Each chunk gets a source-aware header
 * so the model can cite it correctly. Oldest-first order is preserved.
 *
 * @param {Array<{source: string, path?: string, pr_number?: number|null, version?: string|null, content: string}>} hits
 * @param {number} [maxContextChars=80000]
 * @returns {string}
 */
function formatContext(hits, maxContextChars = 80000) {
  if (!Array.isArray(hits)) throw new TypeError('formatContext: hits must be an array');
  const parts = [];
  let totalChars = 0;
  for (const h of hits) {
    if (!h || typeof h.content !== 'string') continue;
    const header = h.source === 'pr'
      ? `[PR #${h.pr_number}]`
      : h.source === 'changelog'
        ? `[CHANGELOG.md${h.version ? ` — ${h.version}` : ''}]`
        : `[${h.path ?? h.source}]`;
    const block = `=== ${header} ===\n${h.content}\n`;
    if (totalChars + block.length > maxContextChars) break;
    parts.push(block);
    totalChars += block.length;
  }
  return parts.join('\n');
}

module.exports = {
  CHUNK_TARGET_CHARS,
  CHUNK_OVERLAP_CHARS,
  MAX_CHUNK_TARGET_CHARS,
  MAX_CODE_FILE_BYTES,
  MAX_CODE_CHUNKS_PER_FILE,
  chunkTextWithinBudget,
  PRIORITY,
  chunkText,
  chunkChangelog,
  isCanonicalChangelogPath,
  shouldExcludeRepoPath,
  shouldIncludeDocPath,
  shouldIncludeCodePath,
  getCodeIngestSkipReason,
  classifyDoc,
  formatContext,
};
