#!/usr/bin/env node
'use strict';

/**
 * FSM invariant structural enforcement.
 *
 * The reminder write-path contract (ARCHITECTURE.md § Reminder FSM and Write-Path Contract,
 * AGENTS.md § Reminder FSM invariants) names three enforcement points:
 *
 *   1. Creation: build new ReminderInfo objects via #MakeScheduledReminder.
 *   2. Scheduling gateway: route event-driven scheduling through #TryScheduleRemindersAsync.
 *   3. State transitions: change reminder.State via #TransitionReminderState only.
 *
 * Prose alone is not enough — a future contributor can still write `reminder.State = X` in
 * one edit. This script scans src/reminders-module.js for the patterns the FSM forbids and
 * fails CI / `npm run validate:fsm` on any unannotated violation. Annotated exceptions must
 * carry the `// FSM-BACKFILL-OK` pragma on the same line so the choice is explicit and
 * reviewable.
 *
 * Scope is intentionally narrow: this is a single-file structural guard, not a general
 * lint. Cross-file write paths funnel through public RemindersModule methods that already
 * delegate into the factory and #TransitionReminderState, so scanning the one module is
 * the cheapest way to catch the next bypass.
 *
 * Exit codes:
 *   0 — all FSM invariants intact
 *   1 — at least one violation found (printed with file:line and offending source line)
 *   2 — script could not locate the target file (likely run from outside repo root)
 */

const fs = require('fs');
const path = require('path');

const RepoRoot = path.resolve(__dirname, '..');
const TargetRelPath = 'src/reminders-module.js';
const TargetAbsPath = path.join(RepoRoot, TargetRelPath);

// Methods inside RemindersModule that ARE allowed to assign `reminder.State =` directly.
// Anything else is a bypass — direct .State = mutation is what #TransitionReminderState exists to centralize.
const STATE_ASSIGNMENT_ALLOWED_METHODS = new Set([
  '#TransitionReminderState',
  '#MakeScheduledReminder',
]);

// Methods allowed to declare an inline `/** @type {ReminderInfo} */ ({ ... })` cast. This is
// how a new ReminderInfo is built — only the factory should be doing it. Outside the factory,
// every other inline cast is a hand-rolled ReminderInfo and a bypass of #MakeScheduledReminder.
const REMINDER_INFO_CAST_ALLOWED_METHODS = new Set([
  '#MakeScheduledReminder',
]);

const BACKFILL_PRAGMA = 'FSM-BACKFILL-OK';

/**
 * Track the enclosing class method for a given source line.
 *
 * Heuristic: a class-body method declaration in this codebase looks like
 *   `  async #Name(` or `  Name(` at exactly 2-space indent. Anything more deeply indented is
 * inside a method body. This is not a full JS parser but the codebase is consistently
 * formatted and the scan only needs the closest preceding match.
 *
 * @param {string[]} ArgLines
 * @returns {(string|null)[]} same length as ArgLines; entry i is the enclosing method or null
 */
function ResolveMethodContextByLine(ArgLines) {
  /** @type {(string|null)[]} */
  const Context = new Array(ArgLines.length).fill(null);
  let Current = null;
  const MethodHeadRE = /^ {2}(?:static\s+)?(?:async\s+)?(#?[A-Za-z_][\w$]*)\s*\(/;
  for(let i = 0; i < ArgLines.length; i++) {
    const Match = ArgLines[i].match(MethodHeadRE);
    if(Match) Current = Match[1];
    Context[i] = Current;
  }
  return Context;
}

function StripLineNoise(ArgLine) {
  return ArgLine.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function Main() {
  if(!fs.existsSync(TargetAbsPath)) {
    console.error(`validate-fsm-invariants: target not found at ${TargetRelPath}`);
    console.error('  Run from the repo root or via `npm run validate:fsm`.');
    process.exit(2);
  }

  const Source = fs.readFileSync(TargetAbsPath, 'utf8');
  const Lines = Source.split('\n');
  const MethodByLine = ResolveMethodContextByLine(Lines);

  const Violations = [];

  for(let i = 0; i < Lines.length; i++) {
    const RawLine = Lines[i];
    const Stripped = StripLineNoise(RawLine);
    const Method = MethodByLine[i];
    const HasBackfillPragma = RawLine.includes(BACKFILL_PRAGMA);

    // Direct `reminder.State =` (assignment, not comparison). Excludes `===`, `==`, and `!=` checks.
    if(/\b\w+\.State\s*=\s*(?!=)/.test(Stripped)) {
      if(STATE_ASSIGNMENT_ALLOWED_METHODS.has(Method) || HasBackfillPragma) continue;
      Violations.push({
        line: i + 1,
        method: Method,
        kind: 'direct .State = assignment outside #TransitionReminderState / #MakeScheduledReminder',
        code: RawLine.trim(),
      });
    }

    // Inline ReminderInfo cast — the factory's signature. Anywhere else, this is a hand-built
    // ReminderInfo bypassing #MakeScheduledReminder.
    if(/\/\*\*\s*@type\s*\{ReminderInfo\}\s*\*\/\s*\(\s*\{/.test(RawLine)) {
      if(REMINDER_INFO_CAST_ALLOWED_METHODS.has(Method) || HasBackfillPragma) continue;
      Violations.push({
        line: i + 1,
        method: Method,
        kind: 'inline ReminderInfo object literal outside #MakeScheduledReminder',
        code: RawLine.trim(),
      });
    }
  }

  if(Violations.length === 0) {
    console.log(`validate-fsm-invariants: OK (${TargetRelPath} has no forbidden patterns).`);
    process.exit(0);
  }

  console.error(`validate-fsm-invariants: ${Violations.length} violation(s) in ${TargetRelPath}:`);
  for(const V of Violations) {
    console.error(`  ${TargetRelPath}:${V.line}  (in ${V.method ?? '<top-level>'})`);
    console.error(`    kind:  ${V.kind}`);
    console.error(`    code:  ${V.code}`);
  }
  console.error('');
  console.error('Either route the change through #MakeScheduledReminder / #TransitionReminderState,');
  console.error(`or mark a legitimate legacy exception with the inline pragma "// ${BACKFILL_PRAGMA}".`);
  process.exit(1);
}

Main();
