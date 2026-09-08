#!/usr/bin/env node
'use strict';
/**
 * sync-model-catalog.js (GH-173, Model-catalog Phase 2) — build-time sync of the shared alias
 * catalog into the `ModelAliases` table the GH-168 resolver already reads.
 *
 * HiQS-Labs/Model-catalog is the pin of record for model aliases across HiQS repos. This script
 * is the ONLY writer of `data/static/ai/command-normalization.json` → `ModelAliases`: it takes the
 * catalog at one git tag, keeps a byte-identical vendored copy beside a pin record (tag + sha256),
 * filters `target: "native"` rows, and writes them as `{ Match, Replace, Source, VerifiedOn, Flags }`.
 * The resolver reads only `Match`/`Replace` and ignores the rest (`src/command-intent-resolver.js`,
 * `GetModelAliasMap` / `GetModelAliasRowsAsync`) — no loader change. `run-diagnostics` reads the
 * provenance columns from the same file (`DescribeModelAliasCatalogAsync`). Nothing reads the
 * catalog at runtime: this runs in a sync PR, and the deploy ships the committed result.
 *
 * Adding or correcting a model is two PRs: a row in Model-catalog (tagged), then a sync PR here.
 *
 * Usage:
 *   node scripts/sync-model-catalog.js --check
 *       Verify the committed state: vendored copy sha256 == pin, catalog version == pin,
 *       ModelAliases == the native rows of the vendored copy, 1:1 and in order. Exit 1 on drift.
 *       (tests/model-catalog-sync.test.js runs this; a hand-edited row is what turns it red.)
 *   node scripts/sync-model-catalog.js --tag vX.Y.Z [--expect-sha256 <hex>]
 *       Fetch https://raw.githubusercontent.com/HiQS-Labs/Model-catalog/<tag>/data/catalog.json,
 *       verify its sha256 (against the committed pin when the tag is unchanged; against
 *       --expect-sha256 when moving to a new tag — the operator supplies the hash from the
 *       Model-catalog release, so a fetch is never self-certifying), then write the three files.
 *   node scripts/sync-model-catalog.js --from <path/to/catalog.json> --tag vX.Y.Z [--expect-sha256 <hex>]
 *       Same, from a local checkout instead of the network (offline sync / tests).
 *
 * No dependencies: node's https + crypto only (the repo's deploy box rebuilds with --omit=dev).
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const path = require('path');

const UpstreamRepo = 'HiQS-Labs/Model-catalog';
const DefaultRootDir = path.join(__dirname, '..');

/** @param {string} ArgRootDir */
function PathsFor(ArgRootDir) {
  const AssetsDir = path.join(ArgRootDir, 'data', 'static', 'ai');
  return {
    AssetsDir,
    VendoredCatalog: path.join(AssetsDir, 'model-catalog.json'),
    PinRecord: path.join(AssetsDir, 'model-catalog.pin.json'),
    Normalization: path.join(AssetsDir, 'command-normalization.json'),
  };
}

/** @param {Buffer|string} ArgBytes */
function Sha256(ArgBytes) {
  return crypto.createHash('sha256').update(ArgBytes).digest('hex');
}

/** @param {string} ArgTag */
function SourceUrlFor(ArgTag) {
  return `https://raw.githubusercontent.com/${UpstreamRepo}/${ArgTag}/data/catalog.json`;
}

/**
 * @param {string} ArgUrl
 * @returns {Promise<Buffer>}
 */
function FetchBytesAsync(ArgUrl) {
  return new Promise((Resolve, Reject) => {
    const Req = https.get(ArgUrl, { headers: { 'User-Agent': 'aegis-sleuth sync-model-catalog' } }, (Res) => {
      if(Res.statusCode !== 200) {
        Res.resume();
        Reject(new Error(`fetch ${ArgUrl}: HTTP ${Res.statusCode}`));
        return;
      }
      /** @type {Buffer[]} */
      const Chunks = [];
      Res.on('data', (Chunk) => Chunks.push(Chunk));
      Res.on('end', () => Resolve(Buffer.concat(Chunks)));
      Res.on('error', Reject);
    });
    Req.on('error', Reject);
    Req.setTimeout(30000, () => Req.destroy(new Error(`fetch ${ArgUrl}: timeout`)));
  });
}

