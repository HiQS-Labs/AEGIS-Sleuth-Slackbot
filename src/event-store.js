'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { AppendFileDurableAsync } = require('./durable-write');

/**
 * NON-authoritative, append-only event store (Phase 1 counter-view).
 *
 * Scope guard: this is a SIDE LEDGER. Mutate-first behavior leads; this log MAY
 * lag or be lossy and is never the source of truth. Therefore:
 *   - `append` is best-effort: it NEVER rejects/throws. Any failure resolves
 *     `{ ok:false, error }` so a caller's reminder transition is never blocked.
 *   - Appends ARE `fsync`'d as of GH-12 Phase 4. The Phase 0 spike recorded a
 *     no-fsync reality that is no longer true; see `src/durable-write.js`
 *     (`AppendFileDurableAsync`) for the benchmark that chose the shape.
 *     This buys RECENCY, not integrity: append-only writes were already
 *     torn-tail-tolerant on read, so the ledger's failure mode was losing the
 *     last event, never corrupting earlier ones.
 *
 * One `<workspace>_events.jsonl` file per workspace under `rootDir`; one JSON
 * object per line. Appends are serialized PER WORKSPACE using the write-chain
 * idiom copied from src/completion-store.js (#WriteChain init at line 34,
 * #SchedulePersistAsync chaining via `.then()` at lines 126-129, and a persist
 * step that never rejects so the chain can't be poisoned, lines 132-138). Here
 * the single chain becomes a Map of one chain per workspace so writes to
 * different workspaces don't serialize against each other.
 */

/**
 * Closed event-type enum and the payload keys each type MUST carry, mirrored
 * from CONTRACT.md "Closed type enum (Phase 1 subset)". A projection replays
 * deterministically only if every required key is present, so an event missing
 * any of them is rejected before it can reach disk.
 * @type {Record<string, string[]>}
 */
const REQUIRED_PAYLOAD_KEYS = {
  ReminderCreated: ['text', 'assigneeId', 'sourceChannelId', 'targetChannelId', 'source', 'githubUrls'],
  ReminderScheduled: ['dueAt', 'via'],
  ReminderCompleted: ['by', 'method', 'summary', 'completedAt'],
  ReminderSnoozed: ['until', 'by'],
  ReminderCancelled: ['by', 'reason'],
  BaselineReminderImported: ['text', 'assigneeId', 'sourceChannelId', 'targetChannelId', 'dueAt', 'state'],
};

/**
 * Validate an event against the closed enum + required payload keys. Returns the
 * normalized, ready-to-write event (with id/v/ts auto-assigned if absent) or
 * `null` when the shape is invalid — in which case the caller writes NOTHING.
 * @param {any} ArgEvent
 * @returns {object|null}
 */
function NormalizeEvent(ArgEvent) {
  if(!ArgEvent || typeof ArgEvent !== 'object' || Array.isArray(ArgEvent)) {
    return null;
  }
  if(typeof ArgEvent.type !== 'string' || !Object.prototype.hasOwnProperty.call(REQUIRED_PAYLOAD_KEYS, ArgEvent.type)) {
    return null;
  }
  if(typeof ArgEvent.reminderId !== 'string' || ArgEvent.reminderId.length === 0) {
    return null;
  }
  const Payload = ArgEvent.payload;
  if(!Payload || typeof Payload !== 'object' || Array.isArray(Payload)) {
    return null;
  }
  for(const Key of REQUIRED_PAYLOAD_KEYS[ArgEvent.type]) {
    if(!Object.prototype.hasOwnProperty.call(Payload, Key)) {
      return null;
    }
  }
  // Shape is valid — auto-assign id/v/ts only if absent so caller-supplied
  // values (e.g. a deterministic id in a test) are preserved.
  return {
    v: typeof ArgEvent.v === 'number' ? ArgEvent.v : 1,
    id: typeof ArgEvent.id === 'string' && ArgEvent.id.length > 0 ? ArgEvent.id : `evt_${crypto.randomUUID()}`,
    ts: typeof ArgEvent.ts === 'string' && ArgEvent.ts.length > 0 ? ArgEvent.ts : new Date().toISOString(),
    workspace: ArgEvent.workspace,
    type: ArgEvent.type,
    reminderId: ArgEvent.reminderId,
    payload: Payload,
  };
}

/**
 * Map a workspace key to its `.jsonl` path under rootDir. The workspace is
 * sanitized so it can't escape rootDir via path separators.
 * @param {string} ArgRootDir
 * @param {string} ArgWorkspace
 * @returns {string}
 */
function EventsFilePath(ArgRootDir, ArgWorkspace) {
  const Safe = String(ArgWorkspace).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(ArgRootDir, `${Safe}_events.jsonl`);
}

/**
 * @param {{ rootDir: string }} ArgOptions
 */
