'use strict';

const {
  FilterCandidates,
  ResolveTimeWindow,
  StartOfZonedDayMs,
} = require('../src/reminder-query-engine');

const TZ = 'America/Los_Angeles';

/** @returns {import('../src/reminder-query-engine').ReminderCandidate} */
function MakeCandidate(ArgOverrides) {
  return {
    id: ArgOverrides.id || 'r1',
    text: ArgOverrides.text ?? 'task',
    assigneeId: ArgOverrides.assigneeId ?? null,
    senderId: ArgOverrides.senderId ?? null,
    clientId: ArgOverrides.clientId ?? null,
    channelId: ArgOverrides.channelId ?? 'C_PUB',
    channelIsPrivate: ArgOverrides.channelIsPrivate ?? false,
    timestampMs: ArgOverrides.timestampMs ?? 0,
    state: ArgOverrides.state ?? 'scheduled',
    isCompleted: ArgOverrides.isCompleted ?? false,
  };
}

describe('FilterCandidates — channel privacy scope (v1 MUST)', () => {
  test('private-channel candidates are excluded from a public-only query', () => {
    const Candidates = [
      MakeCandidate({ id: 'pub', channelIsPrivate: false }),
      MakeCandidate({ id: 'priv', channelId: 'C_PRIV', channelIsPrivate: true }),
    ];
    const Result = FilterCandidates(Candidates, { channelScope: { allowedChannelIds: [] } });
    expect(Result.matched.map(ArgC => ArgC.id)).toEqual(['pub']);
  });

  test('a private channel is included when explicitly allowed (e.g. the query channel)', () => {
    const Candidates = [
      MakeCandidate({ id: 'priv-here', channelId: 'C_HERE', channelIsPrivate: true }),
      MakeCandidate({ id: 'priv-other', channelId: 'C_OTHER', channelIsPrivate: true }),
    ];
    const Result = FilterCandidates(Candidates, { channelScope: { allowedChannelIds: ['C_HERE'] } });
    expect(Result.matched.map(ArgC => ArgC.id)).toEqual(['priv-here']);
  });
});

