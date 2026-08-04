'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Crash-atomic file writes for AEGIS's authoritative JSON stores.
 *
 * Every authoritative store in this repo used to persist with a bare `fs.writeFile`, which is a
 * truncate-then-rewrite: the old bytes are gone before the new ones land. A hard kill inside that
 * window leaves unparseable JSON, every loader degrades a parse failure to "start empty", and the
 * next ordinary save then persists the empty set over the survivor data. See
 * PROJECT/2-WORKING/GH-12-DURABILITY-HARDENING.md for the full audit.
 *
 * The durable sequence here is: write a temp file, `fsync` it, `rename` it onto the target, then
 * `fsync` the parent directory so the rename itself survives a crash. `rename(2)` within a
 * filesystem is atomic, so a reader sees either the complete old file or the complete new one and
 * never a truncation.
 *
 * Two properties this module deliberately does NOT provide, because callers must handle them:
 *
 *   1. **Ordering.** Atomic rename makes each write all-or-nothing; it does not order concurrent
 *      writes. Two writers doing read-modify-write on the same path can still lose an update
 *      (A snapshots, B snapshots, B renames, A renames its stale snapshot on top). Callers that
 *      rewrite whole files must serialize themselves — see `CompletionStore`'s `#WriteChain`.
 *   2. **Zero data loss.** An `fsync` bounds corruption, not loss: a write that never reached this
 *      function is still gone. Atomicity is not durability of unsubmitted data.
 *
 * Platform note: production is Linux/systemd, where `fsync` has real POSIX semantics. On macOS
 * `fsync()` does not force a platform flush (that needs `F_FULLFSYNC`, which Node does not expose),
 * so local dev is a weaker guarantee than prod. Directory `fsync` is unsupported on some
 * filesystems and on Windows; that degrades to a warning rather than an error, since by then the
 * data file is already written and renamed.
 */

/**
 * Monotonic per-process counter, combined with the pid and random bytes to build a temp filename
 * that is unique even across concurrent writes to the same target path.
 * @type {number}
 */
let TempCounter = 0;

/**
 * Build a collision-proof temp path beside the target.
 *
 * A shared `${path}.tmp` would be actively dangerous: `reminders-module.js` has no write
 * serialization and fires at least one save without awaiting it, so two concurrent saves would
 * interleave writes into the same temp file and then rename the corrupted result over good data —
 * turning a rare hard-kill loss into routine corruption. Uniqueness per write removes that.
 * @param {string} ArgFilePath Absolute path of the destination file.
 * @returns {string}
 */
function BuildTempPath(ArgFilePath) {
  TempCounter += 1;
  const Unique = `${process.pid}.${TempCounter}.${crypto.randomBytes(4).toString('hex')}`;
  return `${ArgFilePath}.${Unique}.tmp`;
}

/**
 * Report a non-fatal durability degradation without throwing.
 * @param {{ warn?: (...ArgArgs: any[]) => void }|null|undefined} ArgLogger Optional logger.
 * @param {string} ArgMessage Human-readable description.
 * @param {any} ArgError Underlying error.
 * @returns {void}
 */
function WarnDegraded(ArgLogger, ArgMessage, ArgError) {
  if(ArgLogger && typeof ArgLogger.warn === 'function') {
    ArgLogger.warn(`durable-write: ${ArgMessage}`, ArgError);
  }
}

/**
 * `fsync` a directory so a rename inside it is durable. Never throws: by the time this runs the
 * data file is already written and renamed, so a failure here degrades the guarantee (the rename
 * may not survive a crash) without invalidating the write. Unsupported on Windows and on some
 * filesystems, where opening a directory fails outright.
 * @param {string} ArgDirPath Directory to sync.
 * @param {{ warn?: (...ArgArgs: any[]) => void }|null|undefined} ArgLogger Optional logger.
 * @returns {Promise<void>}
 */