function createEventStore(ArgOptions) {
  const RootDir = ArgOptions && ArgOptions.rootDir;

  /**
   * One write chain per workspace. Each chain serializes that workspace's
   * appends so concurrent appends never interleave a torn line; different
   * workspaces progress independently.
   * @type {Map<string, Promise<{ ok: boolean, error?: Error }>>}
   */
  const WriteChains = new Map();

  /**
   * Best-effort durable append. Mirrors completion-store's #PersistAsync in that
   * it NEVER rejects — it resolves a result object — so the per-workspace chain
   * can't be poisoned and a caller's transition is never blocked by a log error.
   * @param {string} ArgWorkspace
   * @param {object} ArgNormalized
   * @returns {Promise<{ ok: boolean, error?: Error }>}
   */
  async function AppendDurable(ArgWorkspace, ArgNormalized) {
    try {
      await fs.mkdir(RootDir, { recursive: true });
      const Line = `${JSON.stringify(ArgNormalized)}\n`;
      // GH-12 Phase 4: fsync the append so an event is on disk rather than in the page cache when
      // this resolves. Still best-effort — any failure resolves { ok:false } below rather than
      // throwing, so a reminder transition is never blocked by the side ledger.
      await AppendFileDurableAsync(EventsFilePath(RootDir, ArgWorkspace), Line);
      return { ok: true };
    } catch(error) {
      return { ok: false, error };
    }
  }

  return {
    /**
     * Append one event to the workspace's log. NON-authoritative: resolves
     * `{ ok:false, error }` on any failure and NEVER rejects. Validates the
     * event shape BEFORE writing; an invalid event resolves `{ ok:false }` and
     * writes nothing. Serializes per workspace via the write chain.
     * @param {string} ArgWorkspace
     * @param {any} ArgEvent
     * @returns {Promise<{ ok: boolean, error?: Error }>}
     */
    append(ArgWorkspace, ArgEvent) {
      // Defensive: the whole point is to never throw at the call site, so even
      // an invalid workspace key resolves rather than rejects.
      if(typeof ArgWorkspace !== 'string' || ArgWorkspace.length === 0) {
        return Promise.resolve({ ok: false, error: new Error('event-store: workspace must be a non-empty string') });
      }
      // Stamp the workspace onto the event so the persisted line is self-describing.
      const Candidate = (ArgEvent && typeof ArgEvent === 'object' && !Array.isArray(ArgEvent))
        ? { ...ArgEvent, workspace: ArgEvent.workspace == null ? ArgWorkspace : ArgEvent.workspace }
        : ArgEvent;
      const Normalized = NormalizeEvent(Candidate);
      if(Normalized === null) {
        // Invalid shape: write nothing, don't perturb the chain.
        return Promise.resolve({ ok: false, error: new Error('event-store: invalid event shape, not written') });
      }

      const Prior = WriteChains.get(ArgWorkspace) || Promise.resolve({ ok: true });
      // Chain off the prior write but swallow its result so one failure can't
      // reject the next link — matches completion-store's poison-proof chain.
      const Next = Prior.then(() => AppendDurable(ArgWorkspace, Normalized));
      WriteChains.set(ArgWorkspace, Next);
      return Next;
    },

    /**
     * Read all events for a workspace, in append order. A missing file is the
     * normal first-run case → returns `[]`. Tolerant of a corrupt/torn FINAL
     * line (an interrupted append) and of unknown event types: such lines are
     * skipped rather than throwing, per CONTRACT.md "Unknown type on read →
     * skip with a warning ... never throw."
     * @param {string} ArgWorkspace
     * @returns {Promise<object[]>}
     */
    async readAll(ArgWorkspace) {
      let Raw;
      try {
        Raw = await fs.readFile(EventsFilePath(RootDir, ArgWorkspace), 'utf8');
      } catch(error) {
        // Missing file → empty stream; any other read error also degrades to empty
        // since this is a non-authoritative read.
        return [];
      }
      const Lines = Raw.split('\n');
      const Events = [];
      for(let Index = 0; Index < Lines.length; Index += 1) {
        const Line = Lines[Index];
        if(Line.length === 0) {
          continue; // trailing newline / blank line
        }
        let Parsed;
        try {
          Parsed = JSON.parse(Line);
        } catch(error) {
          // A torn final line from an interrupted append, or any unparseable
          // line, is skipped rather than throwing.
          continue;
        }
        // Skip unknown/forward-incompatible types (forward-compatible read).
        if(!Parsed || typeof Parsed !== 'object' || !Object.prototype.hasOwnProperty.call(REQUIRED_PAYLOAD_KEYS, Parsed.type)) {
          continue;
        }
        Events.push(Parsed);
      }
      return Events;
    },
  };
}

module.exports = { createEventStore };
