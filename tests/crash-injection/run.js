'use strict';

/**
 * Crash-injection harness for GH-12.
 *
 * Repeatedly SIGKILLs a child mid-write and then asserts the target file is still fully parseable.
 * `SIGKILL` is deliberate: it cannot be trapped, so no shutdown hook, flush, or `finally` block can
 * paper over the failure. This is the closest reachable analogue to the OOM kill / power loss /
 * container evict that the plain `fs.writeFile` path cannot survive.
 *
 * The harness is only trustworthy if it FAILS on the known-broken path. `--mode unsafe` must report
 * corruption; a run where `unsafe` comes back clean means the harness is not landing its kills
 * inside the write window, and a subsequent clean `durable` run proves nothing.
 *
 * Usage:
 *   node tests/crash-injection/run.js --mode unsafe  --iterations 40
 *   node tests/crash-injection/run.js --mode durable --iterations 100
 *
 * Exit: 0 when the observed result matches what the mode should produce, 1 otherwise.
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

const Mode = ReadFlag('mode', 'durable');
const Iterations = Number(ReadFlag('iterations', '40'));
const RecordCount = Number(ReadFlag('records', '20000'));

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
 * Classify the on-disk state after a kill.
 * @param {string} ArgTargetPath Store path.
 * @returns {Promise<'absent'|'intact'|'CORRUPT'>}
 */
async function InspectAsync(ArgTargetPath) {
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

async function MainAsync() {
  const WorkDir = await fs.mkdtemp(path.join(os.tmpdir(), `crash-injection-${Mode}-`));
  const TargetPath = path.join(WorkDir, 'store.json');
  const WriterPath = path.join(__dirname, 'crash-writer.js');

  let Corrupt = 0;
  let Intact = 0;
  let Absent = 0;

  process.stdout.write(`crash-injection: mode=${Mode} iterations=${Iterations} records=${RecordCount}\n`);

  for(let Iteration = 1; Iteration <= Iterations; Iteration += 1) {
    const Child = spawn(process.execPath, [WriterPath, Mode, TargetPath, String(RecordCount)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    await WaitUntilWritingAsync(Child);
    // Land inside a write rather than between writes. The spread matters more than the magnitude.
    await new Promise(ArgResolve => setTimeout(ArgResolve, 5 + Math.floor(Math.random() * 60)));

    Child.kill('SIGKILL');
    await new Promise(ArgResolve => Child.once('exit', ArgResolve));

    const State = await InspectAsync(TargetPath);
    if(State === 'CORRUPT') Corrupt += 1;
    else if(State === 'intact') Intact += 1;
    else Absent += 1;
  }

  // Leftover temp files would mean the durable path is littering on kill. They are harmless to
  // readers (the store is only ever replaced by rename) but worth reporting honestly.
  const Leftovers = fsSync.readdirSync(WorkDir).filter(ArgName => ArgName.endsWith('.tmp')).length;

  process.stdout.write(
    `crash-injection: corrupt=${Corrupt} intact=${Intact} absent=${Absent} leftover-temps=${Leftovers}\n`);

  if(Mode === 'unsafe') {
    if(Corrupt === 0) {
      process.stdout.write(
        'crash-injection: FAIL — the unsafe path survived every kill, so this harness is not landing\n' +
        '  kills inside the write window. A clean `durable` run would prove nothing. Raise --records\n' +
        '  or --iterations until this reports corruption.\n');
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`crash-injection: PASS — reproduced corruption ${Corrupt}/${Iterations} on the unsafe path\n`);
    return;
  }

  if(Corrupt > 0) {
    process.stdout.write(`crash-injection: FAIL — durable path produced ${Corrupt} unparseable file(s)\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`crash-injection: PASS — ${Intact} intact, ${Absent} not-yet-written, 0 corrupt\n`);
}

MainAsync().catch(ArgError => {
  process.stderr.write(`crash-injection: ${ArgError && ArgError.stack}\n`);
  process.exit(1);
});
