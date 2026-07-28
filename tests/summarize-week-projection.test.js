'use strict';

// node:test suite for Phase 2 — summarize-week projection + shadow-diff harness.
// Run: node --test tests/summarize-week-projection.test.js

const test   = require('node:test');
const assert = require('node:assert');
const fs     = require('node:fs');
const os     = require('node:os');
const path   = require('node:path');
const { execFileSync } = require('node:child_process');

const { summarizeWeekFromEvents } = require('../src/summarize-week-projection');
const { computeShadowDiff }       = require('../scripts/summarize-week-shadow-diff');

const REPO_ROOT         = path.join(__dirname, '..');
const SHADOW_DIFF_CLI   = path.join(REPO_ROOT, 'scripts', 'summarize-week-shadow-diff.js');

// Test week: Sun 2026-06-08 00:00:00Z (inclusive) → Sun 2026-06-15 00:00:00Z (exclusive)
const WEEK_START_MS = Date.parse('2026-06-08T00:00:00Z');
const WEEK_END_MS   = Date.parse('2026-06-15T00:00:00Z');

/**
 * Synthetic fixture events covering:
 *   rem_a  created+scheduled, still open (due after week)
 *   rem_b  completed inside window — should appear in `completed`
 *   rem_c  completed before window — must be excluded
 *   rem_d  cancelled — must NOT appear in `open`
 *   rem_e  completed exactly at weekEndMs (exclusive bound) — must be excluded
 */
