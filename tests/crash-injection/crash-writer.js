'use strict';

/**
 * Child process for the crash-injection harness. Rewrites (or appends to) a store in a tight loop
 * until the parent SIGKILLs it, so the kill has a high chance of landing inside a write.
 *
 * Every mode comes in a matched pair, so the harness can prove it actually detects the bug before
 * it is trusted to certify a fix. The `unsafe` half of each pair is the pre-GH-12 code path:
 *   `unsafe`        / `durable`        — whole-file async. `fs.writeFile` vs `WriteFileDurableAsync`.
 *   `unsafe-sync`   / `durable-sync`   — whole-file sync.  `fs.writeFileSync` vs `WriteFileDurableSync`.
 *                                        Covers client-mapping.js and show-me-projects-command.js,
 *                                        which the original harness never exercised.
 *   `unsafe-append` / `durable-append` — JSONL append.     `fs.appendFile` vs `AppendFileDurableAsync`.
 *                                        Covers event-store.js and the trashed-examples corpus.
 *
 * Usage: node crash-writer.js <mode> <targetPath> <recordCount>
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const {
  WriteFileDurableAsync,
  WriteFileDurableSync,
  AppendFileDurableAsync,
} = require('../../src/durable-write');

const Mode = process.argv[2];
const TargetPath = process.argv[3];
const RecordCount = Number(process.argv[4]) || 20000;

/**
 * Build one store record. Shared by the whole-file and append shapes so both are exercised with the
 * same realistic field set rather than one being quietly cheaper than the other.
 * @param {number} ArgGeneration Monotonic counter, stamped so each generation differs.
 * @param {number} ArgIndex Record position within the generation.
 * @returns {object}
 */
function BuildRecord(ArgGeneration, ArgIndex) {
  return {
    reminderId: `rem-${ArgGeneration}-${ArgIndex}`,
    summary: `generation ${ArgGeneration} record ${ArgIndex} padding padding padding padding`,
    assigneeID: 'U0123456789',
    sourceChannelID: 'C0123456789',
    dueDate: '2026-08-04T00:00:00.000Z',
    completedMs: 1785867610000 + ArgIndex,
  };
}

/**
 * Build a payload big enough that serializing and writing it spans many event-loop turns and many
 * write syscalls. A small payload can complete in a single atomic-ish write, which would hide the
 * very truncation this harness exists to catch.
 * @param {number} ArgGeneration Monotonic counter, stamped so each generation differs.
 * @returns {string}
 */
function BuildPayload(ArgGeneration) {
  const Records = [];
  for(let Index = 0; Index < RecordCount; Index += 1) {
    Records.push(BuildRecord(ArgGeneration, Index));
  }
  return JSON.stringify(Records, null, 2);
}

/**
 * One JSONL batch. A single append is far too small a window for a kill to land inside, so each
 * generation appends a batch — the same reason BuildPayload pads the whole-file shapes.
 * @param {number} ArgGeneration Monotonic counter.
 * @returns {string}
 */
function BuildAppendBatch(ArgGeneration) {
  let Batch = '';
  for(let Index = 0; Index < RecordCount; Index += 1) {
    Batch += `${JSON.stringify(BuildRecord(ArgGeneration, Index))}\n`;
  }
  return Batch;
}

async function MainAsync() {
  let Generation = 0;
  // Signal readiness so the parent starts its kill timer only once real writing is under way.
  process.stdout.write('ready\n');
  for(;;) {
    Generation += 1;
    switch(Mode) {
      case 'durable':
        await WriteFileDurableAsync(TargetPath, BuildPayload(Generation));
        break;
      case 'unsafe':
        await fs.writeFile(TargetPath, BuildPayload(Generation), 'utf8');
        break;
      case 'durable-sync':
        WriteFileDurableSync(TargetPath, BuildPayload(Generation));
        break;
      case 'unsafe-sync':
        fsSync.writeFileSync(TargetPath, BuildPayload(Generation), 'utf8');
        break;
      case 'durable-append':
        await AppendFileDurableAsync(TargetPath, BuildAppendBatch(Generation));
        break;
      case 'unsafe-append':
        await fs.appendFile(TargetPath, BuildAppendBatch(Generation), 'utf8');
        break;
      default:
        throw new Error(`crash-writer: unknown mode "${Mode}"`);
    }
    // The sync shapes never yield on their own, which would starve the readiness pipe and leave the
    // parent killing a process that has not begun writing.
    if(Mode.endsWith('-sync')) await new Promise(ArgResolve => setImmediate(ArgResolve));
  }
}

MainAsync().catch(ArgError => {
  process.stderr.write(`crash-writer: ${ArgError && ArgError.message}\n`);
  process.exit(1);
});
