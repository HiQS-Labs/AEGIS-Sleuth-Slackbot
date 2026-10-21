
'use strict';

const {
  PlanRepoActions,
  NextCursor,
  PruneState,
  EmptyState,
  EscapeMrkdwn,
} = require('../src/github-issue-stream-planner');

/**
 * @param {Partial<import('../src/github-issue-stream-planner').IssueStreamState>} [ArgOverrides]
 */
function MakeState(ArgOverrides = {}) {
  return {
    ...EmptyState(),
    Repos: {
      'hiqs-labs/demo': { Cursor: '2026-10-20T10:00:00.000Z', SeededAt: '2026-10-20T10:00:00.000Z' },
    },
    ...ArgOverrides,
  };
}

describe('EscapeMrkdwn', () => {
  test('escapes ampersand angle brackets', () => {
    expect(EscapeMrkdwn('a & b <c>')).toBe('a &amp; b &lt;c&gt;');
  });
});

describe('PlanRepoActions', () => {
  test('posts a new issue created after SeededAt exactly once as a parent', () => {
    const State = MakeState();
    const Actions = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [{
        number: 1,
        title: 'Ship it',
        state: 'open',
        html_url: 'https://github.com/hiqs-labs/demo/issues/1',
        created_at: '2026-10-20T11:00:00.000Z',
        updated_at: '2026-10-20T11:00:00.000Z',
        user: { login: 'alice', type: 'User' },
      }],
      []
    );
    expect(Actions).toHaveLength(1);
    expect(Actions[0].Kind).toBe('parent');
    expect(Actions[0].IssueKey).toBe('hiqs-labs/demo#1');
    expect(Actions[0].EventKey).toBe('parent:hiqs-labs/demo#1');
    expect(Actions[0].Text).toContain(':new:');
    expect(Actions[0].Text).toContain('`alice`');
  });

  test('skips issues created before SeededAt', () => {
    const State = MakeState();
    const Actions = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [{
        number: 1,
        title: 'Old',
        state: 'open',
        html_url: 'https://github.com/hiqs-labs/demo/issues/1',
        created_at: '2026-10-19T09:00:00.000Z',
        updated_at: '2026-10-20T11:00:00.000Z',
        user: { login: 'alice', type: 'User' },
      }],
      []
    );
    expect(Actions).toEqual([]);
  });

  test('threads comments and skips duplicate comment ids', () => {
    const State = MakeState({
      Issues: {
        'hiqs-labs/demo#1': {
          ChannelID: 'C1',
          ThreadTs: '1.0',
          PostedKeys: ['comment:99'],
          Closed: false,
          LastActivityAt: '2026-10-20T11:00:00.000Z',
        },
      },
    });
    const Actions = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [],
      [
        {
          id: 99,
          body: 'already posted',
          html_url: 'https://github.com/hiqs-labs/demo/issues/1#issuecomment-99',
          created_at: '2026-10-20T11:30:00.000Z',
          updated_at: '2026-10-20T11:30:00.000Z',
          issue_url: 'https://api.github.com/repos/hiqs-labs/demo/issues/1',
          user: { login: 'bob', type: 'User' },
        },
        {
          id: 100,
          body: 'fresh comment',
          html_url: 'https://github.com/hiqs-labs/demo/issues/1#issuecomment-100',
          created_at: '2026-10-20T11:31:00.000Z',
          updated_at: '2026-10-20T11:31:00.000Z',
          issue_url: 'https://api.github.com/repos/hiqs-labs/demo/issues/1',
          user: { login: 'bob', type: 'User' },
        },
      ]
    );
    expect(Actions).toHaveLength(1);
    expect(Actions[0].EventKey).toBe('comment:100');
    expect(Actions[0].Text).toContain(':speech_balloon:');
    expect(Actions[0].Text).toContain('fresh comment');
  });

  test('posts PR opened and merged into the referenced issue thread', () => {
    const State = MakeState({
      Issues: {
        'hiqs-labs/demo#12': {
          ChannelID: 'C1',
          ThreadTs: '1.0',
          PostedKeys: [],
          Closed: false,
          LastActivityAt: '2026-10-20T11:00:00.000Z',
        },
      },
    });
    const Actions = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [{
        number: 45,
        title: 'Fix widget',
        body: 'Closes #12',
        state: 'closed',
        html_url: 'https://github.com/hiqs-labs/demo/pull/45',
        created_at: '2026-10-20T12:00:00.000Z',
        updated_at: '2026-10-20T13:00:00.000Z',
        user: { login: 'carol', type: 'User' },
        pull_request: { merged_at: '2026-10-20T13:00:00.000Z' },
      }],
      []
    );
    expect(Actions.map((ArgA) => ArgA.EventKey)).toEqual([
      'pr-open:hiqs-labs/demo#45',
      'pr-merged:hiqs-labs/demo#45',
    ]);
    expect(Actions.every((ArgA) => ArgA.IssueKey === 'hiqs-labs/demo#12')).toBe(true);
  });

  test('cross-repo owner/repo#n reference lands in the right thread', () => {
    const State = MakeState({
      Issues: {
        'other-org/other#7': {
          ChannelID: 'C1',
          ThreadTs: '7.0',
          PostedKeys: [],
          Closed: false,
          LastActivityAt: '2026-10-20T11:00:00.000Z',
        },
      },
    });
    const Actions = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [{
        number: 2,
        title: 'Link',
        body: 'Fixes other-org/other#7',
        state: 'open',
        html_url: 'https://github.com/hiqs-labs/demo/pull/2',
        created_at: '2026-10-20T12:00:00.000Z',
        updated_at: '2026-10-20T12:00:00.000Z',
        user: { login: 'dave', type: 'User' },
        pull_request: { merged_at: null },
      }],
      []
    );
    expect(Actions).toHaveLength(1);
    expect(Actions[0].IssueKey).toBe('other-org/other#7');
  });

  test('close then reopen each post once', () => {
    const State = MakeState({
      Issues: {
        'hiqs-labs/demo#1': {
          ChannelID: 'C1',
          ThreadTs: '1.0',
          PostedKeys: [],
          Closed: false,
          LastActivityAt: '2026-10-20T11:00:00.000Z',
        },
      },
    });
    const Closed = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [{
        number: 1,
        title: 'X',
        state: 'closed',
        state_reason: 'completed',
        html_url: 'https://github.com/hiqs-labs/demo/issues/1',
        created_at: '2026-10-20T11:00:00.000Z',
        updated_at: '2026-10-20T14:00:00.000Z',
        closed_at: '2026-10-20T14:00:00.000Z',
        user: { login: 'alice', type: 'User' },
      }],
      []
    );
    expect(Closed).toHaveLength(1);
    expect(Closed[0].EventKey).toBe('closed:2026-10-20T14:00:00.000Z');
    expect(Closed[0].MarkClosed).toBe(true);

    State.Issues['hiqs-labs/demo#1'].Closed = true;
    State.Issues['hiqs-labs/demo#1'].PostedKeys.push(Closed[0].EventKey);

    const Reopened = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [{
        number: 1,
        title: 'X',
        state: 'open',
        html_url: 'https://github.com/hiqs-labs/demo/issues/1',
        created_at: '2026-10-20T11:00:00.000Z',
        updated_at: '2026-10-20T15:00:00.000Z',
        user: { login: 'alice', type: 'User' },
      }],
      []
    );
    expect(Reopened).toHaveLength(1);
    expect(Reopened[0].EventKey).toBe('reopened:2026-10-20T15:00:00.000Z');
    expect(Reopened[0].MarkOpen).toBe(true);
  });

  test('skips bot and ignored authors', () => {
    const State = MakeState();
    const Actions = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [
        {
          number: 1,
          title: 'Bot issue',
          state: 'open',
          html_url: 'https://github.com/hiqs-labs/demo/issues/1',
          created_at: '2026-10-20T11:00:00.000Z',
          updated_at: '2026-10-20T11:00:00.000Z',
          user: { login: 'dependabot[bot]', type: 'Bot' },
        },
        {
          number: 2,
          title: 'Ignored',
          state: 'open',
          html_url: 'https://github.com/hiqs-labs/demo/issues/2',
          created_at: '2026-10-20T11:00:00.000Z',
          updated_at: '2026-10-20T11:00:00.000Z',
          user: { login: 'sleuth-filer', type: 'User' },
        },
      ],
      [],
      { IgnoreAuthors: new Set(['sleuth-filer']) }
    );
    expect(Actions).toEqual([]);
  });

  test('parents precede replies when both are planned in one cycle', () => {
    const State = MakeState();
    const Actions = PlanRepoActions(
      State,
      'hiqs-labs/demo',
      [{
        number: 1,
        title: 'New',
        state: 'open',
        html_url: 'https://github.com/hiqs-labs/demo/issues/1',
        created_at: '2026-10-20T11:00:00.000Z',
        updated_at: '2026-10-20T11:05:00.000Z',
        user: { login: 'alice', type: 'User' },
      }],
      [{
        id: 5,
        body: 'first comment',
        html_url: 'https://github.com/hiqs-labs/demo/issues/1#issuecomment-5',
        created_at: '2026-10-20T11:01:00.000Z',
        updated_at: '2026-10-20T11:01:00.000Z',
        issue_url: 'https://api.github.com/repos/hiqs-labs/demo/issues/1',
        user: { login: 'bob', type: 'User' },
      }]
    );
    expect(Actions.map((ArgA) => ArgA.Kind)).toEqual(['parent', 'reply']);
  });
});

