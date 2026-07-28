const fs = require('fs').promises;

/**
 * Sleuth-owned record of completed reminders, independent of Slack Lists.
 *
 * Slack Lists is a one-way mirror that DELETES rows on completion (shared lists) and only
 * retains history on per-user lists, which are not provisioned in every workspace. Relying on
 * it to answer "what got done this week" silently returns nothing wherever per-user lists are
 * absent. This store removes that dependency: every completion is captured at the reminder FSM
 * chokepoint and persisted here, so the weekly summary reads from data Sleuth owns outright.
 *
 * One responsibility: persist and query completion history. It knows nothing about reminders,
 * Slack, or the FSM — callers hand it plain records.
 *
 * @typedef {Object} CompletionRecord
 * @property {string}           reminderId      Reminder UUID (the de-dupe key).
 * @property {string|null}      summary         Task text at completion time.
 * @property {string|null}      assigneeID      Slack user ID the reminder was assigned to, if any.
 * @property {string|null}      sourceChannelID Channel the reminder originated in, if known.
 * @property {string|null}      dueDate         ISO due date the reminder carried, if any.
 * @property {number}           completedMs     Epoch milliseconds when the reminder was completed.
 * @property {string|null}      [clientId]      Stable client slug stamped at completion time (optional, backwards compatible).
 */
class CompletionStore {
  /** Completion records older than this (relative to now) are pruned on load/record. */
  static RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

  /** @type {any} */
  #SlackApp;
  /** @type {string} */
  #FilePath;
  /** @type {CompletionRecord[]} */
  #Records = [];
  /** Serializes durable writes so concurrent completions never clobber the file. @type {Promise<void>} */
  #WriteChain = Promise.resolve();

  /**
   * @param {any} ArgSlackApp Slack app (used only for its Logger).
   * @param {string} ArgFilePath Absolute path to the per-workspace completion history JSON file.
   */
  constructor(ArgSlackApp, ArgFilePath) {
    this.#SlackApp = ArgSlackApp;
    this.#FilePath = ArgFilePath;
  }

