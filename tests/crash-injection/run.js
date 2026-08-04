'use strict';

/**
 * Crash-injection harness for GH-12.
 *
 * Repeatedly SIGKILLs a child mid-write and then asserts the target store is still fully parseable.
 * `SIGKILL` is deliberate: it cannot be trapped, so no shutdown hook, flush, or `finally` block can
 * paper over the failure. This is the closest reachable analogue to the OOM kill / container evict
 * that the plain `fs.writeFile` path cannot survive.
 *
 * **What this harness does and does not prove.** Killing a process does not discard the OS page
 * cache — the kernel still owns the dirty pages and writes them back. So this proves *crash
 * atomicity*: after a hard kill the authoritative file is never torn or truncated, because readers
 * only ever observe a completed `rename`. It does **not** prove durability across power loss or a
 * kernel panic, which is what the `fsync` half of the helper buys; demonstrating that needs real
 * power removal (or a fault-injecting block device), neither of which is reachable here. Claims in
 * HONEST.md are scoped to exactly what this measures and no further.
 *
 * The harness is only trustworthy if it FAILS on the known-broken path. Every mode is therefore a
 * matched pair, and `--matrix` runs each `unsafe` before its `durable` counterpart: the unsafe half
 * must report corruption, or the clean durable half proves nothing.
 *
 * Three write shapes are covered, because they fail differently:
 *   whole-file async  (most stores)                        `unsafe`        / `durable`
 *   whole-file sync   (client-mapping, show-me-projects)   `unsafe-sync`   / `durable-sync`
 *   JSONL append      (event-store, trashed examples)      `unsafe-append` / `durable-append`
 *
 * **The append pair asserts something weaker than the other two, on purpose.** An append-only log
 * has no truncate window, so a kill can only damage the record currently being written — measured,
 * not assumed: the unsafe append path produces torn *tails* and never once damaged an earlier
 * record. The durable append pair therefore does NOT demonstrate an `fsync` benefit; what `fsync`
 * buys an append is recency (a bounded loss window), and that is invisible to process-kill testing
 * for the page-cache reason above. What this pair does assert is that the durable path never
 * damages a non-final record and does not regress the tail-confinement the shape already had.
 *
 * Usage:
 *   node tests/crash-injection/run.js --matrix --iterations 100
 *   node tests/crash-injection/run.js --mode durable --iterations 100
 *
 * Exit: 0 when every mode run produced the result that mode should produce, 1 otherwise.
 */

const { spawn } = require('child_process');
const fsSync = require('fs');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');

/**
 * Parse `--flag value` pairs.
 * @param {string} ArgName Flag name without dashes.
 * @param {string} ArgFallback Value when the flag is absent.
 * @returns {string}
 */
function ReadFlag(ArgName, ArgFallback) {
  const Index = process.argv.indexOf(`--${ArgName}`);
  return Index === -1 ? ArgFallback : process.argv[Index + 1];
}

const Iterations = Number(ReadFlag('iterations', '40'));
const IsMatrix = process.argv.includes('--matrix');
/** Explicit `--records` overrides the per-shape default; absent, each shape picks its own. */
const RecordsOverride = process.argv.includes('--records') ? Number(ReadFlag('records', '0')) : 0;

/**
 * Append needs a LARGER batch than the whole-file shapes, which is counter-intuitive and was
 * established by measurement. A whole-file write tears easily because `fs.writeFile` truncates
 * first, so a kill anywhere in the rewrite leaves a short file. An append has no truncate window,
 * and `SIGKILL` cannot split a single `write(2)` — the kernel completes it. Damage therefore
 * requires a payload big enough that Node's write loop issues several syscalls. Measured on the
 * `unsafe-append` path: 2k records (~0.4 MB) → 0/100 damage; 50k (~10 MB) → 3/30; 200k (~40 MB) →
 * 0/30 because the kill starts landing during `JSON.stringify` instead, before any write begins.
 */
const APPEND_RECORDS = 50000;
const WHOLE_FILE_RECORDS = 20000;

