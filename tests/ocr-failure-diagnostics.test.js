'use strict';

let MockProcessMultimodalMessageWithJsonResponseAsync;

jest.mock('../src/workspace-ai', () => {
  return jest.fn().mockImplementation((WorkspaceInfo) => ({
    WorkspaceInfo,
    DefaultModelName: 'gpt-4o-mini',
    ComplexModelName: 'gpt-4o',
    ProcessMultimodalMessageWithJsonResponseAsync: (...args) => MockProcessMultimodalMessageWithJsonResponseAsync(...args),
    ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({}),
    ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
    ResolveVisionModelName: jest.fn().mockReturnValue('gemini-2.5-flash'),
    LoadChannelModelsAsync: jest.fn().mockResolvedValue(undefined),
    GetChannelModelName: jest.fn().mockReturnValue(null),
    SetChannelModelAsync: jest.fn().mockResolvedValue(undefined),
    ClearChannelModelAsync: jest.fn().mockResolvedValue(undefined),
  }));
});

const { MockSlackApp } = require('./mocks/mock-slack-app');
const ChatModule = require('../src/chat-module');

const TestWorkspaceInfo = {
  WORKSPACE_NAME: 'OCRDiagnosticsWorkspace',
  LIVE_TOKEN: 'xoxb-test',
  OPENAI_API_KEY: 'test-openai-key',
  GEMINI_API_KEY: 'test-gemini-key',
};

const PngAttachment = {
  name: 'receipt.png',
  mimetype: 'image/png',
  size: 50000,
  url_private: 'https://files.slack.com/receipt.png',
  url_private_download: 'https://files.slack.com/receipt.png?dl=1',
};

function GetFailurePost(ArgSlackApp) {
  const FailurePosts = ArgSlackApp.SentMessages.filter(msg => msg.text.includes('*Diagnostics:*'));
  if (FailurePosts.length > 0) return FailurePosts[FailurePosts.length - 1];
  return null;
}

describe('OCR failure diagnostics (GH-76 / GH-88 merge seam)', () => {
  let SlackApp;
  let ChatModuleInstance;

  beforeEach(() => {
    SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
    ChatModuleInstance = new ChatModule(SlackApp, {}, {}, null, null, null);
    MockProcessMultimodalMessageWithJsonResponseAsync = jest.fn().mockResolvedValue({
      title: 'Safety Inspection Findings',
      items: [{ item_number: 1, text: 'text', amount: null, notes: null }],
    });
  });

  test('vision_provider_not_configured produces specific sentence and baseline in thread', async () => {
    MockProcessMultimodalMessageWithJsonResponseAsync.mockRejectedValue(Object.assign(new Error('no config'), { code: 'vision_provider_not_configured' }));
    
    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_OCR',
      user: 'U_TEST',
      text: `${SlackApp.AppMentionString} scan image`,
      files: [PngAttachment],
      ts: '1234.5678',
    });

    const FailurePost = GetFailurePost(SlackApp);
    expect(FailurePost).toBeTruthy();
    expect(FailurePost.text).toContain("Image OCR needs a Gemini model, which isn't configured for this workspace.");
    expect(FailurePost.threadTs).toBe('1234.5678');
    expect(FailurePost.text).toContain('*Diagnostics:*');
  });

  test('transient error produces different sentence but still includes baseline in thread', async () => {
    MockProcessMultimodalMessageWithJsonResponseAsync.mockRejectedValue(new Error('Random transient error'));
    
    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_OCR',
      user: 'U_TEST',
      text: `${SlackApp.AppMentionString} scan image`,
      files: [PngAttachment],
      ts: '1234.5678',
    });

    const FailurePost = GetFailurePost(SlackApp);
    expect(FailurePost).toBeTruthy();
    expect(FailurePost.text).toContain('Image analysis failed — please try again later.');
    expect(FailurePost.threadTs).toBe('1234.5678');
    expect(FailurePost.text).toContain('*Diagnostics:*');
  });

  test('download-failure includes baseline in thread', async () => {
    SlackApp.DownloadFileBase64Async.mockRejectedValue(new Error('Network error'));
    
    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_OCR',
      user: 'U_TEST',
      text: `${SlackApp.AppMentionString} scan image`,
      files: [PngAttachment],
      ts: '2222.3333',
    });

    const FailurePost = GetFailurePost(SlackApp);
    expect(FailurePost).toBeTruthy();
    expect(FailurePost.text).toContain('Failed to download the image. Please try uploading it again.');
    expect(FailurePost.threadTs).toBe('2222.3333');
    expect(FailurePost.text).toContain('*Diagnostics:*');
  });

  test('empty-file includes baseline in thread', async () => {
    SlackApp.DownloadFileBase64Async.mockResolvedValue({ Base64: '' });
    
    await SlackApp.SimulateAppMentionAsync({
      channel: 'C_OCR',
      user: 'U_TEST',
      text: `${SlackApp.AppMentionString} scan image`,
      files: [PngAttachment],
      ts: '4444.5555',
    });

    const FailurePost = GetFailurePost(SlackApp);
    expect(FailurePost).toBeTruthy();
    expect(FailurePost.text).toContain('The image file appeared to be empty.');
    expect(FailurePost.threadTs).toBe('4444.5555');
    expect(FailurePost.text).toContain('*Diagnostics:*');
  });
});
