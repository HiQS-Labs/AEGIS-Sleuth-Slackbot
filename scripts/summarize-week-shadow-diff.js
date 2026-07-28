#!/usr/bin/env node
'use strict';

// Shadow-diff harness: computes BOTH the CompletionStore-based completed list (authoritative)
// and the projection-based list (events ledger), then reports mismatches as structured JSON.
// Read-only; never writes, never touches reminder state.
//
// Usage:
//   node scripts/summarize-week-shadow-diff.js \
//     --events-file <path-to-events.jsonl> \
//     --completions-file <path-to-workspace_completed.json> \
//     [--week-start-ms <epochMs>] [--week-end-ms <epochMs>]
//
// Exit codes: 0 = clean diff, 2 = mismatches found, 1 = runtime error.
// The comparison is by reminderId; unknown fields outside the CompletionRecord shape are ignored.
//
// Known divergence: completedMs will differ by milliseconds because CompletionStore records
// Date.now() at the FSM call site while the event payload.completedAt is set instants earlier.
// A small completedMs diff in the "differing" list is expected; it does NOT indicate a data loss.

const fs = require('node:fs');

const { summarizeWeekFromEvents } = require('../src/summarize-week-projection');

// --- Pure diff logic (exported for tests) --------------------------------

/**
 * Compare two completed-row arrays and return a structured diff report, keyed by reminderId.
 *
 * @param {Object[]} ArgProjected  rows from summarizeWeekFromEvents
 * @param {Object[]} ArgStored     rows from CompletionStore / completion JSON file
 * @returns {{ match: boolean, missing: Object[], extra: Object[], differing: Object[] }}
 */
function computeShadowDiff(ArgProjected, ArgStored) {
  const ProjectedById = new Map((ArgProjected || []).map((ArgRow) => [ArgRow.reminderId, ArgRow]));
  const StoredById    = new Map((ArgStored    || []).map((ArgRow) => [ArgRow.reminderId, ArgRow]));

  const Missing   = []; // in stored, absent from projected
  const Extra     = []; // in projected, absent from stored
  const Differing = []; // present in both but fields differ

  for (const [ArgId, ArgStored] of StoredById) {
    const ArgProjectedRow = ProjectedById.get(ArgId);
    if (!ArgProjectedRow) {
      Missing.push({ reminderId: ArgId, stored: ArgStored });
      continue;
    }
    const FieldDiffs = FindFieldDiffs(ArgProjectedRow, ArgStored);
    if (FieldDiffs.length > 0) {
      Differing.push({ reminderId: ArgId, diffs: FieldDiffs });
    }
  }
  for (const [ArgId, ArgProjectedRow] of ProjectedById) {
    if (!StoredById.has(ArgId)) {
      Extra.push({ reminderId: ArgId, projected: ArgProjectedRow });
    }
  }

  return {
    match:     Missing.length === 0 && Extra.length === 0 && Differing.length === 0,
    missing:   Missing,
    extra:     Extra,
    differing: Differing,
  };
}

/** @returns {{ field: string, projected: any, stored: any }[]} */
function FindFieldDiffs(ArgProjected, ArgStored) {
  const Fields = ['summary', 'assigneeID', 'sourceChannelID', 'dueDate', 'completedMs'];
  const Diffs = [];
  for (const Field of Fields) {
    if (ArgProjected[Field] !== ArgStored[Field]) {
      Diffs.push({ field: Field, projected: ArgProjected[Field], stored: ArgStored[Field] });
    }
  }
  return Diffs;
}

module.exports = { computeShadowDiff };

// --- CLI harness ---------------------------------------------------------

if (require.main === module) {
  RunCLI(process.argv.slice(2)).catch((ArgErr) => {
    console.error('shadow-diff error:', ArgErr.message);
    process.exit(1);
  });
}

async function RunCLI(ArgArgs) {
  const Opts = ParseArgs(ArgArgs);

  if (!Opts.eventsFile || !Opts.completionsFile) {
    process.stderr.write(
      'Usage: node scripts/summarize-week-shadow-diff.js \\\n' +
      '  --events-file <path-to-events.jsonl> \\\n' +
      '  --completions-file <path-to-workspace_completed.json> \\\n' +
      '  [--week-start-ms <epochMs>] [--week-end-ms <epochMs>]\n'
    );
    process.exit(1);
  }

  // Load events JSONL — tolerant of corrupt/empty lines
  const EventLines = fs.readFileSync(Opts.eventsFile, 'utf8').split('\n').filter(Boolean);
  const Events = EventLines.map((ArgLine, ArgIdx) => {
    try { return JSON.parse(ArgLine); }
    catch { process.stderr.write(`[shadow-diff] skipping corrupt events line ${ArgIdx + 1}\n`); return null; }
  }).filter(Boolean);

  // Load CompletionStore JSON (plain array written by completion-store.js)
  const StoredRaw = JSON.parse(fs.readFileSync(Opts.completionsFile, 'utf8'));
  const StoredAll = Array.isArray(StoredRaw) ? StoredRaw : [];

  const { weekStartMs, weekEndMs } = Opts;

  // Apply the same [start, end) window the live handler uses (completion-store.js:104-108)
  const StoredInWindow = StoredAll.filter(
    (ArgRow) => ArgRow.completedMs >= weekStartMs && ArgRow.completedMs < weekEndMs
  );

  const { completed: Projected } = summarizeWeekFromEvents(Events, { weekStartMs, weekEndMs });

  const Diff = computeShadowDiff(Projected, StoredInWindow);

  const Report = {
    weekStartMs,
    weekEndMs,
    projectedCount: Projected.length,
    storedCount:    StoredInWindow.length,
    diff:           Diff,
  };

  process.stdout.write(JSON.stringify(Report, null, 2) + '\n');

  if (!Diff.match) {
    process.exit(2);
  }
}

function ParseArgs(ArgArgs) {
  const Opts = {
    eventsFile:      null,
    completionsFile: null,
    weekStartMs:     GetDefaultWeekStartMs(),
    weekEndMs:       GetDefaultWeekEndMs(),
  };
  for (let i = 0; i < ArgArgs.length; i++) {
    switch (ArgArgs[i]) {
      case '--events-file':      Opts.eventsFile      = ArgArgs[++i]; break;
      case '--completions-file': Opts.completionsFile = ArgArgs[++i]; break;
      case '--week-start-ms':    Opts.weekStartMs     = Number(ArgArgs[++i]); break;
      case '--week-end-ms':      Opts.weekEndMs       = Number(ArgArgs[++i]); break;
    }
  }
  return Opts;
}

function GetDefaultWeekStartMs() {
  const Now = new Date();
  Now.setUTCHours(0, 0, 0, 0);
  Now.setUTCDate(Now.getUTCDate() - Now.getUTCDay()); // back to Sunday
  return Now.getTime();
}

function GetDefaultWeekEndMs() {
  return GetDefaultWeekStartMs() + 7 * 24 * 60 * 60 * 1000;
}
