'use strict';

const fs = require('node:fs');
const {
  BuildEntityLinkingDiagnostics,
  RunCLI,
} = require('../scripts/entity-linking-diagnostics');

/** @param {object} ArgOverrides @returns {object} */
function MakeEvent(ArgOverrides = {}) {
  return {
    id: 'event-1',
    type: 'ReminderCreated',
    workspace: 'workspace-a',
    reminderId: 'task-1',
    ts: '2026-08-01T12:00:00.000Z',
    payload: {
      text: 'Acme payments follow-up',
      sourceChannelId: 'C_ACME',
      githubUrls: ['https://github.com/acme/payments/issues/1'],
    },
    ...ArgOverrides,
  };
}

/** @param {object} ArgOverrides @returns {object} */
function MakeClient(ArgOverrides = {}) {
  return {
    ClientID: 'client-acme',
    ClientName: 'Acme',
    Aliases: ['acme'],
    ChannelIDs: ['C_ACME'],
    GitHubRepoPatterns: ['acme/payments'],
    ...ArgOverrides,
  };
}

describe('entity-linking diagnostics', () => {
  test('reports a clean shadow diff when derived and mapping associations agree', () => {
    const Report = BuildEntityLinkingDiagnostics([MakeEvent()], { clients: [MakeClient()] });

    expect(Report.shadowDiff).toEqual({
      agreements: [{ taskId: 'task-1', clientIds: ['client-acme'] }],
      disagreements: [],
      gaps: [],
    });
    expect(Report.highConfidenceDisagreements).toEqual([]);
  });

  test('surfaces a known disagreement and orders near-threshold candidates in the review queue', () => {
    const Report = BuildEntityLinkingDiagnostics([MakeEvent()], {
      clients: [
        MakeClient({ ClientID: 'client-overlay', Aliases: ['other'], GitHubRepoPatterns: ['acme/payments'] }),
        MakeClient({ ClientID: 'client-derived', Aliases: ['acme'] }),
      ],
    });

    expect(Report.shadowDiff.disagreements).toEqual([{
      taskId: 'task-1',
      derivedClientIds: ['client-derived'],
      overlayClientIds: ['client-overlay'],
    }]);
    expect(Report.highConfidenceDisagreements).toEqual(Report.shadowDiff.disagreements);
    expect(Report.lowConfidenceQueue).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: { type: 'client', id: 'client-overlay' }, confidence: 0.4696 }),
    ]));
  });

  test('an override can force a merge without mutating the historical event input', () => {
    const Events = [MakeEvent({ payload: { text: 'unrelated', sourceChannelId: null, githubUrls: [] } })];
    const Before = JSON.stringify(Events);
    const Report = BuildEntityLinkingDiagnostics(Events, {
      clients: [MakeClient()],
      overrides: { merges: [{ from: { type: 'task', id: 'task-1' }, to: { type: 'client', id: 'client-acme' } }] },
      taskId: 'task-1',
    });

    expect(Report.derivedAssociations).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: { type: 'task', id: 'task-1' }, to: { type: 'client', id: 'client-acme' }, override: 'merge' }),
    ]));
    expect(Report.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ override: 'merge', signals: [{ signal: 'human_override_merge', weight: 1 }] }),
    ]));
    expect(JSON.stringify(Events)).toBe(Before);
  });

  test('an override can force a split over otherwise high-confidence derived evidence', () => {
    const Report = BuildEntityLinkingDiagnostics([MakeEvent()], {
      clients: [MakeClient()],
      overrides: { splits: [{ from: { type: 'task', id: 'task-1' }, to: { type: 'client', id: 'client-acme' } }] },
    });

    expect(Report.derivedAssociations).toEqual([]);
    expect(Report.shadowDiff.gaps).toEqual([{
      taskId: 'task-1',
      kind: 'overlay_only',
      derivedClientIds: [],
      overlayClientIds: ['client-acme'],
    }]);
  });

  test('returns a stable empty report for an empty event log', () => {
    expect(BuildEntityLinkingDiagnostics([], { clients: [MakeClient()] })).toEqual(expect.objectContaining({
      taskCount: 0,
      candidateCount: 0,
      derivedAssociations: [],
      overlayAssociations: [],
      shadowDiff: { agreements: [], disagreements: [], gaps: [] },
      lowConfidenceQueue: [],
    }));
  });

  test('CLI input replay performs no filesystem writes', () => {
    const Writes = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync']
      .map(ArgMethod => jest.spyOn(fs, ArgMethod));
    const InputByPath = {
      events: `${JSON.stringify(MakeEvent())}\n`,
      clients: JSON.stringify({ clients: [MakeClient()] }),
    };
    const Output = [];

    try {
      RunCLI(['--events-file', 'events', '--clients-file', 'clients'], {
        readFileSync: ArgPath => InputByPath[ArgPath],
        write: ArgText => Output.push(ArgText),
      });
      expect(Output).toHaveLength(1);
      expect(Writes.every(ArgSpy => ArgSpy.mock.calls.length === 0)).toBe(true);
    } finally {
      Writes.forEach(ArgSpy => ArgSpy.mockRestore());
    }
  });
});
