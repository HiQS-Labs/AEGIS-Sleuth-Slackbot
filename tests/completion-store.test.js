'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const CompletionStore = require('../src/completion-store');

/**
 * Build a store backed by a real temp file, plus a captured log so tests can assert on
 * warn/error output without a full SlackApp.
 * @param {string} ArgFilePath
 */
function MakeStore(ArgFilePath) {
  const Logged = { errors: [], warns: [] };
  const SlackApp = {
    Logger: {
      error: (...ArgArgs) => Logged.errors.push(ArgArgs),
      warn: (...ArgArgs) => Logged.warns.push(ArgArgs),
    },
  };
  return { Store: new CompletionStore(SlackApp, ArgFilePath), Logged };
}

/**
 * @param {Partial<import('../src/completion-store').CompletionRecord>} ArgOverrides
 */
function MakeRecord(ArgOverrides = {}) {
  return {
    reminderId: 'r1',
    summary: 'A task',
    assigneeID: null,
    sourceChannelID: null,
    dueDate: null,
    completedMs: Date.now(),
    ...ArgOverrides,
  };
}

describe('CompletionStore', () => {
  let TmpDir;
  let FilePath;

  beforeEach(async () => {
    TmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-store-'));
    FilePath = path.join(TmpDir, 'ws_completed.json');
  });

  afterEach(async () => {
    await fs.rm(TmpDir, { recursive: true, force: true });
  });

  test('LoadAsync on a missing file starts empty without logging an error', async () => {
    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();
    expect(Store.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect(Logged.errors).toHaveLength(0);
  });

  test('Record reflects immediately in memory and is durable across a reload', async () => {
    const Now = Date.now();
    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.Record(MakeRecord({ reminderId: 'a', completedMs: Now - 1000 }));

    expect(Store.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER).map(r => r.reminderId)).toEqual(['a']);

    const { Store: Reloaded } = MakeStore(FilePath);
    await Reloaded.LoadAsync();
    expect(Reloaded.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER).map(r => r.reminderId)).toEqual(['a']);
  });

  test('GetCompletedBetween is inclusive of start, exclusive of end, and sorted ascending', async () => {
    const Now = Date.now();
    const Start = Now - 300_000;
    const End = Now - 200_000;
    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.Record(MakeRecord({ reminderId: 'mid', completedMs: Now - 250_000 }));
    await Store.Record(MakeRecord({ reminderId: 'start', completedMs: Start }));
    await Store.Record(MakeRecord({ reminderId: 'end', completedMs: End }));

    // start (== Start) included, end (== End) excluded, returned oldest-first.
    expect(Store.GetCompletedBetween(Start, End).map(r => r.reminderId)).toEqual(['start', 'mid']);
  });

  test('Record de-dupes by reminderId, last write wins', async () => {
    const Now = Date.now();
    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.Record(MakeRecord({ reminderId: 'x', summary: 'first', completedMs: Now - 2000 }));
    await Store.Record(MakeRecord({ reminderId: 'x', summary: 'second', completedMs: Now - 1000 }));

    const Rows = Store.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER);
    expect(Rows).toHaveLength(1);
    expect(Rows[0].summary).toBe('second');
    expect(Rows[0].completedMs).toBe(Now - 1000);
  });

  test('invalid records are ignored and warned, never persisted', async () => {
    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.Record({ reminderId: '', completedMs: Date.now() }); // empty id
    await Store.Record({ reminderId: 'ok', completedMs: Number.NaN }); // non-finite ms
    await Store.Record(null); // not an object

    expect(Store.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect(Logged.warns).toHaveLength(3);
  });

  test('records older than the retention window are pruned on record and on load', async () => {
    const Now = Date.now();
    const StaleMs = Now - CompletionStore.RETENTION_MS - 1000; // just over a year old
    const FreshMs = Now - 1000;

    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.Record(MakeRecord({ reminderId: 'stale', completedMs: StaleMs }));
    await Store.Record(MakeRecord({ reminderId: 'fresh', completedMs: FreshMs }));

    // Pruned on record: the stale row never survives in memory.
    expect(Store.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER).map(r => r.reminderId)).toEqual(['fresh']);

    // And a reload of whatever reached disk stays pruned too.
    const { Store: Reloaded } = MakeStore(FilePath);
    await Reloaded.LoadAsync();
    expect(Reloaded.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER).map(r => r.reminderId)).toEqual(['fresh']);
  });

  test('load-time pruning is persisted to disk, not just dropped from memory', async () => {
    const Now = Date.now();
    const StaleMs = Now - CompletionStore.RETENTION_MS - 1000;
    const FreshMs = Now - 1000;
    // Seed the file directly with a stale row that a load should age out durably.
    await fs.writeFile(FilePath, JSON.stringify([
      { reminderId: 'stale', summary: 'old', assigneeID: null, sourceChannelID: null, dueDate: null, completedMs: StaleMs },
      { reminderId: 'fresh', summary: 'new', assigneeID: null, sourceChannelID: null, dueDate: null, completedMs: FreshMs },
    ]), 'utf8');

    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();

    // The stale row is gone from disk after load, so quiet workspaces don't keep it indefinitely.
    const OnDisk = JSON.parse(await fs.readFile(FilePath, 'utf8'));
    expect(OnDisk.map(r => r.reminderId)).toEqual(['fresh']);
  });

  test('FlushAsync resolves after the most recent queued write has reached disk', async () => {
    const Now = Date.now();
    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();
    Store.Record(MakeRecord({ reminderId: 'a', completedMs: Now - 1000 })); // not awaited — fire-and-forget
    await Store.FlushAsync();

    const OnDisk = JSON.parse(await fs.readFile(FilePath, 'utf8'));
    expect(OnDisk.map(r => r.reminderId)).toEqual(['a']);
  });

  test('LoadAsync tolerates a corrupt file by starting empty and logging an error', async () => {
    await fs.writeFile(FilePath, '{ not valid json', 'utf8');
    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();
    expect(Store.GetCompletedBetween(0, Number.MAX_SAFE_INTEGER)).toEqual([]);
    expect(Logged.errors).toHaveLength(1);
  });
});