function FixtureEvents() {
  return [
    // rem_a — open
    {
      v: 1, id: 'evt_1', ts: '2026-06-08T08:00:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_a',
      payload: { text: 'finish report', assigneeId: 'U_alice', sourceChannelId: 'C_src',
                 targetChannelId: 'C_tgt', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'evt_2', ts: '2026-06-08T08:01:00Z', workspace: 'test',
      type: 'ReminderScheduled', reminderId: 'rem_a',
      payload: { dueAt: '2026-06-20T10:00:00.000Z', via: 'created' },
    },

    // rem_b — completed in window
    {
      v: 1, id: 'evt_3', ts: '2026-06-09T09:00:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_b',
      payload: { text: 'deploy hotfix', assigneeId: 'U_bob', sourceChannelId: 'C_eng',
                 targetChannelId: 'C_eng', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'evt_4', ts: '2026-06-10T15:00:00Z', workspace: 'test',
      type: 'ReminderCompleted', reminderId: 'rem_b',
      payload: { by: 'U_bob', method: 'reaction', summary: 'deployed ok',
                 completedAt: '2026-06-10T15:00:00.000Z' },
    },

    // rem_c — completed before window (should be excluded)
    {
      v: 1, id: 'evt_5', ts: '2026-06-01T10:00:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_c',
      payload: { text: 'old task', assigneeId: 'U_carol', sourceChannelId: 'C_src',
                 targetChannelId: 'C_src', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'evt_6', ts: '2026-06-05T10:00:00Z', workspace: 'test',
      type: 'ReminderCompleted', reminderId: 'rem_c',
      payload: { by: 'U_carol', method: 'slash', summary: 'done last week',
                 completedAt: '2026-06-05T10:00:00.000Z' },
    },

    // rem_d — cancelled (must not appear in open)
    {
      v: 1, id: 'evt_7', ts: '2026-06-08T11:00:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_d',
      payload: { text: 'stale task', assigneeId: null, sourceChannelId: 'C_src',
                 targetChannelId: 'C_src', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'evt_8', ts: '2026-06-09T12:00:00Z', workspace: 'test',
      type: 'ReminderCancelled', reminderId: 'rem_d',
      payload: { by: 'U_alice', reason: 'no longer needed' },
    },

    // rem_e — completed exactly at weekEndMs (exclusive bound — must be excluded)
    {
      v: 1, id: 'evt_9', ts: '2026-06-09T08:00:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_e',
      payload: { text: 'boundary task', assigneeId: 'U_dave', sourceChannelId: 'C_x',
                 targetChannelId: 'C_x', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'evt_10', ts: '2026-06-15T00:00:00Z', workspace: 'test',
      type: 'ReminderCompleted', reminderId: 'rem_e',
      payload: { by: 'U_dave', method: 'reaction', summary: 'boundary',
                 completedAt: '2026-06-15T00:00:00.000Z' },
    },
  ];
}

// ---------------------------------------------------------------------------
// Projection correctness
// ---------------------------------------------------------------------------

test('completed-in-window: only rem_b appears (rem_c before window, rem_e at exclusive end)', () => {
  const { completed } = summarizeWeekFromEvents(FixtureEvents(), { weekStartMs: WEEK_START_MS, weekEndMs: WEEK_END_MS });
  assert.strictEqual(completed.length, 1, 'expected exactly one completed row');
  assert.strictEqual(completed[0].reminderId, 'rem_b');
});

test('completed row fields map correctly to CompletionRecord shape', () => {
  const { completed } = summarizeWeekFromEvents(FixtureEvents(), { weekStartMs: WEEK_START_MS, weekEndMs: WEEK_END_MS });
  const Row = completed[0];
  assert.strictEqual(Row.reminderId,      'rem_b');
  assert.strictEqual(Row.summary,         'deployed ok');
  assert.strictEqual(Row.assigneeID,      'U_bob');
  assert.strictEqual(Row.sourceChannelID, 'C_eng');
  assert.strictEqual(Row.completedMs,     Date.parse('2026-06-10T15:00:00.000Z'));
});

test('inclusive start boundary: completed exactly at weekStartMs is included', () => {
  const AtStart = [
    {
      v: 1, id: 'e1', ts: '2026-06-08T00:00:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_boundary_start',
      payload: { text: 't', assigneeId: null, sourceChannelId: 'C', targetChannelId: 'C', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'e2', ts: '2026-06-08T00:00:00Z', workspace: 'test',
      type: 'ReminderCompleted', reminderId: 'rem_boundary_start',
      payload: { by: 'U_x', method: 'slash', summary: 'done', completedAt: '2026-06-08T00:00:00.000Z' },
    },
  ];
  const { completed } = summarizeWeekFromEvents(AtStart, { weekStartMs: WEEK_START_MS, weekEndMs: WEEK_END_MS });
  assert.strictEqual(completed.length, 1, 'completedAt == weekStartMs should be included');
});

test('exclusive end boundary: completed exactly at weekEndMs is excluded', () => {
  const { completed } = summarizeWeekFromEvents(FixtureEvents(), { weekStartMs: WEEK_START_MS, weekEndMs: WEEK_END_MS });
  const ids = completed.map((r) => r.reminderId);
  assert.ok(!ids.includes('rem_e'), 'rem_e completedAt == weekEndMs must be excluded (exclusive end)');
});

test('open-set derivation: only non-cancelled non-completed reminders appear', () => {
  const { open } = summarizeWeekFromEvents(FixtureEvents(), { weekStartMs: WEEK_START_MS, weekEndMs: WEEK_END_MS });
  const openIds = open.map((r) => r.reminderId).sort();
  // rem_a is open; rem_b completed; rem_c completed (outside window but still completed); rem_d cancelled; rem_e completed
  assert.deepStrictEqual(openIds, ['rem_a'], 'only rem_a should be in open set');
});

test('completed list is sorted oldest-first by completedMs', () => {
  const MultiCompleted = [
    {
      v: 1, id: 'ea1', ts: '2026-06-08T01:00:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_later',
      payload: { text: 'b', assigneeId: null, sourceChannelId: 'C', targetChannelId: 'C', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'ea2', ts: '2026-06-12T10:00:00Z', workspace: 'test',
      type: 'ReminderCompleted', reminderId: 'rem_later',
      payload: { by: 'U_x', method: 'slash', summary: 'b', completedAt: '2026-06-12T10:00:00.000Z' },
    },
    {
      v: 1, id: 'eb1', ts: '2026-06-08T00:30:00Z', workspace: 'test',
      type: 'ReminderCreated', reminderId: 'rem_earlier',
      payload: { text: 'a', assigneeId: null, sourceChannelId: 'C', targetChannelId: 'C', source: 'fsm', githubUrls: [] },
    },
    {
      v: 1, id: 'eb2', ts: '2026-06-09T08:00:00Z', workspace: 'test',
      type: 'ReminderCompleted', reminderId: 'rem_earlier',
      payload: { by: 'U_y', method: 'reaction', summary: 'a', completedAt: '2026-06-09T08:00:00.000Z' },
    },
  ];
  const { completed } = summarizeWeekFromEvents(MultiCompleted, { weekStartMs: WEEK_START_MS, weekEndMs: WEEK_END_MS });
  assert.strictEqual(completed.length, 2);
  assert.ok(completed[0].completedMs <= completed[1].completedMs, 'must be sorted oldest-first');
  assert.strictEqual(completed[0].reminderId, 'rem_earlier');
});

test('determinism: same input yields byte-identical output', () => {
  const Opts = { weekStartMs: WEEK_START_MS, weekEndMs: WEEK_END_MS };
  const A = JSON.stringify(summarizeWeekFromEvents(FixtureEvents(), Opts));
  const B = JSON.stringify(summarizeWeekFromEvents(FixtureEvents(), Opts));
  assert.strictEqual(A, B);
});

// ---------------------------------------------------------------------------
// Shadow-diff harness (pure computeShadowDiff)
// ---------------------------------------------------------------------------

test('computeShadowDiff: clean diff when both sides match', () => {
  const Projected = [
    { reminderId: 'rem_b', summary: 'deployed ok', assigneeID: 'U_bob', sourceChannelID: 'C_eng',
      dueDate: null, completedMs: Date.parse('2026-06-10T15:00:00.000Z') },
  ];
  const Stored = [
    { reminderId: 'rem_b', summary: 'deployed ok', assigneeID: 'U_bob', sourceChannelID: 'C_eng',
      dueDate: null, completedMs: Date.parse('2026-06-10T15:00:00.000Z') },
  ];
  const Diff = computeShadowDiff(Projected, Stored);
  assert.strictEqual(Diff.match, true);
  assert.strictEqual(Diff.missing.length, 0);
  assert.strictEqual(Diff.extra.length, 0);
  assert.strictEqual(Diff.differing.length, 0);
});

test('computeShadowDiff: missing row is flagged (in stored, absent from projected)', () => {
  const Projected = [];
  const Stored = [
    { reminderId: 'rem_b', summary: 'deployed ok', assigneeID: 'U_bob', sourceChannelID: 'C_eng',
      dueDate: null, completedMs: Date.parse('2026-06-10T15:00:00.000Z') },
  ];
  const Diff = computeShadowDiff(Projected, Stored);
  assert.strictEqual(Diff.match, false);
  assert.strictEqual(Diff.missing.length, 1);
  assert.strictEqual(Diff.missing[0].reminderId, 'rem_b');
});

test('computeShadowDiff: extra row is flagged (in projected, absent from stored)', () => {
  const Projected = [
    { reminderId: 'rem_phantom', summary: 'ghost', assigneeID: null, sourceChannelID: null,
      dueDate: null, completedMs: Date.parse('2026-06-11T10:00:00.000Z') },
  ];
  const Stored = [];
  const Diff = computeShadowDiff(Projected, Stored);
  assert.strictEqual(Diff.match, false);
  assert.strictEqual(Diff.extra.length, 1);
  assert.strictEqual(Diff.extra[0].reminderId, 'rem_phantom');
});

test('computeShadowDiff: field mismatch is reported with field name and both values', () => {
  const Projected = [
    { reminderId: 'rem_b', summary: 'deployed ok', assigneeID: 'U_bob', sourceChannelID: 'C_eng',
      dueDate: null, completedMs: Date.parse('2026-06-10T15:00:00.000Z') },
  ];
  // Stored has different summary (planted mismatch)
  const Stored = [
    { reminderId: 'rem_b', summary: 'WRONG SUMMARY', assigneeID: 'U_bob', sourceChannelID: 'C_eng',
      dueDate: null, completedMs: Date.parse('2026-06-10T15:00:00.000Z') },
  ];
  const Diff = computeShadowDiff(Projected, Stored);
  assert.strictEqual(Diff.match, false);
  assert.strictEqual(Diff.differing.length, 1);
  assert.strictEqual(Diff.differing[0].reminderId, 'rem_b');
  const SummaryDiff = Diff.differing[0].diffs.find((d) => d.field === 'summary');
  assert.ok(SummaryDiff, 'expected a diff entry for the summary field');
  assert.strictEqual(SummaryDiff.projected, 'deployed ok');
  assert.strictEqual(SummaryDiff.stored,    'WRONG SUMMARY');
});

// ---------------------------------------------------------------------------
// CLI smoke test (subprocess)
// ---------------------------------------------------------------------------

test('shadow-diff CLI prints structured JSON report on fixture inputs', () => {
  const Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-diff-test-'));
  try {
    // Events file
    const EventLines = FixtureEvents().map((e) => JSON.stringify(e)).join('\n') + '\n';
    const EventsFile = path.join(Dir, 'events.jsonl');
    fs.writeFileSync(EventsFile, EventLines, 'utf8');

    // Completions file (synthetic, matching rem_b)
    const CompletedMs = Date.parse('2026-06-10T15:00:00.000Z');
    const Completions = [
      { reminderId: 'rem_b', summary: 'deployed ok', assigneeID: 'U_bob',
        sourceChannelID: 'C_eng', dueDate: null, completedMs: CompletedMs },
    ];
    const CompletionsFile = path.join(Dir, 'completed.json');
    fs.writeFileSync(CompletionsFile, JSON.stringify(Completions), 'utf8');

    const Stdout = execFileSync(
      process.execPath,
      [
        SHADOW_DIFF_CLI,
        '--events-file', EventsFile,
        '--completions-file', CompletionsFile,
        '--week-start-ms', String(WEEK_START_MS),
        '--week-end-ms', String(WEEK_END_MS),
      ],
      { encoding: 'utf8' }
    );

    const Report = JSON.parse(Stdout); // throws if not valid JSON
    assert.strictEqual(typeof Report.weekStartMs, 'number');
    assert.strictEqual(typeof Report.projectedCount, 'number');
    assert.strictEqual(typeof Report.storedCount, 'number');
    assert.ok('diff' in Report, 'report must have a diff key');
    assert.ok('match' in Report.diff);
  } finally {
    fs.rmSync(Dir, { recursive: true, force: true });
  }
});

test('shadow-diff CLI exits 2 when planted mismatch is present', () => {
  const Dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-diff-mismatch-'));
  try {
    const EventLines = FixtureEvents().map((e) => JSON.stringify(e)).join('\n') + '\n';
    const EventsFile = path.join(Dir, 'events.jsonl');
    fs.writeFileSync(EventsFile, EventLines, 'utf8');

    // Completions file with rem_b but a WRONG summary (planted mismatch)
    const CompletedMs = Date.parse('2026-06-10T15:00:00.000Z');
    const Completions = [
      { reminderId: 'rem_b', summary: 'PLANTED MISMATCH', assigneeID: 'U_bob',
        sourceChannelID: 'C_eng', dueDate: null, completedMs: CompletedMs },
    ];
    const CompletionsFile = path.join(Dir, 'completed.json');
    fs.writeFileSync(CompletionsFile, JSON.stringify(Completions), 'utf8');

    let ExitCode = 0;
    try {
      execFileSync(
        process.execPath,
        [
          SHADOW_DIFF_CLI,
          '--events-file', EventsFile,
          '--completions-file', CompletionsFile,
          '--week-start-ms', String(WEEK_START_MS),
          '--week-end-ms', String(WEEK_END_MS),
        ],
        { encoding: 'utf8' }
      );
    } catch (ArgErr) {
      ExitCode = ArgErr.status;
    }
    assert.strictEqual(ExitCode, 2, 'CLI must exit 2 when the diff is not clean');
  } finally {
    fs.rmSync(Dir, { recursive: true, force: true });
  }
});
