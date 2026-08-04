'use strict';

/**
 * Child process for the crash-injection harness. Rewrites a JSON store in a tight loop until the
 * parent SIGKILLs it, so the kill has a high chance of landing inside a write.
 *
 * Two modes, so the harness can prove it actually detects the bug before it is trusted to certify
 * a fix:
 *   `unsafe`  — the pre-GH-12 path: a bare `fs.writeFile`, i.e. truncate-then-rewrite.
 *   `durable` — the GH-12 path: `WriteFileDurableAsync` (temp -> fsync -> rename -> fsync dir).
 *
 * Usage: node crash-writer.js <unsafe|durable> <targetPath> <recordCount>
 */

const fs = require('fs').promises;
const { WriteFileDurableAsync } = require('../../src/durable-write');

const Mode = process.argv[2];
const TargetPath = process.argv[3];
const RecordCount = Number(process.argv[4]) || 20000;

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
    Records.push({
      reminderId: `rem-${ArgGeneration}-${Index}`,
      summary: `generation ${ArgGeneration} record ${Index} padding padding padding padding`,
      assigneeID: 'U0123456789',
      sourceChannelID: 'C0123456789',
      dueDate: '2026-08-04T00:00:00.000Z',
      completedMs: 1785867610000 + Index,
    });
  }
  return JSON.stringify(Records, null, 2);
}

async function MainAsync() {
  let Generation = 0;
  // Signal readiness so the parent starts its kill timer only once real writing is under way.
  process.stdout.write('ready\n');
  for(;;) {
    Generation += 1;
    const Payload = BuildPayload(Generation);
    if(Mode === 'durable') {
      await WriteFileDurableAsync(TargetPath, Payload);
    } else {
      await fs.writeFile(TargetPath, Payload, 'utf8');
    }
  }
}

MainAsync().catch(ArgError => {
  process.stderr.write(`crash-writer: ${ArgError && ArgError.message}\n`);
  process.exit(1);
});
