'use strict';

const fs = require('fs').promises;
const path = require('path');
const ListsModule = require('../src/lists-module');
const workspaces = require('../src/workspaces');

describe('ListsModule Slack Lists contract', () => {
  jest.setTimeout(20000);

  const WorkspaceName = 'ListsModuleContractWorkspace';
  const CacheFilePath = path.join(workspaces.GetDirPath(), 'lists', `${WorkspaceName}_lists_cache.json`);

  /**
   * Create a reminder-shaped test record.
   * @returns {import('../src/reminders-module').ReminderInfo}
   */
  function MakeReminder() {
    return {
      ReminderID: 'R123',
      CreatedOn: new Date('2026-05-13T16:00:00.000Z'),
      ShouldPostOn: new Date('2026-05-14T17:00:00.000Z'),
      OriginalChannelID: 'C_REMINDERS',
      OriginalChannelName: 'reminders',
      OriginalMessageID: '1747152000.000100',
      OriginalSenderID: 'U_REQUESTER',
      ReminderMessageText: '<@U_REQUESTER> - please follow up by Friday',
      AssigneeID: 'U_ASSIGNEE',
      State: 'scheduled'
    };
  }

  /**
   * Create a reminder with explicit mrkdwn mentions in the extracted task text.
   * @returns {import('../src/reminders-module').ReminderInfo}
   */
  function MakeMentionReminder() {
    return {
      ...MakeReminder(),
      ReminderID: 'R124',
      ReminderMessageText: '<@U_REQUESTER> - please follow up on this:\n\nKey task(s):\n• <@U_TARGET> can you review <https://example.com/spec|Product Schema>'
    };
  }

  /**
   * Build a live-looking Lists module with mocked Slack API methods.
   * @param {{SeedCache?: boolean, UseFakeTimers?: boolean, FailAccessSet?: boolean, FailUserWriteAccessSet?: boolean, FailChannelReadAccessSet?: boolean, CacheData?: any, InitialListStoreRows?: Record<string, any[]>}} [ArgOptions]
   * @returns {Promise<{Lists: ListsModule, ApiCallMock: jest.Mock}>}
   */
  const SchemaColumns = [
    { key: 'summary', id: 'ColSummary' },
    { key: 'status', id: 'ColStatus' },
    { key: 'completed', id: 'ColCompleted' },
    { key: 'assignee', id: 'ColAssignee' },
    { key: 'due_date', id: 'ColDueDate' },
    { key: 'created_on', id: 'ColCreatedOn' },
    { key: 'source_channel', id: 'ColSourceChannel' },
    { key: 'original_message', id: 'ColOriginalMessage' },
    { key: 'requester', id: 'ColRequester' },
    { key: 'reminder_id', id: 'ColReminderId' }
  ];

  /** @returns {Object<string, string>} schema map keyed field key -> column id. */
  function MakeSchemaMap() {
    /** @type {Object<string, string>} */
    const Map = {};
    for(const Column of SchemaColumns) {
      Map[Column.key] = Column.id;
    }
    return Map;
  }

  async function CreateHarnessAsync(ArgOptions = {}) {
    const SeedCache = ArgOptions.SeedCache === true;
    const UseFakeTimers = ArgOptions.UseFakeTimers === true;
    const FailAccessSet = ArgOptions.FailAccessSet === true;
    const FailUserWriteAccessSet = ArgOptions.FailUserWriteAccessSet === true;
    const FailChannelReadAccessSet = ArgOptions.FailChannelReadAccessSet === true;
    const CacheData = ArgOptions.CacheData;
    const InitialListStoreRows = ArgOptions.InitialListStoreRows || null;

    // in-memory model of Slack's list state, so multi-list create/poll/diff tests are meaningful.
    /** @type {Map<string, {items: Map<string, any>}>} */
    const ListStore = new Map();
    // when the cache is seeded, the shared list (F_LIST_123) already "exists" without a create
    // call, so offset the counter — the next create is the first per-user list.
    let CreateCount = SeedCache ? 1 : 0;
    let RowCounter = 0;

    const ApiCallMock = jest.fn(async (ArgMethod, ArgParams) => {
      if(ArgMethod === 'slackLists.items.list' && ArgParams?.list_id === 'F000000000') {
        const Error = new Error('list not found');
        Error.data = { error: 'list_not_found' };
        throw Error;
      }

      if(ArgMethod === 'slackLists.create') {
        CreateCount += 1;
        // first create is the shared list (legacy id); later creates are per-user lists.
        const ListId = CreateCount === 1 ? 'F_LIST_123' : `F_USER_${CreateCount - 1}`;
        if(!ListStore.has(ListId)) {
          ListStore.set(ListId, { items: new Map() });
        }
        return {
          ok: true,
          list_id: ListId,
          list_metadata: { schema: SchemaColumns }
        };
      }

      if(ArgMethod === 'slackLists.access.set') {
        if(
          FailAccessSet ||
          (FailUserWriteAccessSet && Array.isArray(ArgParams?.user_ids)) ||
          (FailChannelReadAccessSet && Array.isArray(ArgParams?.channel_ids))
        ) {
          throw new Error('channel access denied');
        }
        return { ok: true };
      }

      if(ArgMethod === 'slackLists.items.list') {
        const Store = ListStore.get(ArgParams?.list_id);
        const Items = Store ? Array.from(Store.items.values()) : [];
        return { ok: true, items: Items, response_metadata: { next_cursor: '' } };
      }

      if(ArgMethod === 'slackLists.items.create') {
        RowCounter += 1;
        const RowId = RowCounter === 1 ? 'Rec123' : `Rec${RowCounter}`;
        const Row = {
          id: RowId,
          list_id: ArgParams.list_id,
          fields: ArgParams.initial_fields || [],
          updated_timestamp: '1747152000'
        };
        const Store = ListStore.get(ArgParams.list_id);
        if(Store) {
          Store.items.set(RowId, Row);
        }
        return { ok: true, item: Row };
      }

      if(ArgMethod === 'slackLists.items.info') {
        const Store = ListStore.get(ArgParams?.list_id);
        const Row = Store ? Store.items.get(ArgParams?.id) : null;
        return {
          ok: true,
          record: Row || {
            id: ArgParams?.id || 'Rec123',
            list_id: ArgParams?.list_id || 'F_LIST_123',
            fields: [],
            updated_timestamp: '1747152000'
          }
        };
      }

      if(ArgMethod === 'slackLists.items.update') {
        return { ok: true };
      }

      if(ArgMethod === 'slackLists.items.delete') {
        const Store = ListStore.get(ArgParams?.list_id);
        if(Store) {
          Store.items.delete(ArgParams?.id);
        }
        return { ok: true };
      }

      throw new Error(`Unexpected Slack API method in test: ${ArgMethod}`);
    });

    const Logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    const SlackApp = {
      WorkspaceInfo: {
        WORKSPACE_NAME: WorkspaceName,
        ADMIN_EMAIL: 'admin@example.com',
        LIVE_TOKEN: 'xoxb-test',
        LIVE_SIGNING_SECRET: 'secret',
        LIVE_APP_TOKEN: 'xapp-test',
        OPENAI_API_KEY: 'sk-test',
        REMINDER_CHANNEL_NAME: 'reminders',
        MAIN_TIMEZONE: 'America/Los_Angeles'
      },
      Logger,
      BotUserID: 'U_BOT',
      client: {
        apiCall: ApiCallMock,
        auth: {
          test: jest.fn(async () => ({
            ok: true,
            team_id: 'T123',
            url: 'https://mock.slack.test/'
          }))
        },
        conversations: {
          info: jest.fn(async () => ({
            ok: true,
            channel: {
              id: 'C_REMINDERS',
              name: 'reminders'
            }
          }))
        }
      },
      async GetChannelIdAsync(ArgChannelName) {
        return ArgChannelName === 'reminders' ? 'C_REMINDERS' : null;
      },
      async GetUserIdentityAsync(ArgUserID) {
        if(ArgUserID === 'U_ASSIGNEE') {
          return {
            UserID: 'U_ASSIGNEE',
            Mention: '<@U_ASSIGNEE>',
            DisplayName: 'Assignee Person',
            RealName: 'Assignee Person',
            Username: 'assignee.person',
            Email: null,
            IsBot: false,
            IsDeleted: false,
            IsAdmin: false,
            IsOwner: false,
            IsPrimaryOwner: false,
            LastFetchedAt: new Date('2026-05-13T00:00:00.000Z').toISOString(),
          };
        }
        return null;
      },
      async GetChannelNameAsync(ArgChannelID) {
        return ArgChannelID === 'C_REMINDERS' ? 'reminders' : null;
      },
      async GetPermaLinkAsync(ArgChannelID, ArgMessageTS) {
        return `https://mock.slack.test/${ArgChannelID}/${ArgMessageTS}`;
      },
      async PostMessageTextAsync() {
        return '1747152000.000200';
      }
    };
    SlackApp.BoltApp = {
      client: SlackApp.client
    };

    const Lists = new ListsModule(SlackApp, 'test');
    Lists.IsListsAvailableAsync = jest.fn(async () => true);
    const RemindersModule = ArgOptions.RemindersModule || { GetAllReminders: () => [] };
    Lists.SetRemindersModule(RemindersModule);

    if(CacheData || SeedCache) {
      await fs.mkdir(path.dirname(CacheFilePath), { recursive: true });
      await fs.writeFile(CacheFilePath, JSON.stringify(CacheData || {
        listId: 'F_LIST_123',
        itemCache: {},
        listSchema: MakeSchemaMap()
      }, null, 2));
    }

    if(InitialListStoreRows) {
      for(const [ListId, Rows] of Object.entries(InitialListStoreRows)) {
        const ItemsMap = new Map();
        for(const Row of Rows) {
          ItemsMap.set(Row.id, Row);
        }
        ListStore.set(ListId, { items: ItemsMap });
      }
    }

    if(SeedCache && !ListStore.has('F_LIST_123')) {
      // make the seeded shared list "exist" in the mocked Slack state.
      ListStore.set('F_LIST_123', { items: new Map() });
    }

    const StartPromise = Lists.StartAsync({
      OutgoingMessageCount: 0,
      OutgoingMessageLength: 0
    });

    if(UseFakeTimers) {
      await jest.advanceTimersByTimeAsync(5000);
    }

    await StartPromise;

    return { Lists, ApiCallMock, ListStore, RemindersModule };
  }

  /**
   * Build a fake RemindersModule that records the inbound sync calls the Lists module makes.
   * @param {any[]} [ArgReminders]
   * @returns {{GetAllReminders: () => any[], CompleteReminderFromListAsync: jest.Mock, CancelReminderFromListAsync: jest.Mock, UpdateReminderSummaryFromListAsync: jest.Mock, CreateReminderFromListRowAsync: jest.Mock}}
   */
  function MakeFakeRemindersModule(ArgReminders = []) {
    return {
      GetAllReminders: () => ArgReminders,
      CompleteReminderFromListAsync: jest.fn().mockResolvedValue(true),
      CancelReminderFromListAsync: jest.fn().mockResolvedValue(true),
      UpdateReminderSummaryFromListAsync: jest.fn().mockResolvedValue(true),
      CreateReminderFromListRowAsync: jest.fn(async (ArgRowData) => ({
        ok: true,
        reminder: {
          ReminderID: 'R_FROM_ROW',
          CreatedOn: new Date('2026-05-14T00:00:00.000Z'),
          ShouldPostOn: new Date(ArgRowData.dueDate),
          TargetChannelID: ArgRowData.targetChannelID,
          OriginalChannelID: ArgRowData.targetChannelID,
          OriginalChannelName: null,
          OriginalMessageID: '',
          OriginalSenderID: ArgRowData.originalSenderID,
          ReminderMessageText: ArgRowData.summary,
          AssigneeID: ArgRowData.assigneeID,
          State: 'scheduled'
        }
      }))
    };
  }

  /**
   * Build a rich_text list-row field in the shape the Slack Lists API returns.
   * @param {string} ArgColumnId Column ID.
   * @param {string} ArgText Plain text content.
   * @returns {object}
   */
  function MakeRichTextField(ArgColumnId, ArgText) {
    return {
      column_id: ArgColumnId,
      rich_text: [{
        type: 'rich_text',
        elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: ArgText }] }]
      }]
    };
  }

  /** Polling interval the Lists module uses (private #PollingFrequency); advance fake timers by this to trigger one poll. */
  const PollIntervalMs = 300000;

  beforeEach(async () => {
    jest.useRealTimers();
    await fs.rm(CacheFilePath, { force: true });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await fs.rm(CacheFilePath, { force: true });
  });

  it('creates lists with the documented create + access flow', async () => {
    const { Lists, ApiCallMock } = await CreateHarnessAsync();
    const CalledMethods = ApiCallMock.mock.calls.map(([ArgMethod]) => ArgMethod);

    expect(Lists.IsListsAvailable).toBe(true);
    expect(CalledMethods).toContain('slackLists.create');
    const CreateCall = ApiCallMock.mock.calls.find(([ArgMethod]) => ArgMethod === 'slackLists.create');
    expect(CreateCall[1]).not.toHaveProperty('channel_id');
    expect(CreateCall[1].schema.map((ArgColumn) => ArgColumn.key)).toEqual(expect.arrayContaining([
      'summary',
      'status',
      'completed'
    ]));

    const AccessCall = ApiCallMock.mock.calls.find(([ArgMethod]) => ArgMethod === 'slackLists.access.set');
    expect(AccessCall).toEqual([
      'slackLists.access.set',
      {
        list_id: 'F_LIST_123',
        access_level: 'read',
        channel_ids: ['C_REMINDERS']
      }
    ]);

    expect(ApiCallMock.mock.calls.some(([ArgMethod]) => ArgMethod === 'files.share')).toBe(false);
    expect(ApiCallMock.mock.calls.some(([ArgMethod]) => ArgMethod === 'files.sharedPublicURL')).toBe(false);

    await Lists.StopAsync();
  });

  it('updates and deletes rows using documented row and id payloads', async () => {
    const { Lists, ApiCallMock } = await CreateHarnessAsync({ SeedCache: true });
    expect(Lists.IsListsAvailable).toBe(true);

    const AddResult = await Lists.AddReminderToListAsync(MakeReminder());
    expect(AddResult).toBe(true);

    const CompleteResult = await Lists.MarkReminderCompletedAsync('R123');
    expect(CompleteResult).toBe(true);

    const UpdateCall = ApiCallMock.mock.calls.find(([ArgMethod]) => ArgMethod === 'slackLists.items.update');
    expect(UpdateCall[1]).toEqual({
      list_id: 'F_LIST_123',
      cells: expect.arrayContaining([
        {
          row_id: 'Rec123',
          column_id: 'ColStatus',
          select: ['completed']
        },
        {
          row_id: 'Rec123',
          column_id: 'ColCompleted',
          checkbox: true
        }
      ])
    });
    expect(UpdateCall[1]).not.toHaveProperty('item_id');
    expect(UpdateCall[1]).not.toHaveProperty('item');

    const DeleteResult = await Lists.DeleteReminderFromListAsync('R123');
    expect(DeleteResult).toBe(true);

    const DeleteCall = ApiCallMock.mock.calls.find(([ArgMethod]) => ArgMethod === 'slackLists.items.delete');
    expect(DeleteCall[1]).toEqual({
      list_id: 'F_LIST_123',
      id: 'Rec123'
    });
    expect(DeleteCall[1]).not.toHaveProperty('item_id');

    await Lists.StopAsync();
  });

  it('stores task summaries as rich_text with structured user mentions', async () => {
    const { Lists, ApiCallMock } = await CreateHarnessAsync({ SeedCache: true });

    const AddResult = await Lists.AddReminderToListAsync(MakeMentionReminder());
    expect(AddResult).toBe(true);

    const CreateCall = ApiCallMock.mock.calls.find(([ArgMethod]) => ArgMethod === 'slackLists.items.create');
    const SummaryField = CreateCall[1].initial_fields.find((ArgField) => ArgField.column_id === 'ColSummary');

    expect(SummaryField).toBeDefined();
    expect(SummaryField.rich_text).toEqual([
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'user', user_id: 'U_TARGET' },
              { type: 'text', text: ' can you review ' },
              { type: 'link', url: 'https://example.com/spec', text: 'Product Schema' }
            ]
          }
        ]
      }
    ]);

    await Lists.StopAsync();
  });

  it('migrates a legacy flat cache to the versioned v2 shape on first save', async () => {
    // SeedCache writes the legacy flat shape; StartAsync loads it as the shared context.
    const { Lists } = await CreateHarnessAsync({ SeedCache: true });
    expect(Lists.ListId).toBe('F_LIST_123');

    await Lists.StopAsync();

    const CacheFile = JSON.parse(await fs.readFile(CacheFilePath, 'utf8'));
    expect(CacheFile.version).toBe(2);
    expect(CacheFile.shared.listId).toBe('F_LIST_123');
    expect(CacheFile.userLists).toEqual({});
  });

  it('EnsureUserListAsync creates and registers a durable per-user list with no date in the title', async () => {
    jest.useFakeTimers();
    const { Lists, ApiCallMock } = await CreateHarnessAsync({ SeedCache: true, UseFakeTimers: true });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    const Result = await EnsurePromise;

    expect(Result.ok).toBe(true);
    expect(Result.created).toBe(true);
    expect(Result.listId).toBe('F_USER_1');
    expect(Result.listName).toBe('Sleuth Reminders — @assignee.person');
    expect(Result.syncedItemCount).toBe(1);

    // the per-user list create used a dateless durable title.
    const UserCreateCall = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.create' && ArgPayload.name.startsWith('Sleuth Reminders')
    );
    expect(UserCreateCall[1].name).toBe('Sleuth Reminders — @assignee.person');

    // the assignee was granted write access, and the channel got read access for discovery.
    const UserAccessCall = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.access.set' &&
        ArgPayload.list_id === 'F_USER_1' &&
        Array.isArray(ArgPayload.user_ids)
    );
    expect(UserAccessCall[1]).toEqual({
      list_id: 'F_USER_1',
      access_level: 'write',
      user_ids: ['U_ASSIGNEE']
    });

    const ChannelAccessCall = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.access.set' &&
        ArgPayload.list_id === 'F_USER_1' &&
        Array.isArray(ArgPayload.channel_ids)
    );
    expect(ChannelAccessCall[1]).toEqual({
      list_id: 'F_USER_1',
      access_level: 'read',
      channel_ids: ['C_GENERATION']
    });

    // the registry is persisted under the user ID in the v2 cache.
    await Lists.StopAsync();
    const CacheFile = JSON.parse(await fs.readFile(CacheFilePath, 'utf8'));
    expect(CacheFile.version).toBe(2);
    expect(CacheFile.userLists.U_ASSIGNEE.listId).toBe('F_USER_1');
    expect(CacheFile.userLists.U_ASSIGNEE.ownerUserID).toBe('U_ASSIGNEE');
    expect(Object.values(CacheFile.userLists.U_ASSIGNEE.itemCache)).toEqual(['Rec123']);
  });

  it('EnsureUserListAsync resyncs an existing registered list instead of creating a new one', async () => {
    jest.useFakeTimers();
    const { Lists, ApiCallMock } = await CreateHarnessAsync({ SeedCache: true, UseFakeTimers: true });

    const FirstPromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await FirstPromise;

    ApiCallMock.mockClear();

    // second call for the same user should resync, not create.
    const SecondResult = await Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');

    expect(SecondResult.ok).toBe(true);
    expect(SecondResult.created).toBe(false);
    expect(SecondResult.listId).toBe('F_USER_1');
    // the reminder already has a row, so the resync adds nothing new.
    expect(SecondResult.syncedItemCount).toBe(0);

    // resync does not recreate the list, but it does re-assert the expected access grants so
    // old view-only lists are repaired in place.
    const CreateCalls = ApiCallMock.mock.calls.filter(([ArgMethod]) => ArgMethod === 'slackLists.create');
    expect(CreateCalls).toHaveLength(0);

    const ResyncUserAccessCall = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.access.set' &&
        ArgPayload.list_id === 'F_USER_1' &&
        Array.isArray(ArgPayload.user_ids)
    );
    expect(ResyncUserAccessCall[1]).toEqual({
      list_id: 'F_USER_1',
      access_level: 'write',
      user_ids: ['U_ASSIGNEE']
    });

    const ResyncChannelAccessCall = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.access.set' &&
        ArgPayload.list_id === 'F_USER_1' &&
        Array.isArray(ArgPayload.channel_ids)
    );
    expect(ResyncChannelAccessCall[1]).toEqual({
      list_id: 'F_USER_1',
      access_level: 'read',
      channel_ids: ['C_GENERATION']
    });

    await Lists.StopAsync();
  });

  it('EnsureUserListAsync fails when Slack rejects write access for the target user', async () => {
    const { Lists } = await CreateHarnessAsync({ SeedCache: true, FailUserWriteAccessSet: true });

    const Result = await Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');

    expect(Result).toEqual({
      ok: false,
      error: 'Slack rejected write access for the target user.'
    });

    await Lists.StopAsync();
  });

  it('EnsureUserListAsync still succeeds when channel read access fails after user write access is granted', async () => {
    jest.useFakeTimers();
    const { Lists } = await CreateHarnessAsync({
      SeedCache: true,
      UseFakeTimers: true,
      FailChannelReadAccessSet: true
    });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    const Result = await EnsurePromise;

    expect(Result.ok).toBe(true);
    expect(Result.created).toBe(true);
    expect(Result.listId).toBe('F_USER_1');

    await Lists.StopAsync();
  });

  it('HandleReminderCompletedAsync deletes the shared row but keeps the per-user row as history', async () => {
    jest.useFakeTimers();
    const { Lists, ApiCallMock } = await CreateHarnessAsync({ SeedCache: true, UseFakeTimers: true });

    // register a per-user list, then add the reminder so it lands on both the shared and per-user lists.
    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;
    await Lists.AddReminderToListAsync(MakeReminder());

    ApiCallMock.mockClear();
    await Lists.HandleReminderCompletedAsync('R123');

    const UpdateListIds = ApiCallMock.mock.calls
      .filter(([ArgMethod]) => ArgMethod === 'slackLists.items.update')
      .map(([, ArgPayload]) => ArgPayload.list_id)
      .sort();
    const DeleteCalls = ApiCallMock.mock.calls.filter(([ArgMethod]) => ArgMethod === 'slackLists.items.delete');

    // both lists got a completion update.
    expect(UpdateListIds).toEqual(['F_LIST_123', 'F_USER_1']);
    // only the shared list's row was deleted; the per-user row stays as a history record.
    expect(DeleteCalls).toHaveLength(1);
    expect(DeleteCalls[0][1].list_id).toBe('F_LIST_123');

    await Lists.StopAsync();
  });

  it('inbound completion: a checked per-user row completes the reminder, and the creation echo is suppressed', async () => {
    jest.useFakeTimers();
    const Reminders = MakeFakeRemindersModule();
    const { Lists, ListStore } = await CreateHarnessAsync({
      SeedCache: true, UseFakeTimers: true, RemindersModule: Reminders
    });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;

    // poll #1: the freshly-created row is echo-suppressed, so no inbound handler fires.
    await jest.advanceTimersByTimeAsync(PollIntervalMs);
    expect(Reminders.CompleteReminderFromListAsync).not.toHaveBeenCalled();

    // simulate the user checking the "completed" box on the row in Slack.
    const UserList = ListStore.get('F_USER_1');
    const CompletedRow = JSON.parse(JSON.stringify(UserList.items.get('Rec123')));
    for(const Field of CompletedRow.fields) {
      if(Field.column_id === 'ColCompleted') {
        Field.checkbox = true;
      }
    }
    CompletedRow.updated_timestamp = '1747159999';
    UserList.items.set('Rec123', CompletedRow);

    // poll #2: the completion edge is detected and synced back to the reminder.
    await jest.advanceTimersByTimeAsync(PollIntervalMs);
    expect(Reminders.CompleteReminderFromListAsync).toHaveBeenCalledWith('R123', 'list-checkbox');
    expect(Reminders.CompleteReminderFromListAsync).toHaveBeenCalledTimes(1);

    await Lists.StopAsync();
  });

  it('inbound delete: removing a managed per-user row cancels the reminder', async () => {
    jest.useFakeTimers();
    const Reminders = MakeFakeRemindersModule();
    const { Lists, ListStore } = await CreateHarnessAsync({
      SeedCache: true, UseFakeTimers: true, RemindersModule: Reminders
    });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;

    // poll #1: clears the creation echo and seeds the change-detection baseline.
    await jest.advanceTimersByTimeAsync(PollIntervalMs);

    // simulate the user deleting the row in Slack.
    ListStore.get('F_USER_1').items.delete('Rec123');

    // poll #2: the deletion is detected and the reminder is cancelled.
    await jest.advanceTimersByTimeAsync(PollIntervalMs);
    expect(Reminders.CancelReminderFromListAsync).toHaveBeenCalledWith('R123', 'list-row-deleted');

    await Lists.StopAsync();
  });

  it('inbound summary edit: a per-user row title change updates Sleuth and mirrors to the shared list', async () => {
    jest.useFakeTimers();
    const Reminders = MakeFakeRemindersModule();
    const { Lists, ApiCallMock, ListStore } = await CreateHarnessAsync({
      SeedCache: true, UseFakeTimers: true, RemindersModule: Reminders
    });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;
    await Lists.AddReminderToListAsync(MakeReminder());

    // poll #1: clears the creation echo and seeds the baseline.
    await jest.advanceTimersByTimeAsync(PollIntervalMs);

    const UserList = ListStore.get('F_USER_1');
    const EditedRow = JSON.parse(JSON.stringify(UserList.items.get('Rec123')));
    for(const Field of EditedRow.fields) {
      if(Field.column_id === 'ColSummary') {
        Field.rich_text = [MakeRichTextField('ColSummary', '<@U_REQUESTER> join call tomorrow at 3 PM test manual edit').rich_text[0]];
      }
    }
    EditedRow.updated_timestamp = '1747159998';
    UserList.items.set('Rec123', EditedRow);

    ApiCallMock.mockClear();
    await jest.advanceTimersByTimeAsync(PollIntervalMs);

    expect(Reminders.UpdateReminderSummaryFromListAsync).toHaveBeenCalledWith(
      'R123',
      '<@U_REQUESTER> join call tomorrow at 3 PM test manual edit',
      'list-summary-edited'
    );
    expect(Reminders.UpdateReminderSummaryFromListAsync).toHaveBeenCalledTimes(1);

    const SharedUpdateCall = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.items.update' && ArgPayload.list_id === 'F_LIST_123'
    );
    expect(SharedUpdateCall).toBeDefined();
    expect(SharedUpdateCall[1].cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ column_id: 'ColSummary', rich_text: [expect.any(Object)] })
    ]));

    const UserListUpdates = ApiCallMock.mock.calls.filter(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.items.update' && ArgPayload.list_id === 'F_USER_1'
    );
    expect(UserListUpdates).toHaveLength(0);

    await Lists.StopAsync();
  });

  it('inbound delete: removing an unmanaged (hand-authored) row cancels nothing', async () => {
    jest.useFakeTimers();
    const Reminders = MakeFakeRemindersModule();
    const { Lists, ListStore } = await CreateHarnessAsync({
      SeedCache: true, UseFakeTimers: true, RemindersModule: Reminders
    });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;
    await jest.advanceTimersByTimeAsync(PollIntervalMs);

    // a row Sleuth never tracked (no reminder_id) appears, then is removed.
    const UserList = ListStore.get('F_USER_1');
    UserList.items.set('RecManual', { id: 'RecManual', list_id: 'F_USER_1', fields: [], updated_timestamp: '1' });
    await jest.advanceTimersByTimeAsync(PollIntervalMs);
    UserList.items.delete('RecManual');
    await jest.advanceTimersByTimeAsync(PollIntervalMs);

    expect(Reminders.CancelReminderFromListAsync).not.toHaveBeenCalled();

    await Lists.StopAsync();
  });

  it('Phase 2: a valid hand-authored row becomes a reminder, the row is adopted, and the shared list is mirrored', async () => {
    jest.useFakeTimers();
    const Reminders = MakeFakeRemindersModule();
    const { Lists, ApiCallMock, ListStore } = await CreateHarnessAsync({
      SeedCache: true, UseFakeTimers: true, RemindersModule: Reminders
    });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;
    await jest.advanceTimersByTimeAsync(PollIntervalMs); // poll #1: baseline

    // a user adds a row directly in Slack with a summary and a parseable due date, no reminder_id.
    ListStore.get('F_USER_1').items.set('RecManual', {
      id: 'RecManual',
      list_id: 'F_USER_1',
      created_by: 'U_AUTHOR',
      updated_timestamp: '1747160000',
      fields: [
        MakeRichTextField('ColSummary', 'Review the Q3 deck'),
        MakeRichTextField('ColDueDate', '2026-06-01T17:00:00.000Z')
      ]
    });

    ApiCallMock.mockClear();
    await jest.advanceTimersByTimeAsync(PollIntervalMs); // poll #2: detects + creates

    expect(Reminders.CreateReminderFromListRowAsync).toHaveBeenCalledTimes(1);
    expect(Reminders.CreateReminderFromListRowAsync).toHaveBeenCalledWith({
      summary: 'Review the Q3 deck',
      dueDate: '2026-06-01T17:00:00.000Z',
      assigneeID: 'U_AUTHOR',
      targetChannelID: 'C_GENERATION',
      originalSenderID: 'U_AUTHOR'
    });

    // reminder_id was written back into the hand-authored row.
    const UpdateCall = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.items.update' && ArgPayload.list_id === 'F_USER_1'
    );
    expect(UpdateCall).toBeDefined();
    expect(UpdateCall[1].cells).toEqual(expect.arrayContaining([
      { row_id: 'RecManual', column_id: 'ColReminderId', rich_text: [expect.any(Object)] }
    ]));

    // the new reminder was mirrored onto the shared workspace list.
    const SharedCreate = ApiCallMock.mock.calls.find(
      ([ArgMethod, ArgPayload]) => ArgMethod === 'slackLists.items.create' && ArgPayload.list_id === 'F_LIST_123'
    );
    expect(SharedCreate).toBeDefined();

    // poll #3: the adopted row is not turned into a second reminder.
    await jest.advanceTimersByTimeAsync(PollIntervalMs);
    expect(Reminders.CreateReminderFromListRowAsync).toHaveBeenCalledTimes(1);

    await Lists.StopAsync();
  });

  it('Phase 2: a hand-authored row missing a due date is marked needs-info and creates no reminder', async () => {
    jest.useFakeTimers();
    const Reminders = MakeFakeRemindersModule();
    const { Lists, ApiCallMock, ListStore } = await CreateHarnessAsync({
      SeedCache: true, UseFakeTimers: true, RemindersModule: Reminders
    });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;
    await jest.advanceTimersByTimeAsync(PollIntervalMs); // poll #1: baseline

    // a row with a summary but no due date — does not meet the minimum column contract.
    ListStore.get('F_USER_1').items.set('RecIncomplete', {
      id: 'RecIncomplete',
      list_id: 'F_USER_1',
      created_by: 'U_AUTHOR',
      updated_timestamp: '1747160000',
      fields: [MakeRichTextField('ColSummary', 'Vague idea with no date')]
    });

    ApiCallMock.mockClear();
    await jest.advanceTimersByTimeAsync(PollIntervalMs); // poll #2: detects + marks needs-info

    expect(Reminders.CreateReminderFromListRowAsync).not.toHaveBeenCalled();

    // the row was marked needs-info so the operator sees what to fix.
    const UpdateCall = ApiCallMock.mock.calls.find(
      ([ArgMethod]) => ArgMethod === 'slackLists.items.update'
    );
    expect(UpdateCall).toBeDefined();
    expect(UpdateCall[1].cells).toEqual([
      { row_id: 'RecIncomplete', column_id: 'ColStatus', select: ['needs-info'] }
    ]);

    // poll #3: the needs-info row does not re-trigger.
    await jest.advanceTimersByTimeAsync(PollIntervalMs);
    expect(Reminders.CreateReminderFromListRowAsync).not.toHaveBeenCalled();

    await Lists.StopAsync();
  });

  it('GetCompletedRowsBetweenAsync returns per-user completed history rows within the window', async () => {
    jest.useFakeTimers();
    const { Lists, ListStore } = await CreateHarnessAsync({ SeedCache: true, UseFakeTimers: true });

    const EnsurePromise = Lists.EnsureUserListAsync('U_ASSIGNEE', [MakeReminder()], 'C_GENERATION');
    await jest.advanceTimersByTimeAsync(ListsModule.LIST_PROPAGATION_DELAY_MS);
    await EnsurePromise;

    // Mark the per-user history row completed with a known completion timestamp (epoch seconds).
    const UserList = ListStore.get('F_USER_1');
    const CompletedRow = JSON.parse(JSON.stringify(UserList.items.get('Rec123')));
    let HasCompletedField = false;
    for(const Field of CompletedRow.fields) {
      if(Field.column_id === 'ColCompleted') {
        Field.checkbox = true;
        HasCompletedField = true;
      }
    }
    if(!HasCompletedField) {
      CompletedRow.fields.push({ column_id: 'ColCompleted', checkbox: true });
    }
    CompletedRow.updated_timestamp = '1747159999';
    UserList.items.set('Rec123', CompletedRow);

    const InWindow = await Lists.GetCompletedRowsBetweenAsync(1747159000000, 1747160000000);
    expect(InWindow.available).toBe(true);
    expect(InWindow.rows).toHaveLength(1);
    expect(InWindow.rows[0].reminderId).toBe('R123');
    expect(InWindow.rows[0].assigneeID).toBe('U_ASSIGNEE');
    expect(InWindow.rows[0].completedMs).toBe(1747159999000);

    // A window that ends before the completion instant excludes the row.
    const OutOfWindow = await Lists.GetCompletedRowsBetweenAsync(1747160001000, 1747160002000);
    expect(OutOfWindow.available).toBe(true);
    expect(OutOfWindow.rows).toHaveLength(0);

    await Lists.StopAsync();
  });
});