/**
 * The rows the resolver will read, rendered from a catalog object. Native rows only, in catalog
 * order (uniqueness of `(match, target)` is enforced upstream, so order is not load-bearing for
 * an entire-value lookup — it is kept deterministic so the drift check can compare 1:1).
 * @param {{ version: string, aliases: Array<any> }} ArgCatalog
 * @returns {Array<{ Match: string, Replace: string, Source: string, VerifiedOn: string|null, Flags: string[] }>}
 */
function RenderNativeRows(ArgCatalog) {
  return (ArgCatalog.aliases || [])
    .filter((ArgRow) => ArgRow.target === 'native')
    .map((ArgRow) => ({
      Match: String(ArgRow.match),
      Replace: String(ArgRow.replace),
      Source: String(ArgRow.source || ''),
      VerifiedOn: ArgRow.verified_on ? String(ArgRow.verified_on) : null,
      Flags: Array.isArray(ArgRow.flags) ? ArgRow.flags.map(String) : [],
    }));
}

/**
 * @param {string} ArgFilePath
 * @returns {string} The indent the file uses ("  " unless it clearly uses something else).
 */
function DetectIndent(ArgFilePath) {
  try {
    const Second = fs.readFileSync(ArgFilePath, 'utf8').split('\n')[1] || '';
    const M = Second.match(/^(\s+)/);
    return M ? M[1] : '  ';
  } catch {
    return '  ';
  }
}

/**
 * Every way the committed state can disagree with itself, as problem strings (empty = clean).
 * @param {{ RootDir?: string }} [ArgOptions]
 * @returns {string[]}
 */
function CheckSync(ArgOptions = {}) {
  const Paths = PathsFor(ArgOptions.RootDir || DefaultRootDir);
  /** @type {string[]} */
  const Problems = [];
  for(const [Label, P] of [['vendored catalog', Paths.VendoredCatalog], ['pin record', Paths.PinRecord], ['normalization', Paths.Normalization]]) {
    if(!fs.existsSync(P)) Problems.push(`missing ${Label}: ${path.relative(ArgOptions.RootDir || DefaultRootDir, P)}`);
  }
  if(Problems.length > 0) return Problems;

  const CatalogBytes = fs.readFileSync(Paths.VendoredCatalog);
  /** @type {any} */
  let Pin; /** @type {any} */
  let Catalog; /** @type {any} */
  let Normalization;
  try { Pin = JSON.parse(fs.readFileSync(Paths.PinRecord, 'utf8')); } catch(e) { return [`pin record unreadable: ${/** @type {Error} */ (e).message}`]; }
  try { Catalog = JSON.parse(CatalogBytes.toString('utf8')); } catch(e) { return [`vendored catalog unreadable: ${/** @type {Error} */ (e).message}`]; }
  try { Normalization = JSON.parse(fs.readFileSync(Paths.Normalization, 'utf8')); } catch(e) { return [`command-normalization.json unreadable: ${/** @type {Error} */ (e).message}`]; }

  for(const Key of ['repo', 'tag', 'version', 'catalog_sha256']) {
    if(!Pin[Key]) Problems.push(`pin record missing field '${Key}'`);
  }
  if(Problems.length > 0) return Problems;

  const Got = Sha256(CatalogBytes);
  if(Got !== Pin.catalog_sha256)
    Problems.push(`vendored catalog sha256 ${Got.slice(0, 12)}… != pin ${String(Pin.catalog_sha256).slice(0, 12)}… (${Pin.repo} ${Pin.tag}) — the copy is not byte-identical to the pinned tag`);
  if(String(Catalog.version) !== String(Pin.version))
    Problems.push(`vendored catalog version ${Catalog.version} != pin version ${Pin.version}`);

  const Info = Normalization.ModelAliasesCatalog;
  if(!Info || Info.Tag !== Pin.tag || Info.Version !== Pin.version || Info.Sha256 !== Pin.catalog_sha256)
    Problems.push('command-normalization.json ModelAliasesCatalog does not match the pin record (tag/version/sha256)');

  const Expected = RenderNativeRows(Catalog);
  // PR #180 review (P3): the pin's own row count was the one unverified number in a file whose job
  // is verification. Cross-check both recorded counts against the rows the copy actually yields.
  if(Number(Pin.native_rows) !== Expected.length)
    Problems.push(`pin record says native_rows=${Pin.native_rows}; the vendored catalog yields ${Expected.length} native rows`);
  if(Info && Number(Info.NativeRows) !== Expected.length)
    Problems.push(`ModelAliasesCatalog.NativeRows=${Info.NativeRows}; the vendored catalog yields ${Expected.length} native rows`);
  const Actual = Array.isArray(Normalization.ModelAliases) ? Normalization.ModelAliases : [];
  if(Actual.length !== Expected.length)
    Problems.push(`ModelAliases has ${Actual.length} rows; the vendored catalog has ${Expected.length} native rows (must be 1:1)`);
  const N = Math.min(Actual.length, Expected.length);
  for(let I = 0; I < N; I += 1) {
    const A = Actual[I]; const E = Expected[I];
    const Same = A && A.Match === E.Match && A.Replace === E.Replace && (A.Source || '') === E.Source
      && (A.VerifiedOn ?? null) === E.VerifiedOn && JSON.stringify(A.Flags || []) === JSON.stringify(E.Flags);
    if(!Same) {
      Problems.push(`ModelAliases[${I}] differs from the vendored catalog: have ${JSON.stringify(A)}, want ${JSON.stringify(E)} — this section is GENERATED; change the catalog and re-run the sync`);
      break;
    }
  }
  return Problems;
}

