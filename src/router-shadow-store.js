'use strict';

const { createDecisionCorpusStore, CorpusFilePath } = require('./decision-corpus-store');

/**
 * NON-authoritative, append-only JSONL corpus for router-shadow records (GH-397).
 *
 * GH-44: the implementation moved to `decision-corpus-store.js`, which is the same store with the
 * stream name parameterized — the only thing here that was ever routing-specific was the `.jsonl`
 * filename suffix. This module is now a back-compat facade pinned to `stream: 'router-shadow'`, so
 * the on-disk filename (`<workspace>_router-shadow.jsonl`), the exported `ShadowFilePath` signature,
 * and every behavior `tests/router-shadow.test.js` asserts are unchanged. See that module's header
 * for the durability, isolation, and never-throws contract, all of which still apply verbatim.
 *
 * Prefer `createDecisionCorpusStore` directly for any NEW stream. This wrapper exists so the shipped
 * GH-397 router corpus keeps writing to the exact path it already writes to in production.
 */

/** The stream name that reproduces GH-397's original filename. */
const ROUTER_SHADOW_STREAM = 'router-shadow';

/**
 * Map a workspace key to its `.jsonl` path under rootDir. The workspace is sanitized so it cannot
 * escape rootDir via path separators. Unchanged from GH-397 — same two-arg signature, same output.
 * @param {string} ArgRootDir
 * @param {string} ArgWorkspace
 * @returns {string}
 */
function ShadowFilePath(ArgRootDir, ArgWorkspace) {
  return CorpusFilePath(ArgRootDir, ArgWorkspace, ROUTER_SHADOW_STREAM);
}

/**
 * @param {{ rootDir: string }} ArgOptions
 */
function createRouterShadowStore(ArgOptions) {
  return createDecisionCorpusStore({
    rootDir: ArgOptions && ArgOptions.rootDir,
    stream: ROUTER_SHADOW_STREAM,
  });
}

module.exports = { createRouterShadowStore, ShadowFilePath, ROUTER_SHADOW_STREAM };
