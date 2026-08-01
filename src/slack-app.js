
// import required modules.
const path = require('path');
const { App } = require('@slack/bolt');

// add typedefs for our own types.
/**
 * @typedef {import('./workspaces').WorkspaceInfo} WorkspaceInfo
 * @typedef {import('./stats-module').WorkspaceStats} WorkspaceStats
 */

// add typedefs for Slack-defined types needed in the signature of the event handlers. We discovered these types by using
// "Go to Definition" in the function calls to App.event() and App.message(). After finding the path to the types, we use
// that path to import the types below.
/**
 * @typedef {import('@slack/logger').Logger} Logger
 * @typedef {Logger & { WriteSeparatorAsync?: (label?: string) => Promise<void> }} ExtendedLogger
 * @typedef {import("@slack/types/dist/block-kit/blocks").Block} Block
 * @typedef {import("@slack/types/dist/block-kit/blocks").KnownBlock} KnownBlock 
 * @typedef {import("@slack/types/dist/message-metadata").MessageMetadata} MessageMetadata
 * @typedef {import('@slack/bolt/dist/types/utilities').StringIndexed} StringIndexed
 * @typedef {import('@slack/bolt/dist/types/middleware').AllMiddlewareArgs<StringIndexed>} AllMiddlewareArgs
 * @typedef {import('@slack/bolt/dist/types/events/index').SlackEventMiddlewareArgs<"reaction_added"> } ReactionAddedArgs
 * @typedef {import('@slack/bolt/dist/types/events/index').SlackEventMiddlewareArgs<"app_mention"> } AppMentionArgs
 * @typedef {import('@slack/bolt/dist/types/events/index').SlackEventMiddlewareArgs<"message"> } MessageArgs
 * @typedef {import('@slack/bolt/dist/types/actions').SlackActionMiddlewareArgs<import('@slack/bolt/dist/types/actions').BlockAction>} BlockActionArgs
 */

/**
 * Captures essential information from the Slack reaction_added event.
 * @typedef {Object} ReactionAddedEventInfo
 * @property {string} user User ID of the person who added the reaction.
 * @property {string} reaction Name of the reaction (emoji).
 * @property {Object} item Item the reaction was added to.
 * @property {string} item.channel Channel ID where the reaction was added.
 * @property {string} item.ts Timestamp of the message the reaction was added to.
 */

/**
 * Captures essential information from the Slack app_mention event.
 * @typedef {Object} SlackFileInfo
 * @property {string} id File ID.
 * @property {string} name File name including extension.
 * @property {string} mimetype MIME type of the file.
 * @property {string} [filetype] Slack's short file/language type (e.g. "markdown", "text", "shell", "sql"); set for snippets.
 * @property {string} url_private Private URL (may return HTML preview for some file types).
 * @property {string} url_private_download Private URL that always returns raw file bytes.
 * @property {number} size File size in bytes.
 */

/**
 * Normalized result from uploading one local file to Slack.
 * @typedef {Object} UploadedSlackFileResult
 * @property {SlackFileInfo} File Uploaded file metadata.
 * @property {string|null} MessageTS Timestamp of the posted share message when Slack exposes it.
 * @property {string|null} ThreadTS Root thread timestamp for the uploaded file share.
 * @property {string|null} Permalink Slack permalink for the uploaded file, when available.
 */

/**
 * @typedef {Object} AppMentionEventInfo
 * @property {string} channel Channel ID where the event occurred.
 * @property {string} text Text of the message.
 * @property {string} ts Timestamp of the message.
 * @property {string} [thread_ts] Timestamp of the parent message if the event is part of a thread.
 * @property {string} user User ID of the person who mentioned the app.
 * @property {SlackFileInfo[]} [files] Files attached to the message, if any.
 */

/**
 * @typedef {Object} MessageEventInfo
 * @property {string} channel Channel ID where the message was sent.
 * @property {string} text Text of the message.
 * @property {string} ts Timestamp of the message.
 * @property {string} [thread_ts] Timestamp of the parent message if the message is part of a thread.
 * @property {string} user User ID of the person who sent the message.
 * @property {string} [subtype] Subtype of the message, if any.
 * @property {SlackFileInfo[]} [files] Files attached to the message, if any.
 * @property {'channel'|'group'|'im'|'mpim'|'app_home'} [channel_type] Slack's own channel-type
 *   classification; 'im' identifies a true 1:1 direct message (see GH-412).
 */

/**
 * Captures essential information from a Slack message.
 * @typedef {Object} MessageInfo
 * @property {string} user User ID of the person who sent the message.
 * @property {string} text Text of the message.
 * @property {string} ts Timestamp of the message.
 * @property {string} thread_ts Timestamp of the parent message if the message is part of a thread.
 * @property {string} [bot_id] Bot ID if the message was sent by a bot.
 * @property {SlackFileInfo[]} [files] Files attached to the message, if any.
 * @property {string[]} reactions Array of reaction names (emojis) added to the message.
 */

/**
 * Event handler for the Slack reaction_added event.
 * @typedef {(ArgSlackApp: SlackApp, ArgEventInfo: ReactionAddedEventInfo) => Promise<boolean>} OnSlackReactionAddedAsync
 */

/**
 * Event handler for the Slack app_mention event.
 * @typedef {(ArgSlackApp: SlackApp, ArgEventInfo: AppMentionEventInfo) => Promise<boolean>} OnSlackAppMentionAsync
 */

/**
 * Event handler for the Slack message event.
 * @typedef {(ArgSlackApp: SlackApp, ArgEventInfo: MessageEventInfo) => Promise<boolean>} OnSlackMessageAsync
 */

/**
 * Captures essential information from a Slack block_actions interaction (a button click on a
 * message Block Kit element).
 * @typedef {Object} BlockActionInfo
 * @property {string} actionId Action ID of the clicked element.
 * @property {string} value Button value (or selected option) carrying the handler's payload.
 * @property {string} channel Channel ID where the interactive message lives.
 * @property {string} user User ID of the user who triggered the action.
 * @property {string} messageTs Timestamp of the message containing the interactive element.
 * @property {string|null} threadTs Thread root TS if the message is in a thread, else null.
 * @property {string} triggerId Trigger ID usable to open a modal within ~3 seconds.
 */

/**
 * Event handler for a Slack block_actions interaction.
 * @typedef {(ArgSlackApp: SlackApp, ArgActionInfo: BlockActionInfo) => Promise<boolean>} OnSlackActionAsync
 */

/**
 * Normalized Slack user identity payload cached by the SlackApp resolver.
 * @typedef {Object} SlackUserIdentity
 * @property {string} UserID Slack user ID.
 * @property {string} Mention Canonical Slack mention string for the user.
 * @property {string|null} DisplayName Best available human-readable label.
 * @property {string|null} RealName Slack real name field when available.
 * @property {string|null} Username Slack username/handle when available.
 * @property {string|null} Email Slack email when available.
 * @property {boolean} IsBot Whether the identity is a bot user.
 * @property {boolean} IsDeleted Whether the user is deleted/deactivated.
 * @property {boolean} IsAdmin Whether the user is a workspace admin.
 * @property {boolean} IsOwner Whether the user is a workspace owner.
 * @property {boolean} IsPrimaryOwner Whether the user is the workspace primary owner.
 * @property {string} LastFetchedAt ISO timestamp of the last successful Slack fetch.
 */

/**
 * Options controlling Slack user identity lookups.
 * @typedef {Object} SlackUserIdentityLookupOptions
 * @property {boolean} [ForceRefresh] Bypass fresh-cache reads and fetch from Slack again.
 * @property {boolean} [AllowStaleOnError] Return stale cached data if the Slack API lookup fails.
 * @property {number} [CacheTTLMS] Fresh-cache TTL in milliseconds.
 */

/**
 * Outbound Slack write audit context generated at the shared write-path boundary.
 * @typedef {Object} SlackWriteAuditContext
 * @property {string} AuditID Stable ID for correlating pre/post/failure logs.
 * @property {'text'|'blocks'|'file'} Kind Outbound Slack write shape.
 * @property {string} Tag Caller-supplied tag classifying the write origin.
 * @property {string} TargetChannelID Channel receiving the write.
 * @property {string|null|undefined} ThreadTS Thread root timestamp when threaded.
 * @property {number} TextLength Character count of the main text/comment body.
 * @property {string|null} Preview Short log-safe preview of the body when preview logging is enabled.
 * @property {string|null} MetadataEventType Existing Slack metadata event type, if any.
 */

/**
 * Optional audit settings passed by callers into the shared Slack write boundary.
 * Keep this tiny so high-signal call sites can opt in without carrying heavy plumbing.
 * @typedef {Object} SlackWriteAuditOptions
 * @property {string} [Tag] Short caller tag such as `daily-digest`, `startup`, or `github-sync`.
 */

// Temporary observability toggle for outbound Slack writes.
// Set Enabled to false later to silence audit logs/metadata without deleting the code.
const SlackWriteAudit = Object.freeze({
  Enabled: true,
  DefaultTag: 'unlabeled',
  IncludePreview: false,
});