describe('FilterCandidates — time / user / client / keyword', () => {
  const Base = { channelScope: { allowedChannelIds: [] } };

  test('time window is half-open [start, end)', () => {
    const Candidates = [
      MakeCandidate({ id: 'before', timestampMs: 100 }),
      MakeCandidate({ id: 'start', timestampMs: 200 }),
      MakeCandidate({ id: 'inside', timestampMs: 250 }),
      MakeCandidate({ id: 'end', timestampMs: 300 }),
    ];
    const Result = FilterCandidates(Candidates, { ...Base, timeWindow: { startMs: 200, endMs: 300 } });
    expect(Result.matched.map(ArgC => ArgC.id)).toEqual(['start', 'inside']);
  });

  test('GH-393: a completed candidate with a NaN timestamp is excluded from the time window, not falsely included', () => {
    const Candidates = [
      MakeCandidate({ id: 'valid', isCompleted: true, timestampMs: 250 }),
      MakeCandidate({ id: 'nan-timestamp', isCompleted: true, timestampMs: NaN }),
    ];
    const Result = FilterCandidates(Candidates, { ...Base, timeWindow: { startMs: 200, endMs: 300 } });
    expect(Result.matched.map(ArgC => ArgC.id)).toEqual(['valid']);
  });

  test('user filter matches the assignee', () => {
    const Candidates = [
      MakeCandidate({ id: 'a', assigneeId: 'U_MIKE', senderId: 'U_ELAN' }),
      MakeCandidate({ id: 'b', assigneeId: 'U_JANE', senderId: 'U_MIKE' }),
    ];
    expect(FilterCandidates(Candidates, { ...Base, userIds: ['U_MIKE'] })
      .matched.map(ArgC => ArgC.id)).toEqual(['a']);
  });

  test('user filter matches the sender/creator (assignor) — #380', () => {
    const Candidates = [
      MakeCandidate({ id: 'a', assigneeId: 'U_MIKE', senderId: 'U_ELAN' }),
      MakeCandidate({ id: 'b', assigneeId: 'U_JANE', senderId: 'U_MIKE' }),
    ];
    // senderIds filters by creator, independent of assignee — 'b' was created by U_MIKE.
    expect(FilterCandidates(Candidates, { ...Base, senderIds: ['U_MIKE'] })
      .matched.map(ArgC => ArgC.id)).toEqual(['b']);
  });

  test('assignee and sender filters are AND-combined', () => {
    const Candidates = [
      MakeCandidate({ id: 'both', assigneeId: 'U_MIKE', senderId: 'U_NOEL' }),
      MakeCandidate({ id: 'assignee-only', assigneeId: 'U_MIKE', senderId: 'U_OTHER' }),
      MakeCandidate({ id: 'sender-only', assigneeId: 'U_X', senderId: 'U_NOEL' }),
    ];
    expect(FilterCandidates(Candidates, { ...Base, userIds: ['U_MIKE'], senderIds: ['U_NOEL'] })
      .matched.map(ArgC => ArgC.id)).toEqual(['both']);
  });

  test('client filter', () => {
    const Candidates = [
      MakeCandidate({ id: 'client-a', clientId: 'client-a' }),
      MakeCandidate({ id: 'acme', clientId: 'acme' }),
      MakeCandidate({ id: 'none', clientId: null }),
    ];
    expect(FilterCandidates(Candidates, { ...Base, clientId: 'client-a' })
      .matched.map(ArgC => ArgC.id)).toEqual(['client-a']);
  });

  test('keyword filter requires ALL keywords (case-insensitive)', () => {
    const Candidates = [
      MakeCandidate({ id: 'match', text: 'Ship the Client A plugin upgrades to prod' }),
      MakeCandidate({ id: 'partial', text: 'Client A plugin QA' }),
      MakeCandidate({ id: 'none', text: 'unrelated task' }),
    ];
    const Result = FilterCandidates(Candidates, { ...Base, keywords: ['plugin', 'upgrades'] });
    expect(Result.matched.map(ArgC => ArgC.id)).toEqual(['match']);
  });

  test('motivating query: user + client + time + topic combined', () => {
    const InWindow = 1_000_000;
    const Candidates = [
      MakeCandidate({ id: 'target', assigneeId: 'U_MIKE', clientId: 'client-a', timestampMs: InWindow, text: 'Client A plugin upgrades round 2' }),
      MakeCandidate({ id: 'wrong-user', assigneeId: 'U_JANE', clientId: 'client-a', timestampMs: InWindow, text: 'Client A plugin upgrades' }),
      MakeCandidate({ id: 'wrong-topic', assigneeId: 'U_MIKE', clientId: 'client-a', timestampMs: InWindow, text: 'Client A billing call' }),
      MakeCandidate({ id: 'out-of-window', assigneeId: 'U_MIKE', clientId: 'client-a', timestampMs: 5, text: 'Client A plugin upgrades' }),
    ];
    const Result = FilterCandidates(Candidates, {
      ...Base,
      userIds: ['U_MIKE'],
      clientId: 'client-a',
      timeWindow: { startMs: 999_999, endMs: 1_000_001 },
      keywords: ['plugin', 'upgrades'],
    });
    expect(Result.matched.map(ArgC => ArgC.id)).toEqual(['target']);
  });

  test('empty result reports matchedCount 0 (caller short-circuits, no LLM)', () => {
    const Candidates = [MakeCandidate({ id: 'x', clientId: 'acme' })];
    const Result = FilterCandidates(Candidates, { ...Base, clientId: 'client-a' });
    expect(Result.matchedCount).toBe(0);
    expect(Result.total).toBe(1);
  });
});

describe('ResolveTimeWindow (workspace timezone)', () => {
  // Wed 2026-07-15 12:00 PT = 19:00Z. Monday of that week = 2026-07-13.
  const NowMs = Date.parse('2026-07-15T19:00:00Z');

  test('"last week" is the previous Mon..Mon window in PT', () => {
    const W = ResolveTimeWindow('what did Mike do last week', NowMs, TZ);
    expect(W.label).toBe('last week');
    expect(W.startMs).toBe(Date.parse('2026-07-06T07:00:00Z')); // Mon 2026-07-06 00:00 PT
    expect(W.endMs).toBe(Date.parse('2026-07-13T07:00:00Z'));   // Mon 2026-07-13 00:00 PT
  });

  test('"today" starts at PT midnight', () => {
    const W = ResolveTimeWindow('anything today?', NowMs, TZ);
    expect(W.startMs).toBe(Date.parse('2026-07-15T07:00:00Z'));
    expect(W.endMs).toBe(Date.parse('2026-07-16T07:00:00Z'));
  });

  test('"yesterday" is the prior PT day', () => {
    const W = ResolveTimeWindow('yesterday', NowMs, TZ);
    expect(W.startMs).toBe(Date.parse('2026-07-14T07:00:00Z'));
    expect(W.endMs).toBe(Date.parse('2026-07-15T07:00:00Z'));
  });

  test('"last 7 days" is a rolling window ending now', () => {
    const W = ResolveTimeWindow('past 7 days', NowMs, TZ);
    expect(W.endMs).toBe(NowMs);
    expect(W.startMs).toBe(NowMs - 7 * 24 * 60 * 60 * 1000);
  });

  test('unrecognized phrase returns null (caller falls back to all-time)', () => {
    expect(ResolveTimeWindow('sometime around the launch', NowMs, TZ)).toBeNull();
  });

  test('StartOfZonedDayMs lands on PT midnight', () => {
    expect(StartOfZonedDayMs(NowMs, TZ)).toBe(Date.parse('2026-07-15T07:00:00Z'));
  });
});
