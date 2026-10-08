
'use strict';
const mockReplies = jest.fn();
jest.mock('@slack/bolt', () => ({ App: jest.fn(() => ({ client: { conversations: { replies: mockReplies }, auth: { test: jest.fn().mockResolvedValue({ ok: true, user_id: 'UBOT123' }) } }, event: jest.fn(), message: jest.fn(), action: jest.fn() })) }));
const mockAi = { DefaultModelName: 'gpt-4o-mini', ProcessMessageWithJsonResponseAsync: jest.fn(), ProcessMessageWithTextResponseAsync: jest.fn() };
const mockClient = { connect: jest.fn(), listTools: jest.fn(), callTool: jest.fn(), close: jest.fn() };
let mockTransportOptions;
jest.mock('../src/workspace-ai', () => jest.fn(() => mockAi));
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({ Client: jest.fn(() => mockClient) }));
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({ StreamableHTTPClientTransport: jest.fn((ArgUrl, ArgOptions) => { mockTransportOptions = ArgOptions; }) }));
const fs = require('fs').promises;
const compass = require('../src/product-compass');
const ChatModule = require('../src/chat-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');
const team = '11111111-1111-1111-1111-111111111111';
const product = '22222222-2222-2222-2222-222222222222';
const release = '33333333-3333-3333-3333-333333333333';
const document = '44444444-4444-4444-4444-444444444444';
const workspace = { WORKSPACE_NAME: 'CompassCanary', OPENAI_API_KEY: 'test', MAIN_TIMEZONE: 'UTC', PRODUCT_COMPASS_CHANNELS: JSON.stringify({ C123: { TeamId: team, CredentialName: 'test' } }) };
const search = { Action: 'search_documents', Query: 'release requirements', ProductId: product, ReleaseId: release, Answer: '', Citations: [] };
const answer = { Action: 'answer', Query: '', ProductId: '', ReleaseId: '', Answer: 'Release evidence [1.1]', Citations: ['1.1'] };
const passage = { document_id: document, product_id: product, release_id: release, file_name: '1.65.md', release: '1.65', excerpt: 'New capability', lines: '1-8', link: `/t/${team}/library?doc=${document}` };
const tool = (ArgName, ArgFields) => ({ name: ArgName, inputSchema: { type: 'object', properties: { ...Object.fromEntries(ArgFields.map(ArgField => [ArgField, { type: 'string' }])), limit: { type: 'integer' } }, required: ArgFields.slice(0, 1) } });
let read;
let OriginalPlatform;
let OriginalCredentials;
beforeEach(() => {
  jest.clearAllMocks();
  OriginalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'linux' });
  OriginalCredentials = process.env.CREDENTIALS_DIRECTORY;
  process.env.CREDENTIALS_DIRECTORY = '/managed-credentials';
  const OriginalRead = fs.readFile.bind(fs);
  read = jest.spyOn(fs, 'readFile').mockImplementation((ArgFile, ...ArgArgs) => String(ArgFile).startsWith('/managed-credentials/') ? Promise.resolve('pc_live_fixture') : OriginalRead(ArgFile, ...ArgArgs));
  mockClient.connect.mockResolvedValue(undefined);
  mockClient.close.mockResolvedValue(undefined);
  mockClient.listTools.mockResolvedValue({ tools: [tool('list_products', ['team_id']), tool('search_documents', ['team_id', 'query', 'product_id', 'release_id'])] });
  mockClient.callTool.mockImplementation(async ({ name: ArgName }) => ({ structuredContent: ArgName === 'list_products' ? { products: [{ id: product, name: 'Compass', releases: [{ id: release, name: '1.65' }] }] } : { passages: [passage], documents_not_indexed: 1 } }));
  mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValueOnce(search).mockResolvedValueOnce(answer);
});
afterEach(() => {
  read.mockRestore();
  Object.defineProperty(process, 'platform', OriginalPlatform);
  if(OriginalCredentials === undefined) delete process.env.CREDENTIALS_DIRECTORY;
  else process.env.CREDENTIALS_DIRECTORY = OriginalCredentials;
  jest.useRealTimers();
});