const UserIdentityCacheTTLMS = 15 * 60 * 1000;
const UserIdentityErrorBackoffTTLMS = 60 * 1000;

/**
 * Provides functionality for interacting with a Slack workspace.
 */
class SlackApp {
  /**
   * Normalize Slack's filesUploadV2 response into Sleuth's UploadedSlackFileResult shape.
   * Slack currently returns a nested wrapper per upload job (`resp.files[0].files[0]`) rather
   * than the raw file object directly, but older/simple mocks may still pass the raw file shape.
   * @param {any} ArgUploadResp Raw filesUploadV2 response payload.
   * @param {string} ArgTargetChannelID Channel ID the file was uploaded into.
   * @param {string} ArgDisplayFileName Fallback display file name.
   * @param {string|null} ArgReplyingToMessageID Root thread timestamp when uploading into a thread.
   * @returns {UploadedSlackFileResult}
   */
  static NormalizeUploadedFileResult(ArgUploadResp, ArgTargetChannelID, ArgDisplayFileName, ArgReplyingToMessageID) {
    const FirstUploadEntry = ArgUploadResp?.files?.[0] || null;
    const UploadedFile = FirstUploadEntry?.files?.[0] || FirstUploadEntry;
    if(!UploadedFile)
      throw new Error('Failed to upload file: Slack did not return a file payload.');

    const PublicShare = UploadedFile.shares?.public?.[ArgTargetChannelID]?.[0] || null;

    return {
      File: {
        id: UploadedFile.id || '',
        name: UploadedFile.name || ArgDisplayFileName,
        mimetype: UploadedFile.mimetype || 'application/octet-stream',
        url_private: UploadedFile.url_private || '',
        url_private_download: UploadedFile.url_private_download || UploadedFile.url_private || '',
        size: UploadedFile.size || 0,
      },
      MessageTS: PublicShare?.ts || null,
      ThreadTS: PublicShare?.thread_ts || PublicShare?.ts || ArgReplyingToMessageID || null,
      Permalink: UploadedFile.permalink || null,
    };
  }

  /**
   * Normalize one raw Slack file object into Sleuth's SlackFileInfo shape.
   * @param {any} ArgRawFile Raw Slack file payload.
   * @returns {SlackFileInfo}
   */
  static NormalizeSlackFileInfo(ArgRawFile) {
    return {
      id: ArgRawFile?.id || '',
      name: ArgRawFile?.name || '',
      mimetype: ArgRawFile?.mimetype || 'application/octet-stream',
      filetype: ArgRawFile?.filetype || '',
      url_private: ArgRawFile?.url_private || '',
      url_private_download: ArgRawFile?.url_private_download || ArgRawFile?.url_private || '',
      size: ArgRawFile?.size || 0,
    };
  }

  /**
   * Build a log-safe host summary for a URL-like string.
   * @param {string} ArgUrl URL to summarize.
   * @returns {string}
   */
  static GetSafeUrlHostForLog(ArgUrl) {
    try {
      return new URL(ArgUrl).host || 'unknown-host';
    } catch(error) {
      return 'invalid-url';
    }
  }

  /**
   * Workspace information.
   * @type {WorkspaceInfo}
   */
  #WorkspaceInfo;

  /**
   * Slack logger instance.
   * @type {ExtendedLogger}
   */
  #SlackLogger;

  /**
   * Reminders module bound to this workspace.
   *
   * Declared as a getter, not a field: command-catalog.js replaces this accessor on
   * SlackApp.prototype with one that resolves the module bound to this workspace. A class
   * field would install an own property on every instance, which shadows that prototype
   * accessor and makes every read return null. This getter is the fallback that applies
   * only when the anti-containment hooks failed to install.
   *
   * @returns {import('./reminders-module')|null}
   */
  get RemindersModule() {
    return null;
  }

  /**
   * Workspace AI instance bound to this workspace.
   *
   * Declared as a getter for the same reason as RemindersModule above — see that comment.
   *
   * @returns {import('./workspace-ai')|null}
   */
  get WorkspaceAI() {
    return null;
  }

  /**
   * Stats for the workspace.
   * @type {WorkspaceStats}
   */
  #WorkspaceStats;

  /**
   * Slack app instance.
   * @type {App}
   */
  #SlackBoltApp;

  /**
   * Monotonic counter for outbound Slack write audit IDs.
   * @type {number}
   */
  #SlackWriteAuditCounter = 0;

  /**
   * Indicates whether the Bolt app event loop was started by StartAsync.
   * @type {boolean}
   */
  #SlackBoltAppStarted = false;

  /**
   * Array of handlers for reaction_added events.
   * @type {Array<OnSlackReactionAddedAsync>}
   */
  #ReactionAddedHandlers = [];

  /**
   * Array of handlers for app_mention events.
   * @type {Array<OnSlackAppMentionAsync>}
   */
  #AppMentionHandlers = [];

  /**
   * Array of handlers for message events.
   * @type {Array<OnSlackMessageAsync>}
   */
  #MessageHandlers = [];

  /**
   * Map of action_id → registered block_actions handlers, wired into Bolt at start. Bolt's
   * `action()` requires a known action_id (string or regex), so we register one Bolt subscription
   * per action_id we receive a handler for.
   * @type {Map<string, Array<OnSlackActionAsync>>}
   */
  #ActionHandlersByActionId = new Map();

  /**
   * App ID string used to mention the app in Slack messages.
   * @type {string}
   */
  #AppMentionString;

  /**
   * Slack team ID for this workspace, captured from auth.test at StartAsync.
   * Stable Slack-issued identifier (T-prefixed). Used for tenancy-gated features
   * like the `ask-code` RAG command that must only run in the Neochrome workspace.
   * @type {string|null}
   */
  #TeamId = null;

  /**
   * Cached Slack user identity payloads keyed by user ID.
   * @type {Map<string, { Identity: SlackUserIdentity, CachedAtMS: number, ErrorBackoffUntilMS: number|null }>}
   */
  #UserIdentityCacheById = new Map();

  /**
   * In-flight Slack user lookups keyed by user ID so concurrent callers share one request.
   * @type {Map<string, Promise<SlackUserIdentity|null>>}
   */
  #PendingUserIdentityLookupsById = new Map();

  /**
   * Initialize a new instance of the SlackApp with the given workspace info and logger.
   * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info object.
   * @param {Logger} ArgLogger Slack logger instance.
   */
  constructor(ArgWorkspaceInfo, ArgLogger) {
    // save the workspace info and logger.
    this.#WorkspaceInfo = ArgWorkspaceInfo;
    this.#SlackLogger = ArgLogger;
  }

  /**
   * Build an empty stats object for one-shot or test-only client usage.
   * @returns {WorkspaceStats}
   */
  static CreateEmptyWorkspaceStats() {
    return {
      IncomingMessageCount: 0,
      IncomingMessageLength: 0,
      OutgoingMessageCount: 0,
      OutgoingMessageLength: 0,
      OutgoingGptMessageCount: 0,
      OutgoingGptMessageLength: 0,
      IncomingGptMessageCount: 0,
      IncomingGptMessageLength: 0,
    };
  }

  /**
   * Get the workspace info.
   * @returns {WorkspaceInfo}
   */
  get WorkspaceInfo() {
    return this.#WorkspaceInfo;
  }

  /**
   * Get the Slack logger instance.
   * @returns {Logger}
   */
  get Logger() {
    return this.#SlackLogger;
  }

  /**
   * Get app ID string suitable for mentioning the app in Slack messages.
   * @returns {string}
   */
  get AppMentionString() {
    return this.#AppMentionString;
  }

