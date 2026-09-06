'use strict';
/**
 * GH-173 (Model-catalog Phase 2): the ModelAliases table is a build-time sync of the shared
 * catalog, and the committed state must reconcile 1:1 with the pinned tag.
 *
 * Offline by construction: every assertion reads the vendored copy committed beside the table
 * (data/static/ai/model-catalog.json + model-catalog.pin.json). The negative controls mutate
 * SCRATCH copies under os.tmpdir() and point the checker at them with RootDir — nothing here
 * edits the tracked tree.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CheckSync,
  WriteSync,
  RenderNativeRows,
  Sha256,
} = require('../scripts/sync-model-catalog');
const { ResolveModelAliasAsync, GetModelAliasRowsAsync, GetModelAliasProvenanceAsync } = require('../src/command-intent-resolver');

const RepoRoot = path.join(__dirname, '..');
const AssetsDir = path.join(RepoRoot, 'data', 'static', 'ai');
const ReadJson = (ArgPath) => JSON.parse(fs.readFileSync(ArgPath, 'utf8'));

/** Copy the three synced files into a scratch root the checker can be pointed at. */
function MakeScratchRoot() {
  const Root = fs.mkdtempSync(path.join(os.tmpdir(), 'gh173-sync-'));
  const Dst = path.join(Root, 'data', 'static', 'ai');
  fs.mkdirSync(Dst, { recursive: true });
  for(const Name of ['model-catalog.json', 'model-catalog.pin.json', 'command-normalization.json'])
    fs.copyFileSync(path.join(AssetsDir, Name), path.join(Dst, Name));
  return { Root, Dst };
}

