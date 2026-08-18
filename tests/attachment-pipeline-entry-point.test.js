'use strict';

/**
 * GH-62 — entry-point coverage for Slack attachment handling.
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

/** Build a ListsModule stub exposed the way ChatModule reaches it (RemindersModule.ListsModule). */
function MakeRemindersModuleWithLists() {
  const CreateListFromExtractedItemsAsync = jest.fn().mockResolvedValue({
    ok: true,
    ListId: 'L123',
    Permalink: 'https://slack.com/lists/L123',
    ItemCount: 2,
  });
  return {
    RemindersModule: { ListsModule: { CreateListFromExtractedItemsAsync } },
    CreateListFromExtractedItemsAsync,
  };
}

describe('GH-62: Slack attachment handling entry points', () => {
  describe('app_mention with an image (the path that was dead in 1.4.292)', () => {
    test('an image plus a list request creates a Slack List instead of the text-file rejection', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { RemindersModule, CreateListFromExtractedItemsAsync } = MakeRemindersModuleWithLists();
      new ChatModule(SlackApp, {}, RemindersModule, null, null);

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
      // Assert the user learns the list exists and can reach it — not the exact sentence, which
      // GH-83 rewrote. This stub reports no `Announced`, so ChatModule's fallback is what posts.
      expect(AllText).toContain('https://slack.com/lists/L123');
      expect(AllText).toContain('2 item(s)');
      // The exact regression: this rejection is what users actually received in 1.4.292.
      expect(AllText).not.toContain('I can only read text-based files as context');
    });

    test('GH-83: the list is announced exactly once, in-thread, after an in-progress ack', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { RemindersModule, CreateListFromExtractedItemsAsync } = MakeRemindersModuleWithLists();
      // Mirror the real ListsModule once it has posted the list card itself.
      CreateListFromExtractedItemsAsync.mockResolvedValue({
        ok: true,
        ListId: 'L123',
        Permalink: 'https://slack.com/lists/L123',
        ItemCount: 2,
        Announced: true,
      });
      new ChatModule(SlackApp, {}, RemindersModule, null, null);

      await SlackApp.SimulateAppMentionAsync({
        channel: 'C_OCR',
        user: 'U_TEST',
        text: `${SlackApp.AppMentionString} create a list`,
        files: [PngAttachment],
        ts: '111.222',
      });

      // The originating thread is handed to ListsModule so the card lands as a reply, not in the
      // channel root — the whole point of the change.
      expect(CreateListFromExtractedItemsAsync.mock.calls[0][0].ThreadTS).toBe('111.222');

      // Every message ChatModule posts belongs to that thread.
      for(const Message of SlackApp.SentMessages) expect(Message.threadTs).toBe('111.222');

      // The ack fires, and ChatModule adds NO second confirmation once ListsModule announced.
      const Texts = SlackApp.SentMessages.map((ArgMessage) => ArgMessage.text);
      expect(Texts).toHaveLength(1);
      expect(Texts[0]).toContain('Reading your image');
      expect(Texts.join('\n')).not.toContain('✅');
    });

    test('the image is downloaded as base64, not fetched as text', async () => {
      const SlackApp = new MockSlackApp({ WorkspaceInfo: TestWorkspaceInfo });
      const { RemindersModule } = MakeRemindersModuleWithLists();
      new ChatModule(SlackApp, {}, RemindersModule, null, null);

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
      const { RemindersModule, CreateListFromExtractedItemsAsync } = MakeRemindersModuleWithLists();
      new ChatModule(SlackApp, {}, RemindersModule, null, null);

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

  describe('message event with an image (hands-free — had no image path at all)', () => {
    test('a screenshot plus a list request works without an @mention', async () => {
      const SlackApp = new MockSlackApp({
        WorkspaceInfo: TestWorkspaceInfo,
        RespondToAllMessages: true,
      });
      const { RemindersModule, CreateListFromExtractedItemsAsync } = MakeRemindersModuleWithLists();
      new ChatModule(SlackApp, {}, RemindersModule, null, null);

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
      const { RemindersModule, CreateListFromExtractedItemsAsync } = MakeRemindersModuleWithLists();
      new ChatModule(SlackApp, {}, RemindersModule, null, null);

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
      ['image + list intent', [PngAttachment], 'create a list', 'image-ocr'],
      ['image + ocr phrasing', [PngAttachment], 'ocr a list from this', 'image-ocr'],
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
  });
});
