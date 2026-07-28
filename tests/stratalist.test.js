'use strict';

const JinhuiFixture = require('./fixtures/stratalist/jinhui2026.public-share.json');
const {
  BuildStratalistUrlInfoFromSlug,
  ParseStratalistUrlInfo,
  ResolveStratalistReferenceInfo,
  ValidateStratalistPayload,
  FormatStratalistDueForDisplay,
  RenderStratalistListForSlack,
  FetchStratalistPublicListAsync,
} = require('../src/stratalist');

describe('stratalist URL resolution', () => {
  test('accepts a raw slug and builds canonical share + API URLs', () => {
    expect(BuildStratalistUrlInfoFromSlug('jinhui2026')).toEqual({
      ShareUrl: 'https://stratalist.net/go/jinhui2026',
      ApiUrl: 'https://stratalist.net/api/public/share/jinhui2026',
      Slug: 'jinhui2026',
    });
  });

  test('accepts share URLs and API URLs and normalizes back to the same slug', () => {
    expect(ParseStratalistUrlInfo('https://stratalist.net/go/jinhui2026')).toEqual({
      ShareUrl: 'https://stratalist.net/go/jinhui2026',
      ApiUrl: 'https://stratalist.net/api/public/share/jinhui2026',
      Slug: 'jinhui2026',
    });

    expect(ResolveStratalistReferenceInfo('https://stratalist.net/api/public/share/jinhui2026')).toEqual({
      ShareUrl: 'https://stratalist.net/go/jinhui2026',
      ApiUrl: 'https://stratalist.net/api/public/share/jinhui2026',
      Slug: 'jinhui2026',
    });
  });

  test('rejects invalid hosts and malformed slugs', () => {
    expect(() => ResolveStratalistReferenceInfo('https://example.com/go/jinhui2026')).toThrow('must use stratalist.net');
    expect(() => ResolveStratalistReferenceInfo('bad slug!')).toThrow('must use only letters, numbers, underscores, or hyphens');
  });
});

describe('stratalist payload validation + rendering', () => {
  test('normalizes the public payload into sorted validated items', () => {
    const Result = ValidateStratalistPayload(JinhuiFixture);

    expect(Result.ListSlug).toBe('jinhui2026');
    expect(Result.ListTitle).toBe('Jinhui');
    expect(Result.Items).toHaveLength(8);
    expect(Result.Items.map((ArgItem) => ArgItem.Position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Result.Items.find((ArgItem) => ArgItem.Text === 'Decide: New blog URL vs. existing Sherpi/Sleuth WP site')).toMatchObject({
      Completed: true,
      Trashed: false,
    });
  });

  test('renders completed and open items plus the share link', () => {
    const Rendered = RenderStratalistListForSlack(JinhuiFixture, {
      TimeZone: 'America/Los_Angeles',
    });

    expect(Rendered).toContain('*Jinhui*');
    expect(Rendered).toContain('☑ Decide: New blog URL vs. existing Sherpi/Sleuth WP site');
    expect(Rendered).toContain('☐ Maintain LinkedIn cadence: 1 post per week');
    expect(Rendered).toContain('Stratalist: https://stratalist.net/go/jinhui2026');
  });

  test('renders date-only and timestamp due values without using the import-only 10 AM placeholder', () => {
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
          completed: true,
          trashed: false,
          dueAt: '2026-05-10T18:30:00.000Z',
          dueDateOnly: false,
        },
      ],
    };

    const Rendered = RenderStratalistListForSlack(Payload, {
      TimeZone: 'America/Los_Angeles',
    });

    expect(Rendered).toContain('☐ Date only item - due May 10, 2026');
    expect(Rendered).toContain('☑ Timestamp item - due May 10, 2026, 11:30 AM');
  });

  test('formats due text directly for shared rendering helpers', () => {
    expect(FormatStratalistDueForDisplay('2026-05-10T00:00:00.000Z', true, 'America/Los_Angeles')).toBe('May 10, 2026');
    expect(FormatStratalistDueForDisplay('2026-05-10T18:30:00.000Z', false, 'America/Los_Angeles')).toBe('May 10, 2026, 11:30 AM');
  });
});

describe('stratalist fetch', () => {
  test('accepts a slug as the fetch input and maps common HTTP failure modes', async () => {
    const Missing = await FetchStratalistPublicListAsync(
      'jinhui2026',
      async () => ({ status: 404, json: async () => ({}) })
    );
    expect(Missing).toMatchObject({ ok: false, status: 404, errorCode: 'not-found' });

    const Success = await FetchStratalistPublicListAsync(
      'jinhui2026',
      async () => ({ status: 200, json: async () => JinhuiFixture })
    );
    expect(Success).toMatchObject({
      ok: true,
      status: 200,
      urlInfo: {
        ShareUrl: 'https://stratalist.net/go/jinhui2026',
        ApiUrl: 'https://stratalist.net/api/public/share/jinhui2026',
      },
    });
  });
});
