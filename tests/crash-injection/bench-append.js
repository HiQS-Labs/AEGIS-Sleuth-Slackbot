'use strict';

/**
 * GH-12 Phase 4 — measure before choosing the ledger's append shape.
 *
 * Phase 1 deliberately shipped no append primitive: nothing before this phase appends, so
 * publishing the API earlier would have fixed its shape before this measurement determined it.
 * The agy Phase 1 review called open/fsync/close-per-append a "massive performance bottleneck";
 * that may or may not be true here, and neither of us had a number. This produces one.
 *
 * Four candidates, in increasing order of complexity:
 *   baseline        — today's `fs.appendFile`, no fsync at all (the thing being replaced)
 *   sync-per-append — open 'a' -> appendFile -> fsync -> close, every call
 *   batched-sync    — hold a handle, fsync every N appends
 *   handle-holding  — hold a handle open, fsync every append, never reopen
 *
 * Usage: node tests/crash-injection/bench-append.js [--appends 500] [--batch 20]
 */

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

/**
 * @param {string} ArgName Flag name without dashes.
 * @param {string} ArgFallback Default.
 * @returns {string}
 */
function ReadFlag(ArgName, ArgFallback) {
  const Index = process.argv.indexOf(`--${ArgName}`);
  return Index === -1 ? ArgFallback : process.argv[Index + 1];
}

const AppendCount = Number(ReadFlag('appends', '500'));
const BatchSize = Number(ReadFlag('batch', '20'));

/**
 * A realistic ledger line: one ReminderCompleted event as event-store.js writes it.
 * @param {number} ArgIndex Ordinal.
 * @returns {string}
 */
function MakeEventLine(ArgIndex) {
  return `${JSON.stringify({
    v: 1,
    id: `evt_00000000-0000-4000-8000-${String(ArgIndex).padStart(12, '0')}`,
    ts: '2026-08-04T12:00:00.000Z',
    workspace: 'neochrome',
    type: 'ReminderCompleted',
    reminderId: `rem-${ArgIndex}`,
    payload: { by: 'U0123456789', method: 'reaction', summary: `task ${ArgIndex}`, completedAt: '2026-08-04T12:00:00.000Z' },
  })}\n`;
}

/** @returns {Promise<number>} elapsed ms */
async function BenchBaselineAsync(ArgFilePath) {
  const Start = process.hrtime.bigint();
  for(let Index = 0; Index < AppendCount; Index += 1) {
    await fs.appendFile(ArgFilePath, MakeEventLine(Index), 'utf8');
  }
  return Number(process.hrtime.bigint() - Start) / 1e6;
}

/** @returns {Promise<number>} elapsed ms */
async function BenchSyncPerAppendAsync(ArgFilePath) {
  const Start = process.hrtime.bigint();
  for(let Index = 0; Index < AppendCount; Index += 1) {
    const Handle = await fs.open(ArgFilePath, 'a');
    try {
      await Handle.appendFile(MakeEventLine(Index), 'utf8');
      await Handle.sync();
    } finally {
      await Handle.close();
    }
  }
  return Number(process.hrtime.bigint() - Start) / 1e6;
}

/** @returns {Promise<number>} elapsed ms */
async function BenchBatchedSyncAsync(ArgFilePath) {
  const Start = process.hrtime.bigint();
  const Handle = await fs.open(ArgFilePath, 'a');
  try {
    for(let Index = 0; Index < AppendCount; Index += 1) {
      await Handle.appendFile(MakeEventLine(Index), 'utf8');
      if((Index + 1) % BatchSize === 0) await Handle.sync();
    }
    await Handle.sync();
  } finally {
    await Handle.close();
  }
  return Number(process.hrtime.bigint() - Start) / 1e6;
}

/** @returns {Promise<number>} elapsed ms */
async function BenchHandleHoldingAsync(ArgFilePath) {
  const Start = process.hrtime.bigint();
  const Handle = await fs.open(ArgFilePath, 'a');
  try {
    for(let Index = 0; Index < AppendCount; Index += 1) {
      await Handle.appendFile(MakeEventLine(Index), 'utf8');
      await Handle.sync();
    }
  } finally {
    await Handle.close();
  }
  return Number(process.hrtime.bigint() - Start) / 1e6;
}

async function MainAsync() {
  const WorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bench-append-'));
  const Candidates = [
    ['baseline (fs.appendFile, no fsync)', BenchBaselineAsync],
    ['sync-per-append (open/fsync/close)', BenchSyncPerAppendAsync],
    [`batched-sync (fsync every ${BatchSize})`, BenchBatchedSyncAsync],
    ['handle-holding (fsync every append)', BenchHandleHoldingAsync],
  ];

  process.stdout.write(`bench-append: ${AppendCount} appends per candidate, batch=${BatchSize}\n`);
  process.stdout.write(`platform: ${process.platform} (note: on darwin fsync() does not force a platform flush; Linux prod is stricter)\n\n`);

  const Results = [];
  for(const [Label, Fn] of Candidates) {
    const FilePath = path.join(WorkDir, `${Label.replace(/[^a-z]/gi, '-')}.jsonl`);
    const ElapsedMs = await Fn(FilePath);
    Results.push({ Label, ElapsedMs, PerAppendMs: ElapsedMs / AppendCount });
  }

  const BaselinePerAppend = Results[0].PerAppendMs;
  for(const Result of Results) {
    process.stdout.write(
      `${Result.Label.padEnd(38)} ${Result.ElapsedMs.toFixed(1).padStart(9)} ms total  ` +
      `${Result.PerAppendMs.toFixed(3).padStart(7)} ms/append  ` +
      `${(Result.PerAppendMs / BaselinePerAppend).toFixed(1).padStart(5)}x baseline\n`);
  }

  // What matters is not the ratio but the absolute cost at this system's real event rate.
  const SyncPerAppend = Results[1].PerAppendMs;
  process.stdout.write(
    `\nAt ~100 reminder-lifecycle events/day, sync-per-append costs ` +
    `${(SyncPerAppend * 100).toFixed(1)} ms/day in total added latency.\n`);

  await fs.rm(WorkDir, { recursive: true, force: true });
}

MainAsync().catch(ArgError => {
  process.stderr.write(`bench-append: ${ArgError && ArgError.stack}\n`);
  process.exit(1);
});
