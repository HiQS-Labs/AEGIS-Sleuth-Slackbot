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
  IsProjectionRequested,
} = require('../src/reminders-projection');
const { createLedgerCoverage, CoverageFilePath } = require('../src/ledger-coverage');

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

test('PARKED: every real projection flag is blocked in CODE, not only in server config', async () => {
  // The read cutover is parked by decision. Both servers also have these set to `authoritative` in
  // `.env.runtime`, but that is config on two machines: it left a live path from a routine
  // `projection-parity-harness --record-coverage` run straight to a production cutover with no
  // deploy and no review. This list is the code half, and it is what makes the parked state hold.
  for(const Flag of [
    'REMINDERS_READ_SOURCE',
    'COMPLETED_READ_SOURCE',
    'REBALANCE_EXPORT_SOURCE',
    'SUMMARIZE_WEEK_COMPLETED_SOURCE',
  ]) {
    assert.equal(BLOCKED_PROJECTION_FLAGS.has(Flag), true, `${Flag} must be blocked while parked`);
  }

  // And blocked must actually mean "serves authoritative", not merely "is listed".
  for(const Flag of ['REMINDERS_READ_SOURCE', 'COMPLETED_READ_SOURCE', 'REBALANCE_EXPORT_SOURCE']) {
    const Result = await Call({
      flagName: Flag,
      environment: { [Flag]: 'projection' },
      // A gate that would say "clean", to prove the block outranks it.
      IsCoverageCleanAsync: async () => true,
    });
    assert.equal(Result.source, 'authoritative', `${Flag} must not serve even with a clean gate`);
    assert.equal(Result.value, 'authoritative-value');
  }
});

