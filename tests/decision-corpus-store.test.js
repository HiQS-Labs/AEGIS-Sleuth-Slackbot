'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');

const { createDecisionCorpusStore, CorpusFilePath, DEFAULT_STREAM } = require('../src/decision-corpus-store');
const { createRouterShadowStore, ShadowFilePath, ROUTER_SHADOW_STREAM } = require('../src/router-shadow-store');

/** @returns {Promise<string>} a fresh temp rootDir. */
function MakeRootDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'decision-corpus-'));
}

// ---------------------------------------------------------------------------
// GH-44 Phase 1 — the generalized store. These are the gates that are RED before
// this module exists, as distinct from the router-shadow suite, which is the
// zero-modification back-compat regression guard.
// ---------------------------------------------------------------------------
describe('createDecisionCorpusStore', () => {
  test('defaults to the `decisions` stream and round-trips records in order', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir });

    expect(Store.stream).toBe(DEFAULT_STREAM);
    expect(await Store.append('ws1', { decision: 'a' })).toEqual({ ok: true });
    expect(await Store.append('ws1', { decision: 'b' })).toEqual({ ok: true });

    const Records = await Store.readAll('ws1');
    expect(Records.map(ArgR => ArgR.decision)).toEqual(['a', 'b']);
    expect(Records[0].workspace).toBe('ws1');
    expect(typeof Records[0].ts).toBe('string');
    expect(CorpusFilePath(RootDir, 'ws1')).toBe(path.join(RootDir, 'ws1_decisions.jsonl'));
  });

  test('two streams in one rootDir stay in separate files and never interleave', async () => {
    const RootDir = await MakeRootDir();
    const Alpha = createDecisionCorpusStore({ rootDir: RootDir, stream: 'alpha' });
    const Beta = createDecisionCorpusStore({ rootDir: RootDir, stream: 'beta' });

    // interleave the calls deliberately, and await them together, so a shared write chain or a
    // shared path would show up as cross-contamination rather than as ordering luck.
    await Promise.all([
      Alpha.append('ws1', { n: 1 }), Beta.append('ws1', { n: 100 }),
      Alpha.append('ws1', { n: 2 }), Beta.append('ws1', { n: 200 }),
      Alpha.append('ws1', { n: 3 }), Beta.append('ws1', { n: 300 }),
    ]);

    expect((await Alpha.readAll('ws1')).map(ArgR => ArgR.n)).toEqual([1, 2, 3]);
    expect((await Beta.readAll('ws1')).map(ArgR => ArgR.n)).toEqual([100, 200, 300]);
  });

  test('sanitizes both workspace and stream so neither escapes rootDir', () => {
    const Escaped = CorpusFilePath('/tmp/root', '../../etc', '../../passwd');
    expect(Escaped).toBe(path.join('/tmp/root', '.._.._etc_.._.._passwd.jsonl'));
    expect(Escaped.startsWith(path.join('/tmp/root', ''))).toBe(true);
    expect(Escaped).not.toContain('..' + path.sep);
  });

  test('never throws: bad workspace, bad record, and an unserializable record all resolve {ok:false}', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 's' });

    expect((await Store.append('', { a: 1 })).ok).toBe(false);
    expect((await Store.append('ws1', null)).ok).toBe(false);
    expect((await Store.append('ws1', [1, 2])).ok).toBe(false);

    const Circular = /** @type {any} */ ({ decision: 'loop' });
    Circular.self = Circular;
    const Result = await Store.append('ws1', Circular);
    expect(Result.ok).toBe(false);
    expect(Result.error).toBeInstanceOf(Error);

    // nothing above should have created a file
    expect(await Store.readAll('ws1')).toEqual([]);
  });

  test('system-stamped workspace wins a colliding key; caller-supplied ts is preserved', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 's' });

    await Store.append('real-ws', { workspace: 'spoofed-ws', ts: '2026-01-01T00:00:00.000Z', decision: 'x' });
    const [Rec] = await Store.readAll('real-ws');
    expect(Rec.workspace).toBe('real-ws');
    expect(Rec.ts).toBe('2026-01-01T00:00:00.000Z');
  });

  test('a mutation after append does not change what was written (serialize-now)', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 's' });

    const Record = { decision: 'x', payload: { v: 'original' } };
    const Pending = Store.append('ws1', Record);
    Record.payload.v = 'mutated';
    await Pending;

    expect((await Store.readAll('ws1'))[0].payload.v).toBe('original');
  });

  test('skips torn/unparseable lines rather than throwing', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 's' });
    await Store.append('ws1', { decision: 'good' });
    await fs.appendFile(CorpusFilePath(RootDir, 'ws1', 's'), '{"torn":\n', 'utf8');
    await Store.append('ws1', { decision: 'also-good' });

    expect((await Store.readAll('ws1')).map(ArgR => ArgR.decision)).toEqual(['good', 'also-good']);
  });

  test('readAll on a missing file returns [] rather than throwing', async () => {
    const RootDir = await MakeRootDir();
    const Store = createDecisionCorpusStore({ rootDir: RootDir, stream: 's' });
    expect(await Store.readAll('never-written')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The back-compat facade. tests/router-shadow.test.js is the real regression
// guard (it passes unmodified); these assert the delegation contract itself.
// ---------------------------------------------------------------------------
describe('router-shadow-store back-compat facade', () => {
  test('still writes the exact GH-397 production filename', () => {
    expect(ROUTER_SHADOW_STREAM).toBe('router-shadow');
    expect(ShadowFilePath('/tmp/root', 'ws1')).toBe(path.join('/tmp/root', 'ws1_router-shadow.jsonl'));
    // and the generalized path function agrees for that stream
    expect(ShadowFilePath('/tmp/root', 'ws1')).toBe(CorpusFilePath('/tmp/root', 'ws1', 'router-shadow'));
  });

  test('a record written through the facade is readable through the generalized store', async () => {
    const RootDir = await MakeRootDir();
    const Facade = createRouterShadowStore({ rootDir: RootDir });
    const Generalized = createDecisionCorpusStore({ rootDir: RootDir, stream: 'router-shadow' });

    await Facade.append('ws1', { mode: 'shadow', rawText: 'a', routerOutcome: 'matched' });
    expect((await Generalized.readAll('ws1')).map(ArgR => ArgR.rawText)).toEqual(['a']);
  });
});