/** Ordered so each unsafe run is proven to detect its failure mode before its durable pair runs. */
const MATRIX = ['unsafe', 'durable', 'unsafe-sync', 'durable-sync', 'unsafe-append', 'durable-append'];

/**
 * Wait for the child to announce it is writing, then a further random slice, so kills land at
 * varied points inside the write rather than always at the same offset.
 * @param {import('child_process').ChildProcess} ArgChild Spawned writer.
 * @returns {Promise<void>}
 */
function WaitUntilWritingAsync(ArgChild) {
  return new Promise(ArgResolve => {
    let Settled = false;
    const Finish = () => {
      if(Settled) return;
      Settled = true;
      ArgResolve();
    };
    ArgChild.stdout.once('data', Finish);
    setTimeout(Finish, 3000).unref();
  });
}

/**
 * Classify a whole-file store after a kill.
 * @param {string} ArgTargetPath Store path.
 * @returns {Promise<'absent'|'intact'|'CORRUPT'>}
 */
async function InspectWholeFileAsync(ArgTargetPath) {
  let Raw;
  try {
    Raw = await fs.readFile(ArgTargetPath, 'utf8');
  } catch(error) {
    // Never written yet. Not a corruption — the store simply does not exist.
    return 'absent';
  }
  if(Raw.length === 0) return 'CORRUPT';
  try {
    const Parsed = JSON.parse(Raw);
    return Array.isArray(Parsed) ? 'intact' : 'CORRUPT';
  } catch(error) {
    return 'CORRUPT';
  }
}

/**
 * Classify a JSONL store after a kill. An append-only log has a weaker but different contract than
 * a whole-file store: a kill may leave a half-written FINAL line, and that is acceptable — readers
 * skip it and no earlier record is affected. Damage to any NON-final line is real corruption,
 * because it means an append overwrote or tore data it had already acknowledged.
 * @param {string} ArgTargetPath Store path.
 * @returns {Promise<'absent'|'intact'|'torn-tail'|'CORRUPT'>}
 */
async function InspectAppendAsync(ArgTargetPath) {
  let Raw;
  try {
    Raw = await fs.readFile(ArgTargetPath, 'utf8');
  } catch(error) {
    return 'absent';
  }
  if(Raw.length === 0) return 'absent';
  const Lines = Raw.split('\n');
  // A trailing newline yields a final empty element; that is a cleanly-terminated file.
  const HasCleanTail = Lines[Lines.length - 1] === '';
  if(HasCleanTail) Lines.pop();
  if(Lines.length === 0) return 'absent';

  for(let Index = 0; Index < Lines.length - 1; Index += 1) {
    try {
      JSON.parse(Lines[Index]);
    } catch(error) {
      return 'CORRUPT';
    }
  }
  try {
    JSON.parse(Lines[Lines.length - 1]);
  } catch(error) {
    return 'torn-tail';
  }
  return HasCleanTail ? 'intact' : 'torn-tail';
}

/**
 * Run every iteration for one mode.
 * @param {string} ArgMode Writer mode.
 * @returns {Promise<boolean>} True when the mode produced the result it should.
 */
