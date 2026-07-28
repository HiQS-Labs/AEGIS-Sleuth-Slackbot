'use strict';

const JinhuiFixture = require('./fixtures/stratalist/jinhui2026.public-share.json');
const AndyFixture = require('./fixtures/stratalist/tdbhIvYYUWhE.public-share.json');
const {
  ParseStratalistUrlInfo,
  BuildStratalistDuplicateKey,
  ParseStratalistImportCommandText,
  ConvertDateOnlyDueAtToWorkspaceDate,
  NormalizeStratalistPayload,
  FetchStratalistPublicListAsync,
} = require('../src/stratalist-import');

describe('stratalist-import ParseStratalistUrlInfo', () => {
  test('accepts share URLs and derives the public API URL', () => {
    expect(ParseStratalistUrlInfo('https://stratalist.net/go/jinhui2026')).toEqual({
      ShareUrl: 'https://stratalist.net/go/jinhui2026',
      ApiUrl: 'https://stratalist.net/api/public/share/jinhui2026',
      Slug: 'jinhui2026',
    });
  });

  test('accepts the raw API URL and normalizes back to the share URL', () => {
    expect(ParseStratalistUrlInfo('https://stratalist.net/api/public/share/tdbhIvYYUWhE')).toEqual({
      ShareUrl: 'https://stratalist.net/go/tdbhIvYYUWhE',
      ApiUrl: 'https://stratalist.net/api/public/share/tdbhIvYYUWhE',
      Slug: 'tdbhIvYYUWhE',
    });
  });

  test('rejects non-Stratalist hosts and unrelated paths', () => {
    expect(() => ParseStratalistUrlInfo('https://example.com/go/jinhui2026')).toThrow('must use stratalist.net');
    expect(() => ParseStratalistUrlInfo('https://stratalist.net/list/jinhui2026')).toThrow('/go/:slug or /api/public/share/:slug');
  });
});

describe('stratalist-import BuildStratalistDuplicateKey', () => {
  test('uses a stable slug + item id key', () => {
    expect(BuildStratalistDuplicateKey('jinhui2026', 'abc123')).toBe('stratalist:jinhui2026:abc123');
  });
});

describe('stratalist-import ParseStratalistImportCommandText', () => {
  test('parses import URL only', () => {
    expect(ParseStratalistImportCommandText('import https://stratalist.net/go/jinhui2026')).toEqual({
      success: true,
      shareUrl: 'https://stratalist.net/go/jinhui2026',
      assigneeToken: null,
      assigneeMode: 'default',
      undatedFallbackText: null,
      errors: [],
    });
  });

  test('parses assign me, explicit mention, and undated fallback', () => {
    expect(ParseStratalistImportCommandText(
      'import https://stratalist.net/go/jinhui2026 assign me'
    ).assigneeMode).toBe('me');

    expect(ParseStratalistImportCommandText(
      'import https://stratalist.net/go/jinhui2026 assign <@U123ABC>'
    )).toEqual({
      success: true,
      shareUrl: 'https://stratalist.net/go/jinhui2026',
      assigneeToken: '<@U123ABC>',
      assigneeMode: 'explicit',
      undatedFallbackText: null,
      errors: [],
    });

    expect(ParseStratalistImportCommandText(
      'import https://stratalist.net/go/jinhui2026 assign <@U123ABC> undated next monday 10am'
    )).toEqual({
      success: true,
      shareUrl: 'https://stratalist.net/go/jinhui2026',
      assigneeToken: '<@U123ABC>',
      assigneeMode: 'explicit',
      undatedFallbackText: 'next monday 10am',
      errors: [],
    });
  });

  test('rejects unsupported grammar so phase 0 can lock syntax explicitly', () => {
    const Result = ParseStratalistImportCommandText(
      'import https://stratalist.net/go/jinhui2026 undated tomorrow assign <@U123ABC>'
    );

    expect(Result.success).toBe(false);
    expect(Result.errors[0]).toContain('place `assign ...` before `undated ...`');
  });
});

describe('stratalist-import ConvertDateOnlyDueAtToWorkspaceDate', () => {
  test('maps a date-only payload to 10 AM in workspace local time', () => {
    const Result = ConvertDateOnlyDueAtToWorkspaceDate('2026-05-10T00:00:00.000Z', 'America/Los_Angeles');
    expect(Result.toISOString()).toBe('2026-05-10T17:00:00.000Z');
  });
});