/**
 * Write the vendored copy, the pin record, and the ModelAliases section from catalog bytes.
 * @param {{ RootDir?: string, CatalogBytes: Buffer, Tag: string, SourceUrl: string, SyncedOn?: string }} ArgInput
 * @returns {{ Version: string, Rows: number, Sha256: string }}
 */
function WriteSync(ArgInput) {
  const RootDir = ArgInput.RootDir || DefaultRootDir;
  const Paths = PathsFor(RootDir);
  const Catalog = JSON.parse(ArgInput.CatalogBytes.toString('utf8'));
  if(!Catalog || !Array.isArray(Catalog.aliases) || !Catalog.version)
    throw new Error('catalog is not a hiqs.model-catalog document (no aliases[] / version)');
  const Hash = Sha256(ArgInput.CatalogBytes);
  const Rows = RenderNativeRows(Catalog);
  if(Rows.length === 0) throw new Error('catalog has no target:"native" rows — refusing to write an empty alias table');
  // Local calendar date (en-CA renders YYYY-MM-DD), matching how the rest of the repo dates things.
  const SyncedOn = ArgInput.SyncedOn || new Date().toLocaleDateString('en-CA');

  const Pin = {
    repo: UpstreamRepo,
    tag: ArgInput.Tag,
    version: String(Catalog.version),
    updated: Catalog.updated || null,
    catalog_sha256: Hash,
    source: ArgInput.SourceUrl,
    native_rows: Rows.length,
    synced_on: SyncedOn,
    _comment: 'GH-173: pin record for the vendored Model-catalog copy. Verified by `node scripts/sync-model-catalog.js --check` (tests/model-catalog-sync.test.js). Rewrite with the sync script in a sync PR; never by hand.',
  };

  const Indent = DetectIndent(Paths.Normalization);
  /** @type {any} */
  const Existing = fs.existsSync(Paths.Normalization) ? JSON.parse(fs.readFileSync(Paths.Normalization, 'utf8')) : {};
  /** @type {any} */
  const Next = {};
  // ModelAliasesCatalog + ModelAliases first (generated), then every hand-maintained key as-is.
  Next.ModelAliasesCatalog = {
    _comment: `GENERATED by scripts/sync-model-catalog.js from ${UpstreamRepo} ${ArgInput.Tag} — edit the catalog, not these rows. Other keys in this file are hand-maintained.`,
    Repo: UpstreamRepo,
    Tag: ArgInput.Tag,
    Version: String(Catalog.version),
    Sha256: Hash,
    Source: ArgInput.SourceUrl,
    SyncedOn,
    NativeRows: Rows.length,
  };
  Next.ModelAliases = Rows;
  for(const [Key, Value] of Object.entries(Existing)) {
    if(Key === 'ModelAliases' || Key === 'ModelAliasesCatalog') continue;
    Next[Key] = Value;
  }

  fs.mkdirSync(Paths.AssetsDir, { recursive: true });
  fs.writeFileSync(Paths.VendoredCatalog, ArgInput.CatalogBytes);
  fs.writeFileSync(Paths.PinRecord, `${JSON.stringify(Pin, null, 2)}\n`);
  fs.writeFileSync(Paths.Normalization, `${JSON.stringify(Next, null, Indent)}\n`);
  return { Version: String(Catalog.version), Rows: Rows.length, Sha256: Hash };
}

