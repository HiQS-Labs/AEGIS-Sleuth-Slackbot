'use strict';
const mockReplies = jest.fn();
jest.mock('@slack/bolt', () => ({ App: jest.fn(() => ({ client: { conversations: { replies: mockReplies }, auth: { test: jest.fn().mockResolvedValue({ ok: true, user_id: 'UBOT123' }) } }, event: jest.fn(), message: jest.fn(), action: jest.fn() })) }));
const mockAi = { DefaultModelName: 'gpt-4o-mini', ProcessMessageWithJsonResponseAsync: jest.fn(), ProcessMessageWithTextResponseAsync: jest.fn() };
const mockClient = { connect: jest.fn(), listTools: jest.fn(), callTool: jest.fn(), close: jest.fn() };
let mockTransportOptions;
jest.mock('../src/workspace-ai', () => jest.fn(() => mockAi));
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: jest.fn(() => mockClient) }));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: jest.fn((url, options) => { mockTransportOptions = options; }) }));
const fs = require('fs').promises;
const Compass = require('../src/product-compass');
const ChatModule = require('../src/chat-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');
const Team = '11111111-1111-1111-1111-111111111111';
const Product = '22222222-2222-2222-2222-222222222222';
const Release = '33333333-3333-3333-3333-333333333333';
const Document = '44444444-4444-4444-4444-444444444444';
const Workspace = { WORKSPACE_NAME: 'CompassCanary', OPENAI_API_KEY: 'test', MAIN_TIMEZONE: 'UTC', PRODUCT_COMPASS_CHANNELS: JSON.stringify({ C123: { TeamId: Team, CredentialName: 'test' } }) };
const Search = { Action: 'search_documents', Query: 'release requirements', ProductId: Product, ReleaseId: Release, Answer: '', Citations: [] };
const Answer = { Action: 'answer', Query: '', ProductId: '', ReleaseId: '', Answer: 'Release evidence [1.1]', Citations: ['1.1'] };
const Passage = { document_id: Document, product_id: Product, release_id: Release, file_name: '1.65.md', release: '1.65', excerpt: 'New capability', lines: '1-8', link: `/t/${Team}/library?doc=${Document}` };
const Tool = (name, fields) => ({ name, inputSchema: { type: 'object', properties: { ...Object.fromEntries(fields.map(field => [field, { type: 'string' }])), limit: { type: 'integer' } }, required: fields.slice(0, 1) } });
let Read;
let OriginalPlatform;
let OriginalCredentials;
beforeEach(() => {
  jest.clearAllMocks();
  OriginalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  OriginalCredentials = process.env.CREDENTIALS_DIRECTORY;
  process.env.CREDENTIALS_DIRECTORY = '/managed-credentials';
  const OriginalRead = fs.readFile.bind(fs);
  Read = jest.spyOn(fs, 'readFile').mockImplementation((file, ...args) => String(file).startsWith('/managed-credentials/') ? Promise.resolve('pc_live_fixture') : OriginalRead(file, ...args));
  mockClient.connect.mockResolvedValue(undefined);
  mockClient.close.mockResolvedValue(undefined);
  mockClient.listTools.mockResolvedValue({ tools: [Tool('list_products', ['team_id']), Tool('search_documents', ['team_id', 'query', 'product_id', 'release_id'])] });
  mockClient.callTool.mockImplementation(async ({ name }) => ({ structuredContent: name === 'list_products' ? { products: [{ id: Product, name: 'Compass', releases: [{ id: Release, name: '1.65' }] }] } : { passages: [Passage], documents_not_indexed: 1 } }));
  mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValueOnce(Search).mockResolvedValueOnce(Answer);
});
afterEach(() => {
  Read.mockRestore();
  Object.defineProperty(process, 'platform', OriginalPlatform);
  if(OriginalCredentials === undefined) delete process.env.CREDENTIALS_DIRECTORY;
  else process.env.CREDENTIALS_DIRECTORY = OriginalCredentials;
  jest.useRealTimers();
});

