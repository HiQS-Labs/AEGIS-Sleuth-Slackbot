'use strict';

const { GenerateScoredCandidateEdges, SIGNAL_WEIGHTS } = require('../src/entity-linking');

/** @param {object} ArgOverrides @returns {object} */
function MakeTask(ArgOverrides = {}) {
  return {
    reminderId: 'task-1',
    normalizedText: 'implement payments checkout',
    assigneeIds: [],
    originalSenderId: null,
    sourceChannelId: null,
    targetChannelId: null,
    createdAt: null,
    githubRepositoryIds: [],
    githubUrls: [],
    sourceEventId: 'evt-task-1',
    ...ArgOverrides,
  };
}

/** @param {object} ArgOverrides @returns {object} */
function MakeProject(ArgOverrides = {}) {
  return {
    projectId: 'project-payments',
    projectName: 'payments checkout',
    aliases: [],
    channelIds: [],
    githubRepositoryIds: [],
    participantIds: [],
    createdAt: null,
    sourceEventIds: ['evt-project-payments'],
    ...ArgOverrides,
  };
}

/** @param {object} ArgOverrides @returns {object} */
function MakeClient(ArgOverrides = {}) {
  return {
    ClientID: 'client-acme',
    ClientName: 'Acme',
    Aliases: [],
    ChannelIDs: [],
    GitHubRepoPatterns: [],
    ...ArgOverrides,
  };
}

/** @param {any[]} ArgEdges @param {string} ArgType @param {string} ArgTo @returns {any} */
function FindEdge(ArgEdges, ArgType, ArgTo) {
  return ArgEdges.find(ArgEdge => ArgEdge.edgeType === ArgType && ArgEdge.to.id === ArgTo);
}

