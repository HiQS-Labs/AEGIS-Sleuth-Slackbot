'use strict';

// Pure, testable core of the completions-export publisher (GH-367 Phase 2). Kept separate from the
// ESM publish script (which does network + disk I/O) so it can be jest-unit-tested. Turns Sleuth's
// raw on-disk completion history ({workspace}_completed.json) into a bounded, deterministically
// shaped published file (completions-<workspace>.json) so the local "talk to reminders" skill can
// answer time-scoped history questions ("what did X do last week") with zero network.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shape one raw CompletionStore record into the published, camelCase form (matching the active
 * mirror's field conventions). Unusable rows (no reminderId / non-finite completedMs) return null.
 * @param {any} ArgRecord Raw record from {workspace}_completed.json.
 * @returns {object|null}
 */
function ShapeRecord(ArgRecord) {
  const ReminderId = typeof ArgRecord?.reminderId === 'string' ? ArgRecord.reminderId : null;
  const CompletedMs = typeof ArgRecord?.completedMs === 'number' && Number.isFinite(ArgRecord.completedMs)
    ? ArgRecord.completedMs
    : null;
  if(!ReminderId || CompletedMs === null) return null;
  return {
    reminderId: ReminderId,
    summary: typeof ArgRecord.summary === 'string' ? ArgRecord.summary : null,
    assigneeId: typeof ArgRecord.assigneeID === 'string' && ArgRecord.assigneeID.length > 0 ? ArgRecord.assigneeID : null,
    sourceChannelId: typeof ArgRecord.sourceChannelID === 'string' && ArgRecord.sourceChannelID.length > 0 ? ArgRecord.sourceChannelID : null,
    clientId: typeof ArgRecord.clientId === 'string' && ArgRecord.clientId.length > 0 ? ArgRecord.clientId : null,
    dueDate: typeof ArgRecord.dueDate === 'string' ? ArgRecord.dueDate : null,
    completedMs: CompletedMs,
    completedAt: new Date(CompletedMs).toISOString(),
  };
}

/**
 * Build the bounded, deterministic completions-export payload + serialized content.
 *
 * - Keeps only completions in the half-open window [nowMs - windowDays*DAY, nowMs].
 * - Shapes + sorts newest-first (stable, id-tiebroken) so the file is byte-stable for unchanged data.
 * - Stamps an HOURLY-ROUNDED `exportGeneratedAt` heartbeat (same liveness/idempotency contract as the
 *   active export): it advances hourly even when data is unchanged, capping no-op commits at ~24/day.
 *
 * @param {any[]}  ArgRecords       Raw completion records from disk.
 * @param {number} ArgNowMs         Current time in ms (injected for testability).
 * @param {number} ArgWindowDays    Retention window in days (e.g. 90).
 * @param {string} ArgWorkspaceName Workspace slug.
 * @returns {{ payload: object, content: string }}
 */
function BuildCompletionsContent(ArgRecords, ArgNowMs, ArgWindowDays, ArgWorkspaceName) {
  const WindowDays = Number.isFinite(ArgWindowDays) && ArgWindowDays > 0 ? Math.floor(ArgWindowDays) : 90;
  const StartMs = ArgNowMs - WindowDays * DAY_MS;
  const Records = Array.isArray(ArgRecords) ? ArgRecords : [];

  const Completions = Records
    .map(ShapeRecord)
    .filter(ArgShaped => ArgShaped !== null && ArgShaped.completedMs >= StartMs && ArgShaped.completedMs <= ArgNowMs)
    .sort((ArgLeft, ArgRight) =>
      ArgRight.completedMs - ArgLeft.completedMs || ArgLeft.reminderId.localeCompare(ArgRight.reminderId));

  const Payload = {
    workspaceName: ArgWorkspaceName,
    windowDays: WindowDays,
    count: Completions.length,
    exportGeneratedAt: new Date(Math.floor(ArgNowMs / 3600000) * 3600000).toISOString(),
    completions: Completions,
  };
  const Content = JSON.stringify(Payload, null, 2) + '\n';
  return { payload: Payload, content: Content };
}

module.exports = { BuildCompletionsContent, ShapeRecord, DAY_MS };