  /**
   * Get the bot user ID extracted from the AppMentionString.
   * @returns {string|null}
   */
  get BotUserID() {
    if(!this.#AppMentionString) return null;
    const Match = this.#AppMentionString.match(/<@([A-Z0-9]+)>/);
    return Match ? Match[1] : null;
  }

  /**
   * Get the Slack team ID for this workspace, captured at StartAsync from auth.test.
   * Used to gate tenancy-restricted features to specific workspaces. Returns null
   * if the app hasn't been started yet.
   * @returns {string|null}
   */
  get TeamId() {
    return this.#TeamId;
  }

  /**
   * Get the Slack Bolt app instance (for Lists module access to client).
   * @returns {App}
   */
  get BoltApp() {
    return this.#SlackBoltApp;
  }

  /**
   * Start the Slack app.
   * @param {WorkspaceStats} ArgStats Stats for the workspace.
   * @returns {Promise<void>}
   */
  async StartAsync(ArgStats) {
    await this.#InitializeClientAsync(ArgStats, true);
  }

  /**
   * Initialize an authenticated Slack client without starting the Socket Mode event loop.
   * Used by one-shot operator tooling that needs Sleuth's Slack wrapper semantics
   * without opening a long-lived connection.
   * @returns {Promise<void>}
   */
  async ConnectOneShotAsync() {
    await this.#InitializeClientAsync(SlackApp.CreateEmptyWorkspaceStats(), false);
  }

  /**
   * Stop the Slack app.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    // stop processing slack events.
    if(this.#SlackBoltApp && this.#SlackBoltAppStarted) await this.#SlackBoltApp.stop();

    // clear the app instance so we can start it again later if needed.
    this.#SlackBoltApp = null;
    this.#SlackBoltAppStarted = false;
    this.#WorkspaceStats = null;
    this.#AppMentionString = null;
    this.#TeamId = null;
    this.#UserIdentityCacheById = new Map();
    this.#PendingUserIdentityLookupsById = new Map();

    // clear all handler arrays so related objects can be garbage collected.
    this.#ReactionAddedHandlers = [];
    this.#AppMentionHandlers = [];
    this.#MessageHandlers = [];
    this.#ActionHandlersByActionId = new Map();
  }

  /**
   * Run a simple connectivity test using auth.test.
   * @returns {Promise<{ok: boolean, user_id?: string, error?: string}>}
   */
  async CheckSlackConnectivityAsync() {
    try {
      const Resp = await this.#SlackBoltApp.client.auth.test();
      if(Resp.ok) return { ok: true, user_id: Resp.user_id };
      return { ok: false, error: Resp.error || 'unknown error' };
    } catch(error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Add a handler for reaction_added events.
   * 
   * This function adds a handler to the list of handlers for Slack reaction_added events.
   * Handlers are called in a loop when the event occurs. If a handler returns true, the loop stops.
   * If a handler throws an exception, it is caught and logged, and the loop continues with the next handler.
   * @param {OnSlackReactionAddedAsync} ArgHandler Handler function.
   */
  HandleReactionAdded(ArgHandler) {
    this.#ReactionAddedHandlers.push(ArgHandler);
  }

  /**
   * Add a handler for app_mention events.
   * 
   * This function adds a handler to the list of handlers for Slack app_mention events.
   * Handlers are called in a loop when the event occurs. If a handler returns true, the loop stops.
   * If a handler throws an exception, it is caught and logged, and the loop continues with the next handler.
   * @param {OnSlackAppMentionAsync} ArgHandler Handler function.
   */
  HandleAppMention(ArgHandler) {
    this.#AppMentionHandlers.push(ArgHandler);
  }

  /**
   * Add a handler for message events.
   *
   * This function adds a handler to the list of handlers for Slack message events.
   * Handlers are called in a loop when the event occurs. If a handler returns true, the loop stops.
   * If a handler throws an exception, it is caught and logged, and the loop continues with the next handler.
   * @param {OnSlackMessageAsync} ArgHandler Handler function.
   */
  HandleMessage(ArgHandler) {
    this.#MessageHandlers.push(ArgHandler);
  }

  /**
   * Add a handler for Slack block_actions interactions (button clicks etc.) targeting a given
   * action_id. Multiple handlers may register for the same id; they run in order and a handler
   * may return true to stop the chain. Must be called BEFORE StartAsync so the Bolt subscription
   * is wired during socket-mode initialization.
   * @param {string} ArgActionID Action ID set on the Block Kit element.
   * @param {OnSlackActionAsync} ArgHandler Handler function.
   */
  HandleAction(ArgActionID, ArgHandler) {
    const Existing = this.#ActionHandlersByActionId.get(ArgActionID) ?? [];
    Existing.push(ArgHandler);
    this.#ActionHandlersByActionId.set(ArgActionID, Existing);
  }

  /**
   * Post a message to a Slack channel.
   * @param {string} ArgTargetChannelID Channel ID where the message will be posted.
   * @param {string} ArgReplyingToMessageID Timestamp of the message to which this message is a reply.
   * @param {string} ArgMessageText Text of the message to be posted.
   * @param {MessageMetadata} [ArgMessageMetadata] Optional metadata to attach to the message.
   * @param {SlackWriteAuditOptions} [ArgWriteAuditOptions] Optional caller tag for shared write auditing.
   * @returns {Promise<string|null>} Timestamp of the posted message when successful.
   */
  async PostMessageTextAsync(ArgTargetChannelID, ArgReplyingToMessageID, ArgMessageText, ArgMessageMetadata, ArgWriteAuditOptions) {
    const AuditContext = this.#CreateSlackWriteAuditContext(
      'text',
      ArgTargetChannelID,
      ArgReplyingToMessageID,
      ArgMessageText,
      ArgMessageMetadata,
      ArgWriteAuditOptions
    );
    this.#LogSlackWriteAttempt(AuditContext);

    /** @type {any} */
    let PostMessageResp;
    try {
      // post the message to the target channel.
      PostMessageResp = await this.#SlackBoltApp.client.chat.postMessage({
        channel: ArgTargetChannelID,
        thread_ts: ArgReplyingToMessageID,
        text: ArgMessageText,
        unfurl_links: false,
        metadata: this.#AttachAuditMetadata(ArgMessageMetadata, AuditContext),
      });
    } catch(error) {
      this.#LogSlackWriteFailure(AuditContext, error instanceof Error ? error.message : String(error));
      throw error;
    }

    // if post was successful, increment outgoing message stats.
    if(PostMessageResp.ok) {
      this.#WorkspaceStats.OutgoingMessageCount++;
      this.#WorkspaceStats.OutgoingMessageLength += ArgMessageText.length;
      this.#LogSlackWriteSuccess(AuditContext, PostMessageResp.ts ?? null);
      return PostMessageResp.ts ?? null;
    }

    // report an error if the message was not posted successfully.
    if(!PostMessageResp.ok)
      this.#LogSlackWriteFailure(AuditContext, PostMessageResp.error || 'unknown error');

    if(!PostMessageResp.ok)
      throw new Error(`Failed to post message: ${PostMessageResp.error || "unknown error"}`);

    return null;
  }

  /**
   * Post a message with blocks to a Slack channel and return true if the message was posted successfully.
   * @param {string} ArgTargetChannelID Channel ID where the message will be posted.
   * @param {string} ArgMessageText Text of the message to be posted.
   * @param {Array<Block|KnownBlock>} ArgMessageBlocks Blocks to include in the message.
   * @param {MessageMetadata} [ArgMessageMetadata] Optional metadata to attach to the message.
   * @param {string} [ArgReplyingToMessageID] Optional timestamp of message to reply to in a thread.
   * @param {SlackWriteAuditOptions} [ArgWriteAuditOptions] Optional caller tag for shared write auditing.
   * @returns {Promise<boolean>}
   */
  async PostMessageTextWithBlocksAsync(
    ArgTargetChannelID, ArgMessageText, ArgMessageBlocks, ArgMessageMetadata, ArgReplyingToMessageID, ArgWriteAuditOptions
  ) {
    const AuditContext = this.#CreateSlackWriteAuditContext(
      'blocks',
      ArgTargetChannelID,
      ArgReplyingToMessageID,
      ArgMessageText,
      ArgMessageMetadata,
      ArgWriteAuditOptions
    );
    this.#LogSlackWriteAttempt(AuditContext);

