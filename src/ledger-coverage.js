'use strict';

const fs = require('fs').promises;
const path = require('path');
const { WriteFileDurableAsync } = require('./durable-write');

/**
 * Generation-aware ledger coverage gate (P3 Phase C).
 *
 * The problem no field check can solve: appends are best-effort and fire-and-forget
 * (`#EmitLifecycleEvent` tolerates `{ ok:false }`), so the ledger can be VALID BUT SHORT. A lone
 * `ReminderCreated` whose paired `ReminderScheduled` never landed passes every payload check while
 * leaving `ShouldPostOn` null — and a read flag would then replace the authoritative queue with a
 * partial projection. Codex named this in the schema-expansion consult and was explicit that a
 * periodic checkpoint with a staleness bound is NOT sufficient, because a ledger can go short
 * *immediately* after a check passes.
 *
 * So the gate is causal rather than time-based, and answers one question: **is there any reason to
 * believe this workspace's ledger is missing an event?** Three ways it can become unclean:
 *
 *   1. **An append is in flight.** The JSON store may already be ahead of the log. Transient —
 *      clears when the append settles.
 *   2. **An append failed.** The log is now permanently short: nothing retries it, and the event is
 *      gone. This must survive a process restart, because the *file* is short, not just the memory
 *      of it — so it is recorded durably as a gap marker.
 *   3. **No verification has ever run.** Absence of evidence is not evidence of coverage. A
 *      workspace with no recorded verification is treated as unclean, which is why enabling a read
 *      flag on a fresh deployment cannot silently serve.
 *
 * A gap is cleared ONLY by a recorded verification — a parity run proving the fold matches the JSON
 * store (see `scripts/projection-parity-harness.js` and `baseline-import.js --enrich
 * --retire-orphans`). Never by a restart, never by time passing, never automatically.
 */

/**
 * Marker filename for a workspace. Sanitized so a workspace key cannot escape rootDir.
 * @param {string} ArgRootDir
 * @param {string} ArgWorkspace
 * @returns {string}
 */
function CoverageFilePath(ArgRootDir, ArgWorkspace) {
  const Safe = String(ArgWorkspace).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(ArgRootDir, `${Safe}_ledger_coverage.json`);
}

/**
 * One instance per ledger directory, per process.
 * @type {Map<string, any>}
 */
const SharedInstances = new Map();

/**
 * Get the coverage gate for a ledger directory.
 *
 * Instances are SHARED per `rootDir`, which is load-bearing rather than an optimization.
 * `reminders-module` and `web-api` read the same ledger directory in the same process, and the
 * in-flight append counter lives in memory. Two independent instances would let web-api serve a
 * projection while reminders-module has an append in flight — precisely the window the counter
 * exists to cover, reopened by construction. The durable marker is shared through the filesystem
 * either way; only the in-flight signal needs this.
 *
 * @param {{ rootDir: string, Logger?: { warn?: (...args: any[]) => void }, isolate?: boolean }} ArgOptions
 *   `isolate: true` bypasses the cache, for a test that must genuinely simulate a fresh process.
 *   Without it such a test would get the cached instance back, read its in-memory marker, and pass
 *   without ever touching the disk — proving nothing about what survives a restart.
 */
function createLedgerCoverage(ArgOptions) {
  if(ArgOptions && ArgOptions.isolate === true) return BuildLedgerCoverage(ArgOptions);
  const RootDir = ArgOptions && ArgOptions.rootDir;
  const Existing = SharedInstances.get(RootDir);
  if(Existing) return Existing;
  const Instance = BuildLedgerCoverage(ArgOptions);
  SharedInstances.set(RootDir, Instance);
  return Instance;
}

/**
 * @param {{ rootDir: string, Logger?: { warn?: (...args: any[]) => void } }} ArgOptions
 */