describe('Product Compass pipeline canaries', () => {
  test('Slack mapped ingress and follow-up reuse complete context, prior answer, scoped search and selected model', async () => {
    const slack = new MockSlackApp({ WorkspaceInfo: workspace });
    const RealSlack = new (require('../src/slack-app'))(workspace, slack.Logger);
    await RealSlack.ConnectOneShotAsync();
    mockReplies.mockResolvedValueOnce({ ok: true, messages: [{ ts: '1', text: '<@UBOT123> start', user: 'U1' }], response_metadata: { next_cursor: 'page2' } })
      .mockResolvedValueOnce({ ok: true, messages: [{ ts: '2', text: 'stop', reactions: [{ name: 'no_bell' }] }], response_metadata: {} });
    const paginated = await RealSlack.GetConversationMessagesAsync('C123', '1', { MaxPages: 5, Latest: '3' });
    expect(paginated[1].reactions).toContain('no_bell');
    expect(mockReplies.mock.calls[1][0].cursor).toBe('page2');
    mockReplies.mockResolvedValue({ ok: true, messages: [], response_metadata: { next_cursor: 'more' } });
    await expect(RealSlack.GetConversationMessagesAsync('C123', '1', { MaxPages: 5, Latest: '3' })).rejects.toMatchObject({ code: 'context-incomplete' });
    const messages = [{ ts: '1', text: '<@UBOT123> compare 1.0 and 1.65', user: 'U1' }, { ts: '2', text: 'Previous synthesis [source]', bot_id: 'B1', user: 'UBOT123' }];
    slack.GetConversationMessagesAsync = jest.fn().mockResolvedValue(messages);
    const ModelSpy = jest.spyOn(require('../src/channel-model-settings').prototype, 'GetModelForChannel').mockReturnValue('claude-test-model');
    new ChatModule(slack, {}, null, null, null);
    slack.GetFileContentAsync.mockResolvedValue('# Uploaded constraints\nPreserve accessibility');
    await slack.SimulateAppMentionAsync({ channel: 'C123', thread_ts: '1', ts: '3', user: 'CONTRIBUTOR', text: '<@UBOT123> what changed in release 1.65?', files: [{ name: 'constraints.md', size: 100, url_private: 'https://files.slack.test/constraints.md' }] });
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'list_products', arguments: { team_id: team } }, undefined, expect.any(Object));
    expect(mockClient.callTool).toHaveBeenCalledWith({ name: 'search_documents', arguments: { team_id: team, query: search.Query, product_id: product, release_id: release, limit: 12 } }, undefined, expect.any(Object));
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toContain('Previous synthesis');
    expect(JSON.parse(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).Tools).toEqual(['search_documents']);
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toContain('Preserve accessibility');
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]).toContain('what changed in release 1.65');
    expect(slack.GetConversationMessagesAsync).toHaveBeenCalledWith('C123', '1', { MaxPages: 5, Latest: '3' });
    expect(slack.SentMessages.at(-1).text).toContain('New capability');
    expect(slack.SentMessages.at(-1).text).toContain('evidence is incomplete');
    mockAi.ProcessMessageWithJsonResponseAsync.mockResolvedValueOnce(search).mockResolvedValueOnce(answer);
    await slack.SimulateMessageAsync({ channel: 'C123', thread_ts: '1', ts: '4', text: 'What does that imply?', user: 'CONTRIBUTOR' });
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[2][0]).toContain('What does that imply?');
    expect(slack.GetConversationMessagesAsync).toHaveBeenCalledTimes(2);
    const count = slack.SentMessages.length;
    slack.GetConversationMessagesAsync.mockResolvedValue([...messages, ...Array.from({ length: 100 }, (Arg_, ArgIndex) => ({ ts: String(2 + ArgIndex / 1000), text: 'reply', user: 'U1' })), { ts: '3', text: 'stop', reactions: ['no_bell'] }]);
    await slack.SimulateMessageAsync({ channel: 'C123', thread_ts: '1', ts: '5', text: 'stay quiet', user: 'CONTRIBUTOR' });
    expect(slack.SentMessages).toHaveLength(count);
    expect(mockClient.close).toHaveBeenCalledTimes(2);
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][3]).toBe('claude-test-model');
    ModelSpy.mockRestore();
  });

  test('authorization, native custody, scope and citation guards fail closed', async () => {
    await expect(compass.AskAsync(workspace, 'COTHER', 'q', '', mockAi)).rejects.toMatchObject({ code: 'not-mapped' });
    expect(mockClient.connect).not.toHaveBeenCalled();
    for(const decision of [{ ...search, ProductId: document }, { ...search, ReleaseId: document }]) {
      mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValue(decision);
      await expect(compass.AskAsync(workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'scope' });
    }
    expect(mockClient.callTool.mock.calls.every(([ArgCall]) => ArgCall.name === 'list_products')).toBe(true);
    mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValueOnce(search).mockResolvedValueOnce({ ...answer, Citations: ['fake'] });
    await expect(compass.AskAsync(workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'citations' });
    expect(read.mock.calls.some(([ArgFile]) => String(ArgFile).includes(Buffer.from(workspace.WORKSPACE_NAME).toString('hex')))).toBe(true);
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
    await expect(compass.AskAsync(workspace, 'C123', 'question', 'x'.repeat(205000), mockAi)).rejects.toMatchObject({ code: 'too-large' });
    mockClient.listTools.mockResolvedValueOnce({ tools: [] });
    await expect(compass.AskAsync(workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'contract' });
    mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockResolvedValue(search);
    await expect(compass.AskAsync(workspace, 'C123', 'question', '', mockAi)).rejects.toMatchObject({ code: 'tool-limit' });
    expect(mockAi.ProcessMessageWithJsonResponseAsync).toHaveBeenCalledTimes(5);
    expect(mockClient.callTool.mock.calls.filter(([ArgCall]) => ArgCall.name === 'search_documents')).toHaveLength(4);
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    let resolve;
    const entered = new Promise(ArgDone => mockAi.ProcessMessageWithJsonResponseAsync.mockReset().mockImplementation(() => { ArgDone(); return new Promise(ArgResolve => { resolve = ArgResolve; }); }));
    const result = compass.AskAsync(workspace, 'C123', 'question', '', mockAi);
    const assertion = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await entered;
    await jest.advanceTimersByTimeAsync(45001);
    await assertion;
    resolve(answer);
    await Promise.resolve();
    expect(mockAi.ProcessMessageWithJsonResponseAsync.mock.calls[0][4].signal.aborted).toBe(true);
    expect(mockClient.close).toHaveBeenCalled();
  });
});

