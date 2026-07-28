'use strict';

// Pure, testable core of the reminders-export publisher. Kept as a separate
// CommonJS module so it can be unit-tested with jest (the publisher itself is an
// ESM script that performs network I/O on import). The ESM script imports this.

/**
 * Build the deterministic published-export content from the Sleuth API's `data`
 * object. Strips the volatile `fetchedAt` and stamps an HOURLY-ROUNDED
 * `exportGeneratedAt` heartbeat: it advances even when the reminders are
 * unchanged (so a dead publisher is visible to consumers), while rounding to the
 * hour caps no-op commits at ~24/day. Does not mutate the input.
 *
 * The `memories` key is always present in the output — empty array when none exist —
 * so consumers can depend on its presence without a null-check.
 *
 * @param {object} ArgApiData The `data` object from the `?format=rebalance` response.
 * @param {number} ArgNowMs Current time in ms (Date.now()); injected for testability.
 * @param {object[]} [ArgMemories] Thread memories to include. Defaults to [].
 * @returns {{ payload: object, content: string }}
 */
function BuildExportContent(ArgApiData, ArgNowMs, ArgMemories = []) {
  const Payload = { ...ArgApiData };
  delete Payload.fetchedAt;
  Payload.exportGeneratedAt = new Date(Math.floor(ArgNowMs / 3600000) * 3600000).toISOString();
  Payload.memories = Array.isArray(ArgMemories) ? ArgMemories : [];
  const Content = JSON.stringify(Payload, null, 2) + '\n';
  return { payload: Payload, content: Content };
}

module.exports = { BuildExportContent };
