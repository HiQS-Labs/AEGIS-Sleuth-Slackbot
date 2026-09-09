'use strict';

// GH-183: the first automated coverage for `releases_app.py`'s dump parser and its `check
// --rebuild` path. That path is the ONLY documented resolution for a divergent-dump git merge
// (utils/py/releases_app.py:3489), and it was dead repo-wide because INSERT_RE compiled without
// re.DOTALL: a `roadmap_items` row whose `raw_text` carries an embedded newline is dumped as a
// MULTI-LINE statement, `(.*)` could not span it, parse_dump never cleared its buffer, and the
// parse died at EOF with "unparseable trailing statement".
//
// Nothing in the JS suite touched the Python ledger before this file, so these shell out. They
// skip rather than fail when python3 is unavailable, so a JS-only environment stays green.

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RepoRoot = path.resolve(__dirname, '..');
// GH-187: the ledger CLI is vendored. The tracked copy this test originally pointed at was a fork
// that had drifted ~1700 lines behind upstream, and it is deleted. `.xyz/` is gitignored, so a
// clone that has not been vendored yet simply has no CLI to exercise — that is a skip, not a
// failure, exactly as an absent python3 is.
const AppPath = path.join(RepoRoot, '.xyz', 'utils', 'py', 'releases_app.py');
const DumpPath = path.join(RepoRoot, 'releases.sql');

const HasPython = spawnSync('python3', ['--version'], { encoding: 'utf8' }).status === 0;
const HasVendoredApp = fs.existsSync(AppPath);
const Describe = HasPython && HasVendoredApp ? describe : describe.skip;

/** Run a short python program with releases_app.py importable as `App`. */
function RunPython(ArgSource) {
  const Preamble = [
    'import importlib.util, sys',
    `Spec = importlib.util.spec_from_file_location("releases_app", ${JSON.stringify(AppPath)})`,
    'App = importlib.util.module_from_spec(Spec)',
    'Spec.loader.exec_module(App)',
  ].join('\n');
  return execFileSync('python3', ['-c', `${Preamble}\n${ArgSource}`], {
    encoding: 'utf8',
    cwd: RepoRoot,
  });
}

Describe('GH-183: the canonical dump parser', () => {
  test("parses the repo's own committed releases.sql", () => {
    // The regression in one line. Before the fix this refused on the real dump, which is what
    // made every ledger-touching branch unmergeable.
    const Out = RunPython([
      `Text = open(${JSON.stringify(DumpPath)}, encoding="utf-8").read()`,
      'Tables = App.parse_dump(Text)',
      'print("roadmap_items=%d op_receipts=%d" % (len(Tables.get("roadmap_items", [])),',
      '                                            len(Tables.get("op_receipts", []))))',
    ].join('\n'));

    expect(Out).toMatch(/roadmap_items=[1-9]\d* op_receipts=[1-9]\d*/);
  });

  test('parses a statement whose value carries an embedded newline', () => {
    // The narrow shape that broke it, isolated from the repo's data so the case survives any
    // future regeneration of releases.sql.
    const Out = RunPython([
      'Text = (',
      '    "-- generation: 1\\n"',
      '    "INSERT INTO roadmap_items(global_id, raw_text) VALUES(\'a\', \'line one\\n"',
      '    "line two\');\\n"',
      '    "INSERT INTO roadmap_items(global_id, raw_text) VALUES(\'b\', \'plain\');\\n"',
      ')',
      'Rows = App.parse_dump(Text)["roadmap_items"]',
      'print("rows=%d ids=%s multiline=%s" % (len(Rows),',
      '      ",".join(r["global_id"] for r in Rows),',
      '      "\\n" in Rows[0]["raw_text"]))',
    ].join('\n'));

    // Two rows, not one: the pre-fix parser swallowed the second statement into the buffer left
    // open by the first, so asserting only on row 0 would still have passed while broken.
    expect(Out.trim()).toBe('rows=2 ids=a,b multiline=True');
  });

  test('still refuses a genuinely truncated statement', () => {
    // DOTALL widens what one statement may contain; it must not turn a real parse failure into a
    // silent accept. Without this, the test above could be satisfied by deleting the refusal.
    const Result = spawnSync('python3', ['-c', [
      'import importlib.util',
      `Spec = importlib.util.spec_from_file_location("releases_app", ${JSON.stringify(AppPath)})`,
      'App = importlib.util.module_from_spec(Spec)',
      'Spec.loader.exec_module(App)',
      'App.parse_dump("INSERT INTO roadmap_items(global_id) VALUES(\'a\'\\n")',
    ].join('\n')], { encoding: 'utf8', cwd: RepoRoot });

    expect(Result.status).not.toBe(0);
    expect(`${Result.stdout}${Result.stderr}`).toMatch(/dump-parse/);
  });
});

Describe('GH-183: check --rebuild, the documented merge-resolution path', () => {
  test('rebuilds the DB from the dump and records a merge-rebuild receipt', () => {
    // End to end against a throwaway copy of the real ledger: `--rebuild` must bump the
    // generation, append exactly one merge-rebuild receipt (the one legal fork point in the
    // receipt chain), and leave a .bak of the DB it displaced.
    const Work = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ledger-rebuild-'));
    try {
      execFileSync('git', ['init', '-q', Work], { cwd: RepoRoot });
      for (const Name of ['releases.db', 'releases.sql']) {
        fs.copyFileSync(path.join(RepoRoot, Name), path.join(Work, Name));
      }

      const Before = ReadLedgerFacts(Work);
      const Result = spawnSync('python3', [AppPath, '--root', Work, 'check', '--rebuild'], {
        encoding: 'utf8',
        cwd: Work,
      });
      expect(`${Result.stdout}${Result.stderr}`).not.toMatch(/refused: rule=dump-parse/);
      expect(Result.status).toBe(0);

      const After = ReadLedgerFacts(Work);
      expect(After.Generation).toBe(Before.Generation + 1);
      expect(After.MergeRebuildReceipts).toBe(Before.MergeRebuildReceipts + 1);
      expect(fs.existsSync(path.join(Work, 'releases.db.bak'))).toBe(true);
    } finally {
      fs.rmSync(Work, { recursive: true, force: true });
    }
  });
});

/** Generation and merge-rebuild receipt count, read straight out of the SQLite file. */
function ReadLedgerFacts(ArgRoot) {
  const Out = execFileSync('python3', ['-c', [
    'import sqlite3, sys',
    'Conn = sqlite3.connect(sys.argv[1])',
    'Gen = Conn.execute("SELECT value FROM settings WHERE key = \'generation\'").fetchone()[0]',
    'Rebuilds = Conn.execute("SELECT COUNT(*) FROM op_receipts WHERE op = \'merge-rebuild\'").fetchone()[0]',
    'print("%s %s" % (Gen, Rebuilds))',
  ].join('\n'), path.join(ArgRoot, 'releases.db')], { encoding: 'utf8' });

  const [Generation, MergeRebuildReceipts] = Out.trim().split(' ').map(Number);
  return { Generation, MergeRebuildReceipts };
}
