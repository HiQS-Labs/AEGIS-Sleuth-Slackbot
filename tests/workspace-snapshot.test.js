'use strict';

const {
  BuildWorkspaceSnapshot,
  RenderSnapshotContextLines,
  TOP_CLIENT_LIMIT,
} = require('../src/workspace-snapshot');

describe('BuildWorkspaceSnapshot', () => {
  test('returns the empty shape and omits the clients line when there are no reminders', () => {
    const Snapshot = BuildWorkspaceSnapshot({
      activeReminders: [],
      resolveClientName: () => null,
    });

    expect(Snapshot).toEqual({
      openTotal: 0,
      topClientsByOpen: [],
    });
    expect(RenderSnapshotContextLines(Snapshot)).toEqual([
      'open_total: 0',
    ]);
  });

  test('counts only open reminders and buckets clients through the injected resolver', () => {
    const Snapshot = BuildWorkspaceSnapshot({
      activeReminders: [
        { State: 'scheduled', clientId: 'acme' },
        { State: 'posting', clientId: 'acme' },
        { State: 'failed', clientId: 'globex' },
        { State: 'completed', clientId: 'acme' },
        { State: 'canceled', clientId: 'globex' },
        { State: 'dead-letter', clientId: 'initech' },
      ],
      resolveClientName: (ArgClientId) => ({
        acme: 'Acme',
        globex: 'Globex',
      }[ArgClientId] ?? null),
    });

    expect(Snapshot).toEqual({
      openTotal: 3,
      topClientsByOpen: [
        { name: 'Acme', count: 2 },
        { name: 'Globex', count: 1 },
      ],
    });
    expect(RenderSnapshotContextLines(Snapshot)).toEqual([
      'open_total: 3',
      'top_clients_by_open: Acme (2), Globex (1)',
    ]);
  });

  test('omits unattributed and unmatched clients from the top list while preserving the total', () => {
    const Snapshot = BuildWorkspaceSnapshot({
      activeReminders: [
        { State: 'scheduled', clientId: null },
        { State: 'overdue', clientId: 'acme' },
        { State: 'snoozed', clientId: 'unknown' },
        { State: 'posted', clientId: '' },
      ],
      resolveClientName: (ArgClientId) => ({
        acme: 'Acme',
      }[ArgClientId] ?? null),
    });

    expect(Snapshot).toEqual({
      openTotal: 4,
      topClientsByOpen: [
        { name: 'Acme', count: 1 },
      ],
    });
  });

  test('caps the top list at five clients while keeping the full open total', () => {
    const Snapshot = BuildWorkspaceSnapshot({
      activeReminders: [
        { State: 'scheduled', clientId: 'g' },
        { State: 'scheduled', clientId: 'f' },
        { State: 'scheduled', clientId: 'e' },
        { State: 'scheduled', clientId: 'd' },
        { State: 'scheduled', clientId: 'c' },
        { State: 'scheduled', clientId: 'b' },
        { State: 'scheduled', clientId: 'a' },
      ],
      resolveClientName: (ArgClientId) => ({
        a: 'Alpha',
        b: 'Bravo',
        c: 'Charlie',
        d: 'Delta',
        e: 'Echo',
        f: 'Foxtrot',
        g: 'Golf',
      }[ArgClientId] ?? null),
    });

    expect(Snapshot.openTotal).toBe(7);
    expect(Snapshot.topClientsByOpen).toHaveLength(TOP_CLIENT_LIMIT);
    expect(Snapshot.topClientsByOpen).toEqual([
      { name: 'Alpha', count: 1 },
      { name: 'Bravo', count: 1 },
      { name: 'Charlie', count: 1 },
      { name: 'Delta', count: 1 },
      { name: 'Echo', count: 1 },
    ]);
  });

  test('breaks count ties deterministically by client name', () => {
    const Snapshot = BuildWorkspaceSnapshot({
      activeReminders: [
        { State: 'scheduled', clientId: 'globex' },
        { State: 'scheduled', clientId: 'acme' },
        { State: 'scheduled', clientId: 'globex' },
        { State: 'scheduled', clientId: 'acme' },
      ],
      resolveClientName: (ArgClientId) => ({
        acme: 'Acme',
        globex: 'Globex',
      }[ArgClientId] ?? null),
    });

    expect(Snapshot.topClientsByOpen).toEqual([
      { name: 'Acme', count: 2 },
      { name: 'Globex', count: 2 },
    ]);
  });
});
