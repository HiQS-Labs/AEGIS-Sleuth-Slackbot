'use strict';

const { BuildCompletionsContent, ShapeRecord, DAY_MS } = require('../deploy/reminders-export/completions-payload.js');

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // 2026-07-15T12:00:00Z

/** A raw CompletionStore record (shape of {workspace}_completed.json rows). */
function Raw(overrides = {}) {
  return {
    reminderId: 'R-1',
    summary: 'ship the thing',
    assigneeID: 'U_MIKE',
    sourceChannelID: 'C_PUB',
    dueDate: '2026-07-10T00:00:00.000Z',
    completedMs: NOW - 2 * DAY_MS,
    clientId: 'client-a',
    ...overrides,
  };
}

describe('ShapeRecord', () => {
  test('camelCases and preserves fields', () => {
    expect(ShapeRecord(Raw())).toEqual({
      reminderId: 'R-1',
      summary: 'ship the thing',
      assigneeId: 'U_MIKE',
      sourceChannelId: 'C_PUB',
      clientId: 'client-a',
      dueDate: '2026-07-10T00:00:00.000Z',
      completedMs: NOW - 2 * DAY_MS,
      completedAt: new Date(NOW - 2 * DAY_MS).toISOString(),
    });
  });

  test('drops rows with no reminderId or a non-finite completedMs', () => {
    expect(ShapeRecord(Raw({ reminderId: null }))).toBeNull();
    expect(ShapeRecord(Raw({ completedMs: 'nope' }))).toBeNull();
    expect(ShapeRecord(Raw({ completedMs: NaN }))).toBeNull();
  });

  test('normalizes absent optional fields to null', () => {
    const s = ShapeRecord({ reminderId: 'R-9', completedMs: NOW });
    expect(s).toMatchObject({ reminderId: 'R-9', summary: null, assigneeId: null, sourceChannelId: null, clientId: null, dueDate: null });
  });
});

describe('BuildCompletionsContent', () => {
  test('keeps only completions inside the window and sorts newest-first', () => {
    const { payload } = BuildCompletionsContent([
      Raw({ reminderId: 'R-old', completedMs: NOW - 200 * DAY_MS }),  // outside 90d
      Raw({ reminderId: 'R-new', completedMs: NOW - 1 * DAY_MS }),
      Raw({ reminderId: 'R-mid', completedMs: NOW - 30 * DAY_MS }),
      Raw({ reminderId: 'R-future', completedMs: NOW + DAY_MS }),     // after now → excluded
    ], NOW, 90, 'neochrome');

    expect(payload.completions.map(c => c.reminderId)).toEqual(['R-new', 'R-mid']);
    expect(payload.count).toBe(2);
    expect(payload.windowDays).toBe(90);
    expect(payload.workspaceName).toBe('neochrome');
  });

  test('stamps an hourly-rounded exportGeneratedAt heartbeat', () => {
    const { payload } = BuildCompletionsContent([], Date.UTC(2026, 6, 15, 12, 47, 33), 90, 'neochrome');
    expect(payload.exportGeneratedAt).toBe('2026-07-15T12:00:00.000Z');
  });

  test('is byte-idempotent within the hour for unchanged data', () => {
    const a = BuildCompletionsContent([Raw()], Date.UTC(2026, 6, 15, 12, 5, 0), 90, 'neochrome').content;
    const b = BuildCompletionsContent([Raw()], Date.UTC(2026, 6, 15, 12, 55, 0), 90, 'neochrome').content;
    expect(a).toBe(b);
  });

  test('defaults an invalid window to 90 days and emits a trailing newline', () => {
    const { payload, content } = BuildCompletionsContent([Raw()], NOW, 0, 'neochrome');
    expect(payload.windowDays).toBe(90);
    expect(content.endsWith('\n')).toBe(true);
    expect(JSON.parse(content).completions).toHaveLength(1);
  });

  test('does not throw on a non-array input', () => {
    expect(BuildCompletionsContent(null, NOW, 90, 'neochrome').payload.count).toBe(0);
  });
});