async function FsyncDirAsync(ArgDirPath, ArgLogger) {
  let Handle = null;
  try {
    Handle = await fs.open(ArgDirPath, 'r');
    await Handle.sync();
  } catch(error) {
    WarnDegraded(ArgLogger, `directory fsync unsupported or failed for ${ArgDirPath} (rename is written but may not survive a hard kill)`, error);
  } finally {
    if(Handle) {
      try {
        await Handle.close();
      } catch(error) {
        // Closing a handle we already finished with cannot affect the written data.
      }
    }
  }
}

/**
 * Synchronous counterpart of FsyncDirAsync. Never throws, for the same reason.
 * @param {string} ArgDirPath Directory to sync.
 * @param {{ warn?: (...ArgArgs: any[]) => void }|null|undefined} ArgLogger Optional logger.
 * @returns {void}
 */
function FsyncDirSync(ArgDirPath, ArgLogger) {
  let Fd = null;
  try {
    Fd = fsSync.openSync(ArgDirPath, 'r');
    fsSync.fsyncSync(Fd);
  } catch(error) {
    WarnDegraded(ArgLogger, `directory fsync unsupported or failed for ${ArgDirPath} (rename is written but may not survive a hard kill)`, error);
  } finally {
    if(Fd !== null) {
      try {
        fsSync.closeSync(Fd);
      } catch(error) {
        // Same as the async path: a failed close cannot affect the written data.
      }
    }
  }
}

/**
 * Write a file crash-atomically: temp -> fsync -> rename -> fsync parent dir.
 *
 * On any failure the destination keeps its previous contents byte for byte and the temp file is
 * removed, so a failed write can never leave a half-written store behind. Rejects with the
 * underlying error so callers keep whatever error contract they already had.
 * @param {string} ArgFilePath Absolute destination path.
 * @param {string|Buffer} ArgContents Bytes to write.
 * @param {{ Logger?: { warn?: (...ArgArgs: any[]) => void } }} [ArgOptions] Optional logger holder.
 * @returns {Promise<void>}
 */
async function WriteFileDurableAsync(ArgFilePath, ArgContents, ArgOptions) {
  const Logger = ArgOptions && ArgOptions.Logger;
  const TempPath = BuildTempPath(ArgFilePath);
  let Handle = null;
  let Renamed = false;
  try {
    Handle = await fs.open(TempPath, 'w');
    await Handle.writeFile(ArgContents, 'utf8');
    await Handle.sync();
    await Handle.close();
    Handle = null;

    await fs.rename(TempPath, ArgFilePath);
    Renamed = true;

    await FsyncDirAsync(path.dirname(ArgFilePath), Logger);
  } catch(error) {
    if(Handle) {
      try {
        await Handle.close();
      } catch(closeError) {
        // Ignore: the original error is the one worth surfacing.
      }
    }
    if(!Renamed) {
      try {
        await fs.unlink(TempPath);
      } catch(unlinkError) {
        // Best-effort cleanup; a leftover temp is untidy but never corrupts the destination.
      }
    }
    throw error;
  }
}

/**
 * Synchronous counterpart of WriteFileDurableAsync, for call sites that are sync today and would
 * otherwise need an async refactor to gain durability (`client-mapping.js`). Same guarantees, same
 * sequence, same cleanup-on-failure behaviour.
 * @param {string} ArgFilePath Absolute destination path.
 * @param {string|Buffer} ArgContents Bytes to write.
 * @param {{ Logger?: { warn?: (...ArgArgs: any[]) => void } }} [ArgOptions] Optional logger holder.
 * @returns {void}
 */
