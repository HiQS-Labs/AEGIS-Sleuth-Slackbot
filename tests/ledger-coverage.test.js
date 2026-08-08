'use strict';

// node --test tests/ledger-coverage.test.js
// The generation-aware coverage gate (P3 Phase C) — the check that answers "is an event MISSING?",
// which no payload validation can. Runs under node's built-in runner alongside the other projection
// suites.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLedgerCoverage, CoverageFilePath } = require('../src/ledger-coverage');

async function MakeRootAsync() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ledger-coverage-'));
}

test('a workspace with no recorded verification is NOT clean', async (t) => {
  // The load-bearing default. "Nothing has visibly gone wrong" is not evidence of coverage, and a
  // fresh deployment must not silently serve a projection.
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Coverage = createLedgerCoverage({ rootDir: Root });

  assert.equal(await Coverage.IsCleanAsync('acme'), false);
  assert.match(await Coverage.DescribeAsync('acme'), /no verification has ever been recorded/);
});

test('a recorded verification makes it clean', async (t) => {
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Coverage = createLedgerCoverage({ rootDir: Root });

  await Coverage.RecordVerifiedAsync('acme', { eventCount: 1467, reminderCount: 23, completedCount: 152 });
  assert.equal(await Coverage.IsCleanAsync('acme'), true);

  const Marker = JSON.parse(await fs.readFile(CoverageFilePath(Root, 'acme'), 'utf8'));
  assert.equal(Marker.state, 'verified');
  assert.equal(Marker.evidence.reminderCount, 23, 'the evidence is recorded, not just the verdict');
});

test('an in-flight append closes the gate, and settling reopens it', async (t) => {
  // The JSON store can lead the log for the duration of an append. Serving mid-flight would hand
  // out a projection that is legitimately short.
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Coverage = createLedgerCoverage({ rootDir: Root });
  await Coverage.RecordVerifiedAsync('acme');

  Coverage.BeginAppend('acme');
  assert.equal(await Coverage.IsCleanAsync('acme'), false);
  assert.match(await Coverage.DescribeAsync('acme'), /in flight/);

  await Coverage.SettleAppend('acme', true, 'ReminderCreated');
  assert.equal(await Coverage.IsCleanAsync('acme'), true);
});

test('concurrent appends only reopen the gate when the LAST one settles', async (t) => {
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Coverage = createLedgerCoverage({ rootDir: Root });
  await Coverage.RecordVerifiedAsync('acme');

  Coverage.BeginAppend('acme');
  Coverage.BeginAppend('acme');
  await Coverage.SettleAppend('acme', true, 'a');
  assert.equal(await Coverage.IsCleanAsync('acme'), false, 'one append is still outstanding');
  await Coverage.SettleAppend('acme', true, 'b');
  assert.equal(await Coverage.IsCleanAsync('acme'), true);
});

test('a FAILED append records a durable gap that survives a restart', async (t) => {
  // The whole reason this is on disk. Nothing retries a failed append, so the log is short from
  // that moment on — the shortfall is in the file, not merely in this process's memory.
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Coverage = createLedgerCoverage({ rootDir: Root });
  await Coverage.RecordVerifiedAsync('acme');

  Coverage.BeginAppend('acme');
  await Coverage.SettleAppend('acme', false, 'ReminderScheduled');
  assert.equal(await Coverage.IsCleanAsync('acme'), false);

  // A brand-new instance, as after a process restart, reading only what is on disk.
  const Restarted = createLedgerCoverage({ rootDir: Root });
  assert.equal(await Restarted.IsCleanAsync('acme'), false, 'a restart must not clear a real gap');
  assert.match(await Restarted.DescribeAsync('acme'), /gap recorded/);
});

test('only a fresh verification clears a gap', async (t) => {
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Coverage = createLedgerCoverage({ rootDir: Root });

  await Coverage.RecordGapAsync('acme', 'parity-run-found-diffs');
  assert.equal(await Coverage.IsCleanAsync('acme'), false);

  // Successful appends must NOT launder a gap — the missing event is still missing.
  Coverage.BeginAppend('acme');
  await Coverage.SettleAppend('acme', true, 'ReminderCreated');
  assert.equal(await Coverage.IsCleanAsync('acme'), false, 'a later success does not backfill an earlier loss');

  await Coverage.RecordVerifiedAsync('acme');
  assert.equal(await Coverage.IsCleanAsync('acme'), true);
});

test('coverage is per-workspace', async (t) => {
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Coverage = createLedgerCoverage({ rootDir: Root });

  await Coverage.RecordVerifiedAsync('acme');
  await Coverage.RecordGapAsync('other', 'append-failed');
  assert.equal(await Coverage.IsCleanAsync('acme'), true);
  assert.equal(await Coverage.IsCleanAsync('other'), false);
});

test('a corrupt marker reads as unverified, never as clean', async (t) => {
  // Failing open here would defeat the entire gate.
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  await fs.writeFile(CoverageFilePath(Root, 'acme'), '{ this is not json', 'utf8');
  const Coverage = createLedgerCoverage({ rootDir: Root });
  assert.equal(await Coverage.IsCleanAsync('acme'), false);
});

test('a workspace key cannot escape the root directory', async (t) => {
  const Root = await MakeRootAsync();
  t.after(() => fs.rm(Root, { recursive: true, force: true }));
  const Escaped = CoverageFilePath(Root, '../../etc/passwd');
  assert.equal(path.dirname(Escaped), Root);
});