describe('stratalist-import NormalizeStratalistPayload', () => {
  test('live jinhui fixture proves current payload is fully undated after completion filtering', () => {
    const Result = NormalizeStratalistPayload(JinhuiFixture, {
      WorkspaceTimeZone: 'America/Los_Angeles',
      AssigneeID: 'U_IMPORTER',
    });

    expect(Result.ListSlug).toBe('jinhui2026');
    expect(Result.ImportCandidates).toHaveLength(0);
    expect(Result.SkippedCompletedItems).toHaveLength(3);
    expect(Result.SkippedUndatedItems).toHaveLength(5);
  });

  test('undated fallback imports the live jinhui fixture deterministically and sets assignee directly', () => {
    const Result = NormalizeStratalistPayload(JinhuiFixture, {
      WorkspaceTimeZone: 'America/Los_Angeles',
      AssigneeID: 'U_TARGET',
      UndatedFallbackText: 'tomorrow',
    });

    expect(Result.ImportCandidates).toHaveLength(5);
    expect(Result.SkippedCompletedItems).toHaveLength(3);
    expect(Result.SkippedUndatedItems).toHaveLength(0);
    expect(Result.ImportCandidates[0]).toMatchObject({
      SourceListSlug: 'jinhui2026',
      AssigneeID: 'U_TARGET',
      DueDateKind: 'undated',
      UndatedFallbackText: 'tomorrow',
    });
    expect(Result.ImportCandidates[0].DuplicateKey).toBe('stratalist:jinhui2026:b046246b-021e-4b59-a9c1-9b6b6468cce0');
  });

  test('live andy fixture surfaces a warning when item text looks timed but payload dueAt is null', () => {
    const Result = NormalizeStratalistPayload(AndyFixture, {
      WorkspaceTimeZone: 'America/Los_Angeles',
      AssigneeID: 'U_IMPORTER',
    });

    expect(Result.ImportCandidates).toHaveLength(0);
    expect(Result.SkippedUndatedItems).toHaveLength(5);
    expect(Result.Warnings).toEqual([
      {
        Type: 'undated-item-contains-time-like-text',
        ItemId: 'bd156e75-2b47-48b9-b9d7-307a55d8a662',
        Message: 'Item bd156e75-2b47-48b9-b9d7-307a55d8a662 contains time-like text but payload dueAt is null.',
      },
    ]);
  });

  test('date-only payloads become 10 AM local while real timestamps pass through unchanged', () => {
    const Payload = {
      success: true,
      list: {
        slug: 'synthetic',
        title: 'Synthetic',
        shareUrl: 'https://stratalist.net/go/synthetic',
      },
      items: [
        {
          id: 'date-only',
          text: 'Date only item',
          position: 1,
          completed: false,
          trashed: false,
          dueAt: '2026-05-10T00:00:00.000Z',
          dueDateOnly: true,
        },
        {
          id: 'timestamp',
          text: 'Timestamp item',
          position: 2,
          completed: false,
          trashed: false,
          dueAt: '2026-05-10T18:30:00.000Z',
          dueDateOnly: false,
        },
      ],
    };

    const Result = NormalizeStratalistPayload(Payload, {
      WorkspaceTimeZone: 'America/Los_Angeles',
      AssigneeID: 'U_IMPORTER',
    });

    expect(Result.ImportCandidates).toHaveLength(2);
    expect(Result.ImportCandidates[0].DueDateKind).toBe('date-only');
    expect(Result.ImportCandidates[0].DueAt.toISOString()).toBe('2026-05-10T17:00:00.000Z');
    expect(Result.ImportCandidates[1].DueDateKind).toBe('timestamp');
    expect(Result.ImportCandidates[1].DueAt.toISOString()).toBe('2026-05-10T18:30:00.000Z');
  });
});

describe('stratalist-import FetchStratalistPublicListAsync', () => {
  test('maps 403, 404, invalid JSON, and success paths', async () => {
    const NotPublic = await FetchStratalistPublicListAsync(
      'https://stratalist.net/go/jinhui2026',
      async () => ({ status: 403, json: async () => ({}) })
    );
    expect(NotPublic).toMatchObject({ ok: false, status: 403, errorCode: 'not-public' });

    const Missing = await FetchStratalistPublicListAsync(
      'https://stratalist.net/go/jinhui2026',
      async () => ({ status: 404, json: async () => ({}) })
    );
    expect(Missing).toMatchObject({ ok: false, status: 404, errorCode: 'not-found' });

    const InvalidJson = await FetchStratalistPublicListAsync(
      'https://stratalist.net/go/jinhui2026',
      async () => ({ status: 200, json: async () => { throw new Error('boom'); } })
    );
    expect(InvalidJson).toMatchObject({ ok: false, status: 200, errorCode: 'invalid-json' });

    const Success = await FetchStratalistPublicListAsync(
      'https://stratalist.net/go/jinhui2026',
      async () => ({ status: 200, json: async () => JinhuiFixture })
    );
    expect(Success.ok).toBe(true);
    expect(Success.urlInfo.ApiUrl).toBe('https://stratalist.net/api/public/share/jinhui2026');
    expect(Success.payload.list.slug).toBe('jinhui2026');
  });
});