describe('GenerateScoredCandidateEdges', () => {
  test.each([
    ['normalized text', MakeTask(), MakeProject(), 'normalized_text_match'],
    ['repo', MakeTask({ normalizedText: 'implement it', githubRepositoryIds: ['acme/payments'] }), MakeProject({ projectName: 'other', githubRepositoryIds: ['acme/payments'] }), 'repo_match'],
    ['channel', MakeTask({ normalizedText: 'implement it', sourceChannelId: 'C_PAYMENTS' }), MakeProject({ projectName: 'other', channelIds: ['C_PAYMENTS'] }), 'channel_match'],
    ['participant', MakeTask({ normalizedText: 'implement it', assigneeIds: ['U_ALICE'] }), MakeProject({ projectName: 'other', participantIds: ['U_ALICE'] }), 'participant_overlap'],
    ['time-local co-occurrence', MakeTask({ normalizedText: 'implement it', createdAt: '2026-08-01T09:00:00Z' }), MakeProject({ projectName: 'other', createdAt: '2026-08-01T22:00:00Z' }), 'historical_cooccurrence'],
    ['prior accepted alias', MakeTask({ normalizedText: 'repair legacy billing' }), MakeProject({ projectName: 'other', acceptedAliases: ['legacy billing'] }), 'prior_accepted_alias'],
  ])('scores the %s signal in isolation', (_ArgName, ArgTask, ArgProject, ArgSignal) => {
    const Edge = FindEdge(GenerateScoredCandidateEdges([ArgTask], [ArgProject], []), 'task_to_project', 'project-payments');
    expect(Edge).toEqual(expect.objectContaining({
      confidence: SIGNAL_WEIGHTS[ArgSignal],
      provenance: {
        sourceEventIds: ['evt-task-1'],
        signals: [{ signal: ArgSignal, weight: SIGNAL_WEIGHTS[ArgSignal] }],
      },
    }));
  });

  test('uses client-mapping aliases, channels, and repo patterns without a parallel mapping format', () => {
    const Task = MakeTask({ normalizedText: 'acme follow-up', sourceChannelId: 'C_ACME', githubUrls: ['https://github.com/acme/payments/issues/4'] });
    const Edge = FindEdge(GenerateScoredCandidateEdges([Task], [], [MakeClient({ Aliases: ['acme'], ChannelIDs: ['C_ACME'], GitHubRepoPatterns: ['payments'] })]), 'task_to_client', 'client-acme');

    expect(Edge.provenance.signals.map(ArgSignal => ArgSignal.signal)).toEqual([
      'normalized_text_match', 'repo_match', 'channel_match',
    ]);
    expect(Edge.confidence).toBe(0.62872);
  });

  test('raises confidence when several signals agree and preserves each contribution', () => {
    const Task = MakeTask({ sourceChannelId: 'C_PAYMENTS', githubRepositoryIds: ['acme/payments'], assigneeIds: ['U_ALICE'] });
    const Project = MakeProject({ channelIds: ['C_PAYMENTS'], githubRepositoryIds: ['acme/payments'], participantIds: ['U_ALICE'] });
    const Edge = FindEdge(GenerateScoredCandidateEdges([Task], [Project], []), 'task_to_project', 'project-payments');

    expect(Edge.provenance.signals.map(ArgSignal => ArgSignal.signal)).toEqual([
      'normalized_text_match', 'repo_match', 'channel_match', 'participant_overlap',
    ]);
    expect(Edge.confidence).toBe(0.680699);
  });

  test('keeps disagreeing candidate evidence separate instead of treating it as one fuzzy match', () => {
    const Task = MakeTask({ normalizedText: 'acme launch', sourceChannelId: 'C_BRAVO', githubRepositoryIds: ['bravo/app'] });
    const Edges = GenerateScoredCandidateEdges([Task], [], [
      MakeClient({ ClientID: 'client-acme', ClientName: 'Acme' }),
      MakeClient({ ClientID: 'client-bravo', ClientName: 'Bravo', ChannelIDs: ['C_BRAVO'], GitHubRepoPatterns: ['app'] }),
    ]);

    expect(FindEdge(Edges, 'task_to_client', 'client-acme')).toEqual(expect.objectContaining({
      confidence: SIGNAL_WEIGHTS.normalized_text_match,
    }));
    expect(FindEdge(Edges, 'task_to_client', 'client-bravo')).toEqual(expect.objectContaining({
      confidence: 0.4696,
      provenance: expect.objectContaining({ signals: [
        { signal: 'repo_match', weight: SIGNAL_WEIGHTS.repo_match },
        { signal: 'channel_match', weight: SIGNAL_WEIGHTS.channel_match },
      ] }),
    }));
  });

  test('emits project-to-client evidence using the project source event', () => {
    const Project = MakeProject({ projectName: 'acme payments', sourceEventIds: ['evt-project-a'] });
    const Edge = FindEdge(GenerateScoredCandidateEdges([], [Project], [MakeClient({ ClientName: 'Acme' })]), 'project_to_client', 'client-acme');

    expect(Edge).toEqual(expect.objectContaining({
      from: { type: 'project', id: 'project-payments' },
      confidence: SIGNAL_WEIGHTS.normalized_text_match,
      provenance: expect.objectContaining({ sourceEventIds: ['evt-project-a'] }),
    }));
  });

  test('returns no candidates when no cheap signal blocks a pair', () => {
    const Edges = GenerateScoredCandidateEdges(
      [MakeTask({ normalizedText: 'unrelated task' })],
      [MakeProject({ projectName: 'different initiative' })],
      [MakeClient({ ClientName: 'Other Client' })],
    );
    expect(Edges).toEqual([]);
  });

  test('blocking prunes a 20 by 20 fixture to at most its 20 exact matches', () => {
    const Tasks = Array.from({ length: 20 }, (_ArgUnused, ArgIndex) => MakeTask({
      reminderId: `task-${ArgIndex}`,
      normalizedText: `initiative ${ArgIndex}`,
      sourceEventId: `evt-task-${ArgIndex}`,
    }));
    const Projects = Array.from({ length: 20 }, (_ArgUnused, ArgIndex) => MakeProject({
      projectId: `project-${ArgIndex}`,
      projectName: `initiative ${ArgIndex}`,
      sourceEventIds: [`evt-project-${ArgIndex}`],
    }));
    const Edges = GenerateScoredCandidateEdges(Tasks, Projects, []);

    expect(Edges.filter(ArgEdge => ArgEdge.edgeType === 'task_to_project')).toHaveLength(20);
    expect(Edges.length).toBeLessThanOrEqual(20); // 20 candidates, not the 20 × 20 = 400 cartesian pairs.
  });

  test('is byte-identical across runs and canonicalizes output ordering', () => {
    const Tasks = [MakeTask({ reminderId: 'task-b', sourceEventId: 'evt-b' }), MakeTask({ reminderId: 'task-a', sourceEventId: 'evt-a' })];
    const Projects = [MakeProject({ projectId: 'project-b', projectName: 'payments checkout', sourceEventIds: ['evt-pb'] }), MakeProject({ projectId: 'project-a', projectName: 'payments checkout', sourceEventIds: ['evt-pa'] })];
    const First = JSON.stringify(GenerateScoredCandidateEdges(Tasks, Projects, []));
    const Second = JSON.stringify(GenerateScoredCandidateEdges(Tasks, Projects, []));

    expect(First).toBe(Second);
    expect(JSON.parse(First).map(ArgEdge => `${ArgEdge.from.id}/${ArgEdge.to.id}`)).toEqual([
      'task-a/project-a', 'task-a/project-b', 'task-b/project-a', 'task-b/project-b',
    ]);
  });
});
