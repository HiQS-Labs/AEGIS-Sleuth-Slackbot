'use strict';

/**
 * Lightweight logger for test harness use.
 */
/**
 * GH-169: default a simulated event field only when the caller did not supply the key at all, so a
 * malformed-payload corpus can deliver an explicit `''`, `null`, or `undefined` the way a partial
 * Slack payload does. `||` swallowed all three; `??` still swallows `null` and `undefined`.
 * @param {object} ArgInfo Partial event info from the caller.
 * @param {string} ArgKey Field name.
 * @param {any} ArgDefault Value used only when the key is absent.
 * @returns {any}
 */
function FieldOrDefault(ArgInfo, ArgKey, ArgDefault) {
  return Object.hasOwn(ArgInfo, ArgKey) ? ArgInfo[ArgKey] : ArgDefault;
}

class MockLogger {
  constructor() {
    this.DebugMessages = [];
    this.InfoMessages = [];
    this.WarnMessages = [];
    this.ErrorMessages = [];
  }

  /**
   * Debug log store.
   * @type {string[]}
   */
  DebugMessages;

  /**
   * Info log store.
   * @type {string[]}
   */
  InfoMessages;

  /**
   * Warning log store.
   * @type {string[]}
   */
  WarnMessages;

  /**
   * Error log store.
   * @type {string[]}
   */
  ErrorMessages;