describe('model-catalog sync (GH-173)', () => {
  const Pin = ReadJson(path.join(AssetsDir, 'model-catalog.pin.json'));
  const Catalog = ReadJson(path.join(AssetsDir, 'model-catalog.json'));
  const Normalization = ReadJson(path.join(AssetsDir, 'command-normalization.json'));

  test('the committed tree passes --check (pin sha256, version, 1:1 rows)', () => {
    expect(CheckSync({ RootDir: RepoRoot })).toEqual([]);
  });

  test('the vendored copy is byte-identical to the pinned tag (sha256 in the pin record)', () => {
    expect(Sha256(fs.readFileSync(path.join(AssetsDir, 'model-catalog.json')))).toBe(Pin.catalog_sha256);
    expect(Pin.repo).toBe('HiQS-Labs/Model-catalog');
    expect(Pin.tag).toBe(`v${Pin.version}`);
    expect(Catalog.version).toBe(Pin.version);
  });

  test('ModelAliases reconciles 1:1 with the tag\'s native rows — 53 for v1.0.0, and only native rows', () => {
    const Native = Catalog.aliases.filter((ArgRow) => ArgRow.target === 'native');
    const OpenRouter = Catalog.aliases.filter((ArgRow) => ArgRow.target === 'openrouter');
    expect(Native).toHaveLength(53);
    expect(OpenRouter.length).toBeGreaterThan(0); // the other consumer's rows exist upstream ...
    expect(Normalization.ModelAliases).toHaveLength(Native.length); // ... and none of them leaked here
    const Have = new Map(Normalization.ModelAliases.map((ArgRow) => [ArgRow.Match, ArgRow.Replace]));
    for(const Row of Native) expect(Have.get(Row.match)).toBe(Row.replace);
    for(const Row of OpenRouter) expect(Have.has(Row.match)).toBe(false);
    expect(Normalization.ModelAliasesCatalog.Version).toBe(Pin.version);
    expect(Normalization.ModelAliasesCatalog.NativeRows).toBe(Native.length);
  });

  test('every synced row carries the provenance columns beside Match/Replace', () => {
    for(const Row of Normalization.ModelAliases) {
      expect(typeof Row.Match).toBe('string');
      expect(typeof Row.Replace).toBe('string');
      expect(typeof Row.Source).toBe('string');
      expect(Row.Source.length).toBeGreaterThan(0);
      expect(Row.VerifiedOn === null || typeof Row.VerifiedOn === 'string').toBe(true);
      expect(Array.isArray(Row.Flags)).toBe(true);
    }
    const Flagged = Normalization.ModelAliases.filter((ArgRow) => ArgRow.Flags.length > 0).map((ArgRow) => ArgRow.Match);
    expect(Flagged).toContain('gemini pro'); // the GH-168 rev4 flagged pin rides as data, not doc prose
  });

  test('the hand-maintained DirectCommandPatterns section survives a sync untouched', () => {
    expect(Array.isArray(Normalization.DirectCommandPatterns)).toBe(true);
    expect(Normalization.DirectCommandPatterns.length).toBeGreaterThan(0);
  });

  describe('the shipped resolver over the synced rows (loader unchanged)', () => {
    test('GetModelAliasRowsAsync still exposes only Match/Replace — provenance columns are ignored by the resolver', async () => {
      const Rows = await GetModelAliasRowsAsync();
      expect(Rows).toHaveLength(53);
      for(const Row of Rows) expect(Object.keys(Row).sort()).toEqual(['Match', 'Replace']);
    });

    test("'ChatGPT' resolves to its pin with the provenance note", async () => {
      expect(await ResolveModelAliasAsync('ChatGPT')).toEqual({ ModelId: 'gpt-5.6-terra', Note: 'ChatGPT -> gpt-5.6-terra' });
    });

    test('flags are advisory: the flagged gemini pro pin resolves exactly like an unflagged row', async () => {
      expect(await ResolveModelAliasAsync('gemini pro')).toEqual({ ModelId: 'gemini-2.5-pro', Note: 'gemini pro -> gemini-2.5-pro' });
      const { Rows } = await GetModelAliasProvenanceAsync();
      expect(Rows.find((ArgRow) => ArgRow.Match === 'gemini pro').Flags).toEqual(['unverified-generation']);
    });

    test('an unknown name passes through unresolved (refusal happens at catalog validation, never a default)', async () => {
      expect(await ResolveModelAliasAsync('no-such-model-gh173-control')).toEqual({ ModelId: 'no-such-model-gh173-control', Note: null });
    });

    test('an exact ID passes through untouched even when it contains an alias word', async () => {
      expect(await ResolveModelAliasAsync('gpt-5.6-terra')).toEqual({ ModelId: 'gpt-5.6-terra', Note: null });
    });

    test('GetModelAliasProvenanceAsync names the catalog the table was synced from', async () => {
      const { Catalog: Info } = await GetModelAliasProvenanceAsync();
      expect(Info.Repo).toBe('HiQS-Labs/Model-catalog');
      expect(Info.Version).toBe(Pin.version);
      expect(Info.Sha256).toBe(Pin.catalog_sha256);
    });
  });

  describe('negative controls (scratch copies)', () => {
    test('a hand-edited Replace in ModelAliases turns --check red and names the row', () => {
      const { Root, Dst } = MakeScratchRoot();
      const N = ReadJson(path.join(Dst, 'command-normalization.json'));
      const Row = N.ModelAliases.find((ArgRow) => ArgRow.Match === 'chatgpt');
      Row.Replace = 'gpt-hand-edited';
      fs.writeFileSync(path.join(Dst, 'command-normalization.json'), JSON.stringify(N, null, 2));
      const Problems = CheckSync({ RootDir: Root });
      expect(Problems.length).toBeGreaterThan(0);
      expect(Problems.join('\n')).toMatch(/ModelAliases\[\d+\] differs from the vendored catalog/);
      expect(Problems.join('\n')).toContain('gpt-hand-edited');
    });

    test('a removed row (not 1:1) turns --check red', () => {
      const { Root, Dst } = MakeScratchRoot();
      const N = ReadJson(path.join(Dst, 'command-normalization.json'));
      N.ModelAliases = N.ModelAliases.slice(1);
      fs.writeFileSync(path.join(Dst, 'command-normalization.json'), JSON.stringify(N, null, 2));
      expect(CheckSync({ RootDir: Root }).join('\n')).toMatch(/has 52 rows; the vendored catalog has 53 native rows/);
    });

    test('a flipped row in the vendored copy is a pin sha256 mismatch AND a row mismatch', () => {
      const { Root, Dst } = MakeScratchRoot();
      const C = ReadJson(path.join(Dst, 'model-catalog.json'));
      C.aliases.find((ArgRow) => ArgRow.match === 'chatgpt').replace = 'gpt-repinned';
      fs.writeFileSync(path.join(Dst, 'model-catalog.json'), JSON.stringify(C, null, 2));
      const Problems = CheckSync({ RootDir: Root }).join('\n');
      expect(Problems).toMatch(/sha256 .* != pin/);
      expect(Problems).toContain('gpt-repinned');
    });

    test('a stale pin record (sha edited) turns --check red', () => {
      const { Root, Dst } = MakeScratchRoot();
      const P = ReadJson(path.join(Dst, 'model-catalog.pin.json'));
      P.catalog_sha256 = '0'.repeat(64);
      fs.writeFileSync(path.join(Dst, 'model-catalog.pin.json'), JSON.stringify(P, null, 2));
      expect(CheckSync({ RootDir: Root }).join('\n')).toMatch(/sha256 .* != pin/);
    });

    test('a missing vendored copy is a named problem, not a throw or a pass', () => {
      const { Root, Dst } = MakeScratchRoot();
      fs.unlinkSync(path.join(Dst, 'model-catalog.json'));
      expect(CheckSync({ RootDir: Root })).toEqual(['missing vendored catalog: data/static/ai/model-catalog.json']);
    });

    test('re-running the sync from the same bytes closes every edge (the sync-PR recipe)', () => {
      const { Root, Dst } = MakeScratchRoot();
      const N = ReadJson(path.join(Dst, 'command-normalization.json'));
      N.ModelAliases.push({ Match: 'hand appended', Replace: 'nope' });
      fs.writeFileSync(path.join(Dst, 'command-normalization.json'), JSON.stringify(N, null, 2));
      expect(CheckSync({ RootDir: Root }).length).toBeGreaterThan(0);
      const Result = WriteSync({ RootDir: Root, CatalogBytes: fs.readFileSync(path.join(AssetsDir, 'model-catalog.json')), Tag: Pin.tag, SourceUrl: Pin.source, SyncedOn: Pin.synced_on });
      expect(Result.Rows).toBe(53);
      expect(CheckSync({ RootDir: Root })).toEqual([]);
      // and the hand-maintained keys came through the rewrite
      expect(ReadJson(path.join(Dst, 'command-normalization.json')).DirectCommandPatterns).toEqual(Normalization.DirectCommandPatterns);
    });
  });

  test('RenderNativeRows filters by target and keeps catalog order', () => {
    const Rows = RenderNativeRows({ version: 'x', aliases: [
      { match: 'b', replace: 'B', target: 'openrouter', source: 's', verified_on: null, flags: [] },
      { match: 'a', replace: 'A', target: 'native', source: 's', verified_on: '2026-01-01', flags: ['disputed'] },
      { match: 'c', replace: 'C', target: 'native', source: 's', verified_on: null, flags: [] },
    ] });
    expect(Rows).toEqual([
      { Match: 'a', Replace: 'A', Source: 's', VerifiedOn: '2026-01-01', Flags: ['disputed'] },
      { Match: 'c', Replace: 'C', Source: 's', VerifiedOn: null, Flags: [] },
    ]);
  });
});
