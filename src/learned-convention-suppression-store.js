
'use strict';

const fs = require('fs').promises;

/**
 * GH-366 Phase 2.2 — suppression + rate-limit store for learned-convention proposals.
 *
 * `learned-conventions.js` (P2.1) decides *whether* a proposal is warranted from completion
 * history; it never persists anything. This store owns the two pieces of durable state the
 * digest pass (P2.3, not built here) needs before it can surface a proposal:
 *   - suppression: a client+kind proposal the operator already declined should not nag again
 *     until the decline ages out of the window.
 *   - rate limit: a client should see at most one learned-convention proposal per week,
 *     regardless of kind, so the noise budget (≤3/day digest cap) never gets dominated by one
 *     client repeatedly proposing.
 *
 * Same serialized-write idiom as `completion-store.js`: an in-memory array mirrors disk, writes
 * are chained so concurrent callers never clobber the file, and a missing file on load is the
 * normal first-run case. PURE JSON I/O + small pure predicates — no LLM calls, no Slack calls.
 *
 * @typedef {Object} DeclineRecord
 * @property {string} clientId    Stable client slug.
 * @property {string} kind        Proposal kind, e.g. `'assignee'` or `'cadence'`.
 * @property {number} declinedMs  Epoch milliseconds when the decline was recorded.
 *
 * @typedef {Object} SurfacedRecord
 * @property {string} clientId    Stable client slug.
 * @property {number} surfacedMs  Epoch milliseconds when a proposal was surfaced/confirmed.
 */
class LearnedConventionSuppressionStore {
  // ponytail: L=4 weeks, revisit when a client complains a declined proposal came back too soon
  // or too late — no usage data yet to tune this against.
  static SUPPRESSION_WINDOW_MS = 4 * 7 * 24 * 60 * 60 * 1000;

  /** One learned-convention proposal per client per rolling week, regardless of kind. */
  static RATE_LIMIT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  /** @type {any} */
  #SlackApp;
  /** @type {string} */
  #FilePath;
  /** @type {DeclineRecord[]} */
  #Declines = [];
  /** @type {SurfacedRecord[]} */
  #Surfaced = [];
  /** Serializes durable writes so concurrent callers never clobber the file. @type {Promise<void>} */
  #WriteChain = Promise.resolve();

  /**
   * @param {any} ArgSlackApp Slack app (used only for its Logger).
   * @param {string} ArgFilePath Absolute path to the suppression/rate-limit JSON file.
   */
  constructor(ArgSlackApp, ArgFilePath) {
    this.#SlackApp = ArgSlackApp;
    this.#FilePath = ArgFilePath;
  }

  /**
   * Load state from disk. A missing file is the normal first-run case (start empty); any other
   * read/parse failure is logged and degrades to empty rather than blocking startup. Prunes
   * expired rows so a long-idle workspace doesn't carry stale declines/rate-limit rows forever.
   * @returns {Promise<void>}
   */
  async LoadAsync() {
    try {
      const Raw = await fs.readFile(this.#FilePath, 'utf8');
      const Parsed = JSON.parse(Raw);
      this.#Declines = Array.isArray(Parsed?.declines) ? Parsed.declines.filter(IsValidDeclineRecord) : [];
      this.#Surfaced = Array.isArray(Parsed?.surfaced) ? Parsed.surfaced.filter(IsValidSurfacedRecord) : [];
    } catch(error) {
      if(!error || error.code !== 'ENOENT') {
        this.#SlackApp.Logger.error('learned-convention-suppression-store: failed to load state, starting empty:', error);
      }
      this.#Declines = [];
      this.#Surfaced = [];
    }
    // Make load-time pruning durable, same rationale as completion-store: write the trimmed set
    // back now rather than waiting for the next call.
    if(this.#PruneExpired()) {
      await this.#SchedulePersistAsync();
    }
  }

  /**
   * Wait for all writes scheduled so far to reach disk.
   * @returns {Promise<void>}
   */
  async FlushAsync() {
    await this.#WriteChain;
  }

  /**
   * Record that a proposal of ArgKind for ArgClientId was declined. De-dupes by (clientId, kind)
   * so a repeatedly-declined proposal keeps only its most recent decline timestamp.
   * @param {string} ArgClientId
   * @param {string} ArgKind
   * @param {number} [ArgAtMs] Epoch milliseconds; defaults to now.
   * @returns {Promise<void>}
   */
  RecordDecline(ArgClientId, ArgKind, ArgAtMs = Date.now()) {
    const Record = { clientId: ArgClientId, kind: ArgKind, declinedMs: ArgAtMs };
    if(!IsValidDeclineRecord(Record)) {
      this.#SlackApp.Logger.warn('learned-convention-suppression-store: ignoring invalid decline record:', Record);
      return Promise.resolve();
    }
    this.#Declines = this.#Declines.filter(ArgExisting =>
      !(ArgExisting.clientId === ArgClientId && ArgExisting.kind === ArgKind));
    this.#Declines.push(Record);
    this.#PruneExpired();
    return this.#SchedulePersistAsync();
  }