function WriteFileDurableSync(ArgFilePath, ArgContents, ArgOptions) {
  const Logger = ArgOptions && ArgOptions.Logger;
  const TempPath = BuildTempPath(ArgFilePath);
  let Fd = null;
  let Renamed = false;
  try {
    Fd = fsSync.openSync(TempPath, 'w');
    fsSync.writeFileSync(Fd, ArgContents, 'utf8');
    fsSync.fsyncSync(Fd);
    fsSync.closeSync(Fd);
    Fd = null;

    fsSync.renameSync(TempPath, ArgFilePath);
    Renamed = true;

    FsyncDirSync(path.dirname(ArgFilePath), Logger);
  } catch(error) {
    if(Fd !== null) {
      try {
        fsSync.closeSync(Fd);
      } catch(closeError) {
        // Ignore: the original error is the one worth surfacing.
      }
    }
    if(!Renamed) {
      try {
        fsSync.unlinkSync(TempPath);
      } catch(unlinkError) {
        // Best-effort cleanup.
      }
    }
    throw error;
  }
}

/**
 * Append to a file and `fsync` it before resolving, so the appended bytes are on disk rather than
 * sitting in the page cache.
 *
 * Append is already far safer than a full-file rewrite — a torn append damages only the final
 * record, which `event-store.js`'s reader already skips — so this buys recency, not integrity.
 * No temp file or rename is involved: renaming would defeat the point of an append-only log.
 * @param {string} ArgFilePath Absolute path of the log file.
 * @param {string|Buffer} ArgContents Bytes to append, including any trailing newline.
 * @returns {Promise<void>}
 */
async function AppendFileDurableAsync(ArgFilePath, ArgContents) {
  let Handle = null;
  try {
    Handle = await fs.open(ArgFilePath, 'a');
    await Handle.appendFile(ArgContents, 'utf8');
    await Handle.sync();
  } finally {
    if(Handle) {
      try {
        await Handle.close();
      } catch(error) {
        // Ignore: data is already synced by this point.
      }
    }
  }
}

/**
 * Age after which an abandoned temp file is considered stale and safe to remove. Comfortably longer
 * than any real write, so a temp belonging to an in-flight write by another process is never taken.
 * @type {number}
 */
const STALE_TEMP_MS = 60 * 60 * 1000;

/**
 * Remove temp files stranded beside a store by an earlier hard kill.
 *
 * `SIGKILL` cannot be trapped, so a crash mid-write leaves its temp behind — the crash-injection
 * harness reproduces this (14 strays across 40 kills). Strays are harmless to readers, since the
 * store is only ever replaced by an atomic rename, but they would accumulate unbounded across a
 * long-lived deployment. Call this when a store loads.
 *
 * Age-gated rather than pid-gated: a temp younger than STALE_TEMP_MS may belong to a live write in
 * another process, and deleting that would reintroduce exactly the corruption this module exists to
 * prevent. Never throws — cleanup is housekeeping and must not block a store from loading.
 * @param {string} ArgFilePath Store path whose siblings should be swept.
 * @param {{ Logger?: { warn?: (...ArgArgs: any[]) => void } }} [ArgOptions] Optional logger holder.
 * @returns {Promise<number>} Count of temp files removed.
 */
async function SweepStaleTempsAsync(ArgFilePath, ArgOptions) {
  const Logger = ArgOptions && ArgOptions.Logger;
  const DirPath = path.dirname(ArgFilePath);
  const Prefix = `${path.basename(ArgFilePath)}.`;
  let Removed = 0;
  try {
    const Entries = await fs.readdir(DirPath);
    const Cutoff = Date.now() - STALE_TEMP_MS;
    for(const Entry of Entries) {
      if(!Entry.startsWith(Prefix) || !Entry.endsWith('.tmp')) continue;
      const Candidate = path.join(DirPath, Entry);
      try {
        const Stats = await fs.stat(Candidate);
        if(Stats.mtimeMs > Cutoff) continue;
        await fs.unlink(Candidate);
        Removed += 1;
      } catch(error) {
        // A temp that vanished under us, or one we may not remove, is not worth failing a load over.
      }
    }
  } catch(error) {
    WarnDegraded(Logger, `could not sweep stale temp files beside ${ArgFilePath}`, error);
  }
  return Removed;
}

module.exports = {
  WriteFileDurableAsync,
  WriteFileDurableSync,
  AppendFileDurableAsync,
  SweepStaleTempsAsync,
  BuildTempPath,
  STALE_TEMP_MS,
};