describe('NextCursor', () => {
  test('never moves backwards and overlaps by 60 seconds', () => {
    const Previous = '2026-10-20T12:00:00.000Z';
    expect(NextCursor([], [], Previous)).toBe(Previous);
    const Next = NextCursor(
      [{ updated_at: '2026-10-20T12:05:00.000Z', created_at: '2026-10-20T12:05:00.000Z', number: 1, title: '', state: 'open', html_url: '' }],
      [],
      Previous
    );
    expect(Next).toBe('2026-10-20T12:04:00.000Z');
    expect(NextCursor([], [], '2026-10-20T12:10:00.000Z')).toBe('2026-10-20T12:10:00.000Z');
  });
});

describe('PruneState', () => {
  test('preserves old thread identity and keys while pruning removed repo cursors', () => {
    const Now = new Date('2026-10-20T12:00:00.000Z');
    const State = EmptyState();
    State.Issues['a/b#1'] = {
      ChannelID: 'C1',
      ThreadTs: '1',
      PostedKeys: [],
      Closed: true,
      LastActivityAt: new Date(Now.getTime() - 14 * 24 * 60 * 60 * 1000 - 1000).toISOString(),
    };
    State.Issues['a/b#2'] = {
      ChannelID: 'C1',
      ThreadTs: '2',
      PostedKeys: [],
      Closed: false,
      LastActivityAt: new Date(Now.getTime() - 30 * 24 * 60 * 60 * 1000 - 1000).toISOString(),
    };
    State.Issues['a/b#3'] = {
      ChannelID: 'C1',
      ThreadTs: '3',
      PostedKeys: [],
      Closed: false,
      LastActivityAt: Now.toISOString(),
    };
    State.Repos['old/repo'] = { Cursor: Now.toISOString(), SeededAt: Now.toISOString() };
    State.Repos['keep/repo'] = { Cursor: Now.toISOString(), SeededAt: Now.toISOString() };
    PruneState(State, Now, ['keep/repo']);
    expect(State.Issues).toEqual({
      'a/b#1': expect.objectContaining({ ThreadTs: '1' }),
      'a/b#2': expect.objectContaining({ ThreadTs: '2' }),
      'a/b#3': expect.objectContaining({ ThreadTs: '3' }),
    });
    expect(State.Repos).toEqual({
      'keep/repo': expect.any(Object),
    });
  });
});