describe('Product Compass pipeline canaries', () => {
  test('Slack mapped ingress and follow-up reuse complete context, prior answer, scoped search and selected model', async () => {
    const Slack = new MockSlackApp({ WorkspaceInfo: Workspace });
    const RealSlack = new (require('../src/slack-app'))(Workspace, Slack.Logger);
    await RealSlack.ConnectOneShotAsync();
    mockReplies.mockResolvedValueOnce({ ok: true, messages: [{ ts: '1', text: '<@UBOT123> start', user: 'U1' }], response_metadata: { next_cursor: 'page2' } })
      .mockResolvedValueOnce({ ok: true, messages: [{ ts: '2', text: 'stop', reactions: [{ name: 'no_bell' }] }], response_metadata: {} });
    const Paginated = await RealSlack.GetConversationMessagesAsync('C123', '1', { MaxPages: 5, Latest: '3' });
    expect(Paginated[1].reactions).toContain('no_bell');
    expect(mockReplies.mock.calls[1][0].cursor).toBe('page2');
    mockReplies.mockResolvedValue({ ok: true, messages: [], response_metadata: { next_cursor: 'more' } });
    await expect(RealSlack.GetConversationMessagesAsync('C123', '1', { MaxPages: 5, Latest: '3' })).rejects.toMatchObject({ code: 'context-incomplete' });
    const Messages = [{ ts: '1', text: '<@UBOT123> compare 1.0 and 1.65', user: 'U1' }, { ts: '2', text: 'Previous synthesis [source]', bot_id: 'B1', user: 'UBOT123' }];
    Slack.GetConversationMessagesAsync = jest.fn().mockResolvedValue(Messages);
    const ModelSpy = jest.spyOn(require('../src/channel-model-settings').prototype, 'GetModelForChannel').mockReturnValue('claude-test-model');
    new ChatModule(Slack, {}, null, null, null);
    Slack.GetFileContentAsync.mockResolvedValue('# Uploaded constraints\nPreserve accessibility');
    await Slack.SimulateAppMentionAsync({ channel: 'C123', thread_ts: '1', ts: '3', user: 'CONTRIBUTOR', text: '<@UBOT123> what changed in release 1.65?', files: [{ name: 'constraints.md', size: 100, url_private: 'https://files.slack.test/constraints.md' }] });
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'list_products', arguments: { team_id: Team } }, undefined, expect.any(Object));
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'search_documents', arguments: { team_id: Team, query: Search.Query, product_id: Product, release_id: Release, limit: 12 } }, undefined, expect.any(Object));
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toContain('Previous synthesis');
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toContain('Preserve accessibility');
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toContain('what changed in release 1.65');
    expect(Slack.GetConversationMessagesAsync).toHaveBeenCalledWith('C123', '1', { MaxPages: 5, Latest: '3' });
    expect(Slack.SentMessages.at(-1).text).toContain('New capability');
    expect(Slack.SentMessages.at(-1).text).toContain('evidence is incomplete');
    mockAi.ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(Search).mockResolvedValueOnce(Answer);
    await Slack.SimulateMessageAsync({ channel: 'C123', thread_ts: '1', ts: '4', text: 'What does that imply?', user: 'CONTRIBUTOR' });
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[2][0]).toContain('What does that imply?');
    expect(Slack.GetConversationMessagesAsync).toHaveBeenCalledTimes(2);
    const Count = Slack.SentMessages.length;
    Slack.GetConversationMessagesAsync.mockResolvedValue([...Messages, ...Array.from({ length: 100 }, (_, index) => ({ ts: String(2 + index / 1000), text: 'reply', user: 'U1' })), { ts: '3', text: 'stop', reactions: ['no_bell'] }]);
    await Slack.SimulateMessageAsync({ channel: 'C123', thread_ts: '1', ts: '5', text: 'stay quiet', user: 'CONTRIBUTOR' });
    expect(Slack.SentMessages).toHaveLength(Count);
    expect(mockClient.close).toHaveBeenCalledTimes(2);
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][3]).toBe('claude-test-model');
    ModelSpy.mockRestore();
  });

  test('authorization, native custody, scope and citation guards fail closed', async () => {
    await expect(Compass.AskAsync(Workspace, 'COTHER', 'q', '', mockAi)).rejects.toMatchObject({ code: 'not-mapped' });
    expect(mockClient.connect).not.toHaveBeenCalled();
    for(const Decision of [{ ...Search, ProductId: Document }, { ...Search, ReleaseId: Document }]) {
      mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValue(Decision);
      await expect(Compass.AskAsync(Workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'scope' });
    }
    expect(mockClient.callTool.mock.calls.every(([call]) => call.name === 'list_products')).toBe(true);
    mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValueOnce(Search).mockResolvedValueOnce({ ...Answer, Citations: ['fake'] });
    await expect(Compass.AskAsync(Workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'citations' });
    expect(Read.mock.calls.some(([file]) => String(file).includes(Buffer.from(Workspace.WORKSPACE_NAME).toString('hex')))).toBe(true);
    const OriginalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(new Response('{}'));
    try {
      await mockTransportOptions.fetch('https://pmf.neochro.me/mcp/token', { method: 'POST' });
      expect(global.fetch.mock.calls[0][1].headers.get('Authorization')).toBe('Bearer pc_live_fixture');
      expect(global.fetch.mock.calls[0][1].redirect).toBe('error');
      await expect(mockTransportOptions.fetch('https://elsewhere.invalid/', {})).rejects.toMatchObject({ code: 'transport' });
    } finally { global.fetch = OriginalFetch; }
  });

  test('malformed, oversized, tool-budget and stalled-model failures cannot publish late answers', async () => {
    await expect(Compass.AskAsync(Workspace, 'C123', 'question', 'x'.repeat(205000), mockAi)).rejects.toMatchObject({ code: 'too-large' });
    mockClient.listTools.mockResolvedValueOnce({ tools: [] });
    await expect(Compass.AskAsync(Workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'contract' });
    mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValue(Search);
    await expect(Compass.AskAsync(Workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'tool-limit' });
    expect(mockAi.ProcessMessageWithJsonResponseAsync).toHaveBeenCalledTimes(5);
    expect(mockClient.callTool.mock.calls.filter(([call]) => call.name === 'search_documents')).toHaveLength(4);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let Resolve;
    const Entered = new Promise(done => mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockImplementation(() => { done(); return new Promise(resolve => { Resolve = resolve; }); }));
    const Result = Compass.AskAsync(Workspace, 'C123', 'question', '', mockAi);
    const Assertion = expect(Result).rejects.toMatchObject({ code: 'timeout' });
    await Entered;
    await jest.advanceTimersByTimeAsync(45001);
    await Assertion;
    Resolve(Answer);
    await Promise.resolve();
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][4].signal.aborted).toBe(true);
    expect(mockClient.close).toHaveBeenCalled();
  });
});