  /**
   * Whether a (clientId, kind) proposal is currently suppressed, i.e. it was declined within
   * SUPPRESSION_WINDOW_MS of ArgNowMs. Pure predicate over in-memory state; no I/O.
   * @param {string} ArgClientId
   * @param {string} ArgKind
   * @param {number} [ArgNowMs] Epoch milliseconds; defaults to now.
   * @returns {boolean}
   */
  IsSuppressed(ArgClientId, ArgKind, ArgNowMs = Date.now()) {
    const Cutoff = ArgNowMs - LearnedConventionSuppressionStore.SUPPRESSION_WINDOW_MS;
    return this.#Declines.some(ArgRecord =>
      ArgRecord.clientId === ArgClientId && ArgRecord.kind === ArgKind && ArgRecord.declinedMs >= Cutoff);
  }

  /**
   * Record that a learned-convention proposal (any kind) was surfaced/confirmed for ArgClientId.
   * De-dupes by clientId so only the most recent surfacing timestamp is kept.
   * @param {string} ArgClientId
   * @param {number} [ArgAtMs] Epoch milliseconds; defaults to now.
   * @returns {Promise<void>}
   */
  RecordProposalSurfaced(ArgClientId, ArgAtMs = Date.now()) {
    const Record = { clientId: ArgClientId, surfacedMs: ArgAtMs };
    if(!IsValidSurfacedRecord(Record)) {
      this.#SlackApp.Logger.warn('learned-convention-suppression-store: ignoring invalid surfaced record:', Record);
      return Promise.resolve();
    }
    this.#Surfaced = this.#Surfaced.filter(ArgExisting => ArgExisting.clientId !== ArgClientId);
    this.#Surfaced.push(Record);
    this.#PruneExpired();
    return this.#SchedulePersistAsync();
  }

  /**
   * Whether ArgClientId already had a proposal surfaced/confirmed within RATE_LIMIT_WINDOW_MS of
   * ArgNowMs, enforcing 1 proposal/client/week regardless of kind. Pure predicate; no I/O.
   * @param {string} ArgClientId
   * @param {number} [ArgNowMs] Epoch milliseconds; defaults to now.
   * @returns {boolean}
   */
  IsRateLimited(ArgClientId, ArgNowMs = Date.now()) {
    const Cutoff = ArgNowMs - LearnedConventionSuppressionStore.RATE_LIMIT_WINDOW_MS;
    return this.#Surfaced.some(ArgRecord => ArgRecord.clientId === ArgClientId && ArgRecord.surfacedMs >= Cutoff);
  }

  /**
   * Drop declines and surfaced rows older than their respective windows (relative to now).
   * @returns {boolean} true if at least one row was removed.
   */
  #PruneExpired() {
    const Now = Date.now();
    const DeclineCutoff = Now - LearnedConventionSuppressionStore.SUPPRESSION_WINDOW_MS;
    const SurfacedCutoff = Now - LearnedConventionSuppressionStore.RATE_LIMIT_WINDOW_MS;
    const DeclinesBefore = this.#Declines.length;
    const SurfacedBefore = this.#Surfaced.length;
    this.#Declines = this.#Declines.filter(ArgRecord => ArgRecord.declinedMs >= DeclineCutoff);
    this.#Surfaced = this.#Surfaced.filter(ArgRecord => ArgRecord.surfacedMs >= SurfacedCutoff);
    return this.#Declines.length !== DeclinesBefore || this.#Surfaced.length !== SurfacedBefore;
  }

  /**
   * Queue a durable write behind any in-flight write. #PersistAsync never rejects, so the chain
   * cannot be poisoned by a failed save.
   * @returns {Promise<void>}
   */
  #SchedulePersistAsync() {
    this.#WriteChain = this.#WriteChain.then(() => this.#PersistAsync());
    return this.#WriteChain;
  }

  /** @returns {Promise<void>} */
  async #PersistAsync() {
    try {
      const Payload = { declines: this.#Declines, surfaced: this.#Surfaced };
      await fs.writeFile(this.#FilePath, JSON.stringify(Payload, null, 2), 'utf8');
    } catch(error) {
      this.#SlackApp.Logger.error('learned-convention-suppression-store: failed to persist state:', error);
    }
  }
}

/**
 * A decline record is usable only with non-empty clientId/kind strings and a finite declinedMs.
 * @param {any} ArgRecord
 * @returns {boolean}
 */
function IsValidDeclineRecord(ArgRecord) {
  return !!ArgRecord
    && typeof ArgRecord.clientId === 'string' && ArgRecord.clientId.length > 0
    && typeof ArgRecord.kind === 'string' && ArgRecord.kind.length > 0
    && typeof ArgRecord.declinedMs === 'number' && Number.isFinite(ArgRecord.declinedMs);
}

/**
 * A surfaced record is usable only with a non-empty clientId and a finite surfacedMs.
 * @param {any} ArgRecord
 * @returns {boolean}
 */
function IsValidSurfacedRecord(ArgRecord) {
  return !!ArgRecord
    && typeof ArgRecord.clientId === 'string' && ArgRecord.clientId.length > 0
    && typeof ArgRecord.surfacedMs === 'number' && Number.isFinite(ArgRecord.surfacedMs);
}

module.exports = LearnedConventionSuppressionStore;
