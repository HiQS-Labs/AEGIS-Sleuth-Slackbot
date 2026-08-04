'use strict';

/**
 * GH-12 Phase 3 — durability of the completion store (Tier 2).
 *
 * `#PersistAsync` rewrote the whole file with a bare `fs.writeFile`, so a hard kill mid-write left
 * unparseable JSON. `LoadAsync` degraded that to an empty record set, and the next `Record()` call
 * persisted the near-empty set over the survivor data — up to a year of completion history (the
 * retention window) gone silently, taking `summarize-week` with it.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');

const CompletionStore = require('../src/completion-store');
const { BuildTempPath } = require('../src/durable-write');

/** @type {string} */
let WorkDir;

beforeEach(async () => {
  WorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'completion-store-durability-'));
});

afterEach(async () => {
  await fs.rm(WorkDir, { recursive: true, force: true });
});

/**
 * Build a store over a real temp file with a captured logger.
 * @param {string} ArgFilePath Store path.
 * @returns {{ Store: CompletionStore, Logged: { errors: any[][], warns: any[][] } }}
 */
function MakeStore(ArgFilePath) {
  const Logged = { errors: [], warns: [] };
  const SlackApp = {
    Logger: {
      error: (...ArgArgs) => Logged.errors.push(ArgArgs),
      warn: (...ArgArgs) => Logged.warns.push(ArgArgs),
      info: () => {},
    },
  };
  return { Store: new CompletionStore(SlackApp, ArgFilePath), Logged };
}

/**
 * @param {string} ArgId Reminder id.
 * @returns {object}
 */
function MakeRecord(ArgId) {
  return {
    reminderId: ArgId,
    summary: `completed task ${ArgId}`,
    assigneeID: 'U100',
    sourceChannelID: 'C100',
    dueDate: null,
    completedMs: Date.now(),
  };
}

/**
 * Quarantine siblings of a store path.
 * @param {string} ArgFilePath Store path.
 * @returns {string[]}
 */
function QuarantineFiles(ArgFilePath) {
  const Base = path.basename(ArgFilePath);
  return fsSync.readdirSync(path.dirname(ArgFilePath))
    .filter(ArgName => ArgName.startsWith(`${Base}.corrupt-`));
}

describe('corrupt history is quarantined, not silently zeroed', () => {
  test('truncated JSON is moved aside with its bytes intact', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    const Truncated = JSON.stringify([MakeRecord('a'), MakeRecord('b')], null, 2).slice(0, 90);
    await fs.writeFile(FilePath, Truncated, 'utf8');

    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();

    const Quarantined = QuarantineFiles(FilePath);
    expect(Quarantined).toHaveLength(1);
    expect(await fs.readFile(path.join(WorkDir, Quarantined[0]), 'utf8')).toBe(Truncated);
    expect(Logged.errors.length).toBeGreaterThan(0);
  });

  // The exact GH-12 cascade: after a corrupt load the next completion used to persist the empty set
  // over the original file. Quarantining first means the bytes survive that write.
  test('a later write cannot destroy the quarantined bytes', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    const Original = 'this is not json at all';
    await fs.writeFile(FilePath, Original, 'utf8');

    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.Record(MakeRecord('fresh'));
    await Store.FlushAsync();

    // The live store moved on with just the new record...
    expect(JSON.parse(await fs.readFile(FilePath, 'utf8'))).toHaveLength(1);
    // ...and the original bytes are still on disk.
    const Quarantined = QuarantineFiles(FilePath);
    expect(Quarantined).toHaveLength(1);
    expect(await fs.readFile(path.join(WorkDir, Quarantined[0]), 'utf8')).toBe(Original);
  });

  test('valid JSON of the wrong shape is quarantined too', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    await fs.writeFile(FilePath, JSON.stringify({ records: [] }), 'utf8');

    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();

    expect(QuarantineFiles(FilePath)).toHaveLength(1);
    expect(Store.GetCompletedBetween(0, Date.now() + 1000)).toEqual([]);
  });

  // An empty array is a valid state — a workspace with no completions in the retention window.
  test('an empty array is not corruption', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    await fs.writeFile(FilePath, '[]', 'utf8');

    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();

    expect(QuarantineFiles(FilePath)).toHaveLength(0);
    expect(Logged.errors).toEqual([]);
  });

  // ENOENT is the ordinary first-run case: a fresh workspace must still be able to save.
  test('a missing file is a normal first run — no quarantine, saving still works', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');

    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.Record(MakeRecord('first'));
    await Store.FlushAsync();

    expect(QuarantineFiles(FilePath)).toHaveLength(0);
    expect(Logged.errors).toEqual([]);
    expect(JSON.parse(await fs.readFile(FilePath, 'utf8'))).toHaveLength(1);
  });

  // Bytes we could not read are not bytes we know to be bad, so a read failure must not quarantine.
  test('an unreadable file is not quarantined', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    await fs.writeFile(FilePath, JSON.stringify([MakeRecord('a')]), 'utf8');
    const ReadSpy = jest.spyOn(fs, 'readFile')
      .mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));

    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();

    expect(QuarantineFiles(FilePath)).toHaveLength(0);
    expect(Logged.errors.length).toBeGreaterThan(0);
    ReadSpy.mockRestore();
  });
});

describe('existing guarantees still hold', () => {
  test('#WriteChain still serializes concurrent records', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();

    await Promise.all(Array.from({ length: 20 }, (ArgUnused, ArgIndex) =>
      Store.Record(MakeRecord(`rec-${ArgIndex}`))));
    await Store.FlushAsync();

    const OnDisk = JSON.parse(await fs.readFile(FilePath, 'utf8'));
    expect(OnDisk).toHaveLength(20);
  });

  // #PersistAsync must still swallow write errors so a failed save cannot poison the chain or
  // reject into the FSM hook, which fires it without awaiting.
  test('a failed persist neither rejects nor poisons the chain', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();

    const RenameSpy = jest.spyOn(fs, 'rename')
      .mockRejectedValueOnce(new Error('simulated rename failure'));

    await expect(Store.Record(MakeRecord('during-failure'))).resolves.toBeUndefined();
    expect(Logged.errors.length).toBeGreaterThan(0);
    RenameSpy.mockRestore();

    // The chain still works afterwards.
    await Store.Record(MakeRecord('after-failure'));
    await Store.FlushAsync();
    expect(JSON.parse(await fs.readFile(FilePath, 'utf8')).length).toBeGreaterThan(0);
  });

  test('FlushAsync waits for the durable write, including its fsync', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();

    Store.Record(MakeRecord('unawaited')); // fire-and-forget, as the FSM hook does
    await Store.FlushAsync();

    expect(JSON.parse(await fs.readFile(FilePath, 'utf8'))).toHaveLength(1);
  });
});

describe('stale temp files', () => {
  test('a temp stranded by an earlier hard kill is swept on load', async () => {
    const FilePath = path.join(WorkDir, 'completed.json');
    await fs.writeFile(FilePath, JSON.stringify([MakeRecord('kept')]), 'utf8');

    const Stray = BuildTempPath(FilePath);
    await fs.writeFile(Stray, 'half-written payload', 'utf8');
    const Old = new Date(Date.now() - (2 * 60 * 60 * 1000));
    await fs.utimes(Stray, Old, Old);

    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();

    expect(fsSync.existsSync(Stray)).toBe(false);
    expect(JSON.parse(await fs.readFile(FilePath, 'utf8'))).toHaveLength(1);
  });
});