  /**
   * Record a debug message.
   * @param {...any} ArgMessages Messages to record.
   */
  debug(...ArgMessages) {
    this.DebugMessages.push(this.#FormatMessages(ArgMessages));
  }

  /**
   * Record an info message.
   * @param {...any} ArgMessages Messages to record.
   */
  info(...ArgMessages) {
    this.InfoMessages.push(this.#FormatMessages(ArgMessages));
  }

  /**
   * Record a warning message.
   * @param {...any} ArgMessages Messages to record.
   */
  warn(...ArgMessages) {
    this.WarnMessages.push(this.#FormatMessages(ArgMessages));
  }

  /**
   * Record an error message.
   * @param {...any} ArgMessages Messages to record.
   */
  error(...ArgMessages) {
    this.ErrorMessages.push(this.#FormatMessages(ArgMessages));
  }

  /**
   * No-op separator method to match CombinedLogger optional interface.
   * @returns {Promise<void>}
   */
  async WriteSeparatorAsync() {
  }

  /**
   * Format log arguments into a single string.
   * @param {any[]} ArgMessages Messages to format.
   * @returns {string}
   */
  #FormatMessages(ArgMessages) {
    return ArgMessages.map((ArgMessage) => {
      if(ArgMessage instanceof Error) return ArgMessage.stack || ArgMessage.message;
      if(typeof ArgMessage === 'object' && ArgMessage !== null) return JSON.stringify(ArgMessage);
      return String(ArgMessage);
    }).join(' ');
  }
}

/**
 * Minimal SlackApp test harness that mimics Sleuth's wrapper-level interface.
 */
class MockSlackApp {
  /**
   * Initialize the mock Slack app.
   * @param {Object} [ArgOptions] Optional configuration.
   * @param {import('../../src/workspaces').WorkspaceInfo} [ArgOptions.WorkspaceInfo] Workspace info to expose.
   * @param {MockLogger} [ArgOptions.Logger] Logger instance.
   * @param {string} [ArgOptions.AppMentionString] Mention string for the mock bot.
   * @param {string} [ArgOptions.TeamId] Slack team ID to expose via the `TeamId` getter. Used for tenancy tests.
   * @param {string[]} [ArgOptions.AdminUsers] User IDs treated as admins/owners.
   * @param {Record<string, string>} [ArgOptions.ChannelCreatorsById] Channel creator lookup.
   * @param {Record<string, import('../../src/slack-app').MessageInfo[]>} [ArgOptions.ThreadMessagesById] Thread messages by `channel:ts`.
   * @param {Record<string, import('../../src/slack-app').MessageInfo[]>} [ArgOptions.RecentChannelMessagesById] Channel timeline by channel ID, NEWEST-FIRST (GH-55).
   * @param {Record<string, string>} [ArgOptions.ThreadTsById] Thread root ts override by `channel:ts`, for GetMessageThreadTsAsync.
   * @param {Record<string, import('../../src/slack-app').MessageMetadata|null>} [ArgOptions.MessageMetadataById] Message metadata by `channel:ts`.
   * @param {Record<string, string>} [ArgOptions.ChannelIdsByName] Channel ID lookup by name.
   * @param {Record<string, string>} [ArgOptions.ChannelNamesById] Channel name lookup by ID.
   * @param {{ok: boolean, error?: string}} [ArgOptions.SlackConnectivityResult] Connectivity result override.
   */
  constructor(ArgOptions = {}) {
    this.WorkspaceInfo = ArgOptions.WorkspaceInfo || {
      WORKSPACE_NAME: 'TestWorkspace',
      ADMIN_EMAIL: 'admin@example.com',
      LIVE_TOKEN: 'xoxb-test',
      LIVE_SIGNING_SECRET: 'secret',
      LIVE_APP_TOKEN: 'xapp-test',
      OPENAI_API_KEY: 'sk-test',
      REMINDER_CHANNEL_NAME: 'test-reminders',
      MAIN_TIMEZONE: 'America/Los_Angeles',
    };
    this.Logger = ArgOptions.Logger || new MockLogger();
    this.AppMentionString = ArgOptions.AppMentionString || '<@UBOT123>';
    this.#TeamId = typeof ArgOptions.TeamId === 'string' ? ArgOptions.TeamId : 'T_TEST_DEFAULT';

    this.SentMessages = [];
    this.SentBlockMessages = [];
    this.UpdatedMessages = [];
    this.AddedReactions = [];
    this.DeletedMessages = [];

    // configurable per-test mock for Slack file downloads used by context memory ingestion.
    this.GetFileContentAsync = jest.fn().mockResolvedValue('');

    // GH-62: binary download used by the Vision OCR path. Present so an image attachment can be
    // driven all the way through #OnAppMentionAsync — the entry point whose missing coverage let
    // the OCR feature ship unreachable.
    this.DownloadFileBase64Async = jest.fn().mockResolvedValue({
      Base64: 'dGVzdC1pbWFnZS1ieXRlcw==',
      Mimetype: 'image/png',
    });

    this.#AdminUsers = new Set(ArgOptions.AdminUsers || []);
    this.#ChannelCreatorsById = new Map(Object.entries(ArgOptions.ChannelCreatorsById || {}));
    this.#ThreadMessagesById = new Map(Object.entries(ArgOptions.ThreadMessagesById || {}));
    this.#RecentChannelMessagesById = new Map(Object.entries(ArgOptions.RecentChannelMessagesById || {}));
    this.#ThreadTsById = new Map(Object.entries(ArgOptions.ThreadTsById || {}));
    this.#MessageMetadataById = new Map(Object.entries(ArgOptions.MessageMetadataById || {}));
    this.#ChannelIdsByName = new Map(Object.entries(ArgOptions.ChannelIdsByName || {}));
    this.#ChannelNamesById = new Map(Object.entries(ArgOptions.ChannelNamesById || {}));
    this.#SlackConnectivityResult = ArgOptions.SlackConnectivityResult || { ok: true };
  }

  /**
   * Workspace information exposed to modules.
   * @type {import('../../src/workspaces').WorkspaceInfo}
   */
  WorkspaceInfo;

  /**
   * Logger exposed to modules.
   * @type {MockLogger}
   */
  Logger;

  /**
   * Mention string exposed to modules.
   * @type {string}
   */
  AppMentionString;

  /**
   * Sent plain-text messages for assertions.
   * @type {Array<{ channel: string, threadTs: string|null, text: string, metadata: import('../../src/slack-app').MessageMetadata|null, ts: string }>}
   */
  SentMessages;

  /**
   * Sent block messages for assertions.
   * @type {Array<{ channel: string, text: string, blocks: any[], metadata: import('../../src/slack-app').MessageMetadata|null, threadTs: string|null }>}
   */
  SentBlockMessages;

  /**
   * Updated messages for assertions.
   * @type {Array<{ channel: string, ts: string, text: string }>}
   */
  UpdatedMessages;

  /**
   * Added reactions for assertions.
   * @type {Array<{ channel: string, ts: string, reaction: string }>}
   */
  AddedReactions;

  /**
   * Deleted messages for assertions.
   * @type {Array<{ channel: string, ts: string }>}
   */
  DeletedMessages;

  /**
   * Registered app mention handlers.
   * @type {Array<import('../../src/slack-app').OnSlackAppMentionAsync>}
   */
  #AppMentionHandlers = [];

  /**
   * Registered message handlers.
   * @type {Array<import('../../src/slack-app').OnSlackMessageAsync>}
   */
  #MessageHandlers = [];

  /**
   * Registered reaction handlers.
   * @type {Array<import('../../src/slack-app').OnSlackReactionAddedAsync>}
   */
  #ReactionAddedHandlers = [];

  /**
   * Registered block_actions handlers keyed by action_id.
   * @type {Map<string, Array<import('../../src/slack-app').OnSlackActionAsync>>}
   */
  #ActionHandlersByActionId = new Map();

  /**
   * Admin/owner user IDs.
   * @type {Set<string>}
   */
  #AdminUsers;

  /**
   * Channel creator lookup.
   * @type {Map<string, string>}
   */
  #ChannelCreatorsById;

  /**
   * Thread message lookup by `channel:ts`.
   * @type {Map<string, import('../../src/slack-app').MessageInfo[]>}
   */
  #ThreadMessagesById;
  /** @type {Map<string, any[]>} */
  #RecentChannelMessagesById;

  /**
   * Thread root ts override lookup by `channel:ts`, for GetMessageThreadTsAsync.
   * @type {Map<string, string>}
   */
  #ThreadTsById;

  /**
   * Message metadata lookup by `channel:ts`.
   * @type {Map<string, import('../../src/slack-app').MessageMetadata|null>}
   */
  #MessageMetadataById;

  /**
   * Channel ID lookup by name.
   * @type {Map<string, string>}
   */
  #ChannelIdsByName;

  /**
   * Channel name lookup by ID.
   * @type {Map<string, string>}
   */
  #ChannelNamesById;

  /**
   * Slack connectivity result.
   * @type {{ok: boolean, error?: string}}
   */
  #SlackConnectivityResult;

  /**
   * Synthetic message counter for generated timestamps.
   * @type {number}
   */
  #MessageCounter = 1;

  /**
   * Slack team ID exposed via the `TeamId` getter. Defaults to `'T_TEST_DEFAULT'`
   * but tests can inject `'T_NEOCHROME_TEST'` / `'T_OUTSIDER_TEST'` via the
   * constructor option to drive tenancy-gate test cases.
   * @type {string}
   */
  #TeamId;

  /**
   * Expose mock bot user ID derived from AppMentionString.
   * @returns {string|null}
   */
  get BotUserID() {
    const Match = this.AppMentionString.match(/<@([A-Z0-9]+)>/i);
    return Match ? Match[1] : null;
  }

  /**
   * Expose the Slack team ID for this mock workspace. Used by the tenancy gate
   * in ChatModule's command branches.
   * @returns {string}
   */
  get TeamId() {
    return this.#TeamId;
  }

  /**
   * Register an app mention handler.
   * @param {import('../../src/slack-app').OnSlackAppMentionAsync} ArgHandler Handler function.
   */
  HandleAppMention(ArgHandler) {
    this.#AppMentionHandlers.push(ArgHandler);
  }

  /**
   * Register a message handler.
   * @param {import('../../src/slack-app').OnSlackMessageAsync} ArgHandler Handler function.
   */
  HandleMessage(ArgHandler) {
    this.#MessageHandlers.push(ArgHandler);
  }

  /**
   * Register a reaction handler.
   * @param {import('../../src/slack-app').OnSlackReactionAddedAsync} ArgHandler Handler function.
   */
  HandleReactionAdded(ArgHandler) {
    this.#ReactionAddedHandlers.push(ArgHandler);
  }

  /**
   * Register a block_actions handler for a given action_id.
   * @param {string} ArgActionID Action ID set on the Block Kit element.
   * @param {import('../../src/slack-app').OnSlackActionAsync} ArgHandler Handler function.
   */
  HandleAction(ArgActionID, ArgHandler) {
    const Existing = this.#ActionHandlersByActionId.get(ArgActionID) ?? [];
    Existing.push(ArgHandler);
    this.#ActionHandlersByActionId.set(ArgActionID, Existing);
  }

  /**
   * Record a posted plain-text message.
   * @param {string} ArgTargetChannelID Channel ID where the message would be posted.
   * @param {string|null} ArgReplyingToMessageID Thread TS to reply to.
   * @param {string} ArgMessageText Text to post.
   * @param {import('../../src/slack-app').MessageMetadata} [ArgMessageMetadata] Optional metadata.
   * @returns {Promise<string>}
   */
  async PostMessageTextAsync(ArgTargetChannelID, ArgReplyingToMessageID, ArgMessageText, ArgMessageMetadata) {
    const MessageTS = this.#MakeMessageTS();
    this.SentMessages.push({
      channel: ArgTargetChannelID,
      threadTs: ArgReplyingToMessageID ?? null,
      text: ArgMessageText,
      metadata: ArgMessageMetadata ?? null,
      ts: MessageTS,
    });
    return MessageTS;
  }

  /**
   * Record a posted blocks message.
   * @param {string} ArgTargetChannelID Channel ID where the message would be posted.
   * @param {string} ArgMessageText Fallback text.
   * @param {Array<any>} ArgMessageBlocks Blocks payload.
   * @param {import('../../src/slack-app').MessageMetadata} [ArgMessageMetadata] Optional metadata.
   * @param {string} [ArgReplyingToMessageID] Optional thread TS.
   * @returns {Promise<boolean>}
   */
  async PostMessageTextWithBlocksAsync(
    ArgTargetChannelID, ArgMessageText, ArgMessageBlocks, ArgMessageMetadata, ArgReplyingToMessageID
  ) {
    this.SentBlockMessages.push({
      channel: ArgTargetChannelID,
      text: ArgMessageText,
      blocks: ArgMessageBlocks,
      metadata: ArgMessageMetadata ?? null,
      threadTs: ArgReplyingToMessageID ?? null,
    });
    return true;
  }

  /**
   * Record a message update.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgMessageTS Message timestamp.
   * @param {string} ArgMessageText Updated text.
   * @returns {Promise<boolean>}
   */
  async UpdateMessageAsync(ArgChannelID, ArgMessageTS, ArgMessageText) {
    this.UpdatedMessages.push({ channel: ArgChannelID, ts: ArgMessageTS, text: ArgMessageText });
    return true;
  }

  /**
   * Record an added reaction.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgMessageTS Message timestamp.
   * @param {string} ArgReaction Reaction name.
   * @returns {Promise<boolean>}
   */
  async AddReactionAsync(ArgChannelID, ArgMessageTS, ArgReaction) {
    this.AddedReactions.push({ channel: ArgChannelID, ts: ArgMessageTS, reaction: ArgReaction });
    return true;
  }

  /**
   * Record a deleted message.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgMessageTS Message timestamp.
   * @returns {Promise<boolean>}
   */
  async DeleteMessageAsync(ArgChannelID, ArgMessageTS) {
    this.DeletedMessages.push({ channel: ArgChannelID, ts: ArgMessageTS });
    return true;
  }

  /**
   * Return canned Slack connectivity.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async CheckSlackConnectivityAsync() {
    return this.#SlackConnectivityResult;
  }

  /**
   * Look up thread messages.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgThreadTS Thread timestamp.
   * @returns {Promise<import('../../src/slack-app').MessageInfo[]>}
   */
  async GetConversationMessagesAsync(ArgChannelID, ArgThreadTS) {
    return this.#ThreadMessagesById.get(`${ArgChannelID}:${ArgThreadTS}`) || [];
  }

  /**
   * Look up a channel timeline. Mirrors the real `SlackApp#GetRecentChannelMessagesAsync`, which
   * wraps `conversations.history` and therefore returns messages NEWEST-FIRST — fixtures must be
   * ordered that way or a test will pass against an ordering production never produces.
   * @param {string} ArgChannelID Channel ID.
   * @param {number} [ArgLimit] Maximum messages to return.
   * @returns {Promise<import('../../src/slack-app').MessageInfo[]>}
   */
  async GetRecentChannelMessagesAsync(ArgChannelID, ArgLimit = 10) {
    const Messages = this.#RecentChannelMessagesById.get(ArgChannelID) || [];
    return Messages.slice(0, ArgLimit);
  }

  /**
   * Return the thread root timestamp for a message. Mirrors the real
   * SlackApp#GetMessageThreadTsAsync fallback (thread_ts if configured, else the message's own
   * ts) using the `ThreadTsById` constructor map for thread-reply test cases.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgMessageTS Message timestamp.
   * @returns {Promise<string|null>}
   */
  async GetMessageThreadTsAsync(ArgChannelID, ArgMessageTS) {
    return this.#ThreadTsById.get(`${ArgChannelID}:${ArgMessageTS}`) || ArgMessageTS;
  }

  /**
   * Look up a channel ID by name.
   * @param {string} ArgChannelName Channel name.
   * @returns {Promise<string|null>}
   */
  async GetChannelIdAsync(ArgChannelName) {
    return this.#ChannelIdsByName.get(ArgChannelName) || null;
  }

  /**
   * Look up a channel name by ID.
   * @param {string} ArgChannelID Channel ID.
   * @returns {Promise<string|null>}
   */
  async GetChannelNameAsync(ArgChannelID) {
    return this.#ChannelNamesById.get(ArgChannelID) || null;
  }

  /**
   * Return a synthetic permalink.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgMessageTS Message timestamp.
   * @returns {Promise<string>}
   */
  async GetPermaLinkAsync(ArgChannelID, ArgMessageTS) {
    return `https://mock.slack.test/${ArgChannelID}/${ArgMessageTS}`;
  }

  /**
   * Look up message metadata.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgMessageTS Message timestamp.
   * @returns {Promise<import('../../src/slack-app').MessageMetadata|null>}
   */
  async GetMessageMetadataAsync(ArgChannelID, ArgMessageTS) {
    return this.#MessageMetadataById.get(`${ArgChannelID}:${ArgMessageTS}`) || null;
  }

  /**
   * Check whether a user is configured as channel creator.
   * @param {string} ArgChannelID Channel ID.
   * @param {string} ArgUserID User ID.
   * @returns {Promise<boolean>}
   */
  async IsChannelCreatorAsync(ArgChannelID, ArgUserID) {
    return this.#ChannelCreatorsById.get(ArgChannelID) === ArgUserID;
  }

  /**
   * Check whether a user is configured as admin or owner.
   * @param {string} ArgUserID User ID.
   * @returns {Promise<boolean>}
   */
  async IsAdminOrOwnerAsync(ArgUserID) {
    return this.#AdminUsers.has(ArgUserID);
  }

  /**
   * User identity lookup for testing.
   * @type {Map<string, import('../../src/slack-app').SlackUserIdentity>}
   */
  #UserIdentitiesById = new Map();

  /**
   * Configure user display names for GetUserDisplayNameAsync.
   * @param {Record<string, string>} ArgUserNames Map of user ID to display name.
   */
  SetUserDisplayNames(ArgUserNames) {
    this.#UserIdentitiesById = new Map(
      Object.entries(ArgUserNames).map(([ArgUserID, ArgDisplayName]) => [ArgUserID, {
        UserID: ArgUserID,
        Mention: `<@${ArgUserID}>`,
        DisplayName: ArgDisplayName,
        RealName: null,
        Username: null,
        Email: null,
        IsBot: false,
        IsDeleted: false,
        IsAdmin: false,
        IsOwner: false,
        IsPrimaryOwner: false,
        LastFetchedAt: new Date(0).toISOString(),
      }])
    );
  }

  /**
   * Configure full user identities for GetUserIdentityAsync.
   * @param {Record<string, Partial<import('../../src/slack-app').SlackUserIdentity>>} ArgUserIdentities Map of user ID to identity fields.
   */
  SetUserIdentities(ArgUserIdentities) {
    this.#UserIdentitiesById = new Map(
      Object.entries(ArgUserIdentities).map(([ArgUserID, ArgIdentity]) => [ArgUserID, {
        UserID: ArgUserID,
        Mention: `<@${ArgUserID}>`,
        DisplayName: null,
        RealName: null,
        Username: null,
        Email: null,
        IsBot: false,
        IsDeleted: false,
        IsAdmin: false,
        IsOwner: false,
        IsPrimaryOwner: false,
        LastFetchedAt: new Date(0).toISOString(),
        ...ArgIdentity,
        UserID: ArgUserID,
        Mention: `<@${ArgUserID}>`,
      }])
    );
  }

  /**
   * Get a user's normalized identity from the test lookup.
   * @param {string} ArgUserID User ID to look up.
   * @returns {Promise<import('../../src/slack-app').SlackUserIdentity|null>}
   */
  async GetUserIdentityAsync(ArgUserID) {
    return this.#UserIdentitiesById.get(ArgUserID) || null;
  }

  /**
   * Get a user's display name from the test lookup.
   * @param {string} ArgUserID User ID to look up.
   * @returns {Promise<string|null>}
   */
  async GetUserDisplayNameAsync(ArgUserID) {
    const Identity = await this.GetUserIdentityAsync(ArgUserID);
    return Identity?.DisplayName || null;
  }

  /**
   * Simulate a Slack app mention and mirror production handler-chain semantics.
   * @param {Partial<import('../../src/slack-app').AppMentionEventInfo>} ArgEventInfo Partial event info.
   * @returns {Promise<boolean>} True when any handler reports the event handled.
   */
  async SimulateAppMentionAsync(ArgEventInfo) {
    const AppMentionEvent = {
      channel: FieldOrDefault(ArgEventInfo, 'channel', 'C_TEST'),
      text: FieldOrDefault(ArgEventInfo, 'text', `${this.AppMentionString} ping`),
      ts: Object.hasOwn(ArgEventInfo, 'ts') ? ArgEventInfo.ts : this.#MakeMessageTS(),
      thread_ts: ArgEventInfo.thread_ts,
      user: FieldOrDefault(ArgEventInfo, 'user', 'U_TEST'),
      files: ArgEventInfo.files,
    };
    return await this.#DispatchHandlersAsync(this.#AppMentionHandlers, AppMentionEvent, 'app_mention');
  }

  /**
   * Simulate a plain Slack message and mirror production handler-chain semantics.
   * @param {Partial<import('../../src/slack-app').MessageEventInfo>} ArgEventInfo Partial event info.
   * @returns {Promise<boolean>} True when any handler reports the event handled.
   */
  async SimulateMessageAsync(ArgEventInfo) {
    const MessageEvent = {
      channel: FieldOrDefault(ArgEventInfo, 'channel', 'C_TEST'),
      text: FieldOrDefault(ArgEventInfo, 'text', 'test message'),
      ts: Object.hasOwn(ArgEventInfo, 'ts') ? ArgEventInfo.ts : this.#MakeMessageTS(),
      thread_ts: ArgEventInfo.thread_ts,
      user: FieldOrDefault(ArgEventInfo, 'user', 'U_TEST'),
      subtype: ArgEventInfo.subtype,
      files: ArgEventInfo.files,
      channel_type: ArgEventInfo.channel_type,
    };
    return await this.#DispatchHandlersAsync(this.#MessageHandlers, MessageEvent, 'message');
  }

  /**
   * Simulate a Slack block_actions interaction (button click) and dispatch to handlers
   * registered for the given action_id.
   * @param {string} ArgActionID Action ID of the clicked element.
   * @param {Partial<import('../../src/slack-app').BlockActionInfo>} [ArgActionInfo] Partial payload.
   * @returns {Promise<boolean>} True when any handler reports the action handled.
   */
  async SimulateActionAsync(ArgActionID, ArgActionInfo = {}) {
    const ActionEvent = /** @type {import('../../src/slack-app').BlockActionInfo} */ ({
      actionId: ArgActionID,
      value: typeof ArgActionInfo.value === 'string' ? ArgActionInfo.value : '',
      channel: ArgActionInfo.channel || 'C_TEST',
      user: ArgActionInfo.user || 'U_TEST',
      messageTs: ArgActionInfo.messageTs || this.#MakeMessageTS(),
      threadTs: ArgActionInfo.threadTs ?? null,
      triggerId: ArgActionInfo.triggerId || 'trigger_test',
    });

    const Handlers = this.#ActionHandlersByActionId.get(ArgActionID) ?? [];
    return await this.#DispatchHandlersAsync(Handlers, ActionEvent, `block_actions:${ArgActionID}`);
  }

  /**
   * Simulate a reaction event and mirror production handler-chain semantics.
   * @param {Partial<import('../../src/slack-app').ReactionAddedEventInfo>} ArgEventInfo Partial reaction info.
   * @returns {Promise<boolean>} True when any handler reports the event handled.
   */
  async SimulateReactionAddedAsync(ArgEventInfo) {
    const ReactionEvent = {
      user: ArgEventInfo.user || 'U_TEST',
      reaction: ArgEventInfo.reaction || 'white_check_mark',
      item: {
        channel: ArgEventInfo.item?.channel || 'C_TEST',
        ts: ArgEventInfo.item?.ts || this.#MakeMessageTS(),
      },
    };
    return await this.#DispatchHandlersAsync(this.#ReactionAddedHandlers, ReactionEvent, 'reaction_added');
  }

  /**
   * Run a registered handler chain and mirror production semantics.
   * @template T
   * @param {Array<(ArgSlackApp: MockSlackApp, ArgEventInfo: T) => Promise<boolean>>} ArgHandlers Registered handlers.
   * @param {T} ArgEventInfo Event payload.
   * @param {string} ArgEventName Event name for logging.
   * @returns {Promise<boolean>}
   */
  async #DispatchHandlersAsync(ArgHandlers, ArgEventInfo, ArgEventName) {
    this.Logger.info(`${ArgEventName} event (mock):`, ArgEventInfo);
    let WasHandled = false;

    for(const CurrentHandler of ArgHandlers) {
      try {
        if(await CurrentHandler(this, ArgEventInfo)) {
          WasHandled = true;
          break;
        }
      } catch(error) {
        this.Logger.error(`Error in ${ArgEventName} handler:`, error);
      }
    }

    return WasHandled;
  }

  /**
   * Create a synthetic Slack timestamp string.
   * @returns {string}
   */
  #MakeMessageTS() {
    const CounterText = String(this.#MessageCounter++).padStart(6, '0');
    return `1700000000.${CounterText}`;
  }
}

module.exports = { MockSlackApp, MockLogger };
