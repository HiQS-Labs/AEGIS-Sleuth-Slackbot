'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const path = require('path');

const {
  WriteFileDurableAsync,
  WriteFileDurableSync,
  AppendFileDurableAsync,
  SweepStaleTempsAsync,
  BuildTempPath,
  STALE_TEMP_MS,
} = require('../src/durable-write');

/** @type {string} */
let WorkDir;

beforeEach(async () => {
  WorkDir = await fs.mkdtemp(path.join(os.tmpdir(), 'durable-write-'));
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(WorkDir, { recursive: true, force: true });
});

/**
 * Every temp file this module leaves behind in the work dir. The helper's contract is that this is
 * always empty once a call settles, success or failure.
 * @returns {Promise<string[]>}
 */
async function LeftoverTempsAsync() {
  const Entries = await fs.readdir(WorkDir);
  return Entries.filter(ArgName => ArgName.endsWith('.tmp'));
}

describe('WriteFileDurableAsync', () => {
  test('round-trips content', async () => {
    const Target = path.join(WorkDir, 'store.json');
    await WriteFileDurableAsync(Target, JSON.stringify({ hello: 'world' }));
    expect(JSON.parse(await fs.readFile(Target, 'utf8'))).toEqual({ hello: 'world' });
  });

  test('overwrites an existing file and leaves no temp behind', async () => {
    const Target = path.join(WorkDir, 'store.json');
    await WriteFileDurableAsync(Target, '{"v":1}');
    await WriteFileDurableAsync(Target, '{"v":2}');
    expect(await fs.readFile(Target, 'utf8')).toBe('{"v":2}');
    expect(await LeftoverTempsAsync()).toEqual([]);
  });

  // The core property. A durability change that could still leave a half-written destination
  // would be worse than the bug it replaces.
  test('a failed write leaves the previous contents byte-for-byte intact', async () => {
    const Target = path.join(WorkDir, 'store.json');
    const Original = JSON.stringify({ records: [1, 2, 3] });
    await WriteFileDurableAsync(Target, Original);

    jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));
    await expect(WriteFileDurableAsync(Target, '{"records":[]}')).rejects.toThrow('simulated rename failure');

    expect(await fs.readFile(Target, 'utf8')).toBe(Original);
  });

  test('cleans up its temp file when the write fails', async () => {
    const Target = path.join(WorkDir, 'store.json');
    jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated rename failure'));

    await expect(WriteFileDurableAsync(Target, 'payload')).rejects.toThrow();
    expect(await LeftoverTempsAsync()).toEqual([]);
  });

  // The Blocker from the agy plan review (round 1). A shared `${path}.tmp` would let two concurrent
  // saves interleave into one temp file and then rename the corrupted result over good data,
  // turning a rare hard-kill loss into routine corruption. reminders-module.js has no write
  // serialization and fires at least one save without awaiting it, so this is reachable in normal
  // operation. Assert the temp names are actually distinct rather than inferring it from a clean run.
  test('concurrent writers to one path never share a temp filename', async () => {
    const Target = path.join(WorkDir, 'store.json');
    const SeenTempPaths = [];
    const RealOpen = fs.open;
    jest.spyOn(fs, 'open').mockImplementation((ArgPath, ...ArgRest) => {
      if(typeof ArgPath === 'string' && ArgPath.endsWith('.tmp')) SeenTempPaths.push(ArgPath);
      return RealOpen.call(fs, ArgPath, ...ArgRest);
    });

    const Writers = Array.from({ length: 50 }, (ArgUnused, ArgIndex) =>
      WriteFileDurableAsync(Target, JSON.stringify({ writer: ArgIndex })));
    await Promise.all(Writers);

    expect(SeenTempPaths).toHaveLength(50);
    expect(new Set(SeenTempPaths).size).toBe(50);
    // Whichever writer landed last, the file is complete and parseable — never a torn blend.
    expect(() => JSON.parse(fsSync.readFileSync(Target, 'utf8'))).not.toThrow();
    expect(await LeftoverTempsAsync()).toEqual([]);
  });

  test('BuildTempPath is unique across rapid successive calls', () => {
    const Target = path.join(WorkDir, 'store.json');
    const Paths = Array.from({ length: 1000 }, () => BuildTempPath(Target));
    expect(new Set(Paths).size).toBe(1000);
  });

  // A durability improvement must never become a new crash source. Directory fsync is unsupported
  // on Windows and on some filesystems; by the time it runs the data is already written and renamed.
  test('degrades to a warning when directory fsync is unsupported', async () => {
    const Target = path.join(WorkDir, 'store.json');
    const Warnings = [];
    const RealOpen = fs.open;
    jest.spyOn(fs, 'open').mockImplementation((ArgPath, ...ArgRest) => {
      if(ArgPath === WorkDir) return Promise.reject(Object.assign(new Error('EPERM'), { code: 'EPERM' }));
      return RealOpen.call(fs, ArgPath, ...ArgRest);
    });

    await expect(WriteFileDurableAsync(Target, '{"ok":true}', {
      Logger: { warn: (...ArgArgs) => Warnings.push(ArgArgs) },
    })).resolves.toBeUndefined();

    expect(await fs.readFile(Target, 'utf8')).toBe('{"ok":true}');
    expect(Warnings).toHaveLength(1);
    expect(String(Warnings[0][0])).toContain('directory fsync');
  });

  test('propagates the underlying error so callers keep their existing error contract', async () => {
    const Missing = path.join(WorkDir, 'no-such-dir', 'store.json');
    await expect(WriteFileDurableAsync(Missing, 'payload')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('WriteFileDurableSync', () => {
  test('produces byte-identical output to the async variant', async () => {
    const Payload = JSON.stringify({ records: [{ id: 'a' }, { id: 'b' }] }, null, 2);
    const AsyncTarget = path.join(WorkDir, 'async.json');
    const SyncTarget = path.join(WorkDir, 'sync.json');

    await WriteFileDurableAsync(AsyncTarget, Payload);
    WriteFileDurableSync(SyncTarget, Payload);

    expect(await fs.readFile(SyncTarget, 'utf8')).toBe(await fs.readFile(AsyncTarget, 'utf8'));
    expect(await LeftoverTempsAsync()).toEqual([]);
  });

  test('a failed write leaves the previous contents intact and no temp behind', async () => {
    const Target = path.join(WorkDir, 'store.json');
    const Original = '{"v":1}';
    WriteFileDurableSync(Target, Original);

    jest.spyOn(fsSync, 'renameSync').mockImplementationOnce(() => {
      throw new Error('simulated rename failure');
    });
    expect(() => WriteFileDurableSync(Target, '{"v":2}')).toThrow('simulated rename failure');

    expect(fsSync.readFileSync(Target, 'utf8')).toBe(Original);
    expect(await LeftoverTempsAsync()).toEqual([]);
  });
});

// SIGKILL cannot be trapped, so a crash mid-write always strands its temp file. The crash-injection
// harness reproduces this (14 strays across 40 kills). Harmless to readers, but unbounded over the
// life of a deployment, so stores sweep on load.
describe('SweepStaleTempsAsync', () => {
  /**
   * Backdate a file so the age gate treats it as abandoned.
   * @param {string} ArgPath File to age.
   */
  async function MakeStaleAsync(ArgPath) {
    const Old = new Date(Date.now() - STALE_TEMP_MS - 60000);
    await fs.utimes(ArgPath, Old, Old);
  }

  test('removes stranded temps belonging to the store', async () => {
    const Target = path.join(WorkDir, 'store.json');
    await WriteFileDurableAsync(Target, '{"v":1}');

    const Stray = BuildTempPath(Target);
    await fs.writeFile(Stray, 'half-written');
    await MakeStaleAsync(Stray);

    expect(await SweepStaleTempsAsync(Target)).toBe(1);
    expect(await LeftoverTempsAsync()).toEqual([]);
    expect(await fs.readFile(Target, 'utf8')).toBe('{"v":1}');
  });

  // The dangerous case. A temp younger than the cutoff may belong to a live write in another
  // process; deleting it would reintroduce exactly the corruption this module prevents.
  test('leaves a fresh temp alone — it may belong to an in-flight write', async () => {
    const Target = path.join(WorkDir, 'store.json');
    const Fresh = BuildTempPath(Target);
    await fs.writeFile(Fresh, 'in flight');

    expect(await SweepStaleTempsAsync(Target)).toBe(0);
    expect(await LeftoverTempsAsync()).toHaveLength(1);
  });

  test('never touches another store\'s temps', async () => {
    const Mine = path.join(WorkDir, 'mine.json');
    const Theirs = path.join(WorkDir, 'theirs.json');
    const TheirStray = BuildTempPath(Theirs);
    await fs.writeFile(TheirStray, 'not mine');
    await MakeStaleAsync(TheirStray);

    expect(await SweepStaleTempsAsync(Mine)).toBe(0);
    expect(fsSync.existsSync(TheirStray)).toBe(true);
  });

  test('never throws when the directory is unreadable', async () => {
    await expect(SweepStaleTempsAsync(path.join(WorkDir, 'no-such-dir', 'store.json')))
      .resolves.toBe(0);
  });
});

describe('AppendFileDurableAsync', () => {
  test('appends without rewriting earlier records', async () => {
    const Log = path.join(WorkDir, 'events.jsonl');
    await AppendFileDurableAsync(Log, `${JSON.stringify({ n: 1 })}\n`);
    await AppendFileDurableAsync(Log, `${JSON.stringify({ n: 2 })}\n`);

    const Lines = (await fs.readFile(Log, 'utf8')).split('\n').filter(Boolean);
    expect(Lines.map(ArgLine => JSON.parse(ArgLine).n)).toEqual([1, 2]);
  });

  test('creates the file when it does not exist yet', async () => {
    const Log = path.join(WorkDir, 'fresh.jsonl');
    await AppendFileDurableAsync(Log, 'first\n');
    expect(await fs.readFile(Log, 'utf8')).toBe('first\n');
  });

  test('never leaves a temp file — append must not go through rename', async () => {
    const Log = path.join(WorkDir, 'events.jsonl');
    await AppendFileDurableAsync(Log, 'line\n');
    expect(await LeftoverTempsAsync()).toEqual([]);
  });
});
