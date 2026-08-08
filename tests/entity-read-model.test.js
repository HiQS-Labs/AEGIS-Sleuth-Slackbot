'use strict';

const { BuildEntityReadModel, ENTITY_CLUSTER_CONFIDENCE_THRESHOLD } = require('../src/entity-read-model');

/**
 * @param {object} ArgOverrides
 * @returns {object}
 */
function MakeEdge(ArgOverrides = {}) {
  return {
    edgeType: 'task_to_project',
    from: { type: 'task', id: 'task-1', name: 'WP DB Toolkit' },
    to: { type: 'project', id: 'project-wp-db', name: 'wp-db-toolkit' },
    confidence: 0.91,
    provenance: {
      sourceEventIds: ['evt-task-1'],
      signals: [{ signal: 'normalized_text_match', weight: 0.30 }],
    },
    ...ArgOverrides,
  };
}

describe('BuildEntityReadModel', () => {
  test('does not false-merge clients that share only a weak word match', () => {
    const ReadModel = BuildEntityReadModel([
      MakeEdge({
        from: { type: 'client', id: 'client-acme-corp', name: 'Acme Corp' },
        to: { type: 'client', id: 'client-acme-industries', name: 'Acme Industries' },
        confidence: ENTITY_CLUSTER_CONFIDENCE_THRESHOLD - 0.01,
      }),
    ]);

    expect(ReadModel.clusters).toHaveLength(2);
    expect(ReadModel.clusters.map(ArgCluster => ArgCluster.members).sort((ArgLeft, ArgRight) => ArgLeft[0].id.localeCompare(ArgRight[0].id))).toEqual([
      [{ type: 'client', id: 'client-acme-corp' }],
      [{ type: 'client', id: 'client-acme-industries' }],
    ]);
    expect(ReadModel.clusters.every(ArgCluster => ArgCluster.provenance.edges.length === 0)).toBe(true);
  });

  test('collapses equivalent project surface forms and retains edge and event provenance', () => {
    const ReadModel = BuildEntityReadModel([MakeEdge()]);
    const [Cluster] = ReadModel.clusters;

    expect(ReadModel.clusters).toHaveLength(1);
    expect(Cluster.members).toEqual([
      { type: 'project', id: 'project-wp-db' },
      { type: 'task', id: 'task-1' },
    ]);
    expect(Cluster.aliases).toEqual(expect.arrayContaining([
      expect.objectContaining({ surfaceForm: 'WP DB Toolkit', normalizedSurfaceForm: 'wp db toolkit', confidence: 0.91 }),
      expect.objectContaining({ surfaceForm: 'wp-db-toolkit', normalizedSurfaceForm: 'wp db toolkit', confidence: 0.91 }),
    ]));
    expect(Cluster.provenance).toEqual({ edges: [expect.objectContaining({ confidence: 0.91 })], eventIds: ['evt-task-1'] });
    expect(ReadModel.aliasTable).toEqual(expect.arrayContaining([
      expect.objectContaining({ canonicalId: Cluster.canonicalId, confidence: 0.91 }),
    ]));
  });

  test('is independent of scored-edge input order, including canonical ids and provenance ordering', () => {
    const FirstEdge = MakeEdge({
      from: { type: 'task', id: 'task-a', name: 'Alpha' },
      to: { type: 'project', id: 'project-a', name: 'Alpha Project' },
      provenance: { sourceEventIds: ['evt-b', 'evt-a'], signals: [{ signal: 'repo_match', weight: 0.32 }] },
    });
    const SecondEdge = MakeEdge({
      edgeType: 'project_to_client',
      from: { type: 'project', id: 'project-a', name: 'Alpha Project' },
      to: { type: 'client', id: 'client-a', name: 'Alpha Client' },
      provenance: { sourceEventIds: ['evt-c'], signals: [{ signal: 'channel_match', weight: 0.22 }] },
    });

    const First = BuildEntityReadModel([FirstEdge, SecondEdge]);
    const Second = BuildEntityReadModel([SecondEdge, FirstEdge]);

    expect(Second).toEqual(First);
    expect(Second.clusters[0].canonicalId).toBe(First.clusters[0].canonicalId);
  });

  test('returns an empty model for empty input', () => {
    expect(BuildEntityReadModel([])).toEqual({
      threshold: ENTITY_CLUSTER_CONFIDENCE_THRESHOLD,
      clusters: [],
      aliasTable: [],
    });
  });

  test('keeps an explicit standalone item as a single-item cluster', () => {
    const ReadModel = BuildEntityReadModel([], [{
      type: 'client',
      id: 'client-solo',
      name: 'Solo Client',
      aliases: ['solo'],
    }]);

    expect(ReadModel.clusters).toHaveLength(1);
    expect(ReadModel.clusters[0]).toEqual(expect.objectContaining({
      members: [{ type: 'client', id: 'client-solo' }],
      provenance: { edges: [], eventIds: [] },
      aliases: expect.arrayContaining([
        expect.objectContaining({ surfaceForm: 'Solo Client', confidence: null }),
        expect.objectContaining({ surfaceForm: 'solo', confidence: null }),
      ]),
    }));
  });
});
