#!/usr/bin/env node
'use strict';

// Dev CLI: replay an events .jsonl log through the pure projection and print a
// chosen view as JSON to stdout. Read-only — never writes the log or anything
// else — a pure read-side consumer of the event log ("Lane B"): it folds events
// into a view and performs no I/O beyond reading the file it is given.
//
//   node scripts/replay.js <path-to-events.jsonl> [--view rebalance|active|completed]
//                          [--workspace <ws>] [--active-only]
//                          [--from <ISO>] [--to <ISO>]
//
// Reads the .jsonl, folds it, and prints the view. Unknown event types are
// skipped with a warning to stderr (so stdout stays valid JSON).

const fs = require('node:fs');
const path = require('node:path');
const {
  foldToRebalanceShape,
  foldActive,
  foldCompleted,
} = require(path.join(__dirname, '..', 'deploy', 'reminders-export', 'events-projection.js'));

/**
 * Parse argv into options.
 * @param {string[]} ArgArgv process.argv.slice(2)
 * @returns {{ file: string|null, view: string, workspace: string, activeOnly: boolean, fromMs: number|undefined, toMs: number|undefined }}
 */
function ParseArgs(ArgArgv) {
  const Out = {
    file: null,
    view: 'rebalance',
    workspace: '',
    activeOnly: false,
    fromMs: undefined,
    toMs: undefined,
  };
  for (let Index = 0; Index < ArgArgv.length; Index++) {
    const Token = ArgArgv[Index];
    if (Token === '--view') { Out.view = ArgArgv[++Index]; continue; }
    if (Token === '--workspace') { Out.workspace = ArgArgv[++Index]; continue; }
    if (Token === '--active-only') { Out.activeOnly = true; continue; }
    if (Token === '--from') { Out.fromMs = Date.parse(ArgArgv[++Index]); continue; }
    if (Token === '--to') { Out.toMs = Date.parse(ArgArgv[++Index]); continue; }
    if (!Token.startsWith('--') && Out.file === null) { Out.file = Token; continue; }
  }
  return Out;
}

/**
 * Parse a .jsonl string into an Event[]. Blank lines are ignored. A corrupt
 * line is skipped with a warning to stderr (tolerant of a truncated tail).
 * @param {string} ArgText
 * @returns {Object[]}
 */
function ParseJsonl(ArgText) {
  const Lines = ArgText.split('\n');
  const Events = [];
  for (let Index = 0; Index < Lines.length; Index++) {
    const Line = Lines[Index].trim();
    if (Line.length === 0) continue;
    try {
      Events.push(JSON.parse(Line));
    } catch {
      process.stderr.write(`[replay] skipping corrupt line ${Index + 1}\n`);
    }
  }
  return Events;
}

function Main() {
  const Opts = ParseArgs(process.argv.slice(2));
  if (!Opts.file) {
    process.stderr.write('usage: node scripts/replay.js <events.jsonl> [--view rebalance|active|completed] [--workspace <ws>] [--active-only] [--from <ISO>] [--to <ISO>]\n');
    process.exit(2);
    return;
  }

  let Text;
  try {
    Text = fs.readFileSync(Opts.file, 'utf8');
  } catch (ArgErr) {
    process.stderr.write(`[replay] cannot read ${Opts.file}: ${ArgErr.message}\n`);
    process.exit(1);
    return;
  }

  const Events = ParseJsonl(Text);
  const Warn = (ArgMsg) => process.stderr.write(`${ArgMsg}\n`);

  let Result;
  switch (Opts.view) {
    case 'active':
      Result = foldActive(Events, { warn: Warn });
      break;
    case 'completed':
      Result = foldCompleted(Events, { fromMs: Opts.fromMs, toMs: Opts.toMs, warn: Warn });
      break;
    case 'rebalance':
    default:
      Result = foldToRebalanceShape(Events, {
        workspace: Opts.workspace,
        activeOnly: Opts.activeOnly,
        warn: Warn,
      });
      break;
  }

  process.stdout.write(JSON.stringify(Result, null, 2) + '\n');
}

Main();