  /**
   * Load history from disk. A missing file is the normal first-run case (start empty); any other
   * read/parse failure is logged and degrades to empty rather than blocking startup. Prunes
   * expired rows so a long-idle workspace doesn't resurface year-old completions.
   * @returns {Promise<void>}
   */
  async LoadAsync() {
    try {
      const Raw = await fs.readFile(this.#FilePath, 'utf8');
      const Parsed = JSON.parse(Raw);
      this.#Records = Array.isArray(Parsed) ? Parsed.filter(IsValidRecord) : [];
    } catch(error) {
      if(!error || error.code !== 'ENOENT') {
        this.#SlackApp.Logger.error('completion-store: failed to load history, starting empty:', error);
      }
      this.#Records = [];
    }
    // Make load-time pruning durable: if anything aged out, write the pruned set back now rather
    // than waiting for the next completion — otherwise a quiet workspace keeps stale rows on disk
    // indefinitely. Awaited so the file reflects the trimmed set by the time LoadAsync resolves.
    if(this.#PruneExpired()) {
      await this.#SchedulePersistAsync();
    }
  }

  /**
   * Wait for all writes scheduled so far to reach disk. Called on graceful shutdown so a completion
   * recorded just before a restart/deploy is not lost while its async write is still in flight.
   * @returns {Promise<void>}
   */
  async FlushAsync() {
    await this.#WriteChain;
  }

  /**
   * Append a completion. De-dupes by reminderId (last write wins, so a retried completion
   * collapses to one row), prunes expired rows, and durably persists. The in-memory update is
   * synchronous — GetCompletedBetween reflects it immediately — while the disk write runs async.
   * Returns the persist promise so tests can await durability; the FSM hook fires it without awaiting.
   * @param {CompletionRecord} ArgRecord
   * @returns {Promise<void>}
   */
  Record(ArgRecord) {
    if(!IsValidRecord(ArgRecord)) {
      this.#SlackApp.Logger.warn('completion-store: ignoring invalid completion record:', ArgRecord);
      return Promise.resolve();
    }
    this.#Records = this.#Records.filter(ArgExisting => ArgExisting.reminderId !== ArgRecord.reminderId);
    this.#Records.push(ArgRecord);
    this.#PruneExpired();
    return this.#SchedulePersistAsync();
  }

  /**
   * Completion records whose completedMs falls in [ArgStartMs, ArgEndMs), sorted oldest-first.
   * @param {number} ArgStartMs Inclusive lower bound (epoch ms).
   * @param {number} ArgEndMs Exclusive upper bound (epoch ms).
   * @returns {CompletionRecord[]}
   */
  GetCompletedBetween(ArgStartMs, ArgEndMs) {
    return this.#Records
      .filter(ArgRecord => ArgRecord.completedMs >= ArgStartMs && ArgRecord.completedMs < ArgEndMs)
      .sort((ArgLeft, ArgRight) => ArgLeft.completedMs - ArgRight.completedMs);
  }

  /**
   * The epoch-ms timestamp of the most recent completion for any of the supplied reminder IDs, or
   * null if none of them appear in the store. Used by the proactive-digest layer to check whether
   * a client's tasks have seen any completions within a quiet-window without storing clientId on
   * the record itself (the store schema is append-only; callers supply the relevant ID set).
   * Read-only; no schema change.
   * @param {Set<string>} ArgReminderIdSet Set of reminder UUIDs belonging to the client/project.
   * @returns {number|null}
   */
  GetLastCompletionMsForIds(ArgReminderIdSet) {
    if(!ArgReminderIdSet || ArgReminderIdSet.size === 0) return null;
    let Latest = null;
    for(const Record of this.#Records) {
      if(!ArgReminderIdSet.has(Record.reminderId)) continue;
      if(Latest === null || Record.completedMs > Latest) Latest = Record.completedMs;
    }
    return Latest;
  }

  /**
   * Completion records whose reminderId is in ArgReminderIdSet and whose completedMs falls in
   * [ArgStartMs, ArgEndMs), sorted oldest-first. Used by the proactive digest to check per-client
   * recent-completion activity without requiring clientId on the stored record.
   * Read-only; no schema change.
   * @param {Set<string>} ArgReminderIdSet Set of reminder UUIDs to restrict to.
   * @param {number} ArgStartMs Inclusive lower bound (epoch ms).
   * @param {number} ArgEndMs Exclusive upper bound (epoch ms).
   * @returns {CompletionRecord[]}
   */
  GetCompletedBetweenForIds(ArgReminderIdSet, ArgStartMs, ArgEndMs) {
    if(!ArgReminderIdSet || ArgReminderIdSet.size === 0) return [];
    return this.#Records
      .filter(ArgRecord =>
        ArgReminderIdSet.has(ArgRecord.reminderId) &&
        ArgRecord.completedMs >= ArgStartMs &&
        ArgRecord.completedMs < ArgEndMs
      )
      .sort((ArgLeft, ArgRight) => ArgLeft.completedMs - ArgRight.completedMs);
  }

  /**
   * The epoch-ms timestamp of the most recent completion for the given clientId within
   * [ArgStartMs, now), or null if no matching record exists. Used by the proactive-digest
   * gone-quiet check to detect activity from completions that are no longer in the open queue
   * (terminal reminders are deleted from the queue at completion time).
   * Read-only; no schema change — clientId on records is optional/backwards-compatible.
   * @param {string} ArgClientId Stable client slug to match.
   * @param {number} ArgStartMs Inclusive lower bound (epoch ms).
   * @returns {number|null}
   */
  GetLastCompletionMsForClientId(ArgClientId, ArgStartMs) {
    if(!ArgClientId) return null;
    let Latest = null;
    for(const Record of this.#Records) {
      if(Record.clientId !== ArgClientId) continue;
      if(Record.completedMs < ArgStartMs) continue;
      if(Latest === null || Record.completedMs > Latest) Latest = Record.completedMs;
    }
    return Latest;
  }

  /**
   * Drop records older than the retention window.
   * @returns {boolean} true if at least one record was removed.
   */
  #PruneExpired() {
    const Cutoff = Date.now() - CompletionStore.RETENTION_MS;
    const Before = this.#Records.length;
    this.#Records = this.#Records.filter(ArgRecord => ArgRecord.completedMs >= Cutoff);
    return this.#Records.length !== Before;
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
      await fs.writeFile(this.#FilePath, JSON.stringify(this.#Records, null, 2), 'utf8');
    } catch(error) {
      this.#SlackApp.Logger.error('completion-store: failed to persist history:', error);
    }
  }
}

/**
 * A record is usable only with a non-empty reminderId (the de-dupe key) and a finite completedMs
 * (the only field the weekly window filters on). Everything else is display sugar and may be null.
 * @param {any} ArgRecord
 * @returns {boolean}
 */
function IsValidRecord(ArgRecord) {
  return !!ArgRecord
    && typeof ArgRecord.reminderId === 'string'
    && ArgRecord.reminderId.length > 0
    && typeof ArgRecord.completedMs === 'number'
    && Number.isFinite(ArgRecord.completedMs);
}

module.exports = CompletionStore;
