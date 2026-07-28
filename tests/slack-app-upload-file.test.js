'use strict';

const SlackApp = require('../src/slack-app');

describe('SlackApp.NormalizeUploadedFileResult', () => {
  test('unwraps Slack filesUploadV2 nested file payloads', () => {
    const Result = SlackApp.NormalizeUploadedFileResult({
      ok: true,
      files: [
        {
          ok: true,
          files: [
            {
              id: 'F123',
              name: 'contract.md',
              mimetype: 'text/markdown',
              url_private: 'https://example.test/private',
              url_private_download: 'https://example.test/download',
              size: 1234,
              permalink: 'https://example.test/file',
              shares: {
                public: {
                  C123ABC456: [
                    {
                      ts: '1710000000.000101',
                      thread_ts: '1710000000.000100',
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    }, 'C123ABC456', 'fallback.md', null);

    expect(Result).toEqual({
      File: {
        id: 'F123',
        name: 'contract.md',
        mimetype: 'text/markdown',
        url_private: 'https://example.test/private',
        url_private_download: 'https://example.test/download',
        size: 1234,
      },
      MessageTS: '1710000000.000101',
      ThreadTS: '1710000000.000100',
      Permalink: 'https://example.test/file',
    });
  });

  test('accepts direct file payloads for simpler mocks', () => {
    const Result = SlackApp.NormalizeUploadedFileResult({
      ok: true,
      files: [
        {
          id: 'F456',
          name: 'simple.md',
          mimetype: '',
          url_private: 'https://example.test/simple',
          url_private_download: '',
          size: 55,
          permalink: null,
          shares: {},
        },
      ],
    }, 'C123ABC456', 'fallback.md', '1710000000.000200');

    expect(Result).toEqual({
      File: {
        id: 'F456',
        name: 'simple.md',
        mimetype: 'application/octet-stream',
        url_private: 'https://example.test/simple',
        url_private_download: 'https://example.test/simple',
        size: 55,
      },
      MessageTS: null,
      ThreadTS: '1710000000.000200',
      Permalink: null,
    });
  });
});
