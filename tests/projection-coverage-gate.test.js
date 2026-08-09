'use strict';

// node --test tests/projection-coverage-gate.test.js
//
// The gate that decides whether a read flag may actually serve a projection.
//
// These exist because the mechanism was, for a while, entirely inert: `ledger-coverage.js` was
// correct and `ReadWithProjectionFallbackAsync` accepted a gate, but no production call site passed
// one AND the check was skipped when absent. Coverage was recorded that nothing read. Every test
// below fails if that permissive default comes back.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  ReadWithProjectionFallbackAsync,
  BLOCKED_PROJECTION_FLAGS,
} = require('../src/reminders-projection');
const { createLedgerCoverage } = require('../src/ledger-coverage');

// An unblocked flag, so these exercise the coverage gate rather than short-circuiting on the
// blocked-flag branch above it.
const OPEN_FLAG = 'PROJECTION_ERROR_PATH_TEST_ONLY';

/** @param {Partial<Parameters<typeof ReadWithProjectionFallbackAsync>[0]>} ArgOverrides */
function Call(ArgOverrides = {}) {
  return ReadWithProjectionFallbackAsync({
    flagName: OPEN_FLAG,
    environment: { [OPEN_FLAG]: 'projection' },
    ReadAuthoritativeAsync: async () => 'authoritative-value',
    ReadProjectionAsync: async () => 'projection-value',
    ...ArgOverrides,
  });
}

test('the test flag really is unblocked, or everything below proves nothing', () => {
  // Guard on the instrument. If this flag were blocked, every assertion here would pass via the
  // blocked-flag branch without the coverage gate ever running.
  assert.equal(BLOCKED_PROJECTION_FLAGS.has(OPEN_FLAG), false);
});

test('DEFAULT-DENY: a call site that supplies no coverage gate is NOT served a projection', async () => {
  // The regression this file exists for. Every production call site looked like this, so enabling
  // a flag would have served an ungated fold.
  const Result = await Call();
  assert.equal(Result.source, 'authoritative');
  assert.equal(Result.value, 'authoritative-value');
});

test('a gate reporting unclean is not served', async () => {
  const Result = await Call({ IsCoverageCleanAsync: async () => false });
  assert.equal(Result.source, 'authoritative');
});

test('a gate that THROWS is not treated as a pass', async () => {
  // Otherwise the strictest path would be the easiest one to switch off: make the gate fail and
  // get the projection anyway.
  const Result = await Call({
    IsCoverageCleanAsync: async () => { throw new Error('marker unreadable'); },
  });
  assert.equal(Result.source, 'authoritative');
});

test('a gate answering a non-boolean truthy value is not a pass either', async () => {
  const Result = await Call({ IsCoverageCleanAsync: async () => 'yes' });
  assert.equal(Result.source, 'authoritative', 'only a literal true may open the gate');
});

test('a clean gate DOES serve the projection', async () => {
  // The positive case matters as much as the negatives: a gate that can never open would be a
  // permanently disabled feature rather than a safe one.
  const Result = await Call({ IsCoverageCleanAsync: async () => true });
  assert.equal(Result.source, 'projection');
  assert.equal(Result.value, 'projection-value');
});

test('the emergency stop still outranks a clean gate', async () => {
  // BLOCKED_PROJECTION_FLAGS is empty by design now — per-workspace coverage replaced the global
  // refusal. But it remains the rollback lever for a fold found lossy in a way per-workspace
  // evidence cannot detect, so it has to keep working. An empty set means no test would otherwise
  // touch this branch.
  assert.equal(BLOCKED_PROJECTION_FLAGS.size, 0, 'no flag should be blocked outright today');

  BLOCKED_PROJECTION_FLAGS.add(OPEN_FLAG);
  try {
    const Result = await Call({ IsCoverageCleanAsync: async () => true });
    assert.equal(Result.source, 'authoritative', 'the block list outranks a clean gate');
  } finally {
    BLOCKED_PROJECTION_FLAGS.delete(OPEN_FLAG);
  }
});

test('coverage instances are SHARED per rootDir, so an in-flight append is visible across modules',
  async (t) => {
    // web-api and reminders-module both read the same ledger directory in one process. If each got
    // its own instance, web-api could serve a projection while reminders-module had an append in
    // flight — the exact window the in-flight counter exists to cover.
    const Root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-shared-'));
    t.after(() => fs.rm(Root, { recursive: true, force: true }));

    const AsRemindersModule = createLedgerCoverage({ rootDir: Root });
    const AsWebApi = createLedgerCoverage({ rootDir: Root });
    await AsRemindersModule.RecordVerifiedAsync('acme');
    assert.equal(await AsWebApi.IsCleanAsync('acme'), true);

    AsRemindersModule.BeginAppend('acme');
    assert.equal(
      await AsWebApi.IsCleanAsync('acme'), false,
      'the second holder must see the first holder\'s in-flight append'
    );

    await AsRemindersModule.SettleAppend('acme', true, 'ReminderScheduled');
    assert.equal(await AsWebApi.IsCleanAsync('acme'), true);
  });

test('a different rootDir gets its own instance', async (t) => {
  const RootA = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-a-'));
  const RootB = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-b-'));
  t.after(() => Promise.all([
    fs.rm(RootA, { recursive: true, force: true }),
    fs.rm(RootB, { recursive: true, force: true }),
  ]));

  const A = createLedgerCoverage({ rootDir: RootA });
  const B = createLedgerCoverage({ rootDir: RootB });
  await A.RecordVerifiedAsync('acme');
  assert.equal(await A.IsCleanAsync('acme'), true);
  assert.equal(await B.IsCleanAsync('acme'), false, 'sharing must be keyed on the directory');
});
