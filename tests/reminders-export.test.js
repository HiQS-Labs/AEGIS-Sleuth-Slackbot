'use strict';

const { BuildExportContent } = require('../deploy/reminders-export/export-payload.js');

// A representative `data` object (the API's rebalance payload).
function MakeData(overrides = {}) {
  return {
    workspaceName: 'neochrome',
    fetchedAt: '2026-06-05T14:33:21.123Z', // volatile — must be stripped
    totalReminderCount: 1,
    returnedReminderCount: 1,
    filters: { activeOnly: true, states: [] },
    source: { type: 'sleuth-reminders-file', relativePath: 'x.json' },
    reminders: [{ reminderId: 'R-1', state: 'scheduled', isActive: true }],
    ...overrides,
  };
}

describe('BuildExportContent', () => {
  test('strips the volatile fetchedAt', () => {
    const { payload } = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 33, 0));
    expect('fetchedAt' in payload).toBe(false);
  });

  test('stamps an hourly-rounded exportGeneratedAt heartbeat', () => {
    const { payload } = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 33, 21, 500));
    expect(payload.exportGeneratedAt).toBe('2026-06-05T14:00:00.000Z');
  });

  test('is idempotent within the same hour for unchanged data (no commit)', () => {
    const a = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 5, 0)).content;
    const b = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 55, 59)).content;
    expect(a).toBe(b); // byte-identical → publisher skips the commit
  });

  test('content changes across the hour boundary (heartbeat advances)', () => {
    const a = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 5, 0)).content;
    const b = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 15, 5, 0)).content;
    expect(a).not.toBe(b);
  });

  test('content changes when reminder data changes (within the same hour)', () => {
    const a = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 5, 0)).content;
    const b = BuildExportContent(
      MakeData({ reminders: [{ reminderId: 'R-1' }, { reminderId: 'R-2' }] }),
      Date.UTC(2026, 5, 5, 14, 5, 0)
    ).content;
    expect(a).not.toBe(b);
  });

  test('does not mutate the input', () => {
    const input = MakeData();
    BuildExportContent(input, 0);
    expect(input.fetchedAt).toBe('2026-06-05T14:33:21.123Z');
    expect('exportGeneratedAt' in input).toBe(false);
  });

  test('emits valid pretty JSON preserving reminders, trailing newline', () => {
    const { content } = BuildExportContent(MakeData(), 0);
    expect(content.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(content);
    expect(parsed.reminders).toHaveLength(1);
    expect(parsed.workspaceName).toBe('neochrome');
  });

  test('always emits a memories key — empty array when none provided', () => {
    const { payload } = BuildExportContent(MakeData(), 0);
    expect(Array.isArray(payload.memories)).toBe(true);
    expect(payload.memories).toHaveLength(0);
  });

  test('includes provided memories in the payload', () => {
    const Mem = {
      memoryId: 'uuid-1',
      channelId: 'C1',
      channelName: 'payments-team',
      capturedAt: '2026-06-05T14:00:00.000Z',
      capturedBy: 'U1',
      participantIds: ['U1', 'U2'],
      messageCount: 3,
      preview: 'let\'s fix checkout',
      githubRefs: ['https://github.com/o/r/pull/47'],
      threadUrl: 'https://neochrome.slack.com/archives/C1/p100000000000',
    };
    const { payload } = BuildExportContent(MakeData(), 0, [Mem]);
    expect(payload.memories).toHaveLength(1);
    expect(payload.memories[0]).toEqual(Mem);
  });

  test('content changes when memories change (within the same hour)', () => {
    const Mem = { memoryId: 'x', channelId: 'C1', channelName: '', capturedAt: '2026-06-05T10:00:00.000Z',
      capturedBy: 'U1', participantIds: [], messageCount: 1, preview: 'hi', githubRefs: [], threadUrl: '' };
    const a = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 5, 0), []).content;
    const b = BuildExportContent(MakeData(), Date.UTC(2026, 5, 5, 14, 5, 0), [Mem]).content;
    expect(a).not.toBe(b);
  });
});