/** @param {string[]} ArgArgv */
function ParseArgs(ArgArgv) {
  /** @type {{ Check: boolean, Tag: string|null, From: string|null, ExpectSha256: string|null, RootDir: string|null }} */
  const Out = { Check: false, Tag: null, From: null, ExpectSha256: null, RootDir: null };
  for(let I = 0; I < ArgArgv.length; I += 1) {
    const A = ArgArgv[I];
    if(A === '--check') Out.Check = true;
    else if(A === '--tag') Out.Tag = ArgArgv[++I] || null;
    else if(A === '--from') Out.From = ArgArgv[++I] || null;
    else if(A === '--expect-sha256') Out.ExpectSha256 = ArgArgv[++I] || null;
    else if(A === '--root') Out.RootDir = ArgArgv[++I] || null;
    else throw new Error(`unknown argument: ${A}`);
  }
  return Out;
}

async function MainAsync() {
  const Args = ParseArgs(process.argv.slice(2));
  const RootDir = Args.RootDir ? path.resolve(Args.RootDir) : DefaultRootDir;
  const Paths = PathsFor(RootDir);

  if(Args.Check) {
    const Problems = CheckSync({ RootDir });
    if(Problems.length > 0) {
      for(const P of Problems) console.error(`model-catalog sync check: FAIL — ${P}`);
      return 1;
    }
    const Pin = JSON.parse(fs.readFileSync(Paths.PinRecord, 'utf8'));
    console.log(`model-catalog sync check: OK — ${Pin.repo} ${Pin.tag} (v${Pin.version}), ${Pin.native_rows} native rows in ModelAliases match the vendored copy`);
    return 0;
  }

  if(!Args.Tag) throw new Error('--tag vX.Y.Z is required (or --check)');
  const SourceUrl = SourceUrlFor(Args.Tag);
  const CatalogBytes = Args.From ? fs.readFileSync(Args.From) : await FetchBytesAsync(SourceUrl);
  const Hash = Sha256(CatalogBytes);

  /** @type {any} */
  const CurrentPin = fs.existsSync(Paths.PinRecord) ? JSON.parse(fs.readFileSync(Paths.PinRecord, 'utf8')) : null;
  const Expected = Args.ExpectSha256 || (CurrentPin && CurrentPin.tag === Args.Tag ? CurrentPin.catalog_sha256 : null);
  if(!Expected)
    throw new Error(`no expected sha256 for ${Args.Tag}: pass --expect-sha256 <hex> (from the Model-catalog release) when moving to a new tag`);
  if(Hash !== Expected)
    throw new Error(`sha256 mismatch for ${Args.Tag}: got ${Hash}, expected ${Expected} — refusing to write`);

  const Result = WriteSync({ RootDir, CatalogBytes, Tag: Args.Tag, SourceUrl: Args.From ? `${SourceUrl} (synced from local file ${path.basename(Args.From)})` : SourceUrl });
  console.log(`model-catalog sync: ${UpstreamRepo} ${Args.Tag} (v${Result.Version}) → ${Result.Rows} native rows into ModelAliases; sha256 ${Result.Sha256.slice(0, 12)}…`);
  const Problems = CheckSync({ RootDir });
  if(Problems.length > 0) {
    for(const P of Problems) console.error(`model-catalog sync: post-write check FAILED — ${P}`);
    return 1;
  }
  return 0;
}

module.exports = { CheckSync, WriteSync, RenderNativeRows, Sha256, SourceUrlFor, PathsFor, UpstreamRepo };

if(require.main === module) {
  MainAsync().then((Code) => process.exit(Code)).catch((Error_) => {
    console.error(`model-catalog sync: ${Error_.message}`);
    process.exit(2);
  });
}