    try {
      // post the message to the target channel.
      const PostMessageResp = await this.#SlackBoltApp.client.chat.postMessage({
        channel: ArgTargetChannelID,
        text: ArgMessageText,
        blocks: ArgMessageBlocks,
        unfurl_links: false,
        metadata: this.#AttachAuditMetadata(ArgMessageMetadata, AuditContext),
        thread_ts: ArgReplyingToMessageID,
      });

      // if post was successful, increment outgoing message stats and return true.
      if(PostMessageResp.ok) {
        this.#WorkspaceStats.OutgoingMessageCount++;
        this.#WorkspaceStats.OutgoingMessageLength += ArgMessageText.length;
        this.#LogSlackWriteSuccess(AuditContext, PostMessageResp.ts ?? null);
        return true;
      }

      // log the error and return false if the message was not posted successfully.
      this.#LogSlackWriteFailure(AuditContext, PostMessageResp.error || 'unknown error');
      this.#SlackLogger.error(`Failed to post message: ${PostMessageResp.error || "unknown error"}`);
      return false;
    } catch(error) {
      // log the error and return false if an exception occurred.
      this.#LogSlackWriteFailure(AuditContext, error instanceof Error ? error.message : String(error));
      this.#SlackLogger.error(`Failed to post message:`, error);
      return false;
    }
  }

  /**
   * Upload one local file to Slack with an optional initial comment.
   * @param {string} ArgTargetChannelID Channel ID where the file share should be posted.
   * @param {string|null} ArgReplyingToMessageID Root thread timestamp when uploading into a thread.
   * @param {string} ArgLocalFilePath Absolute or relative local file path.
   * @param {string} [ArgInitialComment] Optional share comment text.
   * @param {string} [ArgDisplayFileName] Optional filename to show in Slack.
   * @param {SlackWriteAuditOptions} [ArgWriteAuditOptions] Optional caller tag for shared write auditing.
   * @returns {Promise<UploadedSlackFileResult>}
   */
  async UploadFileAsync(
    ArgTargetChannelID,
    ArgReplyingToMessageID,
    ArgLocalFilePath,
    ArgInitialComment,
    ArgDisplayFileName,
    ArgWriteAuditOptions
  ) {
    const LocalFilePath = path.resolve(ArgLocalFilePath);
    const DisplayFileName = ArgDisplayFileName || path.basename(LocalFilePath);
    const AuditContext = this.#CreateSlackWriteAuditContext(
      'file',
      ArgTargetChannelID,
      ArgReplyingToMessageID,
      ArgInitialComment || '',
      null,
      ArgWriteAuditOptions
    );
    this.#LogSlackWriteAttempt(AuditContext, ` file=${DisplayFileName}`);
    /** @type {any} */
    let UploadResp;
    try {
      UploadResp = await this.#SlackBoltApp.client.filesUploadV2({
        channel_id: ArgTargetChannelID,
        thread_ts: ArgReplyingToMessageID || undefined,
        initial_comment: ArgInitialComment || undefined,
        file: LocalFilePath,
        filename: DisplayFileName,
      });
    } catch(error) {
      this.#LogSlackWriteFailure(AuditContext, error instanceof Error ? error.message : String(error));
      throw error;
    }

    if(!UploadResp.ok || !UploadResp.files?.length) {
      this.#LogSlackWriteFailure(AuditContext, UploadResp.error || 'Slack did not return a file payload.');
      throw new Error(`Failed to upload file: ${UploadResp.error || 'Slack did not return a file payload.'}`);
    }
    const Uploaded = SlackApp.NormalizeUploadedFileResult(
      UploadResp,
      ArgTargetChannelID,
      DisplayFileName,
      ArgReplyingToMessageID || null
    );
    this.#LogSlackWriteSuccess(AuditContext, Uploaded.MessageTS, ` file=${DisplayFileName}`);
    return Uploaded;
  }

  /**
   * Create a short, unique audit record for one outbound Slack write.
   * @param {'text'|'blocks'|'file'} ArgKind Outbound write shape.
   * @param {string} ArgTargetChannelID Target channel ID.
   * @param {string|null|undefined} ArgThreadTS Thread root timestamp when threaded.
   * @param {string} ArgMessageText Main text/comment body.
   * @param {MessageMetadata|null|undefined} ArgMessageMetadata Existing metadata.
   * @param {SlackWriteAuditOptions|null|undefined} ArgWriteAuditOptions Caller-supplied audit options.
   * @returns {SlackWriteAuditContext|null}
   */
  #CreateSlackWriteAuditContext(ArgKind, ArgTargetChannelID, ArgThreadTS, ArgMessageText, ArgMessageMetadata, ArgWriteAuditOptions) {
    if(!SlackWriteAudit.Enabled) return null;

    this.#SlackWriteAuditCounter++;
    const AuditID = `slk-${Date.now()}-${this.#SlackWriteAuditCounter}`;
    const NormalizedText = typeof ArgMessageText === 'string' ? ArgMessageText : '';
    const Preview = SlackWriteAudit.IncludePreview
      ? NormalizedText.replace(/\s+/g, ' ').trim().slice(0, 160)
      : null;

    return {
      AuditID,
      Kind: ArgKind,
      Tag: typeof ArgWriteAuditOptions?.Tag === 'string' && ArgWriteAuditOptions.Tag.trim().length > 0
        ? ArgWriteAuditOptions.Tag.trim()
        : SlackWriteAudit.DefaultTag,
      TargetChannelID: ArgTargetChannelID,
      ThreadTS: ArgThreadTS,
      TextLength: NormalizedText.length,
      Preview: SlackWriteAudit.IncludePreview ? (Preview || '(empty)') : null,
      MetadataEventType: typeof ArgMessageMetadata?.event_type === 'string' ? ArgMessageMetadata.event_type : null,
    };
  }

  /**
   * Attach audit fields to Slack message metadata without disturbing existing event types/payloads.
   * @param {MessageMetadata|null|undefined} ArgMessageMetadata Existing metadata.
   * @param {SlackWriteAuditContext|null} ArgAuditContext Audit context.
   * @returns {MessageMetadata|null|undefined}
   */
  #AttachAuditMetadata(ArgMessageMetadata, ArgAuditContext) {
    if(!ArgAuditContext) return ArgMessageMetadata;

    const ExistingPayload = (ArgMessageMetadata && typeof ArgMessageMetadata.event_payload === 'object' && ArgMessageMetadata.event_payload)
      ? ArgMessageMetadata.event_payload
      : {};

    return /** @type {MessageMetadata} */({
      event_type: ArgMessageMetadata?.event_type || 'sleuth-write-audit',
      event_payload: {
        ...ExistingPayload,
        SleuthAuditWriteID: ArgAuditContext.AuditID,
        SleuthAuditWriteKind: ArgAuditContext.Kind,
        SleuthAuditWriteTag: ArgAuditContext.Tag,
      }
    });
  }

  /**
   * Log the start of an outbound Slack write.
   * @param {SlackWriteAuditContext|null} ArgAuditContext Audit context.
   * @param {string} [ArgSuffix] Optional trailing context for specialized writes.
   */
  #LogSlackWriteAttempt(ArgAuditContext, ArgSuffix = '') {
    if(!ArgAuditContext) return;

    const PreviewSegment = ArgAuditContext.Preview
      ? ` preview=${JSON.stringify(ArgAuditContext.Preview)}`
      : '';
    this.#SlackLogger.info(
      `[slack-write:${ArgAuditContext.AuditID}] attempt kind=${ArgAuditContext.Kind} tag=${ArgAuditContext.Tag} ` +
      `channel=${ArgAuditContext.TargetChannelID} thread=${ArgAuditContext.ThreadTS || '-'} ` +
      `textLength=${ArgAuditContext.TextLength} metadata=${ArgAuditContext.MetadataEventType || '-'} ` +
      `${PreviewSegment}${ArgSuffix}`
    );
  }

  /**
   * Log a successful outbound Slack write.
   * @param {SlackWriteAuditContext|null} ArgAuditContext Audit context.
   * @param {string|null} ArgPostedTS Message/share timestamp if known.
   * @param {string} [ArgSuffix] Optional trailing context for specialized writes.
   */
  #LogSlackWriteSuccess(ArgAuditContext, ArgPostedTS, ArgSuffix = '') {
    if(!ArgAuditContext) return;

    this.#SlackLogger.info(
      `[slack-write:${ArgAuditContext.AuditID}] success kind=${ArgAuditContext.Kind} tag=${ArgAuditContext.Tag} ` +
      `channel=${ArgAuditContext.TargetChannelID} thread=${ArgAuditContext.ThreadTS || '-'} ` +
      `postedTs=${ArgPostedTS || '-'}${ArgSuffix}`
    );
  }

  /**
   * Log a failed outbound Slack write.
   * @param {SlackWriteAuditContext|null} ArgAuditContext Audit context.
   * @param {string} ArgErrorMessage Error summary.
   */
  #LogSlackWriteFailure(ArgAuditContext, ArgErrorMessage) {
    if(!ArgAuditContext) return;

    this.#SlackLogger.error(
      `[slack-write:${ArgAuditContext.AuditID}] failure kind=${ArgAuditContext.Kind} tag=${ArgAuditContext.Tag} ` +
      `channel=${ArgAuditContext.TargetChannelID} thread=${ArgAuditContext.ThreadTS || '-'} ` +
      `error=${ArgErrorMessage}`
    );
  }

  /**
   * Get all messages in a thread.
   * @param {string} ArgChannelID Channel ID where the thread is located.
   * @param {string} ArgThreadTS Timestamp of the parent message of the thread.
   * @returns {Promise<Array<MessageInfo>>}
   */
  async GetConversationMessagesAsync(ArgChannelID, ArgThreadTS) {
    // get all the messages in the thread.
    const ThreadMessages = await this.#SlackBoltApp.client.conversations.replies({
      channel: ArgChannelID,
      ts: ArgThreadTS,
    });

    // if we could not get the thread messages, report an error.
    if(!ThreadMessages.ok)
      throw new Error(`Failed to get thread messages: ${ThreadMessages.error || "unknown error"}`);

    // map the messages to the MessageInfo type and return the array.
    return ThreadMessages.messages.map(this.#MapSlackMessageToMessageInfo);
  }

  /**
   * Get recent messages from a channel timeline.
   * @param {string} ArgChannelID Channel ID to read.
   * @param {number} [ArgLimit] Maximum number of messages to fetch.
   * @returns {Promise<Array<MessageInfo>>}
   */
  async GetRecentChannelMessagesAsync(ArgChannelID, ArgLimit = 10) {
    const Limit = Number.isInteger(ArgLimit) && ArgLimit > 0 ? ArgLimit : 10;
    const HistoryResp = await this.#SlackBoltApp.client.conversations.history({
      channel: ArgChannelID,
      limit: Limit,
    });

    if(!HistoryResp.ok)
      throw new Error(`Failed to get channel history: ${HistoryResp.error || 'unknown error'}`);

    return (HistoryResp.messages || []).map(this.#MapSlackMessageToMessageInfo);
  }

  /**
   * Invoke the registered app_mention handlers locally without waiting for a live Slack event.
   * Useful for one-shot operator harnesses that need production routing semantics against
   * live Slack objects (for example file URLs) without running the long-lived Socket Mode loop.
   * @param {AppMentionEventInfo} ArgEventInfo Event payload to dispatch.
   * @returns {Promise<boolean>} True when any handler reported the event handled.
   */
  async SimulateAppMentionAsync(ArgEventInfo) {
    this.#SlackLogger.info(`simulated app_mention event (${this.#WorkspaceInfo.WORKSPACE_NAME}):`, ArgEventInfo);

    for(const handler of this.#AppMentionHandlers) {
      try {
        if(await handler(this, ArgEventInfo)) return true;
      } catch(error) {
        this.#SlackLogger.error('Error in simulated app_mention handler:', error);
      }
    }

    return false;
  }

  /**
   * Return the thread root timestamp for any message (root or reply).
   * Uses reactions.get which returns the full message object including thread_ts.
   * Returns null on failure.
   * @param {string} ArgChannelID Channel ID where the message is located.
   * @param {string} ArgMessageTS Timestamp of the message.
   * @returns {Promise<string|null>}
   */
  async GetMessageThreadTsAsync(ArgChannelID, ArgMessageTS) {
    try {
      const Response = await this.#SlackBoltApp.client.reactions.get({
        channel: ArgChannelID,
        timestamp: ArgMessageTS,
        full: false,
      });
      if(!Response.ok || !Response.message) return null;
      const MessageInfo = /** @type {{ thread_ts?: string, ts?: string }} */ (Response.message);
      return MessageInfo.thread_ts ?? MessageInfo.ts ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Map one raw Slack message into Sleuth's MessageInfo shape.
   * @param {any} ArgCurrentMessage Raw Slack message payload.
   * @returns {MessageInfo}
   */
  #MapSlackMessageToMessageInfo(ArgCurrentMessage) {
    const Reactions = /** @type {Array<{ name: string }>|undefined} */ (ArgCurrentMessage.reactions);
    const RawFiles = /** @type {Array<any>|undefined} */ (ArgCurrentMessage.files);
    return {
      user: ArgCurrentMessage.user,
      text: ArgCurrentMessage.text,
      ts: ArgCurrentMessage.ts,
      thread_ts: ArgCurrentMessage.thread_ts,
      bot_id: ArgCurrentMessage.bot_id,
      files: Array.isArray(RawFiles)
        ? RawFiles.map((ArgFile) => SlackApp.NormalizeSlackFileInfo(ArgFile))
        : undefined,
      reactions: Reactions?.map((ArgReaction) => ArgReaction.name) ?? [],
    };
  }

  /**
   * Get channel ID for a given channel name (null if not found).
   * @param {string} ArgChannelName Name of the channel.
   * @returns {Promise<string|null>}
   */
  async GetChannelIdAsync(ArgChannelName) {
    // get team ID to search for the channel.
    const TeamID = (await this.#SlackBoltApp.client.auth.test()).team_id;

    // get list of public and private channels in the team.
    let ConversationListResp = await this.#SlackBoltApp.client.conversations.list({
      team_id: TeamID,
      types: "public_channel,private_channel"
    });

    // exit early if channel list could not be retrieved.
    if(!ConversationListResp.ok) return null;

    // search through all pages of channels.
    while(true) {
      // search for channel in current batch of channels.
      for(const TargetChannel of ConversationListResp.channels) {
        if(TargetChannel.name.includes(ArgChannelName))
          return TargetChannel.id;
      }

      // check if we need to fetch more pages.
      const HaveMorePages = !!ConversationListResp.response_metadata?.next_cursor;

      // exit loop if no more pages to fetch.
      if(!HaveMorePages) break;

      // get next page of channels.
      ConversationListResp = await this.#SlackBoltApp.client.conversations.list({
        team_id: TeamID,
        types: "public_channel,private_channel",
        cursor: ConversationListResp.response_metadata.next_cursor
      });

      // exit early if channel list could not be retrieved.
      if(!ConversationListResp.ok) return null;
    }

    // channel was not found.
    return null;
  }

  /**
   * Get the name of a channel given its ID.
   * @param {string} ArgChannelID ID of the channel.
   * @returns {Promise<string|null>}
   */
  async GetChannelNameAsync(ArgChannelID) {
    try {
      // get the channel info for the given channel ID.
      const ChannelInfoResp = await this.#SlackBoltApp.client.conversations.info({ channel: ArgChannelID });

      // check if the request was successful and return the channel name.
      if(ChannelInfoResp.ok) return ChannelInfoResp.channel.name;

      // return null if the request was not successful.
      return null;
    } catch(error) {
      // return null if an error occurred.
      return null;
    }
  }

  /**
   * Whether a channel is private (private channel, DM, or multi-person DM). Returns `null` when the
   * lookup fails — callers enforcing a privacy boundary (e.g. ask-reminders) should treat `null` as
   * private and exclude it (fail-closed), never leak it.
   * @param {string} ArgChannelID ID of the channel.
   * @returns {Promise<boolean|null>}
   */
  async IsChannelPrivateAsync(ArgChannelID) {
    try {
      const ChannelInfoResp = await this.#SlackBoltApp.client.conversations.info({ channel: ArgChannelID });
      if(ChannelInfoResp.ok && ChannelInfoResp.channel) {
        const Channel = ChannelInfoResp.channel;
        return Boolean(Channel.is_private || Channel.is_im || Channel.is_mpim);
      }
      return null;
    } catch(error) {
      return null;
    }
  }

  /**
   * Get permalink for a given channel ID and message timestamp (null if not found or an error occurred).
   *
   * GH-428: `chat.getPermalink`'s own `permalink` field is not used as-is — it can come back wrapped
   * in a `/?redir=%2Farchives%2F...` auth-bounce form that renders a blank page for some
   * browser/session combinations (third-party cookies blocked, not signed into this workspace in
   * that tab, etc.). The API call above still gates access/existence (`!PermalinkResp.ok` → null),
   * but once it succeeds we already have every piece needed (workspace name, channel, message ts,
   * optional thread root ts) to build the same canonical `/archives/CHANNEL/pTS` URL ourselves —
   * so we do, sidestepping whatever produced the redir wrapper.
   * @param {string} ArgChannelID  ID of the channel where the message was posted.
   * @param {string} ArgMessageTS Timestamp of the message.
   * @param {string} [ArgThreadTS] Thread root timestamp, when the message is a threaded reply —
   *   included as `?thread_ts=...&cid=...` so the link deep-links into the thread view.
   * @returns {Promise<string|null>}
   */
  async GetPermaLinkAsync(ArgChannelID, ArgMessageTS, ArgThreadTS) {
    try {
      // request the permalink for the given channel ID and message timestamp — this call still
      // owns the access/existence check (private channel, deleted message, etc).
      const PermalinkResp = await this.#SlackBoltApp.client.chat.getPermalink({
        channel: ArgChannelID,
        message_ts: ArgMessageTS
      });

      // if the request was not successful, return null.
      if(!PermalinkResp.ok) return null;

      // build our own canonical, redir-free URL when we have a workspace name to build it from;
      // fall back to Slack's own response otherwise so behavior degrades gracefully.
      const WorkspaceName = this.WorkspaceInfo?.WORKSPACE_NAME;
      if(!WorkspaceName) return PermalinkResp.permalink;

      const CanonicalMessageTS = ArgMessageTS.replace('.', '');
      const ThreadQuery = (ArgThreadTS && ArgThreadTS !== ArgMessageTS)
        ? `?thread_ts=${ArgThreadTS}&cid=${ArgChannelID}`
        : '';
      return `https://${WorkspaceName}.slack.com/archives/${ArgChannelID}/p${CanonicalMessageTS}${ThreadQuery}`;
    } catch(error) {
      // return null if an error occurred.
      return null;
    }
  }

  /**
   * Get metadata for a given channel ID and message timestamp (null if not found or an error occurred).
   * @param {string} ArgChannelID ID of the channel where the message was posted.
   * @param {string} ArgMessageTS Timestamp of the message.
   * @returns {Promise<MessageMetadata|null>}
   */
  async GetMessageMetadataAsync(ArgChannelID, ArgMessageTS) {
    try {
      // first try getting the message from conversation history (works for top-level messages).
      let MessageResponse = await this.#SlackBoltApp.client.conversations.history({
        channel: ArgChannelID,
        oldest: ArgMessageTS,
        limit: 1,
        inclusive: true,
        include_all_metadata: true
      });

      // if history request failed, returned no messages, or did not return the target message then try getting message
      // from thread replies (works for thread messages).
      if(!MessageResponse.ok || !MessageResponse.messages?.length || MessageResponse.messages[0].ts !== ArgMessageTS) {
        MessageResponse = await this.#SlackBoltApp.client.conversations.replies({
          channel: ArgChannelID,
          ts: ArgMessageTS,
          limit: 1,
          inclusive: true,
          include_all_metadata: true
        });
      }

      // exit early if both requests failed, returned no messages or did not return the target message.
      if(!MessageResponse.ok || !MessageResponse.messages?.length || MessageResponse.messages[0].ts !== ArgMessageTS)
        return null;

      // get metadata from the first message.
      const MessageMetadata = MessageResponse.messages[0].metadata;
      if(!MessageMetadata) return null;

      // map the metadata fields to ensure type compatibility.
      return {
        event_type: MessageMetadata.event_type || '',
        event_payload: MessageMetadata.event_payload
      };
    } catch(error) {
      // return null if an error occurred.
      this.#SlackLogger.error(`Failed to get message metadata:`, error);
      return null;
    }
  }

  /**
   * Delete a message from a Slack channel and return true if deletion was successful.
   * @param {string} ArgChannelID ID of the channel containing the message.
   * @param {string} ArgMessageTS Timestamp of the message to delete.
   * @returns {Promise<boolean>}
   */
  async DeleteMessageAsync(ArgChannelID, ArgMessageTS) {
    try {
      // attempt to delete the message.
      const DeleteMessageResp = await this.#SlackBoltApp.client.chat.delete({
        channel: ArgChannelID,
        ts: ArgMessageTS
      });

      // if deletion was successful, return true.
      if(DeleteMessageResp.ok) return true;

      // if we couldn't delete the message, log the error and return false.
      this.#SlackLogger.error(`Failed to delete message: ${DeleteMessageResp.error || "unknown error"}`);
      return false;
    } catch(error) {
      // log the error and return false if an exception occurred.
      this.#SlackLogger.error(`Failed to delete message:`, error);
      return false;
    }
  }

  /**
   * Add a reaction emoji to a Slack message and return true if successful.
   * @param {string} ArgChannelID ID of channel containing the message.
   * @param {string} ArgMessageTS Timestamp of message to add reaction to.
   * @param {string} ArgReaction Name of the reaction emoji (without colons).
   * @returns {Promise<boolean>} 
   */
  async AddReactionAsync(ArgChannelID, ArgMessageTS, ArgReaction) {
    try {
      // try to add the reaction to the message.
      const AddReactionResp = await this.#SlackBoltApp.client.reactions.add({
        channel: ArgChannelID,
        timestamp: ArgMessageTS,
        name: ArgReaction
      });

      // if reaction was added successfully, return true.
      if(AddReactionResp.ok) return true;

      // log error and return false if reaction wasn't added.
      this.#SlackLogger.error(`Failed to add reaction: ${AddReactionResp.error || "unknown error"}`);
      return false;
    } catch(error) {
      // log error and return false if an exception occurred.
      this.#SlackLogger.error(`Failed to add reaction:`, error);
      return false;
    }
  }

  /**
   * Get a normalized Slack user identity with caching and stale-on-error fallback.
   * @param {string} ArgUserID User ID to look up.
   * @param {SlackUserIdentityLookupOptions} [ArgOptions] Lookup options.
   * @returns {Promise<SlackUserIdentity|null>}
   */
  async GetUserIdentityAsync(ArgUserID, ArgOptions = {}) {
    if(typeof ArgUserID !== 'string' || ArgUserID.length === 0) return null;

    const CacheTTLMS = typeof ArgOptions.CacheTTLMS === 'number' && ArgOptions.CacheTTLMS > 0
      ? ArgOptions.CacheTTLMS
      : UserIdentityCacheTTLMS;
    const AllowStaleOnError = ArgOptions.AllowStaleOnError !== false;
    const CachedEntry = this.#UserIdentityCacheById.get(ArgUserID) || null;
    const IsInErrorBackoffWindow = !!CachedEntry?.ErrorBackoffUntilMS && Date.now() < CachedEntry.ErrorBackoffUntilMS;

    if(!ArgOptions.ForceRefresh && CachedEntry && (
      (Date.now() - CachedEntry.CachedAtMS) < CacheTTLMS || IsInErrorBackoffWindow
    ))
      return CachedEntry.Identity;

    const PendingLookup = this.#PendingUserIdentityLookupsById.get(ArgUserID);
    if(PendingLookup) return await PendingLookup;

    const LookupPromise = this.#FetchUserIdentityAsync(ArgUserID, CachedEntry, AllowStaleOnError);
    this.#PendingUserIdentityLookupsById.set(ArgUserID, LookupPromise);

    try {
      return await LookupPromise;
    } finally {
      this.#PendingUserIdentityLookupsById.delete(ArgUserID);
    }
  }

  /**
   * Get a user's display name (falls back to real_name, then username, then null).
   * @param {string} ArgUserID User ID to look up.
   * @param {SlackUserIdentityLookupOptions} [ArgOptions] Lookup options.
   * @returns {Promise<string|null>}
   */
  async GetUserDisplayNameAsync(ArgUserID, ArgOptions = {}) {
    const Identity = await this.GetUserIdentityAsync(ArgUserID, ArgOptions);
    return Identity?.DisplayName || null;
  }

  /**
   * Fetch one user identity from Slack and update the resolver cache.
   * @param {string} ArgUserID User ID to fetch.
   * @param {{ Identity: SlackUserIdentity, CachedAtMS: number, ErrorBackoffUntilMS: number|null }|null} ArgCachedEntry Existing cached entry if one exists.
   * @param {boolean} ArgAllowStaleOnError Whether stale cached data may be returned on fetch failure.
   * @returns {Promise<SlackUserIdentity|null>}
   */
  async #FetchUserIdentityAsync(ArgUserID, ArgCachedEntry, ArgAllowStaleOnError) {
    try {
      const UserInfo = await this.#SlackBoltApp.client.users.info({ user: ArgUserID });
      if(!UserInfo.ok) {
        this.#SlackLogger.warn(
          `users.info failed for user ${ArgUserID}: ${UserInfo.error || 'unknown error'}`
        );
        if(ArgAllowStaleOnError && ArgCachedEntry) return ArgCachedEntry.Identity;
        return null;
      }

      const Identity = this.#BuildUserIdentity(ArgUserID, UserInfo.user);
      this.#UserIdentityCacheById.set(ArgUserID, {
        Identity,
        CachedAtMS: Date.now(),
        ErrorBackoffUntilMS: null,
      });
      return Identity;
    } catch(error) {
      if(error.data?.error === 'missing_scope') {
        this.#SlackLogger.warn(
          `users.info missing users:read scope while resolving user ${ArgUserID}.`
        );
      } else {
        this.#SlackLogger.error(`Failed to resolve Slack user ${ArgUserID}:`, error);
      }

      if(ArgAllowStaleOnError && ArgCachedEntry) {
        this.#UserIdentityCacheById.set(ArgUserID, {
          Identity: ArgCachedEntry.Identity,
          CachedAtMS: ArgCachedEntry.CachedAtMS,
          ErrorBackoffUntilMS: Date.now() + UserIdentityErrorBackoffTTLMS,
        });
        this.#SlackLogger.warn(`Using stale cached Slack identity for user ${ArgUserID}.`);
        return ArgCachedEntry.Identity;
      }

      return null;
    }
  }

  /**
   * Build the normalized cached user identity object from Slack's users.info payload.
   * @param {string} ArgUserID User ID being resolved.
   * @param {any} ArgUserInfo Raw Slack user object.
   * @returns {SlackUserIdentity}
   */
  #BuildUserIdentity(ArgUserID, ArgUserInfo) {
    const Profile = ArgUserInfo?.profile || {};
    const RealName = Profile.real_name || Profile.real_name_normalized || ArgUserInfo?.real_name || null;
    const Username = typeof ArgUserInfo?.name === 'string' && ArgUserInfo.name.length > 0 ? ArgUserInfo.name : null;
    const DisplayName = this.#ResolvePreferredUserLabel(Profile, ArgUserInfo);

    return {
      UserID: ArgUserID,
      Mention: `<@${ArgUserID}>`,
      DisplayName,
      RealName,
      Username,
      Email: typeof Profile.email === 'string' && Profile.email.length > 0 ? Profile.email : null,
      IsBot: !!ArgUserInfo?.is_bot,
      IsDeleted: !!ArgUserInfo?.deleted,
      IsAdmin: !!ArgUserInfo?.is_admin,
      IsOwner: !!ArgUserInfo?.is_owner,
      IsPrimaryOwner: !!ArgUserInfo?.is_primary_owner,
      LastFetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Resolve the best human-readable user label from Slack's profile fields.
   * @param {any} ArgProfile Slack profile object.
   * @param {any} ArgUserInfo Raw Slack user object.
   * @returns {string|null}
   */
  #ResolvePreferredUserLabel(ArgProfile, ArgUserInfo) {
    const CandidateValues = [
      ArgProfile?.display_name,
      ArgProfile?.display_name_normalized,
      ArgProfile?.real_name,
      ArgProfile?.real_name_normalized,
      ArgUserInfo?.real_name,
      ArgUserInfo?.name,
    ];

    for(const CandidateValue of CandidateValues) {
      if(typeof CandidateValue === 'string' && CandidateValue.trim().length > 0)
        return CandidateValue.trim();
    }

    return null;
  }

  /**
   * Check if bot is a member of a channel (null is returned if an error occurred).
   * @param {string} ArgChannelID Channel ID to check membership for.
   * @returns {Promise<boolean|null>}
   */
  async IsChannelMemberAsync(ArgChannelID) {
    try {
      // get info about the channel.
      const ChannelInfoResp = await this.#SlackBoltApp.client.conversations.info({ channel: ArgChannelID });

      // if request was successful, return the membership status.
      if(ChannelInfoResp.ok) return ChannelInfoResp.channel.is_member;

      // return null since we couldn't get channel info. This means we can't say
      // for sure if the bot is a member or not.
      return null;
    } catch(error) {
      // log error and return null if an exception occurred.
      this.#SlackLogger.error(`failed to check channel membership:`, error);
      return null;
    }
  }

  /**
   * Check whether a specific user is a member of a channel. Returns `null` when the lookup fails or is
   * inconclusive — callers enforcing a privacy boundary (e.g. ask-reminders' membership-aware scoping)
   * must treat `null` as "not a member" (fail-closed) and never leak the channel's contents.
   *
   * Slack only returns a member list for conversations the bot can see, so for a private channel the
   * bot must itself be a member (it is, for any channel where Sleuth posted the reminder). Paginates up
   * to a bounded number of pages so a pathologically large channel cannot stall a query; hitting the
   * cap without finding the user is inconclusive (`null`), not a definitive "not a member".
   * @param {string} ArgChannelID Channel ID to check.
   * @param {string} ArgUserID User ID to look for.
   * @returns {Promise<boolean|null>}
   */
  async IsUserChannelMemberAsync(ArgChannelID, ArgUserID) {
    if(!ArgChannelID || !ArgUserID) return null;
    try {
      // Client/private channels are small in practice; 25 pages * 200 = 5000 members before we give up.
      const MaxPages = 25;
      let Cursor;
      for(let Page = 0; Page < MaxPages; Page++) {
        const MembersResp = await this.#SlackBoltApp.client.conversations.members({
          channel: ArgChannelID,
          limit: 200,
          ...(Cursor ? { cursor: Cursor } : {})
        });

        if(!MembersResp.ok || !Array.isArray(MembersResp.members)) return null;
        if(MembersResp.members.includes(ArgUserID)) return true;

        Cursor = MembersResp.response_metadata && MembersResp.response_metadata.next_cursor;
        if(!Cursor) return false; // walked the entire membership; user is not present.
      }

      // Hit the page cap without exhausting the membership — inconclusive, fail-closed.
      this.#SlackLogger.error(`user channel membership scan hit page cap for channel ${ArgChannelID}`);
      return null;
    } catch(error) {
      this.#SlackLogger.error(`failed to check user channel membership:`, error);
      return null;
    }
  }

  /**
   * Check if a user is the creator of a channel.
   * @param {string} ArgChannelID Channel ID to check.
   * @param {string} ArgUserID User ID to check.
   * @returns {Promise<boolean>}
   */
  async IsChannelCreatorAsync(ArgChannelID, ArgUserID) {
    try {
      // get info about the channel.
      const ConversationInfo = await this.#SlackBoltApp.client.conversations.info({ channel: ArgChannelID });

      // the user is the creator of the channel if the request was successful and the user ID matches the creator's ID.
      return ConversationInfo.ok && ConversationInfo.channel.creator === ArgUserID;
    } catch(error) {
      // if an error occurs, log it and defensively assume the user is NOT the channel creator.
      this.#SlackLogger.error("Error checking channel creator:", error);
      return false;
    }
  }

  /**
   * Check if a user is a workspace admin or owner.
   * @param {string} ArgUserID User ID to check.
   * @returns {Promise<boolean>}
   */
  async IsAdminOrOwnerAsync(ArgUserID) {
    const Identity = await this.GetUserIdentityAsync(ArgUserID);
    if(!Identity) return false;
    return Identity.IsAdmin || Identity.IsOwner || Identity.IsPrimaryOwner;
  }

  /**
   * Download the text content of a private Slack file using the workspace bot token.
   * Requires the `files:read` OAuth scope to be granted to the app.
   * @param {string} ArgFileURL Download URL of the file (url_private_download from the file object).
   * @returns {Promise<string>} Raw text content of the file.
   */
  async GetFileContentAsync(ArgFileURL) {
    const AuthHeaders = { 'Authorization': `Bearer ${this.#WorkspaceInfo.LIVE_TOKEN}` };
    const RequestURL = new URL(ArgFileURL);

    // First request with redirect: 'manual' so same-origin redirects can keep auth while
    // cross-origin signed URLs are followed without leaking the workspace bearer token.
    const First = await fetch(RequestURL, { headers: AuthHeaders, redirect: 'manual' });

    let Response;
    if(First.status >= 300 && First.status < 400) {
      const Location = First.headers.get('location');
      if(!Location)
        throw new Error('Slack file redirect missing location header.');

      const RedirectURL = new URL(Location, RequestURL);
      if(RedirectURL.protocol !== 'https:')
        throw new Error(`Refusing to follow Slack file redirect to non-HTTPS host '${RedirectURL.host || 'unknown-host'}'.`);

      const ShouldForwardAuth = RedirectURL.origin === RequestURL.origin;
      this.#SlackLogger.info(
        `[GetFileContentAsync] following redirect to host: ${SlackApp.GetSafeUrlHostForLog(RedirectURL.toString())} | forwarded auth: ${ShouldForwardAuth}`
      );
      Response = await fetch(
        RedirectURL,
        ShouldForwardAuth ? { headers: AuthHeaders } : {}
      );
    } else {
      Response = First;
    }

    const ContentType = Response.headers.get('content-type') ?? 'unknown';
    this.#SlackLogger.info(`[GetFileContentAsync] HTTP ${Response.status} | ${ContentType}`);
    if(!Response.ok)
      throw new Error(`Failed to fetch Slack file (HTTP ${Response.status}).`);
    return await Response.text();
  }

  /**
   * Handle Slack reaction_added event which is triggered when a user adds an emoji reaction to a message.
   * - must subscribe to the `reaction_added` event here: https://api.slack.com/apps/A07JBP3KX45/event-subscriptions
   * - must add reactions:read scope here: https://api.slack.com/apps/A07JBP3KX45/oauth
   * @param {ReactionAddedArgs & AllMiddlewareArgs} ArgEventInfo Event payload.
   * @returns {Promise<void>}
   */
  async #OnReactionAddedAsync({ event: ArgEvent }) {
    // capture essential information from the reaction_added event.
    const ReactionAddedInfo = /** @type {ReactionAddedEventInfo} */ ({
      user: ArgEvent.user,
      reaction: ArgEvent.reaction,
      item: {
        channel: ArgEvent.item.channel,
        ts: ArgEvent.item.ts,
      },
    });

    // indicate that we are processing the reaction_added event.
    this.#SlackLogger.info("=".repeat(90));
    this.#SlackLogger.info(`reaction_added event (${this.#WorkspaceInfo.WORKSPACE_NAME}):`, ReactionAddedInfo);
    
    // write separator to file log if available.
    if(this.#SlackLogger.WriteSeparatorAsync) {
      this.#SlackLogger.WriteSeparatorAsync(`reaction_added event (${this.#WorkspaceInfo.WORKSPACE_NAME})`);
    }

    // enumerate handlers and invoke each one.
    for(const handler of this.#ReactionAddedHandlers) {
      try {
        if(await handler(this, ReactionAddedInfo)) break;
      } catch(error) {
        this.#SlackLogger.error("Error in reaction_added handler:", error);
      }
    }
  }

  /**
   * Handle Slack app_mention event which is triggered when a user mentions the app in a channel.
   * - must subscribe to the `app_mention` event here: https://api.slack.com/apps/A07JBP3KX45/event-subscriptions
   * - must add app_mentions:read scope here: https://api.slack.com/apps/A07JBP3KX45/oauth
   * @param {AppMentionArgs & AllMiddlewareArgs} ArgEventInfo Event payload.
   * @returns {Promise<void>}
   */
  async #OnAppMentionAsync({ event: ArgEvent }) {
    // capture essential information from the app_mention event.
    const AppMentionInfo =  /** @type {AppMentionEventInfo} */ ({
      channel: ArgEvent.channel,
      text: ArgEvent.text,
      ts: ArgEvent.ts,
      thread_ts: ArgEvent.thread_ts,
      user: ArgEvent.user,
      files: ArgEvent.files ?? [],
    });

    // indicate that we are processing the app_mention event.
    this.#SlackLogger.info("=".repeat(90));
    this.#SlackLogger.info(`app_mention event (${this.#WorkspaceInfo.WORKSPACE_NAME}):`, AppMentionInfo);
    
    // write separator to file log if available.
    if(this.#SlackLogger.WriteSeparatorAsync) {
      this.#SlackLogger.WriteSeparatorAsync(`app_mention event (${this.#WorkspaceInfo.WORKSPACE_NAME})`);
    }

    // enumerate handlers and invoke each one.
    for(const handler of this.#AppMentionHandlers) {
      try {
        if(await handler(this, AppMentionInfo)) break;
      } catch(error) {
        this.#SlackLogger.error("Error in app_mention handler:", error);
      }
    }
  }

  /**
   * Handle Slack message event which is triggered when a user sends a message to a channel.
   * @param {MessageArgs & AllMiddlewareArgs} ArgEventInfo Event payload.
   * @returns {Promise<void>}
   */
  async #OnMessageAsync({ message: ArgMessage }) {
    // ignore messages with structures we don't support. We assume this is any message with a subtype except those listed
    // in the condition below, since they won't have the fields we need to process the message correctly in the code that
    // follows later (i.e. text, ts, user, channel).
    if(ArgMessage.subtype && ArgMessage.subtype !== 'file_share') {
      this.#SlackLogger.info("ignoring message with subtype:", ArgMessage.subtype);
      return;
    }

    // ignore messages that don't have a top-level "text" field (e.g. messages for message_changed events). This was
    // done to silence the TypeScript compiler since it only applies to messages with a subtype field and we are already
    // ignoring those above. See this for the gory details: https://chatgpt.com/share/66f878d4-925c-8008-bb61-341ba6c5c40a
    if(!('text' in ArgMessage) || typeof ArgMessage.text !== 'string') {
      this.#SlackLogger.info("ignoring message without top-level text field:", ArgMessage);
      return;
    }

    // check if message contains /no-eval trigger to skip all processing
    if(ArgMessage.text.toLowerCase().includes('/no-eval')) {
      this.#SlackLogger.info("ignoring message with /no-eval trigger:", ArgMessage.text);
      return;
    }

    // ignore messages that mention the app itself since we are already handling those in the app_mention event.
    if(ArgMessage.text.includes(this.#AppMentionString)) {
      this.#SlackLogger.info("ignoring message that mentions the app:", ArgMessage.text);
      return;
    }

    // increment incoming message stats.
    this.#WorkspaceStats.IncomingMessageCount++;
    this.#WorkspaceStats.IncomingMessageLength += ArgMessage.text.length;

    // capture essential information from the message event.
    const MessageEventInfo = /** @type {MessageEventInfo} */ ({
      channel: ArgMessage.channel,
      text: ArgMessage.text,
      ts: ArgMessage.ts,
      thread_ts: 'thread_ts' in ArgMessage ? ArgMessage.thread_ts : null,
      user: ArgMessage.user,
      subtype: ArgMessage.subtype,
      files: ('files' in ArgMessage && Array.isArray(ArgMessage.files)) ? ArgMessage.files : [],
      channel_type: 'channel_type' in ArgMessage ? ArgMessage.channel_type : undefined,
    });

    // indicate that we are processing the message event.
    this.#SlackLogger.info("=".repeat(90));
    this.#SlackLogger.info(`message event (${this.#WorkspaceInfo.WORKSPACE_NAME}):`, MessageEventInfo);
    
    // write separator to file log if available.
    if(this.#SlackLogger.WriteSeparatorAsync) {
      this.#SlackLogger.WriteSeparatorAsync(`message event (${this.#WorkspaceInfo.WORKSPACE_NAME})`);
    }

    // enumerate handlers and invoke each one.
    for(const handler of this.#MessageHandlers) {
      try {
        if(await handler(this, MessageEventInfo)) break;
      } catch(error) {
        this.#SlackLogger.error("Error in message handler:", error);
      }
    }
  }

  /**
   * Handle a Slack block_actions interaction (button click on a message Block Kit element).
   * Bolt requires the handler to ack() within 3 seconds, so we ack first and then run our
   * user-supplied handler chain for the originating action_id.
   * @param {string} ArgActionID Action ID the handler chain is registered under.
   * @param {BlockActionArgs & AllMiddlewareArgs} ArgInteraction Bolt interaction payload.
   * @returns {Promise<void>}
   */
  async #OnActionAsync(ArgActionID, ArgInteraction) {
    await ArgInteraction.ack();

    // pluck the first action from the payload — multi-element actions blocks still report one
    // action per interaction, so [0] is always the clicked element here.
    const RawAction = /** @type {any} */ (ArgInteraction.action);
    const RawBody = /** @type {any} */ (ArgInteraction.body);

    const ActionInfo = /** @type {BlockActionInfo} */ ({
      actionId: RawAction?.action_id ?? ArgActionID,
      value: typeof RawAction?.value === 'string' ? RawAction.value : '',
      channel: RawBody?.channel?.id ?? '',
      user: RawBody?.user?.id ?? '',
      messageTs: RawBody?.message?.ts ?? '',
      threadTs: RawBody?.message?.thread_ts ?? null,
      triggerId: RawBody?.trigger_id ?? '',
    });

    // log the block_actions event using the same shape as other event logs.
    this.#SlackLogger.info("=".repeat(90));
    this.#SlackLogger.info(`block_actions event (${this.#WorkspaceInfo.WORKSPACE_NAME}):`, ActionInfo);

    if(this.#SlackLogger.WriteSeparatorAsync) {
      this.#SlackLogger.WriteSeparatorAsync(`block_actions event (${this.#WorkspaceInfo.WORKSPACE_NAME})`);
    }

    // enumerate handlers and invoke each one.
    const Handlers = this.#ActionHandlersByActionId.get(ArgActionID) ?? [];
    for(const handler of Handlers) {
      try {
        if(await handler(this, ActionInfo)) break;
      } catch(error) {
        this.#SlackLogger.error("Error in block_actions handler:", error);
      }
    }
  }

  /**
   * Initialize the underlying Slack client and optionally start Socket Mode.
   * @param {WorkspaceStats} ArgStats Stats object to update for outgoing posts.
   * @param {boolean} ArgStartSocketMode Whether to register handlers and start the event loop.
   * @returns {Promise<void>}
   */
  async #InitializeClientAsync(ArgStats, ArgStartSocketMode) {
    // check if the app is already running and report an error if it is (users should stop the app before
    // starting it again).
    if(this.#SlackBoltApp)
      throw new Error(`Slack app is already running for workspace: ${this.#WorkspaceInfo.WORKSPACE_NAME}`);

    // save stats instance.
    this.#WorkspaceStats = ArgStats;

    // initialize the app with the appropriate tokens and secrets (see the getting started guide here
    // https://slack.dev/bolt-js/getting-started for details on getting the tokens and secrets). We run
    // the app in socket mode to avoid the need for a public webhook URL which requires setting up SSL
    // certificates.
    this.#SlackBoltApp = new App({
      token: this.#WorkspaceInfo.LIVE_TOKEN,
      appToken: this.#WorkspaceInfo.LIVE_APP_TOKEN,
      signingSecret: this.#WorkspaceInfo.LIVE_SIGNING_SECRET,
      socketMode: true,
      logger: this.#SlackLogger,
    });

    // run a quick connectivity test and get the app's ID for mentions.
    let AuthTestResp;
    try {
      AuthTestResp = await this.#SlackBoltApp.client.auth.test();
    } catch(/** @type {any} */ error) {
      const Message = error?.data?.error || error?.message || 'unknown error';
      this.#SlackLogger.error(
        `Slack API connectivity test failed for workspace ${this.#WorkspaceInfo.WORKSPACE_NAME}: ${Message}`
      );
      throw new Error(`Slack API connectivity test failed: ${Message}`);
    }
    if(!AuthTestResp.ok) {
      this.#SlackLogger.error(
        `Slack API connectivity test failed for workspace ${this.#WorkspaceInfo.WORKSPACE_NAME}: ${AuthTestResp.error || "unknown error"}`
      );
      throw new Error(`Failed to get app ID: ${AuthTestResp.error || "unknown error"}`);
    }

    this.#SlackLogger.info(
      `Slack API connectivity test succeeded for workspace ${this.#WorkspaceInfo.WORKSPACE_NAME}`
    );
    this.#AppMentionString = `<@${AuthTestResp.user_id}>`;
    this.#TeamId = AuthTestResp.team_id ?? null;

    if(!ArgStartSocketMode) {
      this.#SlackBoltAppStarted = false;
      return;
    }

    // add Slack event handlers.
    this.#SlackBoltApp.event('reaction_added', this.#OnReactionAddedAsync.bind(this));
    this.#SlackBoltApp.event('app_mention', this.#OnAppMentionAsync.bind(this));
    this.#SlackBoltApp.message(this.#OnMessageAsync.bind(this));

    // add Bolt action handlers for each registered action_id. Subscribing per id (rather than a
    // regex catch-all) means Bolt only routes interactions we explicitly handle to this app.
    for(const ActionID of this.#ActionHandlersByActionId.keys()) {
      this.#SlackBoltApp.action(
        ActionID,
        (ArgInteraction) => this.#OnActionAsync(ActionID, /** @type {any} */ (ArgInteraction))
      );
    }

    // start processing slack events.
    await this.#SlackBoltApp.start();
    this.#SlackBoltAppStarted = true;
  }
}

// export the class.
module.exports = SlackApp;
