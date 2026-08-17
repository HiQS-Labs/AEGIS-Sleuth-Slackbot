'use strict';

// GH-58 test suite: Gemini Vision OCR + Slack List creation pipeline.
// Covers context-file-classifier (IsImageMediaFile, SelectImageAttachment),
// GeminiProvider ProcessMultimodalMessageWithJsonResponseAsync,
// WorkspaceAI.ProcessMultimodalMessageWithJsonResponseAsync dispatch,
// and ListsModule.CreateListFromExtractedItemsAsync.

const {
  IsImageMediaFile,
  SelectImageAttachment,
} = require('../src/context-file-classifier');

const GeminiProvider = require('../src/ai-providers/gemini-provider');

const WorkspaceAI = require('../src/workspace-ai');
const { GetAllProviderDescriptors } = require('../src/ai-providers');

describe('GH-58: Gemini Vision OCR and Slack List Creation Pipeline', () => {
  const WorkspaceInfo = { GEMINI_API_KEY: 'goog-test-key' };
  const OriginalFetch = global.fetch;

  /** @type {jest.Mock} */
  let FetchMock;

  function MakeStats() {
    return {
      OutgoingGptMessageCount: 0,
      OutgoingGptMessageLength: 0,
      IncomingGptMessageCount: 0,
      IncomingGptMessageLength: 0,
    };
  }

  function FakeResponse({ ok = true, status = 200, json = {}, text = '' } = {}) {
    return { ok, status, json: async () => json, text: async () => text };
  }

  beforeEach(() => {
    FetchMock = jest.fn();
    global.fetch = FetchMock;
  });

  afterEach(() => {
    global.fetch = OriginalFetch;
    jest.clearAllMocks();
  });

  // ── Context File Classifier ────────────────────────────────────────

  describe('context-file-classifier image helpers', () => {
    describe('IsImageMediaFile', () => {
      test('accepts supported image MIME types', () => {
        expect(IsImageMediaFile({ mimetype: 'image/png' })).toBe(true);
        expect(IsImageMediaFile({ mimetype: 'image/jpeg' })).toBe(true);
        expect(IsImageMediaFile({ mimetype: 'image/jpg' })).toBe(true);
        expect(IsImageMediaFile({ mimetype: 'image/webp' })).toBe(true);
        expect(IsImageMediaFile({ mimetype: 'image/gif' })).toBe(true);
      });

      test('rejects non-image mimetypes', () => {
        expect(IsImageMediaFile({ mimetype: 'application/pdf' })).toBe(false);
        expect(IsImageMediaFile({ mimetype: 'text/plain' })).toBe(false);
        expect(IsImageMediaFile({ mimetype: 'video/mp4' })).toBe(false);
      });

      test('handles null/undefined gracefully', () => {
        expect(IsImageMediaFile(null)).toBe(false);
        expect(IsImageMediaFile(undefined)).toBe(false);
        expect(IsImageMediaFile({})).toBe(false);
      });

      test('is case-insensitive', () => {
        expect(IsImageMediaFile({ mimetype: 'IMAGE/PNG' })).toBe(true);
        expect(IsImageMediaFile({ mimetype: 'image/JPEG' })).toBe(true);
      });
    });

    describe('SelectImageAttachment', () => {
      test('returns null for empty or undefined files array', () => {
        expect(SelectImageAttachment(null)).toBeNull();
        expect(SelectImageAttachment(undefined)).toBeNull();
        expect(SelectImageAttachment([])).toBeNull();
      });

      test('returns the first image attachment when one exists', () => {
        const Files = [
          { name: 'document.pdf', mimetype: 'application/pdf' },
          { name: 'photo.png', mimetype: 'image/png' },
          { name: 'note.txt', mimetype: 'text/plain' },
        ];
        const Result = SelectImageAttachment(Files);
        expect(Result).not.toBeNull();
        expect(Result.name).toBe('photo.png');
        expect(Result.mimetype).toBe('image/png');
      });

      test('returns the first matching image even if earlier items are present', () => {
        const Files = [
          { name: 'cover.jpg', mimetype: 'image/jpeg' },
          { name: 'slide.webp', mimetype: 'image/webp' },
        ];
        const Result = SelectImageAttachment(Files);
        expect(Result.name).toBe('cover.jpg');
      });

      test('returns null when no image attachments exist in the array', () => {
        const Files = [
          { name: 'report.pdf', mimetype: 'application/pdf' },
          { name: 'data.csv', mimetype: 'text/csv' },
        ];
        expect(SelectImageAttachment(Files)).toBeNull();
      });

      test('returns null when not an array', () => {
        expect(SelectImageAttachment('not-an-array')).toBeNull();
        expect(SelectImageAttachment(42)).toBeNull();
      });
    });
  });

  // ── GeminiProvider Multimodal ──────────────────────────────────────

  describe('GeminiProvider ProcessMultimodalMessageWithJsonResponseAsync', () => {
    test('posts inlineData alongside text and parses JSON response', async () => {
      const JsonPayload = { title: 'Compliance Violations', items: [{ item_number: 1, text: 'Missing PPE', amount: '$500', notes: null }] };
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(JsonPayload) }] } }] },
      }));

      const Stats = MakeStats();
      const Provider = new GeminiProvider(WorkspaceInfo, Stats);
      const Image = { Base64: 'iVBORw0KGgoAAAANSUhEUg==', Mimetype: 'image/png' };
      const Schema = { name: 'ocr_list_extraction', strict: true, schema: JsonPayload };

      const Result = await Provider.ProcessMultimodalMessageWithJsonResponseAsync(
        'Extract the list items from this image.',
        'You are an OCR assistant.',
        Schema,
        Image,
        'gemini-2.5-flash'
      );

      expect(Result).toEqual(JsonPayload);

      // Verify the request payload structure.
      const [Url, Init] = FetchMock.mock.calls[0];
      expect(Url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
      expect(Init.headers['x-goog-api-key']).toBe('goog-test-key');

      const Body = JSON.parse(Init.body);
      expect(Body.contents[0].parts.length).toBe(2);
      expect(Body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUg==' } });
      expect(Body.contents[0].parts[1]).toEqual({ text: 'Extract the list items from this image.' });
      expect(Body.generationConfig.responseMimeType).toBe('application/json');
    });

    test('sanitizes additionalProperties from schema before sending to Gemini', async () => {
      const JsonPayload = { ok: true };
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(JsonPayload) }] } }] },
      }));

      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());
      const Image = { Base64: 'base64data', Mimetype: 'image/jpeg' };
      const Envelope = {
        name: 'test',
        strict: true,
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
      };

      await Provider.ProcessMultimodalMessageWithJsonResponseAsync('q', 'sys', Envelope, Image, 'gemini-2.5-flash');

      const Body = JSON.parse(FetchMock.mock.calls[0][1].body);
      const Schema = Body.generationConfig.responseSchema;
      expect(Schema.additionalProperties).toBeUndefined();
      expect(Schema.type).toBe('object');
    });

    test('records token/character stats for multimodal calls', async () => {
      const PromptText = 'Extract list from this image';
      const SystemInstructions = 'Be accurate';
      const Base64Data = 'a'.repeat(1000);

      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"title":"t","items":[]}' }] } }] },
      }));

      const Stats = MakeStats();
      const Provider = new GeminiProvider(WorkspaceInfo, Stats);
      const Image = { Base64: Base64Data, Mimetype: 'image/png' };

      await Provider.ProcessMultimodalMessageWithJsonResponseAsync(PromptText, SystemInstructions, { schema: {} }, Image, 'gemini-2.5-flash');

      expect(Stats.OutgoingGptMessageCount).toBe(1);
      // Outgoing length includes prompt text + system instructions + base64 data length
      expect(Stats.OutgoingGptMessageLength).toBeGreaterThanOrEqual(PromptText.length + SystemInstructions.length + Base64Data.length);
      expect(Stats.IncomingGptMessageCount).toBe(1);
      expect(Stats.IncomingGptMessageLength).toBe('{"title":"t","items":[]}'.length);
    });

    test('throws when model stops for non-STOP reason', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '{}' }] } }] },
      }));

      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());
      const Image = { Base64: 'x', Mimetype: 'image/png' };

      await expect(
        Provider.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, Image, 'gemini-2.5-flash')
      ).rejects.toThrow('Model did not stop naturally: SAFETY');
    });

    test('throws when API returns non-OK status', async () => {
      FetchMock.mockResolvedValue(FakeResponse({ ok: false, status: 400, text: 'bad request detail' }));

      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());
      const Image = { Base64: 'x', Mimetype: 'image/png' };

      await expect(
        Provider.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, Image, 'gemini-2.5-flash')
      ).rejects.toThrow('Gemini API failed (400): bad request detail');
    });

    test('throws with a clear message when ArgImage is missing required fields', async () => {
      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());
      await expect(
        Provider.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, null, 'gemini-2.5-flash')
      ).rejects.toThrow('requires an ArgImage with Base64 and Mimetype');
      await expect(
        Provider.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, { Base64: '' }, 'gemini-2.5-flash')
      ).rejects.toThrow('requires an ArgImage with Base64 and Mimetype');
      await expect(
        Provider.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, { Mimetype: 'image/png' }, 'gemini-2.5-flash')
      ).rejects.toThrow('requires an ArgImage with Base64 and Mimetype');
    });

    test('throws when model returns invalid JSON', async () => {
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'this is not json' }] } }] },
      }));

      const Provider = new GeminiProvider(WorkspaceInfo, MakeStats());
      const Image = { Base64: 'x', Mimetype: 'image/png' };

      await expect(
        Provider.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, Image, 'gemini-2.5-flash')
      ).rejects.toThrow(/invalid JSON/i);
    });
  });

  // ── WorkspaceAI Multimodal Dispatch ────────────────────────────────

  describe('WorkspaceAI ProcessMultimodalMessageWithJsonResponseAsync', () => {
    test('resolves provider for gemini-* model and delegates correctly', async () => {
      const JsonPayload = { title: 'Test', items: [] };
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(JsonPayload) }] } }] },
      }));

      const WorkspaceInfoGemini = { ...WorkspaceInfo, WORKSPACE_NAME: 'test-gemini' };
      const Stats = MakeStats();
      const AIAgent = new WorkspaceAI(WorkspaceInfoGemini, Stats, 'gemini-2.5-flash');

      const Image = { Base64: 'imgdata', Mimetype: 'image/webp' };
      const Schema = { name: 'demo', strict: true, schema: {} };

      const Result = await AIAgent.ProcessMultimodalMessageWithJsonResponseAsync(
        'extract items',
        'OCR instructions',
        Schema,
        Image,
        'gemini-2.5-flash'
      );

      expect(Result).toEqual(JsonPayload);
      expect(FetchMock).toHaveBeenCalledTimes(1);
      expect(FetchMock.mock.calls[0][0]).toContain('gemini-2.5-flash:generateContent');
    });

    test('uses default model name when ArgModelName is omitted', async () => {
      const JsonPayload = { title: 'Default', items: [] };
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(JsonPayload) }] } }] },
      }));

      const WorkspaceInfoGemini = { ...WorkspaceInfo, WORKSPACE_NAME: 'test-default' };
      const Stats = MakeStats();
      // Default model is gemini-3.5-flash per BuiltInDefaultModelNamesByProvider
      const AIAgent = new WorkspaceAI(WorkspaceInfoGemini, Stats);

      const Image = { Base64: 'x', Mimetype: 'image/png' };
      await AIAgent.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, Image);

      expect(FetchMock).toHaveBeenCalledTimes(1);
      expect(FetchMock.mock.calls[0][0]).toContain('gemini-3.5-flash:generateContent');
    });

    test('throws descriptive error when provider does not implement ProcessMultimodalMessageWithJsonResponseAsync', async () => {
      // OpenAI provider does NOT implement ProcessMultimodalMessageWithJsonResponseAsync
      const WorkspaceInfoOpenAI = { OPENAI_API_KEY: 'sk-test-key', WORKSPACE_NAME: 'test-openai' };
      const Stats = MakeStats();
      const AIAgent = new WorkspaceAI(WorkspaceInfoOpenAI, Stats, 'gpt-4o-mini');

      const Image = { Base64: 'x', Mimetype: 'image/png' };
      await expect(
        AIAgent.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, Image, 'gpt-4o-mini')
      ).rejects.toThrow("Provider 'openai' does not implement ProcessMultimodalMessageWithJsonResponseAsync");
    });

    test('throws descriptive error when provider is not configured', async () => {
      const WorkspaceNoKey = { GEMINI_API_KEY: '', WORKSPACE_NAME: 'no-key' };
      const Stats = MakeStats();
      const AIAgent = new WorkspaceAI(WorkspaceNoKey, Stats, 'gemini-2.5-flash');

      await expect(
        AIAgent.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, { Base64: 'x', Mimetype: 'image/png' }, 'gemini-2.5-flash')
      ).rejects.toThrow(/API key is not configured/i);
    });

    test('passes through fetch errors from the provider', async () => {
      FetchMock.mockRejectedValue(new Error('network timeout'));

      const WorkspaceInfoGemini = { ...WorkspaceInfo, WORKSPACE_NAME: 'test-error' };
      const Stats = MakeStats();
      const AIAgent = new WorkspaceAI(WorkspaceInfoGemini, Stats, 'gemini-2.5-flash');

      await expect(
        AIAgent.ProcessMultimodalMessageWithJsonResponseAsync('q', 's', { schema: {} }, { Base64: 'x', Mimetype: 'image/png' }, 'gemini-2.5-flash')
      ).rejects.toThrow('network timeout');
    });
  });

  // ── ListsModule CreateListFromExtractedItemsAsync ──────────────────

  describe('ListsModule CreateListFromExtractedItemsAsync', () => {
    const ReminderSchemaColumns = [
      { key: 'summary', id: 'ColSummary' },
      { key: 'status', id: 'ColStatus' },
      { key: 'completed', id: 'ColCompleted' },
      { key: 'assignee', id: 'ColAssignee' },
      { key: 'due_date', id: 'ColDueDate' },
      { key: 'created_on', id: 'ColCreatedOn' },
      { key: 'source_channel', id: 'ColSourceChannel' },
      { key: 'original_message', id: 'ColOriginalMessage' },
      { key: 'requester', id: 'ColRequester' },
      { key: 'reminder_id', id: 'ColReminderId' },
    ];

    const OcrSchemaColumns = [
      { key: 'item_number', id: 'ColItemNumber', name: 'Item #' },
      { key: 'task', id: 'ColTask', name: 'Item / Task', isPrimaryColumn: true },
      { key: 'amount_fine', id: 'ColAmountFine', name: 'Amount / Fine' },
      { key: 'notes', id: 'ColNotes', name: 'Notes' },
      { key: 'status', id: 'ColStatus', name: 'Status', type: 'select' },
    ];

    const ListsModule = require('../src/lists-module');
    const origDelay = ListsModule.LIST_PROPAGATION_DELAY_MS;

    beforeAll(() => {
      ListsModule.LIST_PROPAGATION_DELAY_MS = 0;
    });

    afterAll(() => {
      ListsModule.LIST_PROPAGATION_DELAY_MS = origDelay;
    });

    const CreatedModules = [];

    afterEach(async () => {
      while(CreatedModules.length > 0) {
        const Mod = CreatedModules.pop();
        if(Mod) await Mod.StopAsync();
      }
    });

    /** Build a mock ListsModule harness using standard Slack client apiCall mock. */
    async function CreateListsHarnessAsync(ArgOptions = {}) {
      const Available = ArgOptions.Available !== false;
      const FailCreate = ArgOptions.FailCreate === true;
      const FailItemIndex = ArgOptions.FailItemIndex ?? -1;

      const ApiCalls = [];
      let ItemCallCount = 0;

      const ApiCallMock = jest.fn(async (ArgMethod, ArgParams) => {
        ApiCalls.push({ method: ArgMethod, params: ArgParams });

        if(ArgMethod === 'slackLists.items.list' && ArgParams?.list_id === 'F000000000') {
          if(!Available) {
            const ErrorObj = new Error('paid_teams_only');
            ErrorObj.data = { error: 'paid_teams_only' };
            throw ErrorObj;
          }
          const ErrorObj = new Error('list not found');
          ErrorObj.data = { error: 'list_not_found' };
          throw ErrorObj;
        }

        if(ArgMethod === 'slackLists.access.set') {
          if(!Available) throw new Error('not_allowed');
          return { ok: true };
        }

        if(ArgMethod === 'slackLists.create') {
          const isOcr = ArgParams?.schema?.some((c) => c.key === 'item_number' || c.key === 'task');
          if(isOcr) {
            if(FailCreate) throw new Error('Slack API rejected list creation');
            return {
              ok: true,
              list_id: 'FLIST123',
              list_metadata: { schema: OcrSchemaColumns },
            };
          }
          return {
            ok: true,
            list_id: 'F_SHARED_123',
            list_metadata: { schema: ReminderSchemaColumns },
          };
        }

        if(ArgMethod === 'slackLists.items.create') {
          const CurrentIndex = ItemCallCount++;
          if(CurrentIndex === FailItemIndex) {
            throw new Error('Row insertion failed');
          }
          return { ok: true, item: { id: `Rec${CurrentIndex + 1}` } };
        }

        if(ArgMethod === 'slackLists.items.list') {
          return { ok: true, items: [], response_metadata: { next_cursor: '' } };
        }

        return { ok: true };
      });

      const MockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      };

      const MockSlackApp = {
        WorkspaceInfo: {
          WORKSPACE_NAME: 'test-ocr-lists-workspace',
          LIVE_TOKEN: 'xoxb-test',
          REMINDER_CHANNEL_NAME: 'reminders',
          ADMIN_EMAIL: 'admin@example.com',
          MAIN_TIMEZONE: 'America/Los_Angeles',
        },
        Logger: MockLogger,
        BotUserID: 'U_BOT',
        client: {
          apiCall: ApiCallMock,
          auth: {
            test: jest.fn(async () => ({ ok: true, team_id: 'T123', url: 'https://test.slack.com/' })),
          },
          conversations: {
            info: jest.fn(async () => ({ ok: true, channel: { id: 'C123', name: 'reminders' } })),
          },
        },
        BoltApp: {
          client: {
            apiCall: ApiCallMock,
            auth: {
              test: jest.fn(async () => ({ ok: true, team_id: 'T123', url: 'https://test.slack.com/' })),
            },
            conversations: {
              info: jest.fn(async () => ({ ok: true, channel: { id: 'C123', name: 'reminders' } })),
            },
          },
        },
        GetChannelIdAsync: jest.fn().mockResolvedValue('C123'),
        PostMessageTextAsync: jest.fn().mockResolvedValue('ts123'),
      };

      const ListsModule = require('../src/lists-module');
      const ModuleInstance = new ListsModule(MockSlackApp);

      if(Available) {
        await ModuleInstance.StartAsync({ TotalMessages: 0 });
      }

      CreatedModules.push(ModuleInstance);

      return { ModuleInstance, MockSlackApp, MockLogger, ApiCallMock, ApiCalls };
    }

    test('returns error when Lists is not available', async () => {
      const { ModuleInstance } = await CreateListsHarnessAsync({ Available: false });
      const Result = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: 'Test List',
        Items: [{ item_number: 1, text: 'Item 1' }],
        ChannelID: 'C123',
        UserID: 'U123',
      });
      expect(Result.ok).toBe(false);
      expect(Result.error).toContain('not available');
    });

    test('validates required parameters', async () => {
      const { ModuleInstance } = await CreateListsHarnessAsync({ Available: true });

      // Missing ListTitle
      let R = await ModuleInstance.CreateListFromExtractedItemsAsync({
        Items: [], ChannelID: 'C123', UserID: 'U123',
      });
      expect(R.ok).toBe(false);
      expect(R.error).toContain('ListTitle is required');

      // Empty ListTitle
      R = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: '', Items: [], ChannelID: 'C123', UserID: 'U123',
      });
      expect(R.ok).toBe(false);
      expect(R.error).toContain('ListTitle is required');

      // Items not an array
      R = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: 'Test', Items: 'not-array', ChannelID: 'C123', UserID: 'U123',
      });
      expect(R.ok).toBe(false);
      expect(R.error).toContain('Items must be an array');

      // Missing ChannelID
      R = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: 'Test', Items: [], ChannelID: '', UserID: 'U123',
      });
      expect(R.ok).toBe(false);
      expect(R.error).toContain('ChannelID is required');

      // Missing UserID
      R = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: 'Test', Items: [], ChannelID: 'C123', UserID: '',
      });
      expect(R.ok).toBe(false);
      expect(R.error).toContain('UserID is required');

      // Null options
      R = await ModuleInstance.CreateListFromExtractedItemsAsync(null);
      expect(R.ok).toBe(false);
      expect(R.error).toContain('ListTitle is required');
    });

    test('creates list with OCR schema and populates rows for each item', async () => {
      const { ModuleInstance, ApiCalls } = await CreateListsHarnessAsync({ Available: true });

      const Items = [
        { item_number: 1, text: 'No Privacy Policy', amount: '$2,663', notes: 'Legal risk' },
        { item_number: 2, text: 'No user data notice', amount: '$7,988', notes: null },
        { item_number: 3, text: 'Storage bucket public', amount: '$750', notes: 'S3 security' },
      ];

      const Result = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: '10 Ways App Sued',
        Items,
        ChannelID: 'C123',
        UserID: 'U123',
      });

      expect(Result.ok).toBe(true);
      expect(Result.ListId).toBe('FLIST123');
      expect(Result.ItemCount).toBe(3);

      const CreateListCalls = ApiCalls.filter(c => c.method === 'slackLists.create');
      expect(CreateListCalls.length).toBe(1);
      expect(CreateListCalls[0].params.name).toBe('10 Ways App Sued');

      const CreateItemCalls = ApiCalls.filter(c => c.method === 'slackLists.items.create');
      expect(CreateItemCalls.length).toBe(3);
    });

    test('handles partial item insertion failures (some rows fail)', async () => {
      // Second row (index 1) fails.
      const { ModuleInstance } = await CreateListsHarnessAsync({ Available: true, FailItemIndex: 1 });

      const Items = [
        { text: 'A' },
        { text: 'B' },
        { text: 'C' },
      ];

      const Result = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: 'Partial List',
        Items,
        ChannelID: 'C123',
        UserID: 'U123',
      });

      expect(Result.ok).toBe(true);
      expect(Result.ItemCount).toBe(2);
    });

    test('catches schema creation errors and returns them', async () => {
      const { ModuleInstance } = await CreateListsHarnessAsync({ Available: true, FailCreate: true });

      const Result = await ModuleInstance.CreateListFromExtractedItemsAsync({
        ListTitle: 'Bad List',
        Items: [{ text: 'X' }],
        ChannelID: 'C123',
        UserID: 'U123',
      });

      expect(Result.ok).toBe(false);
      expect(Result.error).toContain('Slack API rejected list creation');
    });
  });

  // ── End-to-end integration flow (lightweight) ──────────────────────

  describe('integrated flow summary', () => {
    test('end-to-end: classifier detects image → provider runs multimodal → returns structured data', async () => {
      // Step 1: classifier picks the image.
      const Files = [
        { name: 'notice.pdf', mimetype: 'application/pdf' },
        { name: 'compliance-photo.png', mimetype: 'image/png' },
      ];
      const Image = SelectImageAttachment(Files);
      expect(Image).not.toBeNull();
      expect(Image.name).toBe('compliance-photo.png');

      // Step 2: GeminiVision OCR processes it.
      const ExpectedResult = {
        title: 'Safety Inspection Findings',
        items: [
          { item_number: 1, text: 'Missing guardrail on north side', amount: '$200', notes: 'high priority' },
          { item_number: 2, text: 'PPE violation logged', amount: null, notes: null },
        ],
      };
      FetchMock.mockResolvedValue(FakeResponse({
        json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(ExpectedResult) }] } }] },
      }));

      const WorkspaceInfoGemini = { ...WorkspaceInfo, WORKSPACE_NAME: 'e2e-test' };
      const Stats = MakeStats();
      const AIAgent = new WorkspaceAI(WorkspaceInfoGemini, Stats, 'gemini-2.5-flash');

      const Schema = { name: 'ocr_list_extraction', strict: true, schema: ExpectedResult };
      const OcrData = await AIAgent.ProcessMultimodalMessageWithJsonResponseAsync(
        'Extract violations from this photo',
        'OCR instructions',
        Schema,
        { Base64: 'photo-base64-data', Mimetype: 'image/png' },
        'gemini-2.5-flash'
      );

      expect(OcrData.title).toBe('Safety Inspection Findings');
      expect(OcrData.items.length).toBe(2);
      expect(OcrData.items[0].text).toBe('Missing guardrail on north side');
      expect(OcrData.items[1].notes).toBeNull();

      // Step 3: Verify stats were recorded.
      expect(Stats.OutgoingGptMessageCount).toBe(1);
      expect(Stats.IncomingGptMessageCount).toBe(1);
    });
  });
});
