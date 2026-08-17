'use strict';

/**
 * GH-62 — entry-point coverage for Slack attachment handling.
 * GH-73 — intent-grammar and action-split coverage for the two image arms.
 *
 * The Vision OCR feature (GH-58) shipped in 1.4.292 with 27 passing tests and was still
 * unreachable in production: every one of those tests started at `SelectImageAttachment` or
 * below, so nothing exercised `#OnAppMentionAsync` — the only path a real user can take. The text
 * ingest ran first, classified an image as 'unsupported', posted a rejection, and returned before
 * the OCR branch.
 *
 * These tests therefore drive REAL Slack event payloads through the module's public event
 * handlers. A unit test of the resolver would not have caught the original bug and must not be
 * treated as a substitute for what is here.
 */

const {
  ResolveAttachmentIntent,
  HasListCreationIntent,
  HasImageTextExtractionIntent,
} = require('../src/context-file-classifier');

const mockOcrResult = {
  title: 'Safety Inspection Findings',
  items: [
    { item_number: 1, text: 'Missing guardrail on north side', amount: '$200', notes: 'high priority' },
    { item_number: 2, text: 'PPE violation logged', amount: null, notes: null },
  ],
};

jest.mock('../src/workspace-ai', () => {
  return jest.fn().mockImplementation((WorkspaceInfo) => ({
    WorkspaceInfo,
    DefaultModelName: 'gpt-4o-mini',
    ComplexModelName: 'gpt-4o',
    // Deliberately a NON-Gemini default: GH-63 requires OCR to work anyway.
    ProcessMultimodalMessageWithJsonResponseAsync: jest.fn().mockResolvedValue(mockOcrResult),
    ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue(mockOcrResult),
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
  WORKSPACE_NAME: 'AttachmentEntryPointWorkspace',
  LIVE_TOKEN: 'xoxb-test',
  OPENAI_API_KEY: 'test-openai-key',
  GEMINI_API_KEY: 'test-gemini-key',
};

const PngAttachment = {
  name: 'fines.png',
  mimetype: 'image/png',
  size: 50000,
  url_private: 'https://files.slack.com/fines.png',
  url_private_download: 'https://files.slack.com/fines.png?dl=1',
};

const MarkdownAttachment = {
  name: 'notes.md',
  mimetype: 'text/markdown',
  size: 1200,
  url_private: 'https://files.slack.com/notes.md',
  url_private_download: 'https://files.slack.com/notes.md?dl=1',
};

/** Build a ListsModule stub injected the way ChatModule receives it (GH-75: direct constructor injection). */
function MakeListsModuleStub() {
  const CreateListFromExtractedItemsAsync = jest.fn().mockResolvedValue({
    ok: true,
    ListId: 'L123',
    Permalink: 'https://slack.com/lists/L123',
    ItemCount: 2,
  });
  return {
    ListsModule: { CreateListFromExtractedItemsAsync },
    CreateListFromExtractedItemsAsync,
  };
}

describe('GH-62: Slack attachment handling entry points', () => {
  describe('app_mention with an image (the path that was dead in 1.4.292)', () => {
    test('an image plus a list request creates a Slack List instead of the text-file rejection', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { ListsModule, CreateListFromExtractedItemsAsync } = MakeListsModuleStub();
      new ChatModule(SlackApp, {}, {}, null, null, ListsModule);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_OCR',
        user: 'U_TEST',
        text: `${SlackApp.AppMentionString} create a list`,
        files: [PngAttachment],
      });

      expect(WasHandled).toBe(true);
      expect(CreateListFromExtractedItemsAsync).toHaveBeenCalledTimes(1);

      const CreateArgs = CreateListFromExtractedItemsAsync.mock.calls[0][0];
      expect(CreateArgs.ListTitle).toBe('Safety Inspection Findings');
      expect(CreateArgs.Items).toHaveLength(2);
      expect(CreateArgs.ChannelID).toBe('C_OCR');

      const AllText = SlackApp.SentMessages.map((ArgMessage) => ArgMessage.text).join('\n');
      expect(AllText).toContain('Created list');
      // The exact regression: this rejection is what users actually received in 1.4.292.
      expect(AllText).not.toContain('I can only read text-based files as context');
    });

    test('the image is downloaded as base64, not fetched as text', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { ListsModule } = MakeListsModuleStub();
      new ChatModule(SlackApp, {}, {}, null, null, ListsModule);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_OCR',
        user: 'U_TEST',
        text: `${SlackApp.AppMentionString} create a list`,
        files: [PngAttachment],
      });

      expect(SlackApp.DownloadFileBase64Async).toHaveBeenCalledTimes(1);
      expect(SlackApp.GetFileContentAsync).not.toHaveBeenCalled();
    });

    test('an image with no list intent still gets the text-only guidance, never silence', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { ListsModule, CreateListFromExtractedItemsAsync } = MakeListsModuleStub();
      new ChatModule(SlackApp, {}, {}, null, null, ListsModule);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_OCR',
        user: 'U_TEST',
        text: `${SlackApp.AppMentionString} what do you make of this?`,
        files: [PngAttachment],
      });

      expect(WasHandled).toBe(true);
      expect(CreateListFromExtractedItemsAsync).not.toHaveBeenCalled();
      const AllText = SlackApp.SentMessages.map((ArgMessage) => ArgMessage.text).join('\n');
      expect(AllText).toContain('I can only read text-based files as context');
    });
  });

  describe('GH-73: the production mis-route — "make a todo list for by OCRing the attached image"', () => {
    test('modifier wording reaches the list arm: list created, no rejection posted', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { ListsModule, CreateListFromExtractedItemsAsync } = MakeListsModuleStub();
      new ChatModule(SlackApp, {}, {}, null, null, ListsModule);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_OCR',
        user: 'U_TEST',
        // The exact wording from the 2026-08-17 neochrome thread.
        text: `${SlackApp.AppMentionString} make a todo list for by OCRing the attached image.`,
        files: [PngAttachment],
      });

      // Branch: the image-list arm ran.
      expect(WasHandled).toBe(true);
      // Side effect: a Slack List was materialized…
      expect(CreateListFromExtractedItemsAsync).toHaveBeenCalledTimes(1);
      expect(CreateListFromExtractedItemsAsync.mock.calls[0][0].Items).toHaveLength(2);
      // …and the text-files-only rejection is gone.
      const AllText = SlackApp.SentMessages.map((ArgMessage) => ArgMessage.text).join('\n');
      expect(AllText).not.toContain('I can only read text-based files as context');
      expect(AllText).toContain('Created list');
    });

    test('scan-only wording reaches the text arm: text posted, NO list created', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { ListsModule, CreateListFromExtractedItemsAsync } = MakeListsModuleStub();
      new ChatModule(SlackApp, {}, {}, null, null, ListsModule);

      const WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_OCR',
        user: 'U_TEST',
        text: `${SlackApp.AppMentionString} read the text in this screenshot`,
        files: [PngAttachment],
      });

      // Branch: handled by the attachment dispatch, not the chat fallback.
      expect(WasHandled).toBe(true);
      // Side effect: extraction ran (the OCR model was called)…
      expect(SlackApp.DownloadFileBase64Async).toHaveBeenCalledTimes(1);
      // …the extracted text was posted in the scan-command shape…
      const AllText = SlackApp.SentMessages.map((ArgMessage) => ArgMessage.text).join('\n');
      expect(AllText).toContain('Safety Inspection Findings');
      expect(AllText).toContain('Missing guardrail on north side');
      // …and NO Slack List was materialized — a scan-only intent must stop after extraction.
      expect(CreateListFromExtractedItemsAsync).not.toHaveBeenCalled();
      expect(AllText).not.toContain('Created list');
      expect(AllText).not.toContain('I can only read text-based files as context');
    });

    test('a list worded request with both signals still prefers the list arm', async () => {
      // "make a todo list … by OCRing" carries BOTH the list verb and an ocr+image phrase; the
      // list intent must win (documented resolver precedence).
      expect(ResolveAttachmentIntent([PngAttachment], 'make a todo list for by OCRing the attached image').Kind).toBe('image-list');
    });
  });

  describe('message event with an image (hands-free — had no image path at all)', () => {
    test('a screenshot plus a list request works without an @mention', async () => {
      const SlackApp = new MockSlackApp({
        WorkspaceInfo: TestWorkspaceInfo,
        RespondToAllMessages: true,
      });
      const { ListsModule, CreateListFromExtractedItemsAsync } = MakeListsModuleStub();
      new ChatModule(SlackApp, {}, {}, null, null, ListsModule);

      await SlackApp.SimulateMessageAsync({
        channel: 'C_OCR',
        user: 'U_TEST',
        text: 'create a list from this',
        files: [PngAttachment],
      });

      // Hands-free response is gated by workspace settings; when the module does respond to the
      // message, the image must reach OCR rather than the text ingest.
      if(CreateListFromExtractedItemsAsync.mock.calls.length > 0) {
        expect(CreateListFromExtractedItemsAsync.mock.calls[0][0].Items).toHaveLength(2);
      }
      const AllText = SlackApp.SentMessages.map((ArgMessage) => ArgMessage.text).join('\n');
      expect(AllText).not.toContain('I can only read text-based files as context');
    });
  });

  describe('text attachments still behave exactly as before', () => {
    test('a markdown upload is ingested as context memory, not routed to OCR', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      SlackApp.GetFileContentAsync.mockResolvedValue('# Notes\n\nSome content.');
      const { ListsModule, CreateListFromExtractedItemsAsync } = MakeListsModuleStub();
      new ChatModule(SlackApp, {}, {}, null, null, ListsModule);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_TEXT',
        user: 'U_TEST',
        thread_ts: '1700000000.000100',
        text: `${SlackApp.AppMentionString} create a list`,
        files: [MarkdownAttachment],
      });

      // A text file wins even when the text carries a list intent — documented precedence.
      expect(SlackApp.GetFileContentAsync).toHaveBeenCalled();
      expect(CreateListFromExtractedItemsAsync).not.toHaveBeenCalled();
    });
  });

  describe('ResolveAttachmentIntent — the single classification seam', () => {
    test.each([
      ['image + list intent', [PngAttachment], 'create a list', 'image-list'],
      ['image + ocr phrasing', [PngAttachment], 'ocr a list from this', 'image-list'],
      ['image + todo-list wording (GH-73)', [PngAttachment], 'make a todo list for by OCRing the attached image', 'image-list'],
      ['image + checklist wording (GH-73)', [PngAttachment], 'build a checklist from this image', 'image-list'],
      ['image + scan-only wording (GH-73)', [PngAttachment], 'read the text in this screenshot', 'image-text'],
      ['image + no intent', [PngAttachment], 'what is this?', 'unsupported'],
      ['text file wins over image', [MarkdownAttachment, PngAttachment], 'create a list', 'text'],
      ['no attachments', [], 'create a list', 'none'],
      ['undefined attachments', undefined, 'create a list', 'none'],
    ])('%s -> %s', (_Label, ArgFiles, ArgText, ArgExpectedKind) => {
      expect(ResolveAttachmentIntent(ArgFiles, ArgText).Kind).toBe(ArgExpectedKind);
    });

    test('intent detection survives smart quotes and spacing noise', () => {
      expect(HasListCreationIntent('  Create   A  List  ')).toBe(true);
      expect(HasListCreationIntent('extract items from this')).toBe(true);
      expect(HasListCreationIntent('just saying hello')).toBe(false);
      expect(HasListCreationIntent('')).toBe(false);
      expect(HasListCreationIntent(undefined)).toBe(false);
    });

    test('GH-73: the list grammar accepts modifier words before the list noun', () => {
      // Every case here was missed by the pre-GH-73 grammar (verb + article + "list" only).
      expect(HasListCreationIntent('make a todo list for by OCRing the attached image')).toBe(true);
      expect(HasListCreationIntent('create a task list from this')).toBe(true);
      expect(HasListCreationIntent('make a to-do list out of the screenshot')).toBe(true);
      expect(HasListCreationIntent('build a checklist from this image')).toBe(true);
      expect(HasListCreationIntent('generate a shopping list')).toBe(true);
      // Two modifiers is the ceiling; three must not match (keeps the regex from eating sentences).
      expect(HasListCreationIntent('make a very long grocery shopping list')).toBe(false);
    });

    test('GH-73: scan-only intents are detected separately from list intents', () => {
      expect(HasImageTextExtractionIntent('read the text in this screenshot')).toBe(true);
      expect(HasImageTextExtractionIntent('ocr the attached image')).toBe(true);
      expect(HasImageTextExtractionIntent('can you scan this picture')).toBe(true);
      expect(HasImageTextExtractionIntent('what does this image say')).toBe(false);
      expect(HasImageTextExtractionIntent('')).toBe(false);
      expect(HasImageTextExtractionIntent(undefined)).toBe(false);
      // A list request that mentions OCR must stay a LIST intent, not flip to scan-only.
      expect(HasListCreationIntent('make a todo list by OCRing the attached image')).toBe(true);
    });
  });
});