function BuildLedgerCoverage(ArgOptions) {
  const RootDir = ArgOptions && ArgOptions.rootDir;
  const Logger = ArgOptions && ArgOptions.Logger;

  /**
   * In-flight append count per workspace. Incremented BEFORE the append is submitted and decremented
   * when it settles, so the window where the JSON store may lead the log is always covered.
   * @type {Map<string, number>}
   */
  const InFlight = new Map();

  /**
   * Cached marker state per workspace, so the read path does not hit the disk on every call.
   * `undefined` means "not yet loaded" — distinct from `null`, which means "loaded, no marker".
   * @type {Map<string, any>}
   */
  const MarkerCache = new Map();

  /**
   * @param {string} ArgWorkspace
   * @returns {Promise<any|null>} The marker object, or null when the workspace has none.
   */
  async function ReadMarkerAsync(ArgWorkspace) {
    if(MarkerCache.has(ArgWorkspace)) return MarkerCache.get(ArgWorkspace);
    let Marker = null;
    try {
      const Raw = await fs.readFile(CoverageFilePath(RootDir, ArgWorkspace), 'utf8');
      const Parsed = JSON.parse(Raw);
      Marker = (Parsed && typeof Parsed === 'object' && !Array.isArray(Parsed)) ? Parsed : null;
    } catch(error) {
      // A missing file is the normal first-run case. An unreadable or corrupt one is deliberately
      // treated the same as "no verification recorded" — which is UNCLEAN, not clean. Failing open
      // here would defeat the whole gate.
      Marker = null;
    }
    MarkerCache.set(ArgWorkspace, Marker);
    return Marker;
  }

  /**
   * @param {string} ArgWorkspace
   * @param {any} ArgMarker
   */
  async function WriteMarkerAsync(ArgWorkspace, ArgMarker) {
    const FilePath = CoverageFilePath(RootDir, ArgWorkspace);
    // The two marker kinds move the gate in OPPOSITE directions, so they cannot share a caching
    // order. Writing one unconditionally before the durable write — as this function used to —
    // is correct for a gap and a fail-OPEN defect for a verification: a `RecordVerifiedAsync`
    // whose disk write failed would still open the gate for the rest of the process's life, with
    // nothing on disk behind it. Codex caught this in the 2026-08-09 consult.
    const IsVerified = ArgMarker !== null && typeof ArgMarker === 'object' && ArgMarker.state === 'verified';

    // GAP: cache FIRST, synchronously, before any await. `SettleAppend` returns this promise but
    // callers on the ledger path do not await it, so deferring the cache write until after the
    // durable write would leave a window where the gate still reads `verified` even though this
    // process already knows an append was lost. Optimism is the safe direction here — the cached
    // state is strictly more restrictive than the disk's.
    if(!IsVerified) MarkerCache.set(ArgWorkspace, ArgMarker);

    try {
      await fs.mkdir(RootDir, { recursive: true });
      await WriteFileDurableAsync(FilePath, JSON.stringify(ArgMarker, null, 2), { Logger });
      // VERIFIED: cache ONLY once the proof is durable. An unproven verification must never open
      // the gate, so this is the pessimistic direction.
      if(IsVerified) MarkerCache.set(ArgWorkspace, ArgMarker);
      return;
    } catch(error) {
      // Never throw at the call site — this sits on the ledger path, which must not break a
      // reminder transition.
      Logger?.warn?.(`[ledger-coverage] could not persist coverage marker for ${ArgWorkspace}`, error);
    }

    if(IsVerified) {
      // `null` is "loaded, no marker" — which IsCleanAsync reads as unclean. Deliberately not left
      // as `undefined` ("not yet loaded"), which would send the next read back to the disk and
      // resurrect an older marker this failed write was meant to supersede.
      MarkerCache.set(ArgWorkspace, null);
      return;
    }

    // A gap we could not persist. This process is safe (cached above), but a restart would read
    // whatever is still on disk — including an older `verified` marker that is now provably wrong,
    // which is the second half of the same fail-open. Absence reads as unclean, so REMOVING the
    // stale marker is a durable way to fail closed even when writing a new one is impossible
    // (ENOSPC being the obvious case: no room to write, but unlinking always works).
    //
    // `recursive` because the point is to leave nothing at that path, whatever shape it has taken;
    // the path is sanitized by CoverageFilePath and cannot escape RootDir.
    try {
      await fs.rm(FilePath, { recursive: true, force: true });
    } catch(error) {
      Logger?.warn?.(
        `[ledger-coverage] could not persist a gap for ${ArgWorkspace} AND could not remove the stale `
        + 'marker; a restart may read an out-of-date coverage state. Re-run the parity harness.',
        error
      );
    }
  }

  return {
    /**
     * Record that an append is about to be submitted. Pair with `SettleAppend`.
     * @param {string} ArgWorkspace
     */
    BeginAppend(ArgWorkspace) {
      InFlight.set(ArgWorkspace, (InFlight.get(ArgWorkspace) || 0) + 1);
    },

    /**
     * Record that an append settled. A failure durably marks the workspace as having a gap, because
     * the event is not retried anywhere — the log is short from here until a verification says
     * otherwise.
     * @param {string} ArgWorkspace
     * @param {boolean} ArgOk
     * @param {string} [ArgDetail] Event type or other context, for the marker.
     * @returns {Promise<void>|void}
     */
    SettleAppend(ArgWorkspace, ArgOk, ArgDetail) {
      const Remaining = (InFlight.get(ArgWorkspace) || 1) - 1;
      InFlight.set(ArgWorkspace, Remaining > 0 ? Remaining : 0);
      if(ArgOk) return;
      return WriteMarkerAsync(ArgWorkspace, {
        state: 'gap',
        reason: 'append-failed',
        detail: typeof ArgDetail === 'string' ? ArgDetail : null,
        // Callers stamp their own instant; this module does not read the clock so its output stays
        // deterministic under test.
        recordedAt: new Date().toISOString(),
      });
    },

    /**
     * May a projection be served for this workspace?
     *
     * False whenever an append is in flight, whenever a gap has been recorded, and whenever no
     * verification has ever been recorded. The last case is the important default: a workspace that
     * has never been proven is not clean just because nothing has gone visibly wrong.
     * @param {string} ArgWorkspace
     * @returns {Promise<boolean>}
     */
    async IsCleanAsync(ArgWorkspace) {
      if((InFlight.get(ArgWorkspace) || 0) > 0) return false;
      const Marker = await ReadMarkerAsync(ArgWorkspace);
      return Marker !== null && Marker.state === 'verified';
    },

    /**
     * Explain the current state, for a log line an operator can act on. Kept separate from
     * `IsCleanAsync` so the hot read path does not build strings it will not use.
     * @param {string} ArgWorkspace
     * @returns {Promise<string>}
     */
    async DescribeAsync(ArgWorkspace) {
      if((InFlight.get(ArgWorkspace) || 0) > 0) return 'an append is in flight; the log may trail the JSON store';
      const Marker = await ReadMarkerAsync(ArgWorkspace);
      if(Marker === null) return 'no verification has ever been recorded for this workspace';
      if(Marker.state === 'verified') return `verified at ${Marker.recordedAt}`;
      return `gap recorded at ${Marker.recordedAt} (${Marker.reason}${Marker.detail ? `: ${Marker.detail}` : ''})`;
    },

    /**
     * Record that a parity verification passed. This is the ONLY way a workspace becomes clean.
     * @param {string} ArgWorkspace
     * @param {{ eventCount?: number, reminderCount?: number, completedCount?: number }} [ArgEvidence]
     * @returns {Promise<void>}
     */
    async RecordVerifiedAsync(ArgWorkspace, ArgEvidence = {}) {
      await WriteMarkerAsync(ArgWorkspace, {
        state: 'verified',
        recordedAt: new Date().toISOString(),
        evidence: {
          eventCount: typeof ArgEvidence.eventCount === 'number' ? ArgEvidence.eventCount : null,
          reminderCount: typeof ArgEvidence.reminderCount === 'number' ? ArgEvidence.reminderCount : null,
          completedCount: typeof ArgEvidence.completedCount === 'number' ? ArgEvidence.completedCount : null,
        },
      });
    },

    /**
     * Record a gap explicitly — for a caller that detects one by means other than a failed append
     * (a parity run that came back with diffs, for instance).
     * @param {string} ArgWorkspace
     * @param {string} ArgReason
     * @returns {Promise<void>}
     */
    async RecordGapAsync(ArgWorkspace, ArgReason) {
      await WriteMarkerAsync(ArgWorkspace, {
        state: 'gap',
        reason: typeof ArgReason === 'string' && ArgReason.length > 0 ? ArgReason : 'unspecified',
        detail: null,
        recordedAt: new Date().toISOString(),
      });
    },
  };
}

module.exports = { createLedgerCoverage, CoverageFilePath };
