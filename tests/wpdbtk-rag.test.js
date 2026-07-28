'use strict';

const {
  AskQuestionAsync,
  GetWpdbtkRagConfiguration,
  IsWpdbtkRagEnabled,
  WpdbtkRagError,
} = require('../src/wpdbtk-rag');

describe('wpdbtk-rag client', () => {
  /** @type {jest.SpyInstance} */
  let FetchSpy;

  const WorkspaceInfo = {
    WORKSPACE_NAME: 'Neochrome',
    ADMIN_EMAIL: 'admin@example.com',
    LIVE_TOKEN: 'xoxb-test',
    LIVE_SIGNING_SECRET: 'secret',
    LIVE_APP_TOKEN: 'xapp-test',
    OPENAI_API_KEY: 'sk-test',
    REMINDER_CHANNEL_NAME: 'general',
    MAIN_TIMEZONE: 'America/Los_Angeles',
    WPDBTK_RAG_ENABLED: 'yes',
    WPDBTK_RAG_BASE_URL: 'https://rag.example.com/',
    WPDBTK_RAG_SERVICE_TOKEN: 'rag_token_123',
    WPDBTK_RAG_DEFAULT_SOURCE: 'bq_client-a',
  };

  beforeEach(() => {
    FetchSpy = jest.spyOn(global, 'fetch').mockReset();
  });

  afterEach(() => {
    FetchSpy.mockRestore();
  });

  test('detects enabled workspaces and normalizes configuration', () => {
    expect(IsWpdbtkRagEnabled(WorkspaceInfo)).toBe(true);
    expect(GetWpdbtkRagConfiguration(WorkspaceInfo)).toEqual({
      BaseUrl: 'https://rag.example.com',
      ServiceToken: 'rag_token_123',
      DefaultSource: 'bq_client-a',
    });
  });

  test('posts to /api/ask with bearer auth and caller metadata', async () => {
    FetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: jest.fn().mockReturnValue('req_123') },
      text: jest.fn().mockResolvedValue(JSON.stringify({
        answer: 'Top products: Gummies, Tinctures.',
        mode: 'analytics',
        diagnostics: { request_id: 'req_123' },
      })),
    });

    const Result = await AskQuestionAsync(WorkspaceInfo, {
      question: 'What sold best last week?',
      caller: {
        app: 'sleuth-app',
        workspace_name: 'Neochrome',
        team_id: 'T123',
        slack_user_id: 'U123',
        channel_id: 'C123',
        thread_ts: '1712345678.123456',
      },
    });

    expect(Result).toEqual({
      answer: 'Top products: Gummies, Tinctures.',
      mode: 'analytics',
      requestId: 'req_123',
      diagnostics: { request_id: 'req_123' },
    });

    expect(FetchSpy).toHaveBeenCalledTimes(1);
    const [TargetUrl, RequestOptions] = FetchSpy.mock.calls[0];
    expect(TargetUrl).toBe('https://rag.example.com/api/ask');
    expect(RequestOptions.method).toBe('POST');
    expect(RequestOptions.headers.Authorization).toBe('Bearer rag_token_123');

    const ParsedBody = JSON.parse(RequestOptions.body);
    expect(ParsedBody).toEqual({
      question: 'What sold best last week?',
      source: 'bq_client-a',
      force_mode: null,
      scope: 'all',
      top_k: 5,
      caller: {
        app: 'sleuth-app',
        workspace_name: 'Neochrome',
        team_id: 'T123',
        slack_user_id: 'U123',
        channel_id: 'C123',
        thread_ts: '1712345678.123456',
      },
    });
  });

  test('maps upstream auth failures to a stable client error', async () => {
    FetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      headers: { get: jest.fn().mockReturnValue('req_auth') },
      text: jest.fn().mockResolvedValue(JSON.stringify({ detail: 'bad token' })),
    });

    await expect(AskQuestionAsync(WorkspaceInfo, {
      question: 'What sold best last week?',
      caller: {
        app: 'sleuth-app',
        workspace_name: 'Neochrome',
        team_id: 'T123',
        slack_user_id: 'U123',
        channel_id: 'C123',
        thread_ts: '1712345678.123456',
      },
    })).rejects.toMatchObject({
      name: 'WpdbtkRagError',
      code: 'auth',
      statusCode: 401,
      requestId: 'req_auth',
    });
  });

  test('fails closed when the workspace is not enabled', async () => {
    const DisabledWorkspace = { ...WorkspaceInfo, WPDBTK_RAG_ENABLED: 'no' };

    expect(() => GetWpdbtkRagConfiguration(DisabledWorkspace)).toThrow(WpdbtkRagError);
    await expect(AskQuestionAsync(DisabledWorkspace, {
      question: 'Anything',
      caller: {
        app: 'sleuth-app',
        workspace_name: 'Neochrome',
        team_id: 'T123',
        slack_user_id: 'U123',
        channel_id: 'C123',
        thread_ts: '1712345678.123456',
      },
    })).rejects.toMatchObject({ code: 'not-enabled' });
    expect(FetchSpy).not.toHaveBeenCalled();
  });
});