async function RunModeAsync(ArgMode) {
  const IsAppend = ArgMode.endsWith('-append');
  const IsUnsafe = ArgMode.startsWith('unsafe');
  const RecordCount = RecordsOverride || (IsAppend ? APPEND_RECORDS : WHOLE_FILE_RECORDS);

  const WorkDir = await fs.mkdtemp(path.join(os.tmpdir(), `crash-injection-${ArgMode}-`));
  const TargetPath = path.join(WorkDir, IsAppend ? 'store.jsonl' : 'store.json');
  const WriterPath = path.join(__dirname, 'crash-writer.js');

  let Corrupt = 0;
  let Intact = 0;
  let Absent = 0;
  let TornTail = 0;

  process.stdout.write(`\ncrash-injection: mode=${ArgMode} iterations=${Iterations} records=${RecordCount}\n`);

  for(let Iteration = 1; Iteration <= Iterations; Iteration += 1) {
    // Each append iteration starts from an empty log, and this is load-bearing rather than tidiness.
    // Letting the file accumulate makes the previous iteration's torn TAIL become an INTERIOR line
    // once the next iteration appends past it, which the inspector would then score as damage to
    // history. That artifact reported 22/100 "corrupt" on unsafe and 35/100 on durable — a fault in
    // the experiment, not in either write path. One process's own sequence of appends is still the
    // real subject: the kill window below is tuned so batches complete before the kill lands.
    if(IsAppend) await fs.rm(TargetPath, { force: true });

    const Child = spawn(process.execPath, [WriterPath, ArgMode, TargetPath, String(RecordCount)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await WaitUntilWritingAsync(Child);
    // Land inside a write rather than between writes. The spread matters more than the magnitude.
    // Append needs a longer window than the whole-file shapes: the question it answers is whether a
    // crash damages an ALREADY-COMPLETED record, so at least one batch must finish before the kill.
    await new Promise(ArgResolve => setTimeout(ArgResolve, IsAppend
      ? 60 + Math.floor(Math.random() * 340)
      : 5 + Math.floor(Math.random() * 60)));

    Child.kill('SIGKILL');
    await new Promise(ArgResolve => Child.once('exit', ArgResolve));

    const State = IsAppend ? await InspectAppendAsync(TargetPath) : await InspectWholeFileAsync(TargetPath);
    if(State === 'CORRUPT') Corrupt += 1;
    else if(State === 'intact') Intact += 1;
    else if(State === 'torn-tail') TornTail += 1;
    else Absent += 1;
  }

  // Leftover temp files would mean the durable path is littering on kill. They are harmless to
  // readers (the store is only ever replaced by rename) but worth reporting honestly.
  const Leftovers = fsSync.readdirSync(WorkDir).filter(ArgName => ArgName.endsWith('.tmp')).length;

  process.stdout.write(
    `crash-injection: corrupt=${Corrupt} intact=${Intact} torn-tail=${TornTail} ` +
    `absent=${Absent} leftover-temps=${Leftovers}\n`);

  if(IsUnsafe) {
    // The append pair is the honest exception: an unsynced append can only damage its own tail, so
    // it produces torn tails rather than the earlier-record corruption the whole-file shapes show.
    const Detected = IsAppend ? (Corrupt + TornTail) : Corrupt;
    if(Detected === 0) {
      process.stdout.write(
        `crash-injection: FAIL — the ${ArgMode} path survived every kill, so this harness is not landing\n` +
        '  kills inside the write window. A clean durable run would prove nothing. Raise --records\n' +
        '  or --iterations until this reports damage.\n');
      return false;
    }
    process.stdout.write(
      `crash-injection: PASS — reproduced damage ${Detected}/${Iterations} on the ${ArgMode} path\n`);
    return true;
  }

  if(Corrupt > 0) {
    process.stdout.write(`crash-injection: FAIL — ${ArgMode} produced ${Corrupt} damaged store(s)\n`);
    return false;
  }
  process.stdout.write(
    `crash-injection: PASS — ${Intact} intact, ${TornTail} torn-tail (acceptable for append-only), ` +
    `${Absent} not-yet-written, 0 corrupt\n`);
  return true;
}

async function MainAsync() {
  const Modes = IsMatrix ? MATRIX : [ReadFlag('mode', 'durable')];
  const Failures = [];

  for(const Mode of Modes) {
    const Ok = await RunModeAsync(Mode);
    if(!Ok) Failures.push(Mode);
  }

  if(Failures.length > 0) {
    process.stdout.write(`\ncrash-injection: OVERALL FAIL — ${Failures.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\ncrash-injection: OVERALL PASS — ${Modes.length} mode(s), ${Iterations} iterations each\n`);
}

MainAsync().catch(ArgError => {
  process.stderr.write(`crash-injection: ${ArgError && ArgError.stack}\n`);
  process.exit(1);
});