test('the ungated summarize-week flag is refused too, via the same list', () => {
  // SUMMARIZE_WEEK_COMPLETED_SOURCE never reaches ReadWithProjectionFallbackAsync — it is read at
  // its own call site and has NO coverage gate of any kind, which made it the least protected of
  // the four. IsProjectionRequested is how it consults the shared blocklist.
  assert.equal(
    IsProjectionRequested('SUMMARIZE_WEEK_COMPLETED_SOURCE', {
      env: { SUMMARIZE_WEEK_COMPLETED_SOURCE: 'projection' },
    }),
    false,
    'a blocked flag must read as "not requested" however it is set'
  );

  // The helper must still be capable of returning true, or the assertion above proves nothing.
  assert.equal(
    IsProjectionRequested(OPEN_FLAG, { env: { [OPEN_FLAG]: 'projection' } }), true);
  assert.equal(
    IsProjectionRequested(OPEN_FLAG, { env: { [OPEN_FLAG]: 'authoritative' } }), false);
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
  // Was: "the set is empty by design, per-workspace coverage replaced the global refusal." That is
  // no longer true — the read cutover is parked and all four real flags are blocked again (see the
  // PARKED test above). What this test still proves is the ORDERING: a blocked flag serves
  // authoritative even when the coverage gate would say clean, so re-blocking is a real emergency
  // stop and not merely advisory. Uses the synthetic flag so it stays independent of which real
  // flags happen to be listed.
  assert.equal(BLOCKED_PROJECTION_FLAGS.has(OPEN_FLAG), false, 'precondition: the test flag is free');

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

test('FAIL-CLOSED: a verification that cannot be persisted does NOT open the gate', async (t) => {
  // The gate's whole job is to refuse without proof. WriteMarkerAsync used to cache the marker
  // before the durable write and swallow the failure, so a RecordVerifiedAsync whose disk write
  // failed opened the gate for the rest of the process's life with nothing on disk behind it —
  // a fail-OPEN in a component that exists to fail closed. Found by Codex, 2026-08-09 consult.
  const Parent = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-ro-'));
  t.after(async () => {
    await fs.chmod(Parent, 0o700).catch(() => {});
    await fs.rm(Parent, { recursive: true, force: true });
  });
  // rootDir does not exist yet and its parent is not writable, so both the mkdir and the write fail.
  const Root = path.join(Parent, 'nested');
  await fs.chmod(Parent, 0o500);

  const Gate = createLedgerCoverage({ rootDir: Root, isolate: true });
  await Gate.RecordVerifiedAsync('acme', { eventCount: 12 });

  assert.equal(await Gate.IsCleanAsync('acme'), false, 'an unproven verification must not serve');
  assert.match(await Gate.DescribeAsync('acme'), /no verification has ever been recorded/);
});

test('the gate is not open BEFORE a verification is durable, only after', async (t) => {
  // The ordering half of the same fix, which the test above does not reach: even on a filesystem
  // where the write ultimately SUCCEEDS, caching the marker before awaiting it opens the gate
  // during the write. RecordVerifiedAsync is async and the harness does not await it in lockstep
  // with reads, so this window is reachable — the marker must not count until it is on disk.
  const Root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-order-'));
  t.after(() => fs.rm(Root, { recursive: true, force: true }));

  const Gate = createLedgerCoverage({ rootDir: Root, isolate: true });
  const Recording = Gate.RecordVerifiedAsync('acme', { eventCount: 3 }); // deliberately not awaited
  assert.equal(await Gate.IsCleanAsync('acme'), false, 'unproven in flight is not clean');
  await Recording;
  assert.equal(await Gate.IsCleanAsync('acme'), true, 'and clean once it is durable');
});

test('a failed RE-verification does not keep serving on the previous proof', async (t) => {
  // The reset-to-null in the failure path earns its place only here. With a marker already on
  // disk, dropping the cache entry would send the next read back to that older `verified` — the
  // proof the failed write was meant to supersede — and the gate would keep serving as if the
  // re-verification had succeeded.
  const Root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-reverify-'));
  t.after(() => fs.rm(Root, { recursive: true, force: true }));

  const Gate = createLedgerCoverage({ rootDir: Root, isolate: true });
  await Gate.RecordVerifiedAsync('acme', { eventCount: 3 });
  assert.equal(await Gate.IsCleanAsync('acme'), true, 'precondition: an earned marker is on disk');

  // Block only the write; rootDir stays writable, and an older marker stays readable underneath.
  const MarkerPath = CoverageFilePath(Root, 'acme');
  await fs.rm(MarkerPath, { force: true });
  await fs.mkdir(MarkerPath);
  await fs.writeFile(path.join(MarkerPath, 'blocker'), 'x');

  await Gate.RecordVerifiedAsync('acme', { eventCount: 9 });
  assert.equal(await Gate.IsCleanAsync('acme'), false,
    'a re-verification that never reached disk must not inherit the old one');
});

test('a gap closes the gate IMMEDIATELY, without waiting for the durable write', async (t) => {
  // SettleAppend returns this promise but the ledger path does not await it. If the cache write
  // moved after the durable write, there would be a window where the gate still reads `verified`
  // although this process already knows an append was lost. The gap direction must stay optimistic.
  const Root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-sync-'));
  t.after(() => fs.rm(Root, { recursive: true, force: true }));

  const Gate = createLedgerCoverage({ rootDir: Root, isolate: true });
  await Gate.RecordVerifiedAsync('acme', { eventCount: 3 });
  assert.equal(await Gate.IsCleanAsync('acme'), true, 'precondition: the gate is open');

  Gate.BeginAppend('acme');
  const Settling = Gate.SettleAppend('acme', false, 'ReminderScheduled'); // deliberately not awaited
  assert.equal(await Gate.IsCleanAsync('acme'), false, 'the gap must land before the write settles');
  await Settling;
});

test('a gap that cannot be persisted REMOVES the stale verified marker, so a restart cannot re-open',
  async (t) => {
    // The second half of the same fail-open: this process is safe because the gap is cached, but a
    // restart reads the disk — and an older `verified` marker there is now provably wrong. Absence
    // reads as unclean, so removing it is a durable way to fail closed when writing is impossible.
    const Root = await fs.mkdtemp(path.join(os.tmpdir(), 'coverage-stale-'));
    t.after(() => fs.rm(Root, { recursive: true, force: true }));

    const Gate = createLedgerCoverage({ rootDir: Root, isolate: true });
    await Gate.RecordVerifiedAsync('acme', { eventCount: 3 });
    const MarkerPath = CoverageFilePath(Root, 'acme');
    assert.equal(JSON.parse(await fs.readFile(MarkerPath, 'utf8')).state, 'verified');

    // Block the write without blocking removal: a directory at the marker path defeats
    // WriteFileDurableAsync while rootDir itself stays writable.
    await fs.rm(MarkerPath, { force: true });
    await fs.mkdir(MarkerPath);
    await fs.writeFile(path.join(MarkerPath, 'blocker'), 'x');

    Gate.BeginAppend('acme');
    await Gate.SettleAppend('acme', false, 'ReminderScheduled');

    assert.equal(await Gate.IsCleanAsync('acme'), false, 'this process must see the gap');
    await assert.rejects(() => fs.stat(MarkerPath), /ENOENT/,
      'the stale marker must be gone, not left for the next process to trust');

    // A genuinely fresh process reads only the disk. Absence is unclean.
    const AfterRestart = createLedgerCoverage({ rootDir: Root, isolate: true });
    assert.equal(await AfterRestart.IsCleanAsync('acme'), false, 'a restart must not re-open the gate');
  });
