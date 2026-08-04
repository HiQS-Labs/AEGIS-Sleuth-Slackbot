'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * NON-authoritative, append-only JSONL corpus for router-shadow records (GH-397).
 *
 * Mirrors src/event-store.js on purpose: one `<workspace>_router-shadow.jsonl` file per
 * workspace under `rootDir`, per-workspace write-chain serialization, and a best-effort
 * `append` that NEVER rejects/throws (it resolves `{ ok, error }`) so a logging failure can
 * never touch the hot path. Unlike event-store this carries NO closed type enum — the corpus
 * is disposable telemetry, replayed OFFLINE, and must stay OUT of `data/runtime/events/`
 * (the P3 authoritative ledger). It must never be folded into a projection.
 */

/**
 * Map a workspace key to its `.jsonl` path under rootDir. The workspace is sanitized so it
 * cannot escape rootDir via path separators.
 * @param {string} ArgRootDir
 * @param {string} ArgWorkspace
 * @returns {string}
 */
function ShadowFilePath(ArgRootDir, ArgWorkspace) {
  const Safe = String(ArgWorkspace).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(ArgRootDir, `${Safe}_router-shadow.jsonl`);
}

/**
 * @param {{ rootDir: string }} ArgOptions
 */
function createRouterShadowStore(ArgOptions) {
  const RootDir = ArgOptions && ArgOptions.rootDir;

  /**
   * One write chain per workspace so concurrent appends to the same workspace never interleave
   * a torn line; different workspaces progress independently.
   * @type {Map<string, Promise<{ ok: boolean, error?: Error }>>}
   */
  const WriteChains = new Map();

  /**
   * Memoized `mkdir -p` of the corpus root. `recursive: true` resolves `string|undefined` (the path
   * when a directory was created, `undefined` when it already existed), hence the type. Mirrors
   * `event-store.js`: the directory only has to be made once per process, and doing it on every
   * append put a syscall on the routing hot path for no benefit. Reset to `null` on failure so a
   * transient error retries rather than caching a rejected promise forever.
   * @type {Promise<string|undefined>|null}
   */
  let RootDirReady = null;

  /** @returns {Promise<any>} */
  function EnsureRootDirAsync() {
    if(!RootDirReady) {
      RootDirReady = fs.mkdir(RootDir, { recursive: true }).catch(ArgError => {
        RootDirReady = null;
        throw ArgError;
      });
    }
    return RootDirReady;
  }

  /**
   * Best-effort append. Never rejects — resolves a result object — so the per-workspace chain
   * can't be poisoned and a caller is never blocked by a log error.
   *
   * **Deliberately NOT fsync'd** (GH-12), unlike `event-store.js`'s otherwise-identical append.
   * This corpus is disposable telemetry written on the routing hot path; `AppendFileDurableAsync`
   * costs ~5.7 ms per record and would cap this store at roughly 175 records/sec, which is a real
   * regression to buy recency for data the module contract already declares replayable-or-
   * droppable. A torn tail line damages only the final record and the offline replayer skips it.
   * Renamed from `AppendDurable`: that name promised a guarantee this function does not provide.
   *
   * Takes an already-serialized line rather than the record object: see `append` for why.
   * @param {string} ArgWorkspace
   * @param {string} ArgLine Serialized record, newline-terminated.
   * @returns {Promise<{ ok: boolean, error?: Error }>}
   */
  async function AppendBestEffort(ArgWorkspace, ArgLine) {
    try {
      await EnsureRootDirAsync();
      await fs.appendFile(ShadowFilePath(RootDir, ArgWorkspace), ArgLine, 'utf8');
      return { ok: true };
    } catch(error) {
      return { ok: false, error: /** @type {Error} */ (error) };
    }
  }

  return {
    /**
     * Append one record to the workspace's corpus. NON-authoritative: resolves `{ ok:false, error }`
     * on any failure and NEVER rejects. Stamps `ts` (if absent) and `workspace`. Serializes per
     * workspace via the write chain.
     * @param {string} ArgWorkspace
     * @param {object} ArgRecord
     * @returns {Promise<{ ok: boolean, error?: Error }>}
     */
    append(ArgWorkspace, ArgRecord) {
      if(typeof ArgWorkspace !== 'string' || ArgWorkspace.length === 0) {
        return Promise.resolve({ ok: false, error: new Error('router-shadow-store: workspace must be a non-empty string') });
      }
      if(!ArgRecord || typeof ArgRecord !== 'object' || Array.isArray(ArgRecord)) {
        return Promise.resolve({ ok: false, error: new Error('router-shadow-store: record must be an object') });
      }
      const RecordAny = /** @type {any} */ (ArgRecord);
      // The spread goes FIRST so the two system-stamped fields win a key collision. With it last, a
      // record carrying its own `workspace` overwrote the authoritative one — and since the file
      // path is derived from ArgWorkspace, that wrote a line into one workspace's corpus labelled
      // as another's, which an offline replayer has no way to detect. The docstring already claimed
      // this function "stamps ts and workspace"; it only actually did so for records that happened
      // not to carry those keys. `ts` keeps its prior semantics: a caller-supplied string wins, and
      // anything else (absent, empty, non-string) is replaced with a generated stamp.
      const Record = {
        ...ArgRecord,
        ts: (typeof RecordAny.ts === 'string' && RecordAny.ts.length > 0) ? RecordAny.ts : new Date().toISOString(),
        workspace: ArgWorkspace,
      };

      // Serialize NOW, synchronously, rather than inside the chain — the same fix event-store.js
      // carries. The spread above is a SHALLOW copy, so a nested value (e.g. `record.payload`) is
      // still shared with the caller; serializing when the chain reaches it would capture whatever
      // the caller has since mutated it into, not what was submitted.
      let Line;
      try {
        Line = `${JSON.stringify(Record)}\n`;
      } catch(error) {
        // A circular or otherwise unserializable record must not reject — this store never throws
        // at the call site.
        return Promise.resolve({ ok: false, error: /** @type {Error} */ (error) });
      }

      const Prior = WriteChains.get(ArgWorkspace) || Promise.resolve({ ok: true });
      // Chain off the prior write but swallow its result so one failure can't reject the next link.
      const Next = Prior.then(() => AppendBestEffort(ArgWorkspace, Line));
      WriteChains.set(ArgWorkspace, Next);
      return Next;
    },

    /**
     * Read all records for a workspace, in append order. A missing file (normal first-run case)
     * or any read error returns `[]`. Torn/unparseable lines are skipped rather than throwing.
     * @param {string} ArgWorkspace
     * @returns {Promise<object[]>}
     */
    async readAll(ArgWorkspace) {
      let Raw;
      try {
        Raw = await fs.readFile(ShadowFilePath(RootDir, ArgWorkspace), 'utf8');
      } catch(error) {
        return [];
      }
      const Out = [];
      for(const Line of Raw.split('\n')) {
        if(Line.length === 0) continue;
        try {
          Out.push(JSON.parse(Line));
        } catch(error) {
          continue;
        }
      }
      return Out;
    },
  };
}

module.exports = { createRouterShadowStore, ShadowFilePath };
