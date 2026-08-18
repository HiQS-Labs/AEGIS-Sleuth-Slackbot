// import required modules.
const fs = require('fs').promises;
const path = require('path');
const { WriteFileDurableAsync } = require('./durable-write');
const workspaces = require('./workspaces');
const SlackFormatUtils = require('./slack-format-utils');
const ListContext = require('./list-context');

// add typedefs for types.
/**
 * @typedef {import('./slack-app')} SlackApp
 * @typedef {import('./reminders-module').ReminderInfo} ReminderInfo
 * @typedef {import('./stats-module').WorkspaceStats} WorkspaceStats
 * @typedef {import('@slack/web-api').WebClient} WebClient
 */

/**
 * Represents item structure for Slack List.
 * @typedef {Object} ListItemData
 * @property {string} id Unique identifier for the list item
 * @property {string} reminder_id Associated reminder ID
 * @property {string} summary Task/reminder text
 * @property {number} scheduled_time Unix timestamp in milliseconds
 * @property {string} source_channel Source channel ID
 * @property {string} original_message_link Permalink to original message
 * @property {string} status Status of the reminder (pending/posted/completed)
 * @property {string} assignee User ID of assignee
 * @property {boolean} completed Whether the item is completed
 * @property {string} due_date Due date in ISO format
 */

/**
 * Manages Slack Lists integration for reminders.
 */
class ListsModule {
  /**
   * Slack app instance.
   * @type {SlackApp}
   */
  #SlackApp;

  /**
   * Workspace stats.
   * @type {WorkspaceStats}
   */
  #WorkspaceStats;

  /**
   * Slack Web API client.
   * @type {WebClient}
   */
  #SlackClient;

  /**
   * Workspace name.
   * @type {string}
   */
  #WorkspaceName;

  /**
   * The shared workspace list context (the original single managed list).
   * @type {ListContext|null}
   */
  #SharedContext = null;

  /**
   * Durable per-user list contexts, keyed by Slack user ID.
   * @type {Map<string, ListContext>}
   */
  #UserContexts = new Map();

  /**
   * All contexts keyed by Slack list ID, for O(1) poll routing.
   * @type {Map<string, ListContext>}
   */
  #ContextsByListId = new Map();

  /**
   * Cache TTL in milliseconds (5 minutes).
   * @type {number}
   */
  #CacheTTL = 300000;

  /**
   * Whether Lists feature is available for this workspace.
   * @type {boolean}
   */
  #ListsAvailable = false;

  /**
   * Path to cache file for persistence.
   * @type {string}
   */
  #CacheFilePath;

  /**
   * Polling interval ID.
   * @type {NodeJS.Timeout|null}
   */
  #PollingInterval = null;

  /**
   * Polling frequency in milliseconds (5 minutes).
   * @type {number}
   */
  #PollingFrequency = 300000;

  /**
   * Reference to RemindersModule for bidirectional updates.
   * @type {import('./reminders-module')|null}
   */
  #RemindersModule = null;

  /**
   * Environment name (e.g., 'development', 'production').
   * @type {string|null}
   */
  #Environment = null;

  /**
   * Whether a background population is currently running.
   * @type {boolean}
   */
  #IsPopulating = false;

  /**
   * Cache for channel verification results.
   * @type {Map<string, boolean>}
   */
  #ChannelVerificationCache = new Map();

  /**
   * Base list name without environment suffix.
   * @type {string}
   */
  static BASE_LIST_NAME = "Sleuth To-do's";

  /**
   * Select choices for the custom reminder status column.
   * @type {Array<{value: string, label: string, color: string}>}
   */
  static STATUS_CHOICES = [
    { value: 'pending', label: 'Pending', color: 'yellow' },
    { value: 'posted', label: 'Posted', color: 'blue' },
    { value: 'completed', label: 'Completed', color: 'green' },
    { value: 'needs-info', label: 'Needs Info', color: 'red' }
  ];

  /**
   * Delay after creating a list before adding rows so Slack has time to propagate the list.
   * @type {number}
   */
  static LIST_PROPAGATION_DELAY_MS = 5000;

  /**
   * Spacing between polling successive list contexts, to ease rate-limit pressure
   * as the number of managed lists grows.
   * @type {number}
   */
  static INTER_CONTEXT_POLL_DELAY_MS = 250;

  /**
   * Initialize a new instance of the ListsModule.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {string|null} [ArgEnvironment] Environment name (optional).
   */
  constructor(ArgSlackApp, ArgEnvironment = null) {
    // save the slack app instance.
    this.#SlackApp = ArgSlackApp;
    this.#WorkspaceName = ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME;
    this.#Environment = ArgEnvironment;

    // setup cache file path.
    const WorkspaceDir = workspaces.GetDirPath();
    const ListsCacheDir = path.join(WorkspaceDir, 'lists');
    this.#CacheFilePath = path.join(ListsCacheDir, `${this.#WorkspaceName}_lists_cache.json`);
  }

  /**
   * Get the Slack Web API client from the Bolt app.
   * @returns {WebClient}
   */
  get SlackClient() {
    return this.#SlackClient;
  }

  /**
   * Get whether Lists feature is available.
   * @returns {boolean}
   */
  get IsListsAvailable() {
    return this.#ListsAvailable;
  }

  /**
   * Get the shared workspace List ID if available.
   * @returns {string|null}
   */
  get ListId() {
    return this.#SharedContext ? this.#SharedContext.ListId : null;
  }

  /**
   * Set the RemindersModule reference for bidirectional updates.
   * @param {import('./reminders-module')} ArgRemindersModule RemindersModule instance.
   */
  SetRemindersModule(ArgRemindersModule) {
    this.#RemindersModule = ArgRemindersModule;
  }

  /**
   * Force one immediate poll cycle across every managed list context.
   * Intended for operator tooling and live-test automation.
   * @returns {Promise<{ok: boolean, contextCount?: number, error?: string}>}
   */
  async ForcePollNowAsync() {
    if(!this.#ListsAvailable) {
      return { ok: false, error: 'Slack Lists is not available in this workspace.' };
    }

    await this.#PollAllContextsAsync();
    await this.#SaveCacheAsync();
    return { ok: true, contextCount: this.#AllContexts().length };
  }

  /**
   * Return a read-only summary of every managed list context.
   * Intended for operator tooling and live-test automation.
   * @returns {Promise<{ok: boolean, sharedListId: string|null, userListCount: number, contexts: Array<{kind: string, listId: string|null, ownerUserID: string|null, displayTitle: string|null, accessChannelID: string|null, managedReminderCount: number, rowCount: number, lastSync: string|null}>}>}
   */
  async GetSyncStatusAsync() {
    /** @type {Array<{kind: string, listId: string|null, ownerUserID: string|null, displayTitle: string|null, accessChannelID: string|null, managedReminderCount: number, rowCount: number, lastSync: string|null}>} */
    const ContextSummaries = [];
    for(const Context of this.#AllContexts()) {
      const RawItems = await this.#GetAllListItemsAsync(Context);
      ContextSummaries.push({
        kind: Context.Kind,
        listId: Context.ListId,
        ownerUserID: Context.OwnerUserID,
        displayTitle: Context.DisplayTitle,
        accessChannelID: Context.AccessChannelID,
        managedReminderCount: Context.ItemCache.size,
        rowCount: RawItems.length,
        lastSync: Context.LastSync ? Context.LastSync.toISOString() : null
      });
    }

    return {
      ok: true,
      sharedListId: this.#SharedContext ? this.#SharedContext.ListId : null,
      userListCount: this.#UserContexts.size,
      contexts: ContextSummaries
    };
  }

  /**
   * Return the current parsed rows for one registered per-user list.
   * Intended for operator tooling and live-test automation.
   * @param {string} ArgUserID Owner Slack user ID.
   * @returns {Promise<{ok: boolean, listId: string, displayTitle: string|null, ownerUserID: string|null, accessChannelID: string|null, managedReminderCount: number, rowCount: number, rows: Array<{rowId: string|null, reminderId: string|null, summary: string|null, status: string|null, completed: boolean, dueDate: string|null, assigneeID: string|null, sourceChannelID: string|null, originalMessage: string|null, updatedTimestamp: string|null, managed: boolean}>}>}
   */
  async GetUserListRowsAsync(ArgUserID) {
    const Context = this.#GetRequiredUserContext(ArgUserID);
    const RawItems = await this.#GetAllListItemsAsync(Context);
    const Rows = RawItems.map(ArgItem => this.#BuildHarnessRowSnapshot(Context, ArgItem));

    return {
      ok: true,
      listId: /** @type {string} */(Context.ListId),
      displayTitle: Context.DisplayTitle,
      ownerUserID: Context.OwnerUserID,
      accessChannelID: Context.AccessChannelID,
      managedReminderCount: Context.ItemCache.size,
      rowCount: Rows.length,
      rows: Rows
    };
  }

  /**
   * Collect completed task-history rows across every registered per-user list whose completion
   * timestamp falls within [ArgStartMs, ArgEndMs). Completed reminders are removed from the live
   * queue and from the shared list, so the per-user lists (where completed rows are kept as history
   * records — see HandleReminderCompletedAsync) are the only retained record of finished work.
   * Rows are de-duplicated by reminder ID across lists, keeping the latest completion timestamp.
   *
   * @param {number} ArgStartMs Inclusive window start (real-UTC epoch milliseconds).
   * @param {number} ArgEndMs Exclusive window end (real-UTC epoch milliseconds).
   * @returns {Promise<{available: boolean, rows: Array<{reminderId: string|null, summary: string|null, assigneeID: string|null, sourceChannelID: string|null, dueDate: string|null, ownerUserID: string|null, completedMs: number}>}>}
   */
  async GetCompletedRowsBetweenAsync(ArgStartMs, ArgEndMs) {
    if(!this.#ListsAvailable) {
      return { available: false, rows: [] };
    }

    /** @type {Map<string, {reminderId: string|null, summary: string|null, assigneeID: string|null, sourceChannelID: string|null, dueDate: string|null, ownerUserID: string|null, completedMs: number}>} */
    const RowsByKey = new Map();

    for(const Context of this.#UserContexts.values()) {
      const RawItems = await this.#GetAllListItemsAsync(Context);
      for(const RawItem of RawItems) {
        const Validation = this.#ValidateListItem(Context, RawItem);
        const Data = Validation.data;
        if(!Data || Data.completed !== true) {
          continue;
        }

        const CompletedMs = this.#ParseRowUpdatedMs(RawItem && /** @type {any} */(RawItem).updated_timestamp);
        if(CompletedMs === null || CompletedMs < ArgStartMs || CompletedMs >= ArgEndMs) {
          continue;
        }

        // A reminder completed for several people lands as a history row on each of their lists;
        // collapse those into one entry, preferring the most recent completion timestamp.
        const DedupeKey = Data.reminderId || Data.listItemId || `${Context.OwnerUserID}:${CompletedMs}`;
        const Existing = RowsByKey.get(DedupeKey);
        if(Existing && Existing.completedMs >= CompletedMs) {
          continue;
        }

        RowsByKey.set(DedupeKey, {
          reminderId: Data.reminderId || null,
          summary: Data.summary || null,
          assigneeID: Data.assignee || null,
          sourceChannelID: Data.sourceChannel || null,
          dueDate: Data.dueDate || null,
          ownerUserID: Context.OwnerUserID || null,
          completedMs: CompletedMs,
        });
      }
    }

    const Rows = [...RowsByKey.values()].sort((ArgLeft, ArgRight) => ArgLeft.completedMs - ArgRight.completedMs);
    return { available: true, rows: Rows };
  }

  /**
   * Normalize a Slack Lists `updated_timestamp` (epoch seconds or milliseconds, numeric or string)
   * into epoch milliseconds. Returns null when the value cannot be parsed.
   * @param {unknown} ArgUpdatedTimestamp Raw `updated_timestamp` from a Slack list row.
   * @returns {number|null}
   */
  #ParseRowUpdatedMs(ArgUpdatedTimestamp) {
    const Numeric = typeof ArgUpdatedTimestamp === 'number'
      ? ArgUpdatedTimestamp
      : (typeof ArgUpdatedTimestamp === 'string' && ArgUpdatedTimestamp.trim() ? Number(ArgUpdatedTimestamp) : NaN);
    if(!Number.isFinite(Numeric) || Numeric <= 0) {
      return null;
    }
    // Slack returns epoch seconds (e.g. "1747152000"); promote to milliseconds. Values already in
    // milliseconds (>= ~Sep 2001 in ms) are kept as-is.
    return Numeric < 1e12 ? Math.round(Numeric * 1000) : Math.round(Numeric);
  }

  /**
   * Create a hand-authored row in a registered per-user list without marking it as a Sleuth-authored write.
   * This intentionally bypasses echo suppression so the next poll can process it as an inbound addition.
   * Intended for operator tooling and live-test automation.
   * @param {string} ArgUserID Owner Slack user ID.
   * @param {{summary: string, dueDate: string, assigneeID?: string|null, targetChannelID?: string|null}} ArgRowData
   * @returns {Promise<{ok: boolean, listId: string, rowId: string|null}>}
   */
  async CreateManualUserListRowAsync(ArgUserID, ArgRowData) {
    const Context = this.#GetRequiredUserContext(ArgUserID);
    const Schema = Context.Schema;
    if(!Schema) {
      return { ok: false, listId: /** @type {string} */(Context.ListId), rowId: null };
    }

    const Summary = typeof ArgRowData.summary === 'string' ? ArgRowData.summary.trim() : '';
    const DueDate = typeof ArgRowData.dueDate === 'string' ? ArgRowData.dueDate.trim() : '';
    if(!Summary || !DueDate) {
      throw new Error('Manual row creation requires both summary and dueDate.');
    }

    /** @type {Array<any>} */
    const InitialFields = [];
    if(Schema.summary) {
      InitialFields.push({
        column_id: Schema.summary,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(Summary)]
      });
    }
    if(Schema.due_date) {
      InitialFields.push({
        column_id: Schema.due_date,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(DueDate)]
      });
    }
    if(typeof ArgRowData.assigneeID === 'string' && ArgRowData.assigneeID && Schema.assignee) {
      InitialFields.push({
        column_id: Schema.assignee,
        user: [ArgRowData.assigneeID]
      });
    }
    if(typeof ArgRowData.targetChannelID === 'string' && ArgRowData.targetChannelID && Schema.source_channel) {
      InitialFields.push({
        column_id: Schema.source_channel,
        channel: [ArgRowData.targetChannelID]
      });
    }

    const CreateResponse = /** @type {any} */(await this.#SlackClient.apiCall('slackLists.items.create', {
      list_id: Context.ListId,
      initial_fields: InitialFields
    }));

    return {
      ok: true,
      listId: /** @type {string} */(Context.ListId),
      rowId: CreateResponse.item?.id || CreateResponse.record_id || null
    };
  }

  /**
   * Toggle a row's completion fields in a registered per-user list without echo suppression.
   * This intentionally simulates an external Slack-side edit so the next poll sees it as inbound.
   * Intended for operator tooling and live-test automation.
   * @param {string} ArgUserID Owner Slack user ID.
   * @param {string} ArgRowID Slack row ID to update.
   * @param {boolean} [ArgCompleted] Completion state to write.
   * @returns {Promise<{ok: boolean, listId: string}>}
   */
  async SetUserListRowCompletedAsync(ArgUserID, ArgRowID, ArgCompleted = true) {
    const Context = this.#GetRequiredUserContext(ArgUserID);
    const Schema = Context.Schema;
    if(!Schema?.completed || !Schema?.status) {
      throw new Error('User list schema does not expose completed/status columns.');
    }

    await this.#SlackClient.apiCall('slackLists.items.update', {
      list_id: Context.ListId,
      cells: [
        {
          row_id: ArgRowID,
          column_id: Schema.completed,
          checkbox: ArgCompleted
        },
        {
          row_id: ArgRowID,
          column_id: Schema.status,
          select: [ArgCompleted ? 'completed' : 'pending']
        }
      ]
    });

    return {
      ok: true,
      listId: /** @type {string} */(Context.ListId)
    };
  }

  /**
   * Delete one row from a registered per-user list without touching local caches.
   * This intentionally simulates an external Slack-side delete so the next poll sees it as inbound.
   * Intended for operator tooling and live-test automation.
   * @param {string} ArgUserID Owner Slack user ID.
   * @param {string} ArgRowID Slack row ID to delete.
   * @returns {Promise<{ok: boolean, listId: string}>}
   */
  async DeleteUserListRowAsync(ArgUserID, ArgRowID) {
    const Context = this.#GetRequiredUserContext(ArgUserID);
    await this.#SlackClient.apiCall('slackLists.items.delete', {
      list_id: Context.ListId,
      id: ArgRowID
    });

    return {
      ok: true,
      listId: /** @type {string} */(Context.ListId)
    };
  }

  /**
   * All managed list contexts (shared first, then per-user).
   * @returns {ListContext[]}
   */
  #AllContexts() {
    /** @type {ListContext[]} */
    const Contexts = [];
    if(this.#SharedContext) {
      Contexts.push(this.#SharedContext);
    }
    for(const Context of this.#UserContexts.values()) {
      Contexts.push(Context);
    }
    return Contexts;
  }

  /**
   * Register a context in the list-id lookup, and in the per-user registry when applicable.
   * @param {ListContext} ArgContext Context to register.
   */
  #RegisterContext(ArgContext) {
    if(ArgContext.ListId) {
      this.#ContextsByListId.set(ArgContext.ListId, ArgContext);
    }
    if(ArgContext.Kind === 'user' && ArgContext.OwnerUserID) {
      this.#UserContexts.set(ArgContext.OwnerUserID, ArgContext);
    }
  }

  /**
   * Remove a context from all registries.
   * @param {ListContext} ArgContext Context to drop.
   */
  #UnregisterContext(ArgContext) {
    if(ArgContext.ListId) {
      this.#ContextsByListId.delete(ArgContext.ListId);
    }
    if(ArgContext.Kind === 'user' && ArgContext.OwnerUserID) {
      this.#UserContexts.delete(ArgContext.OwnerUserID);
    }
  }

  /**
   * Find the per-user context that currently manages a given reminder, if any.
   * @param {string} ArgReminderID Reminder ID to look up.
   * @returns {ListContext|null}
   */
  #GetContextForReminderId(ArgReminderID) {
    for(const Context of this.#UserContexts.values()) {
      if(Context.ItemCache.has(ArgReminderID)) {
        return Context;
      }
    }
    return null;
  }

  /**
   * Resolve one registered per-user context or throw a descriptive error.
   * @param {string} ArgUserID Owner Slack user ID.
   * @returns {ListContext}
   */
  #GetRequiredUserContext(ArgUserID) {
    if(typeof ArgUserID !== 'string' || ArgUserID.length === 0) {
      throw new Error('A valid Slack user ID is required.');
    }

    const Context = this.#UserContexts.get(ArgUserID);
    if(!Context || !Context.IsReady) {
      throw new Error(`No registered per-user list is available for ${ArgUserID}.`);
    }
    return Context;
  }

  /**
   * Build a stable read-only row snapshot for operator tooling.
   * @param {ListContext} ArgContext Owning per-user context.
   * @param {any} ArgRawItem Raw Slack Lists row payload.
   * @returns {{rowId: string|null, reminderId: string|null, summary: string|null, status: string|null, completed: boolean, dueDate: string|null, assigneeID: string|null, sourceChannelID: string|null, originalMessage: string|null, updatedTimestamp: string|null, managed: boolean}}
   */
  #BuildHarnessRowSnapshot(ArgContext, ArgRawItem) {
    const Validation = this.#ValidateListItem(ArgContext, ArgRawItem);
    const Item = ArgRawItem && ArgRawItem.fields && Array.isArray(ArgRawItem.fields)
      ? this.#TransformListItem(ArgContext, ArgRawItem)
      : ArgRawItem;
    const ReminderId = Validation.data ? Validation.data.reminderId : null;

    return {
      rowId: typeof Item?.id === 'string' ? Item.id : null,
      reminderId: ReminderId,
      summary: Validation.data ? Validation.data.summary : null,
      status: Validation.data ? Validation.data.status : null,
      completed: Validation.data ? Validation.data.completed === true : false,
      dueDate: Validation.data ? Validation.data.dueDate : null,
      assigneeID: Validation.data ? Validation.data.assignee : null,
      sourceChannelID: Validation.data ? Validation.data.sourceChannel : null,
      originalMessage: Validation.data ? Validation.data.originalMessage : null,
      updatedTimestamp: typeof Item?.updated_timestamp === 'string' ? Item.updated_timestamp : null,
      managed: !!(ReminderId && ArgContext.ItemCache.has(ReminderId))
    };
  }

  /**
   * Get the full list name including environment suffix.
   * @returns {string}
   */
  GetListName() {
    if(this.#Environment) {
      return `${ListsModule.BASE_LIST_NAME} (${this.#Environment})`;
    }
    return ListsModule.BASE_LIST_NAME;
  }

  /**
   * Start the lists module and initialize the list if available.
   * @param {WorkspaceStats} ArgStats Workspace stats.
   * @returns {Promise<void>}
   */
  async StartAsync(ArgStats) {
    // save stats.
    this.#WorkspaceStats = ArgStats;

    // get the Slack client from the Bolt app (we need to access it after the app has started).
    // The BoltApp property will be exposed by SlackApp in the next step.
    this.#SlackClient = this.#SlackApp.BoltApp?.client || null;

    if(!this.#SlackClient) {
      this.#SlackApp.Logger.warn('Slack client not available, Lists module will run in fallback mode');
      return;
    }

    // create cache directory if it doesn't exist.
    const ListsCacheDir = path.dirname(this.#CacheFilePath);
    await fs.mkdir(ListsCacheDir, { recursive: true });

    // load cache from disk.
    await this.#LoadCacheAsync();

    // check if Lists feature is available.
    this.#ListsAvailable = await this.IsListsAvailableAsync();

    if(this.#ListsAvailable) {
      this.#SlackApp.Logger.info(`Lists feature available for workspace: ${this.#WorkspaceName}`);

      // initialize the list.
      await this.InitializeAsync();

      // start polling for changes.
      this.#StartPolling();
    } else {
      this.#SlackApp.Logger.warn(`Lists feature not available for workspace: ${this.#WorkspaceName} (free plan or missing permissions)`);
    }
  }

  /**
   * Stop the lists module.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    // stop polling.
    this.#StopPolling();

    // save cache to disk before stopping.
    if(this.#SharedContext || this.#UserContexts.size > 0) {
      await this.#SaveCacheAsync();
    }
  }

  /**
   * Check if the workspace supports Slack Lists.
   * @returns {Promise<boolean>}
   */
  async IsListsAvailableAsync() {
    try {
      // Simple availability check: just try to call the API and see what error we get.
      // We'll attempt to get info about a non-existent list - if we get 'list_not_found',
      // that means the API is available. If we get 'missing_scope', 'unknown_method', etc.,
      // then Lists isn't available.

      this.#SlackApp.Logger.info('Checking Lists API availability with slackLists.items.list...');

      // Try a lightweight API call first - attempt to access info about a dummy list.
      // This is better than creating test lists that would clutter the workspace.
      await this.#SlackClient.apiCall('slackLists.items.list', {
        list_id: 'F000000000' // non-existent list ID
      });

      // if we got here without error, Lists is available (shouldn't happen with fake ID).
      this.#SlackApp.Logger.info('Lists API available (unexpected success with dummy ID)');
      return true;
    } catch(error) {
      // log the actual error for debugging.
      this.#SlackApp.Logger.info(`Lists availability check error: ${error.data?.error}`);
      this.#SlackApp.Logger.info('Full error details:', {
        message: error.message,
        code: error.code,
        data: error.data
      });

      // check for specific error codes that indicate Lists IS available (just our test failed).
      if(error.data?.error === 'list_not_found' ||
         error.data?.error === 'invalid_list_id') {
        // these errors mean the API is working, we just used a bad ID.
        this.#SlackApp.Logger.info(`✓ Lists API is available (got expected error: ${error.data?.error})`);
        return true;
      }

      // check for error codes that indicate Lists is NOT available.
      if(error.data?.error === 'paid_teams_only' ||
         error.data?.error === 'not_allowed' ||
         error.data?.error === 'method_not_supported' ||
         error.data?.error === 'unknown_method' ||
         error.data?.error === 'missing_scope') {
        this.#SlackApp.Logger.warn(`✗ Lists API not available: ${error.data?.error}`);
        return false;
      }

      // for other errors, log them with full details and assume Lists is not available.
      this.#SlackApp.Logger.error('✗ Unexpected error checking Lists availability:', error);
      this.#SlackApp.Logger.error('Error type not recognized, assuming Lists not available');
      return false;
    }
  }

  /**
   * Initialize or retrieve the Slack List for reminders.
   * @returns {Promise<void>}
   */
  async InitializeAsync() {
    try {
      const ListName = this.GetListName();

      this.#SlackApp.Logger.info(`Starting list initialization for: ${ListName}`);

      // ensure cache is loaded before checking for an existing list.
      // the cache should persist across deployments.
      if(!this.#SharedContext) {
        this.#SlackApp.Logger.info('No shared list context in memory, ensuring cache is loaded from disk...');
        await this.#LoadCacheAsync();
      }

      // verify the cached shared list still exists.
      if(this.#SharedContext && this.#SharedContext.ListId) {
        this.#SlackApp.Logger.info(`Checking cached list ID: ${this.#SharedContext.ListId}`);
        const ListExists = await this.#VerifyListExistsAsync(this.#SharedContext.ListId);
        if(ListExists) {
          this.#SlackApp.Logger.info(`✓ Cached list verified and exists: ${this.#SharedContext.ListId}`);
        } else {
          this.#SlackApp.Logger.warn(`✗ Cached list ${this.#SharedContext.ListId} no longer exists or is inaccessible`);
          this.#SlackApp.Logger.warn('Note: Slack Lists API does not support searching by name, so we cannot find the existing list.');
          this.#SlackApp.Logger.warn('If the list still exists, restore the cache file or manually update the list ID.');
          this.#UnregisterContext(this.#SharedContext);
          this.#SharedContext = null;
        }
      }

      if(this.#SharedContext && this.#SharedContext.ListId) {
        // use the existing list and sync reminders TO it (reminders are source of truth).
        this.#SlackApp.Logger.info('Using existing list - syncing reminders TO list (reminders are source of truth)');
        await this.#PopulateListFromRemindersAsync();
      } else {
        // no list found - create a new one. This should only happen on first-time setup
        // or if the cache is permanently lost.
        this.#SlackApp.Logger.warn(`⚠ No existing list found - creating new list: ${ListName}`);
        this.#SlackApp.Logger.warn('This will create a NEW list. If an existing list should be used, restore the cache file.');

        this.#SharedContext = await this.#CreateListAsync();
        if(!this.#SharedContext || !this.#SharedContext.ListId) {
          throw new Error('Failed to create list - no list ID returned');
        }
        this.#RegisterContext(this.#SharedContext);

        this.#SlackApp.Logger.info(`✓ Created new list: ${this.#SharedContext.ListId} (${ListName})`);

        // Wait for list to propagate before adding items.
        // The Slack Lists API may return internal_error if items are added too quickly after list creation.
        this.#SlackApp.Logger.info('Waiting 5 seconds for list to propagate before adding items...');
        await new Promise(resolve => setTimeout(resolve, ListsModule.LIST_PROPAGATION_DELAY_MS));

        await this.#PopulateListFromRemindersAsync();
      }

      // save the list ID to cache (important for future deployments).
      await this.#SaveCacheAsync();
      this.#SlackApp.Logger.info(`✓ List initialization complete. Cache saved to: ${this.#CacheFilePath}`);
    } catch(error) {
      this.#SlackApp.Logger.error('✗ Error initializing list:', error);
      this.#SlackApp.Logger.error('Error details:', {
        message: error.message,
        data: error.data,
        stack: error.stack
      });
      this.#ListsAvailable = false;
    }
  }

  /**
   * Create the shared workspace Slack List with the reminder schema.
   * @returns {Promise<ListContext>} The created shared list context.
   */
  async #CreateListAsync() {
    const ReminderChannelName = this.#SlackApp.WorkspaceInfo.REMINDER_CHANNEL_NAME;
    const ReminderChannelID = await this.#SlackApp.GetChannelIdAsync(ReminderChannelName);

    if(!ReminderChannelID) {
      throw new Error(`Could not find reminder channel: ${ReminderChannelName}`);
    }

    const CreatedList = await this.#CreateListWithReminderSchemaAsync(
      this.GetListName(),
      {
        ChannelReadAccessID: ReminderChannelID,
        PostAnnouncementChannelID: ReminderChannelID
      }
    );

    return new ListContext({
      ListId: CreatedList.ListId,
      Schema: CreatedList.ListSchema,
      Kind: 'shared',
      AccessChannelID: ReminderChannelID,
      DisplayTitle: this.GetListName()
    });
  }

  /**
   * Create or resync a durable per-user Slack List that mirrors a user's reminders.
   *
   * On the first call the list is created, registered, and populated; subsequent calls
   * verify the list still exists and resync it. The registry is keyed on the Slack user ID,
   * so the list survives restarts and is polled for bi-directional changes.
   * @param {string} ArgUserID Slack user ID the list belongs to.
   * @param {ReminderInfo[]} ArgReminders The user's current reminders.
   * @param {string} ArgAccessChannelID Channel that should receive read access to the list.
   * @returns {Promise<{ok: boolean, listId?: string, listName?: string|null, permalink?: string|null, created?: boolean, syncedItemCount?: number, requestedItemCount?: number, error?: string}>}
   */
  async EnsureUserListAsync(ArgUserID, ArgReminders, ArgAccessChannelID) {
    if(!this.#ListsAvailable || !this.#SlackClient) {
      return { ok: false, error: 'Slack Lists is not available in this workspace.' };
    }

    if(typeof ArgUserID !== 'string' || ArgUserID.length === 0) {
      return { ok: false, error: 'A valid Slack user ID is required.' };
    }

    if(!Array.isArray(ArgReminders)) {
      return { ok: false, error: 'A reminder list is required.' };
    }

    if(typeof ArgAccessChannelID !== 'string' || ArgAccessChannelID.length === 0) {
      return { ok: false, error: 'A target Slack channel is required for list access.' };
    }

    // already registered: verify the list still exists, then resync it.
    const ExistingContext = this.#UserContexts.get(ArgUserID);
    if(ExistingContext) {
      const StillExists = await this.#VerifyListExistsAsync(ExistingContext.ListId);
      if(StillExists) {
        const AccessResult = await this.#EnsurePerUserListAccessAsync(
          ExistingContext.ListId,
          ArgUserID,
          ArgAccessChannelID
        );
        if(!AccessResult.UserAccessGranted) {
          this.#SlackApp.Logger.warn(
            `Registered user list ${ExistingContext.ListId} for ${ArgUserID} exists, but Sleuth could not restore user write access.`
          );
          return { ok: false, error: 'Slack rejected write access for the target user.' };
        }

        if(!AccessResult.ChannelAccessGranted) {
          this.#SlackApp.Logger.warn(
            `Registered user list ${ExistingContext.ListId} for ${ArgUserID} exists, but channel ${ArgAccessChannelID} could not be granted read access.`
          );
        }

        const SyncedCount = await this.#ResyncUserContextAsync(ExistingContext, ArgReminders);
        await this.#SaveCacheAsync();
        return {
          ok: true,
          created: false,
          listId: ExistingContext.ListId,
          listName: ExistingContext.DisplayTitle,
          permalink: await this.#BuildListPermalinkAsync(ExistingContext.ListId),
          syncedItemCount: SyncedCount,
          requestedItemCount: ArgReminders.length
        };
      }

      // the list was deleted externally - drop the stale context and recreate below.
      this.#SlackApp.Logger.warn(
        `Registered user list ${ExistingContext.ListId} for ${ArgUserID} no longer exists - recreating`
      );
      this.#UnregisterContext(ExistingContext);
    }

    // create a new durable per-user list.
    const ListName = await this.#BuildUserListTitleAsync(ArgUserID);
    const CreatedList = await this.#CreateListWithReminderSchemaAsync(ListName, {
      UserWriteAccessID: ArgUserID,
      ChannelReadAccessID: ArgAccessChannelID,
      PostAnnouncementChannelID: ArgAccessChannelID
    });

    if(!CreatedList.UserAccessGranted) {
      this.#SlackApp.Logger.warn(
        `Aborting user list setup for ${CreatedList.ListId} because user ${ArgUserID} could not be granted write access.`
      );
      return { ok: false, error: 'Slack rejected write access for the target user.' };
    }

    if(!CreatedList.ChannelAccessGranted) {
      this.#SlackApp.Logger.warn(
        `Created user list ${CreatedList.ListId} for ${ArgUserID}, but channel ${ArgAccessChannelID} could not be granted read access.`
      );
    }

    const Context = new ListContext({
      ListId: CreatedList.ListId,
      Schema: CreatedList.ListSchema,
      Kind: 'user',
      OwnerUserID: ArgUserID,
      AccessChannelID: ArgAccessChannelID,
      DisplayTitle: ListName
    });
    this.#RegisterContext(Context);

    this.#SlackApp.Logger.info(
      `Waiting ${ListsModule.LIST_PROPAGATION_DELAY_MS}ms for user list ${Context.ListId} to propagate before adding items...`
    );
    await new Promise(resolve => setTimeout(resolve, ListsModule.LIST_PROPAGATION_DELAY_MS));

    let SyncedCount = 0;
    for(const Reminder of ArgReminders) {
      const Added = await this.#CreateListItemAsync(Context, Reminder, { UpdateCache: true });
      if(Added) SyncedCount++;
    }

    await this.#SaveCacheAsync();

    return {
      ok: SyncedCount === ArgReminders.length,
      created: true,
      listId: Context.ListId,
      listName: ListName,
      permalink: CreatedList.Permalink,
      syncedItemCount: SyncedCount,
      requestedItemCount: ArgReminders.length
    };
  }

  /**
   * Resync an already-registered per-user list to the user's current reminders.
   *
   * Rebuilds the reminder -> row mapping from each row's reminder_id column so a stale
   * cache self-heals, refreshes the change-detection baseline, then adds rows for any
   * reminders that have no row yet. Completed/history rows are intentionally left in place.
   * @param {ListContext} ArgContext Registered per-user list context.
   * @param {ReminderInfo[]} ArgReminders The user's current reminders.
   * @returns {Promise<number>} Count of reminders newly added during this resync.
   */
  async #ResyncUserContextAsync(ArgContext, ArgReminders) {
    const CurrentItems = await this.#GetAllListItemsAsync(ArgContext);

    // rebuild the reminder -> row mapping from the live list (self-healing).
    // completed rows are intentionally excluded: they are kept as history records and are
    // no longer actively managed, so re-adopting them would allow a later delete to be
    // mistaken as a fresh cancellation.
    const RebuiltCache = new Map();
    for(const RawItem of CurrentItems) {
      const Validation = this.#ValidateListItem(ArgContext, RawItem);
      const ReminderId = Validation.data ? Validation.data.reminderId : null;
      const ItemId = Validation.data ? Validation.data.listItemId : null;
      const IsCompleted = Validation.data ? Validation.data.completed : false;
      if(ReminderId && ItemId && !IsCompleted) {
        RebuiltCache.set(ReminderId, ItemId);
      }
    }
    ArgContext.ItemCache = RebuiltCache;

    // refresh the change-detection baseline so the next poll starts clean.
    ArgContext.ListItemsCache.clear();
    for(const RawItem of CurrentItems) {
      const AnyItem = /** @type {any} */ (RawItem);
      if(AnyItem && typeof AnyItem === 'object' && typeof AnyItem.id === 'string') {
        ArgContext.ListItemsCache.set(AnyItem.id, AnyItem);
      }
    }

    // add rows for reminders that have no row yet.
    let AddedCount = 0;
    for(const Reminder of ArgReminders) {
      if(ArgContext.ItemCache.has(Reminder.ReminderID)) {
        continue;
      }
      const Added = await this.#CreateListItemAsync(ArgContext, Reminder, { UpdateCache: true });
      if(Added) AddedCount++;
    }

    ArgContext.LastSync = new Date();
    return AddedCount;
  }

  /**
   * Create a reminder list with the shared schema and optional user/channel access grants.
   * @param {string} ArgListName List title to create.
   * @param {{ChannelReadAccessID?: string|null, UserWriteAccessID?: string|null, PostAnnouncementChannelID?: string|null}} [ArgAccessOptions] Optional access/sharing behavior.
    * @returns {Promise<{ListId: string, ListSchema: Object<string, string>, Permalink: string|null, ChannelAccessGranted: boolean, UserAccessGranted: boolean}>}
   */
  async #CreateListWithReminderSchemaAsync(ArgListName, ArgAccessOptions = {}) {
    try {
      const ChannelReadAccessID = ArgAccessOptions.ChannelReadAccessID ?? null;
      const UserWriteAccessID = ArgAccessOptions.UserWriteAccessID ?? null;
      const PostAnnouncementChannelID = ArgAccessOptions.PostAnnouncementChannelID ?? null;

      this.#SlackApp.Logger.info(`Calling lists.create API with name: ${ArgListName}`);

      const CreateResponse = /** @type {any} */(await this.#SlackClient.apiCall('slackLists.create', {
        name: ArgListName,
        schema: this.#BuildReminderListSchemaDefinition()
      }));

      this.#SlackApp.Logger.info(`API Response:`, CreateResponse);

      const ListId = CreateResponse.list_id || CreateResponse.list?.id;
      if(!ListId) {
        this.#SlackApp.Logger.error('No list ID in create response:', CreateResponse);
        throw new Error('No list ID in create response.');
      }

      const ListSchema = this.#ExtractListSchemaFromMetadata(CreateResponse.list_metadata);
      const ListPermalink = await this.#BuildListPermalinkAsync(ListId, CreateResponse);
      const UserAccessGranted = UserWriteAccessID
        ? await this.#GrantListUserWriteAccessAsync(ListId, UserWriteAccessID)
        : true;
      const ChannelAccessGranted = ChannelReadAccessID
        ? await this.#GrantListChannelReadAccessAsync(ListId, ChannelReadAccessID)
        : true;

      if(PostAnnouncementChannelID && ChannelAccessGranted) {
        try {
          if(ListPermalink) {
            await this.#SlackApp.PostMessageTextAsync(
              PostAnnouncementChannelID,
              null,
              `📋 New Slack List created: <${ListPermalink}|${ArgListName}>\nClick to view and manage your reminders.`
            );
            this.#SlackApp.Logger.info('Posted list link to reminder channel');
          } else {
            this.#SlackApp.Logger.warn(`Could not determine permalink for new list ${ListId}`);
          }
        } catch(error) {
          this.#SlackApp.Logger.warn(`Could not post list link to channel: ${error.message}`);
        }
      }

      return {
        ListId,
        ListSchema,
        Permalink: ListPermalink,
        ChannelAccessGranted,
        UserAccessGranted
      };
    } catch(error) {
      this.#SlackApp.Logger.error('Error creating list:', error);
      this.#SlackApp.Logger.error('Error details:', {
        message: error.message,
        data: error.data,
        code: error.code
      });
      throw error;
    }
  }

  /**
   * Ensure the target user can edit their durable per-user list and the invocation channel
   * can still discover it.
   * @param {string} ArgListId List ID.
   * @param {string} ArgUserID Slack user ID that should receive write access.
   * @param {string|null} ArgChannelID Channel that should receive read access.
   * @returns {Promise<{UserAccessGranted: boolean, ChannelAccessGranted: boolean}>}
   */
  async #EnsurePerUserListAccessAsync(ArgListId, ArgUserID, ArgChannelID) {
    return {
      UserAccessGranted: await this.#GrantListUserWriteAccessAsync(ArgListId, ArgUserID),
      ChannelAccessGranted: ArgChannelID
        ? await this.#GrantListChannelReadAccessAsync(ArgListId, ArgChannelID)
        : true
    };
  }

  /**
   * Grant one Slack user write access to a list.
   * @param {string} ArgListId List ID.
   * @param {string} ArgUserID Slack user ID.
   * @returns {Promise<boolean>}
   */
  async #GrantListUserWriteAccessAsync(ArgListId, ArgUserID) {
    try {
      this.#SlackApp.Logger.info(`Granting user ${ArgUserID} write access to list ${ArgListId}`);
      await this.#SlackClient.apiCall('slackLists.access.set', {
        list_id: ArgListId,
        access_level: 'write',
        user_ids: [ArgUserID]
      });
      return true;
    } catch(error) {
      this.#SlackApp.Logger.warn(`Could not grant user write access to list ${ArgListId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Grant one Slack channel read access to a list.
   * @param {string} ArgListId List ID.
   * @param {string} ArgChannelID Slack channel ID.
   * @returns {Promise<boolean>}
   */
  async #GrantListChannelReadAccessAsync(ArgListId, ArgChannelID) {
    try {
      this.#SlackApp.Logger.info(`Granting channel ${ArgChannelID} read access to list ${ArgListId}`);
      await this.#SlackClient.apiCall('slackLists.access.set', {
        list_id: ArgListId,
        access_level: 'read',
        channel_ids: [ArgChannelID]
      });
      return true;
    } catch(error) {
      this.#SlackApp.Logger.warn(`Could not grant channel read access to list ${ArgListId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Build the shared reminder-list schema definition used for both the live synced list and snapshots.
   * @returns {Array<any>}
   */
  #BuildReminderListSchemaDefinition() {
    return [
      { key: 'summary', name: 'Task', type: 'text', is_primary_column: true },
      { key: 'status', name: 'Status', type: 'select', options: { choices: ListsModule.STATUS_CHOICES } },
      { key: 'completed', name: 'Completed', type: 'checkbox' },
      { key: 'assignee', name: 'Assignee', type: 'user' },
      { key: 'due_date', name: 'Due Date', type: 'text' },
      { key: 'created_on', name: 'Created On', type: 'text' },
      { key: 'source_channel', name: 'Source', type: 'channel' },
      { key: 'original_message', name: 'Message', type: 'link' },
      { key: 'requester', name: 'Requester', type: 'user' },
      { key: 'reminder_id', name: 'Reminder ID', type: 'text' }
    ];
  }

  /**
   * Extract the key -> column ID schema map from Slack list metadata.
  * @param {any} ArgListMetadata Slack list metadata object.
  * @returns {Object<string, string>}
  */
  #ExtractListSchemaFromMetadata(ArgListMetadata) {
    /** @type {Object<string, string>} */
    const ListSchema = {};
    for(const Column of ArgListMetadata?.schema || []) {
      if(Column.key && Column.id) {
        ListSchema[Column.key] = Column.id;
      }
    }

    this.#SlackApp.Logger.info('Stored list schema:', ListSchema);
    return ListSchema;
  }

  /**
   * Build the durable display title for a per-user list.
   *
   * The registry is keyed on the user ID, so this title is cosmetic. There is no date
   * stamp — the list is durable and continuously synced, not a dated snapshot.
   * @param {string} ArgUserID Owner Slack user ID.
   * @returns {Promise<string>}
   */
  async #BuildUserListTitleAsync(ArgUserID) {
    const Identity = await this.#SlackApp.GetUserIdentityAsync(ArgUserID, { AllowStaleOnError: true });
    const Username = Identity?.Username ? `@${Identity.Username}` : null;
    const Label = Username || Identity?.DisplayName || ArgUserID;
    return `Sleuth Reminders — ${Label}`;
  }

  /**
   * Verify that a list exists.
   * @param {string} ArgListId List ID to verify.
   * @returns {Promise<boolean>}
   */
  async #VerifyListExistsAsync(ArgListId) {
    try {
      await this.#SlackClient.apiCall('slackLists.items.list', {
        list_id: ArgListId,
        limit: 1
      });

      return true;
    } catch(error) {
      return false;
    }
  }

  /**
   * Build a Slack permalink for a list when Slack does not return one directly.
   * @param {string} ArgListId List ID.
   * @param {any} [ArgCreateResponse] Optional create response.
   * @returns {Promise<string|null>}
   */
  async #BuildListPermalinkAsync(ArgListId, ArgCreateResponse = null) {
    const DirectPermalink =
      ArgCreateResponse?.list?.permalink ||
      ArgCreateResponse?.list_metadata?.permalink ||
      null;
    if(DirectPermalink) {
      return DirectPermalink;
    }

    try {
      const AuthResp = /** @type {any} */(await this.#SlackClient.auth.test());
      const TeamId = AuthResp.team_id || '';
      const WorkspaceUrl = AuthResp.url || '';
      if(!TeamId || !WorkspaceUrl) {
        return null;
      }

      const WorkspaceDomain = WorkspaceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `https://${WorkspaceDomain}/lists/${TeamId}/${ArgListId}`;
    } catch(error) {
      this.#SlackApp.Logger.debug(`Could not build list permalink for ${ArgListId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Verify that a channel exists and is accessible.
   * Uses cache to avoid repeated API calls for the same channel.
   * @param {string} ArgChannelId Channel ID to verify.
   * @returns {Promise<boolean>}
   */
  async #VerifyChannelExistsAsync(ArgChannelId) {
    // Check cache first
    if(this.#ChannelVerificationCache.has(ArgChannelId)) {
      return this.#ChannelVerificationCache.get(ArgChannelId);
    }

    try {
      const Response = /** @type {any} */(await this.#SlackClient.conversations.info({
        channel: ArgChannelId
      }));

      const Exists = !!Response.channel;
      this.#ChannelVerificationCache.set(ArgChannelId, Exists);
      return Exists;
    } catch(error) {
      // Log the actual error to help diagnose why channel access is failing
      const ErrorCode = error.data?.error || error.code || 'unknown';
      // Always log the error code for debugging (even channel_not_found to confirm it)
      this.#SlackApp.Logger.debug(`Channel verification error for ${ArgChannelId}: ${ErrorCode} - ${error.message || 'no message'}`);
      // Channel doesn't exist or bot doesn't have access
      this.#ChannelVerificationCache.set(ArgChannelId, false);
      return false;
    }
  }

  /**
   * Add a reminder to the Slack List.
   * @param {ReminderInfo} ArgReminder Reminder to add.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async AddReminderToListAsync(ArgReminder) {
    if(!this.#ListsAvailable) {
      return false;
    }

    // primary: the shared workspace list.
    let SharedOk = false;
    if(this.#SharedContext && this.#SharedContext.IsReady) {
      SharedOk = await this.#CreateListItemAsync(this.#SharedContext, ArgReminder, {
        UpdateCache: true,
        ValidateRoundtrip: true
      });
    }

    // Fan one shared reminder out into every registered assignee context. Each context cache is
    // keyed by reminder ID, so this remains one row per list and one lifecycle across all owners.
    const AssigneeIDs = Array.isArray(ArgReminder.AssigneeIDs) && ArgReminder.AssigneeIDs.length > 0
      ? [...new Set(ArgReminder.AssigneeIDs)]
      : [ArgReminder.AssigneeID || ArgReminder.OriginalSenderID];
    for(const AssigneeID of AssigneeIDs) {
      if(typeof AssigneeID !== 'string' || !AssigneeID || AssigneeID === this.#SlackApp.BotUserID) continue;
      const UserContext = this.#UserContexts.get(AssigneeID);
      if(UserContext && UserContext.IsReady && !UserContext.ItemCache.has(ArgReminder.ReminderID)) {
        await this.#CreateListItemAsync(UserContext, ArgReminder, { UpdateCache: true });
      }
    }

    return SharedOk;
  }

  /**
   * Add one reminder row to a list context.
   * When ArgOptions.UpdateCache is false, this leaves the context's item cache untouched.
   * @param {ListContext} ArgContext Target list context.
   * @param {ReminderInfo} ArgReminder Reminder to add.
   * @param {{ UpdateCache?: boolean, ValidateRoundtrip?: boolean }} [ArgOptions] Cache/validation flags.
   * @returns {Promise<boolean>}
   */
  async #CreateListItemAsync(ArgContext, ArgReminder, ArgOptions = {}) {
    try {
      const InitialFields = await this.#BuildReminderInitialFieldsAsync(ArgReminder, ArgContext.Schema);
      this.#SlackApp.Logger.info('Creating list item with fields:', JSON.stringify(InitialFields, null, 2));

      const CreateResponse = /** @type {any} */(await this.#SlackClient.apiCall('slackLists.items.create', {
        list_id: ArgContext.ListId,
        initial_fields: InitialFields
      }));

      this.#SlackApp.Logger.info('Create item response:', CreateResponse);

      const ItemId = CreateResponse.item?.id || CreateResponse.record_id;
      if(ItemId && ArgOptions.UpdateCache === true) {
        ArgContext.ItemCache.set(ArgReminder.ReminderID, ItemId);
        ArgContext.MarkRowEchoSuppressed(ItemId, CreateResponse.item);
        await this.#SaveCacheAsync();

        if(ArgOptions.ValidateRoundtrip === true)
          await this.#ValidateRoundtripAsync(ArgContext, ArgReminder, ItemId);
      }

      return !!ItemId;
    } catch(error) {
      const ErrorCode = error.data?.error || error.code || 'unknown';
      const ResponseMetadata = error.data?.response_metadata || {};

      this.#SlackApp.Logger.error('Error adding reminder to list:', {
        errorCode: ErrorCode,
        errorMessage: error.message,
        responseMetadata: ResponseMetadata,
        httpStatus: error.status,
        reminderID: ArgReminder.ReminderID,
        listID: ArgContext.ListId,
        retryAfter: error.headers?.['retry-after'] || 'not present'
      });

      if(ErrorCode === 'rate_limited' || error.status === 429) {
        this.#SlackApp.Logger.warn('RATE LIMITED: Slack is throttling requests. Check Retry-After header.');
      } else if(ErrorCode === 'internal_error') {
        this.#SlackApp.Logger.error('INTERNAL_ERROR: This is a Slack server-side error, NOT rate limiting.');
        this.#SlackApp.Logger.error('This may indicate: API instability, invalid request format, or a bug in the Lists API.');
        this.#SlackApp.Logger.error('Full error data:', JSON.stringify(error.data, null, 2));
      }

      return false;
    }
  }

  /**
   * Build the item-create payload for one reminder against a target list schema.
   * @param {ReminderInfo} ArgReminder Reminder being serialized.
   * @param {Object<string, string>} ArgListSchema Schema map for the target list.
   * @returns {Promise<Array<any>>}
   */
  async #BuildReminderInitialFieldsAsync(ArgReminder, ArgListSchema) {
    const InitialFields = [];

    if(ArgListSchema.summary) {
      const CleanSummary = SlackFormatUtils.ExtractKeyTasks(ArgReminder.ReminderMessageText);
      InitialFields.push({
        column_id: ArgListSchema.summary,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(CleanSummary)]
      });
    }

    if(ArgListSchema.due_date && ArgReminder.ReminderMessageText) {
      const DueDate = SlackFormatUtils.ExtractDueDate(ArgReminder.ReminderMessageText);
      if(DueDate) {
        InitialFields.push({
          column_id: ArgListSchema.due_date,
          rich_text: [{
            type: 'rich_text',
            elements: [{
              type: 'rich_text_section',
              elements: [{ type: 'text', text: DueDate }]
            }]
          }]
        });
      }
    }

    if(ArgListSchema.created_on) {
      const FormattedDate = SlackFormatUtils.FormatTimestampForDisplay(ArgReminder.ShouldPostOn);
      InitialFields.push({
        column_id: ArgListSchema.created_on,
        rich_text: [{
          type: 'rich_text',
          elements: [{
            type: 'rich_text_section',
            elements: [{ type: 'text', text: FormattedDate }]
          }]
        }]
      });
    }

    if(ArgListSchema.status) {
      InitialFields.push({
        column_id: ArgListSchema.status,
        select: ['pending']
      });
    }

    if(ArgListSchema.completed) {
      InitialFields.push({
        column_id: ArgListSchema.completed,
        checkbox: false
      });
    }

    if(ArgListSchema.source_channel && ArgReminder.OriginalChannelID) {
      try {
        const ChannelExists = await this.#VerifyChannelExistsAsync(ArgReminder.OriginalChannelID);
        if(ChannelExists) {
          InitialFields.push({
            column_id: ArgListSchema.source_channel,
            channel: [ArgReminder.OriginalChannelID]
          });
        } else {
          const ChannelName = ArgReminder.OriginalChannelName || await this.#SlackApp.GetChannelNameAsync(ArgReminder.OriginalChannelID);
          const ChannelDisplay = ChannelName ? `#${ChannelName}` : ArgReminder.OriginalChannelID;
          this.#SlackApp.Logger.warn(`Skipping source_channel for reminder ${ArgReminder.ReminderID}: channel ${ChannelDisplay} (${ArgReminder.OriginalChannelID}) not found or bot doesn't have access`);
        }
      } catch(error) {
        const ChannelName = ArgReminder.OriginalChannelName;
        const ChannelDisplay = ChannelName ? `#${ChannelName}` : ArgReminder.OriginalChannelID;
        this.#SlackApp.Logger.warn(`Skipping source_channel for reminder ${ArgReminder.ReminderID}: error verifying channel ${ChannelDisplay} (${ArgReminder.OriginalChannelID}): ${error.message}`);
      }
    }

    if(ArgListSchema.original_message && ArgReminder.OriginalChannelID) {
      try {
        const Permalink = await this.#SlackApp.GetPermaLinkAsync(
          ArgReminder.OriginalChannelID,
          ArgReminder.OriginalMessageID
        );
        if(Permalink) {
          InitialFields.push({
            column_id: ArgListSchema.original_message,
            link: [{
              original_url: Permalink,
              display_name: 'View message',
              display_as_url: true
            }]
          });
        }
      } catch(error) {
        this.#SlackApp.Logger.debug(`Skipping original_message for reminder ${ArgReminder.ReminderID}: ${error.message}`);
      }
    }

    if(ArgListSchema.requester && ArgReminder.OriginalSenderID) {
      InitialFields.push({
        column_id: ArgListSchema.requester,
        user: [ArgReminder.OriginalSenderID]
      });
    }

    if(ArgListSchema.assignee) {
      let AssigneeId = null;
      if(ArgReminder.AssigneeID) {
        AssigneeId = ArgReminder.AssigneeID;
      } else if(ArgReminder.ReminderMessageText) {
        AssigneeId = SlackFormatUtils.ExtractAssignee(
          ArgReminder.ReminderMessageText,
          ArgReminder.OriginalSenderID,
          this.#SlackApp.BotUserID
        );
      }

      if(AssigneeId) {
        InitialFields.push({
          column_id: ArgListSchema.assignee,
          user: [AssigneeId]
        });
      }
    }

    if(ArgListSchema.reminder_id) {
      InitialFields.push({
        column_id: ArgListSchema.reminder_id,
        rich_text: [{
          type: 'rich_text',
          elements: [{
            type: 'rich_text_section',
            elements: [{ type: 'text', text: ArgReminder.ReminderID }]
          }]
        }]
      });
    }

    return InitialFields;
  }

  /**
   * Validate that a written list item can be read back correctly.
   * Performs roundtrip verification after creating/updating a list item.
   *
   * @param {ListContext} ArgContext List context the item belongs to.
   * @param {ReminderInfo} ArgOriginalReminder Original reminder data
   * @param {string} ArgListItemId Created list item ID
   * @returns {Promise<{isValid: boolean, differences: Array<string>}>}
   */
  async #ValidateRoundtripAsync(ArgContext, ArgOriginalReminder, ArgListItemId) {
    try {
      // Fetch the item we just created/updated
      const Response = /** @type {any} */(await this.#SlackClient.apiCall('slackLists.items.info', {
        list_id: ArgContext.ListId,
        id: ArgListItemId
      }));

      const ListItem = Response.record;
      if(!ListItem) {
        this.#SlackApp.Logger.warn(`Roundtrip validation: Item ${ArgListItemId} not found after creation`);
        return { isValid: false, differences: ['Item not found after creation'] };
      }

      // Parse the item using our validation logic
      const Validation = this.#ValidateListItem(ArgContext, ListItem);
      if(!Validation.isValid) {
        this.#SlackApp.Logger.warn(`Roundtrip validation failed: ${Validation.errors.join(', ')}`);
        return { isValid: false, differences: Validation.errors };
      }

      // Compare key fields
      const Comparison = SlackFormatUtils.CompareReminderData(ArgOriginalReminder, Validation.data);
      if(!Comparison.isEqual) {
        this.#SlackApp.Logger.warn(`Roundtrip validation differences: ${Comparison.differences.join(', ')}`);
        return { isValid: false, differences: Comparison.differences };
      } else {
        this.#SlackApp.Logger.info(`Roundtrip validation passed for item ${ArgListItemId}`);
        return { isValid: true, differences: [] };
      }
    } catch(error) {
      this.#SlackApp.Logger.error(`Roundtrip validation error for item ${ArgListItemId}:`, error.message);
      return { isValid: false, differences: [`Validation API error: ${error.message}`] };
    }
  }

  /**
   * Update a reminder in the Slack List.
   * @param {string} ArgReminderID Reminder ID to update.
   * @param {Object} ArgUpdates Updates to apply.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async UpdateReminderInListAsync(ArgReminderID, ArgUpdates) {
    if(!this.#ListsAvailable || !this.#SharedContext) {
      return false;
    }
    return await this.#UpdateReminderInContextAsync(this.#SharedContext, ArgReminderID, ArgUpdates);
  }

  /**
   * Update a reminder's row within a specific list context.
   * @param {ListContext} ArgContext Target list context.
   * @param {string} ArgReminderID Reminder ID to update.
   * @param {Object} ArgUpdates Updates to apply.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async #UpdateReminderInContextAsync(ArgContext, ArgReminderID, ArgUpdates) {
    if(!ArgContext || !ArgContext.IsReady) {
      return false;
    }

    const ItemId = ArgContext.ItemCache.get(ArgReminderID);
    if(!ItemId) {
      this.#SlackApp.Logger.warn(`No list item found for reminder: ${ArgReminderID}`);
      return false;
    }

    return await this.#UpdateRowAsync(ArgContext, ItemId, ArgUpdates);
  }

  /**
   * Update a specific row in a list context by its Slack row ID.
   * @param {ListContext} ArgContext Target list context.
   * @param {string} ArgRowId Slack row ID to update.
   * @param {Record<string, any>} ArgUpdates Field updates to apply.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async #UpdateRowAsync(ArgContext, ArgRowId, ArgUpdates) {
    if(!ArgContext || !ArgContext.IsReady) {
      return false;
    }

    try {
      const Cells = this.#BuildUpdateCells(ArgContext, ArgRowId, ArgUpdates);
      if(Cells.length === 0) {
        this.#SlackApp.Logger.warn(
          `No Slack List columns matched update keys for row ${ArgRowId}: ${Object.keys(ArgUpdates).join(', ')}`
        );
        return false;
      }

      // update the item in the list using the documented row/cell payload.
      await this.#SlackClient.apiCall('slackLists.items.update', {
        list_id: ArgContext.ListId,
        cells: Cells
      });

      ArgContext.MarkRowEchoSuppressed(ArgRowId);
      return true;
    } catch(error) {
      this.#SlackApp.Logger.error('Error updating row in list:', error);
      return false;
    }
  }

  /**
   * Delete a reminder from the Slack List.
   * @param {string} ArgReminderID Reminder ID to delete.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async DeleteReminderFromListAsync(ArgReminderID) {
    if(!this.#ListsAvailable || !this.#SharedContext) {
      return false;
    }
    return await this.#DeleteReminderFromContextAsync(this.#SharedContext, ArgReminderID);
  }

  /**
   * Delete a reminder's row within a specific list context.
   * @param {ListContext} ArgContext Target list context.
   * @param {string} ArgReminderID Reminder ID to delete.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async #DeleteReminderFromContextAsync(ArgContext, ArgReminderID) {
    if(!ArgContext || !ArgContext.ListId) {
      return false;
    }

    try {
      // get the list item ID from the context cache.
      const ItemId = ArgContext.ItemCache.get(ArgReminderID);

      if(!ItemId) {
        this.#SlackApp.Logger.warn(`No list item found for reminder: ${ArgReminderID}`);
        return false;
      }

      // delete the item from the list.
      await this.#SlackClient.apiCall('slackLists.items.delete', {
        list_id: ArgContext.ListId,
        id: ItemId
      });

      // remove from the context cache.
      ArgContext.ItemCache.delete(ArgReminderID);
      await this.#SaveCacheAsync();

      return true;
    } catch(error) {
      this.#SlackApp.Logger.error('Error deleting reminder from list:', error);
      return false;
    }
  }

  /**
   * Mark a reminder's row as completed within a list context (status + checkbox).
   * @param {ListContext} ArgContext Target list context.
   * @param {string} ArgReminderID Reminder ID to mark completed.
   * @returns {Promise<boolean>}
   */
  async #MarkCompletedInContextAsync(ArgContext, ArgReminderID) {
    return await this.#UpdateReminderInContextAsync(ArgContext, ArgReminderID, {
      status: 'completed',
      completed: true
    });
  }

  /**
   * Mark a reminder as completed in the shared workspace list.
   * @param {string} ArgReminderID Reminder ID to mark as completed.
   * @returns {Promise<boolean>} True if successful, false otherwise.
   */
  async MarkReminderCompletedAsync(ArgReminderID) {
    return await this.#MarkCompletedInContextAsync(this.#SharedContext, ArgReminderID);
  }

  /**
   * Mark a reminder as posted in every list that currently tracks it
   * (the shared workspace list and the assignee's per-user list, if registered).
   * @param {string} ArgReminderID Reminder ID to mark as posted.
   * @returns {Promise<boolean>} True if at least one list was updated.
   */
  async MarkReminderPostedAsync(ArgReminderID) {
    if(!this.#ListsAvailable) {
      return false;
    }
    let AnySuccess = false;
    for(const Context of this.#ContextsContainingReminder(ArgReminderID)) {
      const Ok = await this.#UpdateReminderInContextAsync(Context, ArgReminderID, { status: 'posted' });
      AnySuccess = AnySuccess || Ok;
    }
    return AnySuccess;
  }

  /**
   * Fan a summary/title edit out to every list row tracking the reminder except the source row
   * the human just edited directly in Slack.
   * @param {string} ArgReminderID Reminder ID to update.
   * @param {string} ArgSummaryMrkdwn New summary in Slack mrkdwn format.
   * @param {ListContext|null} [ArgSourceContext] Context where the edit originated.
   * @returns {Promise<boolean>}
   */
  async SyncReminderSummaryAcrossListsAsync(ArgReminderID, ArgSummaryMrkdwn, ArgSourceContext = null) {
    if(!this.#ListsAvailable || typeof ArgSummaryMrkdwn !== 'string' || ArgSummaryMrkdwn.trim().length === 0) {
      return false;
    }

    let AnySuccess = false;
    for(const Context of this.#ContextsContainingReminder(ArgReminderID)) {
      if(ArgSourceContext && Context === ArgSourceContext) {
        continue;
      }
      const Ok = await this.#UpdateReminderInContextAsync(Context, ArgReminderID, { summary: ArgSummaryMrkdwn });
      AnySuccess = AnySuccess || Ok;
    }
    return AnySuccess;
  }

  /**
   * Every managed context (shared + per-user) that currently has a row for a reminder.
   * @param {string} ArgReminderID Reminder ID to look up.
   * @returns {ListContext[]}
   */
  #ContextsContainingReminder(ArgReminderID) {
    return this.#AllContexts().filter(Context => Context.ItemCache.has(ArgReminderID));
  }

  /**
   * Handle a reminder that was completed in Sleuth — fan the completion out to every list.
   *
   * On the shared list the row is marked completed and then deleted (preserving the legacy
   * shared-list behavior). On a per-user list the row is marked completed and kept as a
   * history record; the reminder is dropped from that list's item cache so it is no longer
   * actively managed.
   * @param {string} ArgReminderID Reminder ID that was completed.
   * @returns {Promise<void>}
   */
  async HandleReminderCompletedAsync(ArgReminderID) {
    if(!this.#ListsAvailable) {
      return;
    }

    for(const Context of this.#ContextsContainingReminder(ArgReminderID)) {
      await this.#MarkCompletedInContextAsync(Context, ArgReminderID);

      if(Context.DeleteRowOnComplete) {
        await this.#DeleteReminderFromContextAsync(Context, ArgReminderID);
      } else {
        // keep the row as a history record, but stop actively managing it.
        Context.ItemCache.delete(ArgReminderID);
        await this.#SaveCacheAsync();
      }
    }
  }

  /**
   * Handle a reminder that was removed from Sleuth (canceled, dead-letter, expired) —
   * delete its row from every list that tracks it.
   * @param {string} ArgReminderID Reminder ID that was removed.
   * @param {string} [ArgReason] Reason for removal (for logging).
   * @returns {Promise<void>}
   */
  async HandleReminderRemovedAsync(ArgReminderID, ArgReason = 'removed') {
    if(!this.#ListsAvailable) {
      return;
    }

    for(const Context of this.#ContextsContainingReminder(ArgReminderID)) {
      this.#SlackApp.Logger.debug(
        `Removing reminder ${ArgReminderID} row from ${Context.Kind} list ${Context.ListId} (${ArgReason})`
      );
      await this.#DeleteReminderFromContextAsync(Context, ArgReminderID);
    }
  }

  /**
   * Convert a reminder update object into Slack Lists cells for a specific row.
   * @param {ListContext} ArgContext List context whose schema maps field keys to column IDs.
   * @param {string} ArgListItemId List row ID.
   * @param {Record<string, any>} ArgUpdates Update payload.
   * @returns {Array<Record<string, any>>}
   */
  #BuildUpdateCells(ArgContext, ArgListItemId, ArgUpdates) {
    const Schema = ArgContext ? ArgContext.Schema : null;
    if(!Schema) {
      return [];
    }

    /** @type {Array<Record<string, any>>} */
    const Cells = [];

    if(typeof ArgUpdates.summary === 'string' && Schema.summary) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.summary,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(ArgUpdates.summary)]
      });
    }

    if(typeof ArgUpdates.status === 'string' && Schema.status) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.status,
        select: [ArgUpdates.status]
      });
    }

    if(typeof ArgUpdates.completed === 'boolean' && Schema.completed) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.completed,
        checkbox: ArgUpdates.completed
      });
    }

    if(typeof ArgUpdates.due_date === 'string' && Schema.due_date) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.due_date,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(ArgUpdates.due_date)]
      });
    }

    if(typeof ArgUpdates.created_on === 'string' && Schema.created_on) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.created_on,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(ArgUpdates.created_on)]
      });
    }

    if(typeof ArgUpdates.source_channel === 'string' && Schema.source_channel) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.source_channel,
        channel: [ArgUpdates.source_channel]
      });
    }

    if(typeof ArgUpdates.original_message === 'string' && Schema.original_message) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.original_message,
        link: [{
          original_url: ArgUpdates.original_message,
          display_name: 'View message',
          display_as_url: true
        }]
      });
    }

    if(typeof ArgUpdates.requester === 'string' && Schema.requester) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.requester,
        user: [ArgUpdates.requester]
      });
    }

    if(typeof ArgUpdates.assignee === 'string' && Schema.assignee) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.assignee,
        user: [ArgUpdates.assignee]
      });
    }

    if(typeof ArgUpdates.reminder_id === 'string' && Schema.reminder_id) {
      Cells.push({
        row_id: ArgListItemId,
        column_id: Schema.reminder_id,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(ArgUpdates.reminder_id)]
      });
    }

    return Cells;
  }

  /**
   * Sync reminders from JSON to the Slack List.
   * @param {ReminderInfo[]} ArgReminders Array of reminders to sync.
   * @returns {Promise<void>}
   */
  async SyncFromJsonAsync(ArgReminders) {
    if(!this.#ListsAvailable || !this.#SharedContext || !this.#SharedContext.ListId) {
      return;
    }

    this.#SlackApp.Logger.info(`Starting sync of ${ArgReminders.length} reminders to list`);

    try {
      // get existing items in the list.
      const ExistingItems = await this.#GetAllListItemsAsync(this.#SharedContext);

      // create a map of existing items by reminder ID (if we can extract it).
      const ExistingItemsMap = new Map();

      for(const Item of ExistingItems) {
        // we'll need a way to identify which items correspond to which reminders.
        // for now, we'll use a combination of summary and scheduled time as a key.
        if(Item && typeof Item === 'object' && 'summary' in Item && 'scheduled_time' in Item) {
          const Key = `${Item.summary}_${Item.scheduled_time}`;
          ExistingItemsMap.set(Key, Item);
        }
      }

      // add missing reminders to the list.
      let AddedCount = 0;
      let SkippedCount = 0;

      for(const Reminder of ArgReminders) {
        // create a key for this reminder.
        const Key = `${Reminder.ReminderMessageText}_${Reminder.ShouldPostOn.getTime()}`;

        // check if this reminder already exists in the list.
        if(ExistingItemsMap.has(Key) || this.#SharedContext.ItemCache.has(Reminder.ReminderID)) {
          SkippedCount++;
          continue;
        }

        // add the reminder to the list.
        const Success = await this.AddReminderToListAsync(Reminder);

        if(Success) {
          AddedCount++;
        }

        // add a small delay to avoid rate limits.
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      this.#SlackApp.Logger.info(`Sync complete: added ${AddedCount}, skipped ${SkippedCount}`);

      // update last sync time.
      this.#SharedContext.LastSync = new Date();
      await this.#SaveCacheAsync();
    } catch(error) {
      this.#SlackApp.Logger.error('Error syncing reminders to list:', error);
    }
  }

  /**
   * Get all items from a list context.
   * @param {ListContext} ArgContext List context to read.
   * @returns {Promise<Array<Object>>} Array of list items.
   */
  async #GetAllListItemsAsync(ArgContext) {
    if(!this.#ListsAvailable || !ArgContext || !ArgContext.ListId) {
      return [];
    }

    try {
      const Items = [];
      let Cursor = undefined;

      // paginate through all items.
      do {
        const Response = /** @type {any} */(await this.#SlackClient.apiCall('slackLists.items.list', {
          list_id: ArgContext.ListId,
          limit: 100,
          cursor: Cursor
        }));

        if(Response.items) {
          Items.push(...Response.items);
        }

        Cursor = Response.response_metadata?.next_cursor;
      } while(Cursor);

      return Items;
    } catch(error) {
      this.#SlackApp.Logger.error('Error getting list items:', error);
      return [];
    }
  }

  /**
   * Load cache from disk.
   *
   * Supports the versioned v2 shape ({ version, shared, userLists }) and transparently
   * migrates the legacy flat shape ({ listId, itemCache, lastSync, listSchema }) — the
   * next save rewrites it as v2.
   * @returns {Promise<void>}
   */
  async #LoadCacheAsync() {
    try {
      const CacheData = await fs.readFile(this.#CacheFilePath, 'utf-8');
      const ParsedCache = JSON.parse(CacheData);

      if(ParsedCache.version === 2) {
        // v2 shape: { version, shared, userLists }.
        if(ParsedCache.shared && ParsedCache.shared.listId) {
          this.#SharedContext = ListContext.FromCacheEntry(ParsedCache.shared, 'shared');
          this.#RegisterContext(this.#SharedContext);
        }

        for(const [UserID, Entry] of Object.entries(ParsedCache.userLists || {})) {
          // isolate a corrupt entry so one bad user list cannot lose the rest.
          try {
            const Context = ListContext.FromCacheEntry(/** @type {any} */(Entry), 'user');
            if(!Context.OwnerUserID) {
              Context.OwnerUserID = UserID;
            }
            this.#RegisterContext(Context);
          } catch(entryError) {
            this.#SlackApp.Logger.warn(`Skipping corrupt user list cache entry for ${UserID}: ${entryError.message}`);
          }
        }
      } else if(ParsedCache.listId) {
        // legacy flat shape — load it as the shared context; next save rewrites as v2.
        this.#SharedContext = ListContext.FromCacheEntry(ParsedCache, 'shared');
        this.#RegisterContext(this.#SharedContext);
      }

      const SharedItemCount = this.#SharedContext ? this.#SharedContext.ItemCache.size : 0;
      this.#SlackApp.Logger.info(
        `Loaded lists cache: shared list ${this.#SharedContext ? 'yes' : 'no'} ` +
        `(${SharedItemCount} items), ${this.#UserContexts.size} per-user list(s)`
      );
    } catch(error) {
      // cache file doesn't exist or is invalid, start fresh.
      this.#SlackApp.Logger.info('No valid lists cache found, starting fresh');
    }
  }

  /**
   * Save cache to disk as the versioned v2 shape, writing atomically (temp file + rename)
   * so a crash mid-write cannot leave a corrupt cache file.
   * @returns {Promise<void>}
   */
  async #SaveCacheAsync() {
    try {
      /** @type {Object<string, object>} */
      const UserLists = {};
      for(const [UserID, Context] of this.#UserContexts.entries()) {
        UserLists[UserID] = Context.ToCacheEntry();
      }

      const CacheData = {
        version: 2,
        shared: this.#SharedContext ? this.#SharedContext.ToCacheEntry() : null,
        userLists: UserLists
      };

      // Folded into the shared helper (GH-12 Phase 5). This was the codebase's only ad-hoc
      // temp+rename: it had no fsync, used a fixed `.tmp` name that two concurrent saves would
      // collide on, and leaked that temp on failure. The helper fixes all three.
      await WriteFileDurableAsync(this.#CacheFilePath, JSON.stringify(CacheData, null, 2), { Logger: this.#SlackApp.Logger });
    } catch(error) {
      this.#SlackApp.Logger.error('Error saving lists cache:', error);
    }
  }

  /**
   * Post a message to the reminder channel in Slack.
   * @param {string} ArgMessage Message text to post.
   * @returns {Promise<void>}
   */
  async #PostToSlackAsync(ArgMessage) {
    try {
      const ReminderChannelName = this.#SlackApp.WorkspaceInfo.REMINDER_CHANNEL_NAME;
      const ReminderChannelID = await this.#SlackApp.GetChannelIdAsync(ReminderChannelName);

      if(ReminderChannelID) {
        await this.#SlackApp.PostMessageTextAsync(ReminderChannelID, null, ArgMessage);
        this.#SlackApp.Logger.debug(`Posted Lists status message to ${ReminderChannelName}`);
      } else {
        this.#SlackApp.Logger.warn(`Could not find reminder channel ${ReminderChannelName} for Lists status message`);
      }
    } catch(error) {
      this.#SlackApp.Logger.error('Error posting Lists status to Slack:', error);
    }
  }

  /**
   * Get the URL to view the list in Slack.
   * @returns {string|null} List URL if available, null otherwise.
   */
  GetListUrl() {
    const SharedListId = this.#SharedContext ? this.#SharedContext.ListId : null;
    if(!SharedListId) {
      return null;
    }

    // construct the list URL (format may vary).
    // this is a hypothetical URL format - need to verify with actual Slack documentation.
    // For now, return a basic URL without team ID.
    return `https://app.slack.com/lists/${SharedListId}`;
  }

  /**
   * Start polling for list changes across every managed context.
   */
  #StartPolling() {
    if(!this.#ListsAvailable || !this.#SharedContext || !this.#SharedContext.ListId) {
      return;
    }

    this.#SlackApp.Logger.info(`Starting list polling with ${this.#PollingFrequency / 1000}s interval`);

    // poll immediately on startup.
    this.#PollAllContextsAsync().catch(error => {
      this.#SlackApp.Logger.error('Error in initial list poll:', error);
    });

    // set up recurring polling.
    this.#PollingInterval = setInterval(() => {
      this.#PollAllContextsAsync().catch(error => {
        this.#SlackApp.Logger.error('Error polling lists for changes:', error);
      });
    }, this.#PollingFrequency);
  }

  /**
   * Stop polling for list changes.
   */
  #StopPolling() {
    if(this.#PollingInterval) {
      clearInterval(this.#PollingInterval);
      this.#PollingInterval = null;
      this.#SlackApp.Logger.info('Stopped list polling');
    }
  }

  /**
   * Poll every managed context for changes. Each context runs in its own try/catch
   * so one bad list never blocks the others.
   *
   * @returns {Promise<void>}
   */
  async #PollAllContextsAsync() {
    const Contexts = this.#AllContexts();
    for(let Index = 0; Index < Contexts.length; Index++) {
      // space out successive lists to ease rate-limit pressure as the count grows.
      if(Index > 0) {
        await new Promise(resolve => setTimeout(resolve, ListsModule.INTER_CONTEXT_POLL_DELAY_MS));
      }
      try {
        await this.#PollContextForChangesAsync(Contexts[Index]);
      } catch(error) {
        this.#SlackApp.Logger.error(`Error polling list ${Contexts[Index].ListId}:`, error);
      }
    }
  }

  /**
   * Poll one list context for changes and process them.
   *
   * @param {ListContext} ArgContext List context to poll.
   * @returns {Promise<void>}
   */
  async #PollContextForChangesAsync(ArgContext) {
    try {
      // fetch all current list items.
      const CurrentItems = await this.#GetAllListItemsAsync(ArgContext);

      // detect changes compared to cached items.
      const Changes = this.#DetectChanges(ArgContext, CurrentItems);

      // echo suppression: drop rows Sleuth itself just wrote so the bot's own
      // outbound writes are not reprocessed as inbound user edits. One-shot:
      // the suppression set is cleared once consumed.
      if(ArgContext.EchoSuppressRowIds.size > 0) {
        Changes.added = Changes.added.filter(
          Item => !(Item && ArgContext.EchoSuppressRowIds.has(Item.id))
        );
        Changes.updated = Changes.updated.filter(
          Change => !(Change && Change.new && ArgContext.EchoSuppressRowIds.has(Change.new.id))
        );
        ArgContext.EchoSuppressRowIds.clear();
      }

      if(Changes.added.length > 0 || Changes.updated.length > 0 || Changes.deleted.length > 0) {
        this.#SlackApp.Logger.info(
          `List changes detected (${ArgContext.Kind} ${ArgContext.ListId}): ${Changes.added.length} added, ` +
          `${Changes.updated.length} updated, ${Changes.deleted.length} deleted`
        );

        // process the changes.
        await this.#ProcessListChangesAsync(ArgContext, Changes);
      }

      // update the change-detection cache with current items.
      ArgContext.ListItemsCache.clear();
      for(const Item of CurrentItems) {
        if(Item && typeof Item === 'object' && 'id' in Item && typeof Item.id === 'string') {
          ArgContext.ListItemsCache.set(Item.id, Item);
        }
      }

      // update last sync time.
      ArgContext.LastSync = new Date();

    } catch(error) {
      this.#SlackApp.Logger.error('Error polling list for changes:', error);
    }
  }

  /**
   * Detect changes between current items and a context's cached items.
   *
   * @param {ListContext} ArgContext List context being polled.
   * @param {Array<any>} ArgCurrentItems Current list items from API.
   * @returns {{added: Array<any>, updated: Array<{old: any, new: any}>, deleted: Array<any>}}
   */
  #DetectChanges(ArgContext, ArgCurrentItems) {
    /** @type {{added: Array<any>, updated: Array<{old: any, new: any}>, deleted: Array<any>}} */
    const Changes = {
      added: [],
      updated: [],
      deleted: []
    };

    // create a set of current item IDs for quick lookup.
    const CurrentItemIds = new Set();

    // check for added and updated items.
    for(const Item of ArgCurrentItems) {
      if(!Item || typeof Item !== 'object' || !('id' in Item)) {
        continue;
      }

      CurrentItemIds.add(Item.id);

      if(!ArgContext.ListItemsCache.has(Item.id)) {
        // new item added.
        Changes.added.push(Item);
      } else {
        // check if item was updated.
        const CachedItem = ArgContext.ListItemsCache.get(Item.id);
        if(this.#HasItemChanged(CachedItem, Item)) {
          Changes.updated.push({ old: CachedItem, new: Item });
        }
      }
    }

    // check for deleted items.
    for(const [ItemId, CachedItem] of ArgContext.ListItemsCache.entries()) {
      if(!CurrentItemIds.has(ItemId)) {
        Changes.deleted.push(CachedItem);
      }
    }

    return Changes;
  }

  /**
   * Check if a list item has changed.
   * 
   * @param {any} ArgOldItem Old item data.
   * @param {any} ArgNewItem New item data.
   * @returns {boolean} True if item has changed.
   */
  #HasItemChanged(ArgOldItem, ArgNewItem) {
    // compare relevant fields to detect changes.
    const OldJson = JSON.stringify(ArgOldItem);
    const NewJson = JSON.stringify(ArgNewItem);
    return OldJson !== NewJson;
  }

  /**
   * Process detected list changes for a context.
   *
   * @param {ListContext} ArgContext List context the changes belong to.
   * @param {{added: Array<any>, updated: Array<any>, deleted: Array<any>}} ArgChanges Detected changes.
   * @returns {Promise<void>}
   */
  async #ProcessListChangesAsync(ArgContext, ArgChanges) {
    // process added items.
    for(const Item of ArgChanges.added) {
      await this.#HandleAddedListItemAsync(ArgContext, Item);
    }

    // process updated items.
    for(const Change of ArgChanges.updated) {
      await this.#HandleUpdatedListItemAsync(ArgContext, Change.old, Change.new);
    }

    // process deleted items.
    for(const Item of ArgChanges.deleted) {
      await this.#HandleDeletedListItemAsync(ArgContext, Item);
    }
  }

  /**
   * Transform raw list item from Slack API (with fields array) to flat object.
   * The Slack Lists API returns items with a `fields` array containing column_id and values.
   * This method converts it to a flat object with our schema keys.
   *
   * @param {ListContext} ArgContext List context whose schema maps column IDs to field keys.
   * @param {any} ArgRawItem Raw item from Slack API
   * @returns {Object} Flat object with field keys as properties
   */
  #TransformListItem(ArgContext, ArgRawItem) {
    if(!ArgRawItem || typeof ArgRawItem !== 'object') {
      return ArgRawItem;
    }

    // Start with basic properties
    const TransformedItem = {
      id: ArgRawItem.id,
      list_id: ArgRawItem.list_id,
      date_created: ArgRawItem.date_created,
      created_by: ArgRawItem.created_by,
      updated_by: ArgRawItem.updated_by,
      updated_timestamp: ArgRawItem.updated_timestamp
    };

    const Schema = ArgContext ? ArgContext.Schema : null;

    // If no fields array or no schema, return as-is
    if(!ArgRawItem.fields || !Array.isArray(ArgRawItem.fields) || !Schema) {
      return TransformedItem;
    }

    // Create reverse lookup: column_id -> field_key
    /** @type {{[key: string]: string}} */
    const ColumnToKey = {};
    for(const [Key, ColumnId] of Object.entries(Schema)) {
      ColumnToKey[ColumnId] = Key;
    }

    // Transform each field from the fields array to flat properties
    for(const Field of ArgRawItem.fields) {
      if(!Field || typeof Field !== 'object' || !Field.column_id) {
        continue;
      }

      const FieldKey = ColumnToKey[Field.column_id];
      if(!FieldKey) {
        continue; // Unknown column, skip
      }

      // Extract the value based on field type
      // The field structure varies: { column_id, rich_text: [...] } or { column_id, number: [...] } etc.
      /** @type {any} */
      const TransformedItemAny = TransformedItem;
      if('rich_text' in Field) {
        TransformedItemAny[FieldKey] = Field.rich_text;
      } else if('number' in Field) {
        TransformedItemAny[FieldKey] = Field.number;
      } else if('channel' in Field) {
        TransformedItemAny[FieldKey] = Field.channel;
      } else if('link' in Field) {
        TransformedItemAny[FieldKey] = Field.link;
      } else if('user' in Field) {
        TransformedItemAny[FieldKey] = Field.user;
      } else if('select' in Field) {
        TransformedItemAny[FieldKey] = Field.select;
      } else if('checkbox' in Field) {
        TransformedItemAny[FieldKey] = Field.checkbox;
      } else if('date' in Field) {
        TransformedItemAny[FieldKey] = Field.date;
      } else if('text' in Field) {
        TransformedItemAny[FieldKey] = Field.text;
      }
    }

    return TransformedItem;
  }

  /**
   * Validate and extract reminder data from list item.
   * Uses SlackFormatUtils to handle Block Kit structures returned by Slack Lists API.
   *
   * @param {ListContext} ArgContext List context whose schema is used to flatten raw rows.
   * @param {any} ArgItem List item data (raw from API or already transformed).
   * @returns {{isValid: boolean, data: any|null, errors: Array<string>}}
   */
  #ValidateListItem(ArgContext, ArgItem) {
    const Errors = [];

    // check required fields.
    if(!ArgItem || typeof ArgItem !== 'object') {
      return { isValid: false, data: null, errors: ['Item is not an object'] };
    }

    // Transform if this is raw API response (has fields array)
    const Item = ArgItem.fields && Array.isArray(ArgItem.fields)
      ? this.#TransformListItem(ArgContext, ArgItem)
      : ArgItem;

    // extract and validate fields.
    /** @type {{listItemId: string|null, summary: string|null, scheduledTime: number|null, sourceChannel: string|null, originalMessage: string|null, status: string|null, assignee: string|null, completed: boolean, dueDate: string|null, reminderId: string|null, fullMessage: string|null}} */
    const Data = {
      listItemId: Item.id || null,
      summary: null,
      scheduledTime: null,
      sourceChannel: null,
      originalMessage: null,
      status: null,
      assignee: null,
      completed: false,
      dueDate: null,
      reminderId: null,
      fullMessage: null
    };

    // validate summary - may be string OR rich_text Block Kit structure
    if('summary' in Item) {
      const ParsedSummary = SlackFormatUtils.ParseListFieldValue(Item.summary, 'rich_text');
      if(ParsedSummary && ParsedSummary.trim().length > 0) {
        Data.summary = ParsedSummary.trim();
      }
    }
    if(!Data.summary) {
      Errors.push('Missing or invalid summary field');
    }

    // validate reminder_id - direct lookup field
    if('reminder_id' in Item) {
      Data.reminderId = SlackFormatUtils.ParseListFieldValue(Item.reminder_id, 'rich_text');
    }

    // validate due_date - extracted due date text
    if('due_date' in Item) {
      Data.dueDate = SlackFormatUtils.ParseListFieldValue(Item.due_date, 'rich_text');
    }

    // created_on is a formatted display string (e.g. "Nov 26 5:00 PM"); not parsed back to a timestamp.
    // scheduledTime stays null in the current schema.

    // validate source_channel - may be string or array [string]
    if('source_channel' in Item) {
      Data.sourceChannel = SlackFormatUtils.ParseListFieldValue(Item.source_channel, 'channel');
    }

    // validate original_message - may be string URL or array [{original_url, ...}]
    if('original_message' in Item) {
      Data.originalMessage = SlackFormatUtils.ParseListFieldValue(Item.original_message, 'link');
    }

    // validate requester (user field) - may be string or array [string]
    // Note: requester is stored for reference but not used as assignee
    if('requester' in Item) {
      SlackFormatUtils.ParseListFieldValue(Item.requester, 'user');
      // Requester stored but we use assignee field for actual assignment
    }

    // validate assignee (user field) - the person assigned to the task
    if('assignee' in Item) {
      const Assignee = SlackFormatUtils.ParseListFieldValue(Item.assignee, 'user');
      if(Assignee) {
        Data.assignee = Assignee;
      }
    }

    Data.status = 'pending'; // Default status for backwards compatibility
    if('status' in Item) {
      const StatusValue = Array.isArray(Item.status) ? Item.status[0] : Item.status;
      if(typeof StatusValue === 'string' && StatusValue.trim().length > 0) {
        Data.status = StatusValue;
      }
    }

    // validate completed (optional).
    if('completed' in Item) {
      Data.completed = Boolean(Item.completed);
    }

    return {
      isValid: Errors.length === 0,
      data: Data,
      errors: Errors
    };
  }

  /**
   * Handle a new item added to a list context.
   *
   * @param {ListContext} ArgContext List context the item belongs to.
   * @param {any} ArgItem List item data.
   * @returns {Promise<void>}
   */
  async #HandleAddedListItemAsync(ArgContext, ArgItem) {
    const ItemId = (ArgItem && typeof ArgItem === 'object' && 'id' in ArgItem) ? ArgItem.id : 'unknown';

    // the shared workspace list stays output-only - reminders JSON is the source of truth.
    if(ArgContext.Kind !== 'user') {
      this.#SlackApp.Logger.debug(`List item ${ItemId} added to shared List - ignored (reminders are source of truth)`);
      return;
    }

    const Validation = this.#ValidateListItem(ArgContext, ArgItem);
    const ReminderId = Validation.data ? Validation.data.reminderId : null;

    if(ReminderId) {
      // a Sleuth-authored row that slipped past echo suppression (e.g. a restart) - adopt it
      // so it is tracked but not re-created. Completed history rows are intentionally excluded:
      // they are no longer actively managed, and re-adopting them would let a later delete
      // be mistaken as a fresh cancellation.
      const IsCompleted = Validation.data ? Validation.data.completed : false;
      if(!IsCompleted) {
        if(!ArgContext.ItemCache.has(ReminderId)) {
          ArgContext.ItemCache.set(ReminderId, ItemId);
          await this.#SaveCacheAsync();
          this.#SlackApp.Logger.debug(`User list ${ArgContext.ListId}: adopted existing row ${ItemId} for reminder ${ReminderId}`);
        }

        await this.#ReconcileReminderSummaryFromRowAsync(ArgContext, ArgItem, ReminderId, 'list-row-adopted');
      }
      return;
    }

    // a hand-authored row with no reminder link - turn it into a new reminder (Phase 2).
    const RowData = Validation.data || {};
    const Summary = typeof RowData.summary === 'string' ? RowData.summary.trim() : '';
    const DueDate = typeof RowData.dueDate === 'string' ? RowData.dueDate.trim() : '';
    const ParsedDue = DueDate ? new Date(DueDate) : null;

    // minimum column contract: a summary and a parseable due date are required.
    if(!Summary || !ParsedDue || isNaN(ParsedDue.getTime())) {
      this.#SlackApp.Logger.info(
        `User list ${ArgContext.ListId}: row ${ItemId} is missing a summary or a valid due date - marking needs-info`
      );
      // mark the row so the operator sees what to fix; the marker also stops it re-triggering.
      await this.#UpdateRowAsync(ArgContext, ItemId, { status: 'needs-info' });
      return;
    }

    if(!this.#RemindersModule) {
      this.#SlackApp.Logger.warn(`User list ${ArgContext.ListId}: cannot create reminder from row ${ItemId} - RemindersModule not set`);
      return;
    }

    // target channel: the row's source_channel column if set, otherwise the list's access channel.
    const TargetChannelID = (typeof RowData.sourceChannel === 'string' && RowData.sourceChannel)
      ? RowData.sourceChannel
      : ArgContext.AccessChannelID;
    const AuthoredBy = (ArgItem && typeof ArgItem === 'object' ? ArgItem.created_by : null) || ArgContext.OwnerUserID || null;

    const Created = await this.#RemindersModule.CreateReminderFromListRowAsync({
      summary: Summary,
      dueDate: DueDate,
      assigneeID: RowData.assignee || AuthoredBy,
      targetChannelID: TargetChannelID,
      originalSenderID: AuthoredBy
    });

    if(!Created || !Created.ok || !Created.reminder) {
      this.#SlackApp.Logger.warn(
        `User list ${ArgContext.ListId}: failed to create a reminder from row ${ItemId}: ${Created ? Created.error : 'no result'}`
      );
      await this.#UpdateRowAsync(ArgContext, ItemId, { status: 'needs-info' });
      return;
    }

    const NewReminder = Created.reminder;

    // adopt the existing hand-authored row: write reminder_id back so the next poll treats it
    // as a managed row, and start tracking it in this context.
    await this.#UpdateRowAsync(ArgContext, ItemId, {
      reminder_id: NewReminder.ReminderID,
      status: 'pending'
    });
    ArgContext.ItemCache.set(NewReminder.ReminderID, ItemId);

    // mirror onto the shared workspace list.
    if(this.#SharedContext && this.#SharedContext.IsReady) {
      await this.#CreateListItemAsync(this.#SharedContext, NewReminder, { UpdateCache: true });
    } else {
      await this.#SaveCacheAsync();
    }

    // if the reminder is assigned to a different user with their own registered list, mirror
    // there too. Without this, a row in Alice's list assigned to Bob never appears in Bob's list.
    const AssigneeIDs = Array.isArray(NewReminder.AssigneeIDs) && NewReminder.AssigneeIDs.length > 0
      ? [...new Set(NewReminder.AssigneeIDs)]
      : [NewReminder.AssigneeID || NewReminder.OriginalSenderID];
    for(const AssigneeID of AssigneeIDs) {
      if(typeof AssigneeID !== 'string' || !AssigneeID || AssigneeID === this.#SlackApp.BotUserID) continue;
      const AssigneeContext = this.#UserContexts.get(AssigneeID);
      if(AssigneeContext && AssigneeContext !== ArgContext && AssigneeContext.IsReady
        && !AssigneeContext.ItemCache.has(NewReminder.ReminderID)) {
        await this.#CreateListItemAsync(AssigneeContext, NewReminder, { UpdateCache: true });
      }
    }

    this.#SlackApp.Logger.info(
      `User list ${ArgContext.ListId}: created reminder ${NewReminder.ReminderID} from hand-authored row ${ItemId}`
    );
  }

  /**
   * Handle an updated item in a list context.
   *
   * @param {ListContext} ArgContext List context the item belongs to.
   * @param {any} ArgOldItem Old item data.
   * @param {any} ArgNewItem New item data.
   * @returns {Promise<void>}
   */
  async #HandleUpdatedListItemAsync(ArgContext, ArgOldItem, ArgNewItem) {
    const ItemId = (ArgNewItem && typeof ArgNewItem === 'object' && 'id' in ArgNewItem) ? ArgNewItem.id : 'unknown';

    // the shared workspace list stays output-only - reminders JSON is the source of truth.
    if(ArgContext.Kind !== 'user') {
      this.#SlackApp.Logger.debug(`List item ${ItemId} updated in shared List - ignored (reminders are source of truth)`);
      return;
    }

    const NewValidation = this.#ValidateListItem(ArgContext, ArgNewItem);
    const ReminderId = NewValidation.data ? NewValidation.data.reminderId : null;
    if(!ReminderId) {
      // a hand-authored row being edited - no reminder link to sync structured state back to.
      return;
    }

    // detect the completion edge: completed now, and not already completed before.
    // (summary text is Sleuth-owned and intentionally never read back inbound.)
    const NewCompleted = NewValidation.data.completed === true || NewValidation.data.status === 'completed';
    const OldValidation = this.#ValidateListItem(ArgContext, ArgOldItem);
    const OldCompleted = OldValidation.data
      ? (OldValidation.data.completed === true || OldValidation.data.status === 'completed')
      : false;

    if(NewCompleted && !OldCompleted) {
      this.#SlackApp.Logger.info(
        `User list ${ArgContext.ListId}: reminder ${ReminderId} marked completed in Slack`
      );
      if(this.#RemindersModule) {
        // CompleteReminderFromListAsync routes back through HandleReminderCompletedAsync,
        // which marks the row done in every list, keeps the per-user row as history, and
        // drops it from this context's item cache. That normalizing write is echo-suppressed.
        await this.#RemindersModule.CompleteReminderFromListAsync(ReminderId, 'list-checkbox');
      }
      return;
    }

    const NewSummaryPlain = typeof NewValidation.data.summary === 'string'
      ? NewValidation.data.summary.trim()
      : '';
    const OldSummaryPlain = OldValidation.data && typeof OldValidation.data.summary === 'string'
      ? OldValidation.data.summary.trim()
      : '';

    if(NewSummaryPlain && NewSummaryPlain !== OldSummaryPlain && this.#RemindersModule
      && typeof this.#RemindersModule.UpdateReminderSummaryFromListAsync === 'function') {
      const NewSummaryMrkdwn = this.#ExtractSummaryMrkdwnFromListItem(ArgContext, ArgNewItem, NewSummaryPlain);
      this.#SlackApp.Logger.info(
        `User list ${ArgContext.ListId}: reminder ${ReminderId} summary edited in Slack`
      );
      const Updated = await this.#RemindersModule.UpdateReminderSummaryFromListAsync(
        ReminderId,
        NewSummaryMrkdwn,
        'list-summary-edited'
      );
      if(Updated) {
        await this.SyncReminderSummaryAcrossListsAsync(ReminderId, NewSummaryMrkdwn, ArgContext);
      }
    }
  }

  /**
   * Handle a deleted item from a list context.
   *
   * @param {ListContext} ArgContext List context the item belonged to.
   * @param {any} ArgItem List item data.
   * @returns {Promise<void>}
   */
  async #HandleDeletedListItemAsync(ArgContext, ArgItem) {
    const ItemId = (ArgItem && typeof ArgItem === 'object' && 'id' in ArgItem) ? ArgItem.id : 'unknown';

    // the shared workspace list stays output-only - reminders JSON is the source of truth.
    if(ArgContext.Kind !== 'user') {
      this.#SlackApp.Logger.debug(`List item ${ItemId} deleted from shared List - ignored (reminders are source of truth)`);
      // drop the stale cache mapping since the row no longer exists.
      const SharedReminderId = this.#FindReminderIdInContext(ArgContext, ItemId);
      if(SharedReminderId) {
        ArgContext.ItemCache.delete(SharedReminderId);
        await this.#SaveCacheAsync();
      }
      return;
    }

    // only managed rows have a reminder mapping; an already-unmanaged row (e.g. a completed
    // history row a user later deletes) maps to nothing and triggers no reminder action.
    const ReminderId = this.#FindReminderIdInContext(ArgContext, ItemId);
    if(!ReminderId) {
      this.#SlackApp.Logger.debug(
        `User list ${ArgContext.ListId}: deleted row ${ItemId} maps to no managed reminder - ignored`
      );
      return;
    }

    this.#SlackApp.Logger.info(
      `User list ${ArgContext.ListId}: row for reminder ${ReminderId} deleted in Slack - cancelling reminder`
    );

    // drop the mapping first (in-memory) so the downstream removal fan-out does not try to
    // re-delete this already-gone row, then cancel the reminder, then persist the cache.
    ArgContext.ItemCache.delete(ReminderId);
    if(this.#RemindersModule) {
      await this.#RemindersModule.CancelReminderFromListAsync(ReminderId, 'list-row-deleted');
    }
    await this.#SaveCacheAsync();
  }

  /**
   * Find a reminder ID by its list row ID within a context.
   *
   * @param {ListContext} ArgContext List context to search.
   * @param {string} ArgListItemId List row ID.
   * @returns {string|null} Reminder ID if found, null otherwise.
   */
  #FindReminderIdInContext(ArgContext, ArgListItemId) {
    if(!ArgContext) {
      return null;
    }
    for(const [ReminderId, ListItemId] of ArgContext.ItemCache.entries()) {
      if(ListItemId === ArgListItemId) {
        return ReminderId;
      }
    }
    return null;
  }

  /**
   * Reconcile a managed row's summary back into Sleuth when the row carries a different task
   * title than the current reminder snapshot. This is used both for explicit update events and
   * for restart-time adoption of already-edited rows.
   * @param {ListContext} ArgContext List context the row belongs to.
   * @param {any} ArgItem Raw or transformed Slack Lists row.
   * @param {string} ArgReminderID Reminder ID linked to the row.
   * @param {string} ArgReason Reason tag for logging/persistence.
   * @returns {Promise<boolean>}
   */
  async #ReconcileReminderSummaryFromRowAsync(ArgContext, ArgItem, ArgReminderID, ArgReason) {
    if(!this.#RemindersModule || typeof this.#RemindersModule.UpdateReminderSummaryFromListAsync !== 'function') {
      return false;
    }

    const Reminder = this.#FindReminderById(ArgReminderID);
    if(!Reminder || typeof Reminder.ReminderMessageText !== 'string') {
      return false;
    }

    const CurrentSummary = SlackFormatUtils.ExtractKeyTasks(Reminder.ReminderMessageText).trim();
    const RowSummaryMrkdwn = this.#ExtractSummaryMrkdwnFromListItem(ArgContext, ArgItem, CurrentSummary).trim();
    if(!RowSummaryMrkdwn || RowSummaryMrkdwn === CurrentSummary) {
      return false;
    }

    this.#SlackApp.Logger.info(
      `User list ${ArgContext.ListId}: reminder ${ArgReminderID} summary differs from Sleuth during ${ArgReason}`
    );
    const Updated = await this.#RemindersModule.UpdateReminderSummaryFromListAsync(
      ArgReminderID,
      RowSummaryMrkdwn,
      ArgReason
    );
    if(Updated) {
      await this.SyncReminderSummaryAcrossListsAsync(ArgReminderID, RowSummaryMrkdwn, ArgContext);
      return true;
    }
    return false;
  }

  /**
   * Find one reminder by ID via the current RemindersModule snapshot.
   * @param {string} ArgReminderID Reminder ID to look up.
   * @returns {ReminderInfo|null}
   */
  #FindReminderById(ArgReminderID) {
    if(!this.#RemindersModule || typeof this.#RemindersModule.GetAllReminders !== 'function') {
      return null;
    }

    const Reminder = this.#RemindersModule.GetAllReminders().find(
      ArgCurrentReminder => ArgCurrentReminder.ReminderID === ArgReminderID
    );
    return Reminder || null;
  }

  /**
   * Extract one row's summary as Slack mrkdwn instead of flattened plain text.
   * This preserves mentions/links when a user edits the task title in Slack Lists and the
   * change needs to round-trip back into ReminderMessageText.
   * @param {ListContext} ArgContext List context used to flatten raw rows.
   * @param {any} ArgItem Raw or transformed Slack Lists row.
   * @param {string} [ArgFallbackSummary] Plain-text fallback when no rich_text payload exists.
   * @returns {string}
   */
  #ExtractSummaryMrkdwnFromListItem(ArgContext, ArgItem, ArgFallbackSummary = '') {
    if(!ArgItem || typeof ArgItem !== 'object') {
      return ArgFallbackSummary;
    }

    const Item = ArgItem.fields && Array.isArray(ArgItem.fields)
      ? this.#TransformListItem(ArgContext, ArgItem)
      : ArgItem;
    const SummaryField = /** @type {any} */ (Item).summary;

    if(typeof SummaryField === 'string' && SummaryField.trim().length > 0) {
      return SummaryField.trim();
    }

    if(Array.isArray(SummaryField) || (SummaryField && typeof SummaryField === 'object')) {
      const Mrkdwn = SlackFormatUtils.RichTextToMrkdwn(SummaryField).trim();
      if(Mrkdwn.length > 0) {
        return Mrkdwn;
      }
    }

    return ArgFallbackSummary;
  }

  /**
   * Populate the Slack List from reminders backup (Reminders are source of truth).
   * Called when creating a new list after the old one was deleted.
   * Uses a slow, throttled approach (15 seconds between items) to avoid rate limits.
   * This runs in the background and does NOT block other Slack operations.
   *
   * @returns {Promise<void>}
   */
  async #PopulateListFromRemindersAsync() {
    try {
      this.#SlackApp.Logger.info('Populating new list from reminders backup (Reminders are source of truth)');

      if(!this.#RemindersModule) {
        this.#SlackApp.Logger.warn('Cannot populate list: RemindersModule not set');
        return;
      }

      if(!this.#SharedContext) {
        this.#SlackApp.Logger.warn('Cannot populate list: shared list context not initialized');
        return;
      }

      // get all pending reminders from RemindersModule.
      const Reminders = this.#RemindersModule.GetAllReminders();
      this.#SlackApp.Logger.info(`Found ${Reminders.length} reminders to add to list`);

      if(Reminders.length === 0) {
        this.#SlackApp.Logger.info('No reminders to add to list');
        return;
      }

      // Filter out reminders that are already in the shared list cache
      const RemindersToAdd = Reminders.filter(r => !this.#SharedContext.ItemCache.has(r.ReminderID));
      this.#SlackApp.Logger.info(`${RemindersToAdd.length} reminders need to be added (${Reminders.length - RemindersToAdd.length} already in cache)`);

      if(RemindersToAdd.length === 0) {
        this.#SlackApp.Logger.info('All reminders already in list cache');
        return;
      }

      // Estimate time: 15 seconds per item
      const EstimatedMinutes = Math.ceil((RemindersToAdd.length * 15) / 60);
      this.#SlackApp.Logger.info(`Starting slow list population: ${RemindersToAdd.length} items @ 15s each = ~${EstimatedMinutes} minutes`);
      await this.#PostToSlackAsync(`📋 Starting list population: ${RemindersToAdd.length} reminders to add.\nUsing slow mode (15 seconds between items) to avoid rate limits.\nEstimated time: ~${EstimatedMinutes} minutes.\nNew reminders will still be added normally during this process.`);

      // Start background population - don't await, let it run independently
      this.#RunBackgroundPopulationAsync(RemindersToAdd).catch(error => {
        this.#SlackApp.Logger.error('Background population failed:', error);
      });

    } catch(error) {
      this.#SlackApp.Logger.error('Error starting list population:', error);
    }
  }

  /**
   * Run background population of list items with 15-second delays.
   * This method runs asynchronously and does not block other operations.
   *
   * @param {ReminderInfo[]} ArgReminders Reminders to add to the list.
   * @returns {Promise<void>}
   */
  async #RunBackgroundPopulationAsync(ArgReminders) {
    if(this.#IsPopulating) {
      this.#SlackApp.Logger.warn('Background population already in progress, skipping');
      return;
    }

    this.#IsPopulating = true;
    let AddedCount = 0;
    let FailedCount = 0;
    let SkippedCount = 0;

    try {
      for(let i = 0; i < ArgReminders.length; i++) {
        const Reminder = ArgReminders[i];

        // Check if this reminder was added while we were waiting (e.g., by normal operation)
        if(this.#SharedContext && this.#SharedContext.ItemCache.has(Reminder.ReminderID)) {
          this.#SlackApp.Logger.debug(`Reminder ${Reminder.ReminderID} already in list, skipping`);
          SkippedCount++;
          continue;
        }

        // Check if Lists is still available (might have been disabled)
        if(!this.#ListsAvailable || !this.#SharedContext || !this.#SharedContext.ListId) {
          this.#SlackApp.Logger.warn('Lists no longer available, stopping background population');
          break;
        }

        try {
          this.#SlackApp.Logger.info(`[Background] Adding reminder ${i + 1}/${ArgReminders.length}: ${Reminder.ReminderID}`);
          const Success = await this.AddReminderToListAsync(Reminder);
          if(Success) {
            AddedCount++;
          } else {
            FailedCount++;
          }
        } catch(error) {
          this.#SlackApp.Logger.warn(`[Background] Failed to add reminder ${Reminder.ReminderID}:`, error.message);
          FailedCount++;
        }

        // Wait 15 seconds before the next item (unless this is the last one)
        if(i < ArgReminders.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
      }

      this.#SlackApp.Logger.info(`[Background] List population complete: added ${AddedCount}, failed ${FailedCount}, skipped ${SkippedCount}`);
      await this.#PostToSlackAsync(`✅ List population complete!\n• Added: ${AddedCount}\n• Failed: ${FailedCount}\n• Skipped (already added): ${SkippedCount}`);

    } finally {
      this.#IsPopulating = false;
    }
  }

  /**
   * Create a custom Slack List populated with OCR-extracted items from an image.
   * Builds a list schema (Item Number, Item / Task, Amount / Fine, Notes, Status), creates the list
   * in Slack with channel read access, adds one row per extracted item, and returns the result.
   * Intended to be called from ChatModule after Gemini Vision OCR extracts structured items from an image.
   * @param {{ ListTitle: string, Items: Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }>, ChannelID: string, UserID: string, ThreadTS?: string|null }} ArgOptions
   *   `ThreadTS` threads the "new list created" announcement as a reply; omit it to post at the
   *   channel root (the pre-GH-83 behavior, still used by callers with no originating thread).
   * @returns {Promise<{ ok: boolean, ListId?: string, Permalink?: string|null, ItemCount?: number, error?: string, Announced?: boolean }>}
   *   `Announced` is true when this call already told the user about the list, so the caller can
   *   skip its own confirmation instead of duplicating it.
   */
  async CreateListFromExtractedItemsAsync(ArgOptions) {
    if(!this.#ListsAvailable || !this.#SlackClient) {
      return { ok: false, error: 'Slack Lists is not available in this workspace.' };
    }

    const { ListTitle, Items, ChannelID, UserID, ThreadTS } = ArgOptions || {};
    if(!ListTitle || typeof ListTitle !== 'string' || ListTitle.trim().length === 0) {
      return { ok: false, error: 'ListTitle is required.' };
    }
    if(!Array.isArray(Items)) {
      return { ok: false, error: 'Items must be an array.' };
    }
    if(typeof ChannelID !== 'string' || ChannelID.length === 0) {
      return { ok: false, error: 'ChannelID is required.' };
    }
    if(typeof UserID !== 'string' || UserID.length === 0) {
      return { ok: false, error: 'UserID is required.' };
    }

    try {
      // Step 1: create the list with the OCR-specific schema.
      const CreatedList = await this.#CreateListWithOcrSchemaAsync(ListTitle, {
        UserWriteAccessID: UserID,
        ChannelReadAccessID: ChannelID,
        PostAnnouncementChannelID: ChannelID,
        AnnouncementThreadTS: typeof ThreadTS === 'string' && ThreadTS.length > 0 ? ThreadTS : null,
      });

      if(!CreatedList.ListId) {
        return { ok: false, error: 'Failed to create list — no list ID returned.', Permalink: null, ItemCount: 0 };
      }

      // Wait for Slack Lists propagation so we don't hit internal_error on first row insert.
      this.#SlackApp.Logger.info(`Waiting ${ListsModule.LIST_PROPAGATION_DELAY_MS}ms for OCR list ${CreatedList.ListId} to propagate...`);
      await new Promise(resolve => setTimeout(resolve, ListsModule.LIST_PROPAGATION_DELAY_MS));

      // Step 2: populate rows.
      let AddedCount = 0;
      let FailedCount = 0;
      const Schema = CreatedList.ListSchema;

      for(const Item of Items) {
        const Success = await this.#CreateOcrListItemAsync(CreatedList.ListId, Schema, Item);
        if(Success) AddedCount++;
        else FailedCount++;
      }

      this.#SlackApp.Logger.info(
        `OCR list "${ListTitle}" created: ${AddedCount}/${Items.length} items added, ${FailedCount} failed.`
      );

      return {
        ok: true,
        ListId: CreatedList.ListId,
        Permalink: CreatedList.Permalink,
        ItemCount: AddedCount,
        // GH-83: the caller posts its own confirmation ONLY when this came back false, so success
        // is always announced exactly once — never twice, never silently.
        Announced: CreatedList.Announced === true,
      };
    } catch(error) {
      this.#SlackApp.Logger.error('Error creating OCR list:', error);
      return { ok: false, error: error.message || String(error), Permalink: null, ItemCount: 0, Announced: false };
    }
  }

  /**
   * Create a Slack List with the OCR-specific schema (Item Number, Item/Task, Amount/Fine, Notes, Status).
   * @param {string} ArgListName List title.
   * @param {{UserWriteAccessID?: string|null, ChannelReadAccessID?: string|null, PostAnnouncementChannelID?: string|null, AnnouncementThreadTS?: string|null}} [ArgAccessOptions]
   * @returns {Promise<{ ListId: string, ListSchema: Object<string, string>, Permalink: string|null, Announced: boolean }>}
   */
  async #CreateListWithOcrSchemaAsync(ArgListName, ArgAccessOptions = {}) {
    try {
      const ChannelReadAccessID = ArgAccessOptions.ChannelReadAccessID ?? null;
      const UserWriteAccessID = ArgAccessOptions.UserWriteAccessID ?? null;
      const PostAnnouncementChannelID = ArgAccessOptions.PostAnnouncementChannelID ?? null;
      // GH-83: null posts to the channel root. The image routes pass the originating thread so the
      // list lands as a reply to the upload instead of detaching into the channel.
      const AnnouncementThreadTS = ArgAccessOptions.AnnouncementThreadTS ?? null;
      let Announced = false;

      this.#SlackApp.Logger.info(`Calling lists.create API with OCR schema name: ${ArgListName}`);

      const CreateResponse = /** @type {any} */(await this.#SlackClient.apiCall('slackLists.create', {
        name: ArgListName,
        schema: this.#BuildOcrListSchemaDefinition(),
      }));

      const ListId = CreateResponse.list_id || CreateResponse.list?.id;
      if(!ListId) {
        this.#SlackApp.Logger.error('No list ID in OCR create response:', CreateResponse);
        throw new Error('No list ID in OCR create response.');
      }

      const ListSchema = this.#ExtractListSchemaFromMetadata(CreateResponse.list_metadata);
      const ListPermalink = await this.#BuildListPermalinkAsync(ListId, CreateResponse);
      const UserAccessGranted = UserWriteAccessID
        ? await this.#GrantListUserWriteAccessAsync(ListId, UserWriteAccessID)
        : true;
      const ChannelAccessGranted = ChannelReadAccessID
        ? await this.#GrantListChannelReadAccessAsync(ListId, ChannelReadAccessID)
        : true;

      if(PostAnnouncementChannelID && ChannelAccessGranted) {
        try {
          if(ListPermalink) {
            await this.#SlackApp.PostMessageTextAsync(
              PostAnnouncementChannelID,
              AnnouncementThreadTS,
              `📋 New OCR list created: <${ListPermalink}|${ArgListName}>\nItems extracted from uploaded image.`
            );
            Announced = true;
          } else {
            this.#SlackApp.Logger.warn(`Could not determine permalink for new OCR list ${ListId}`);
          }
        } catch(error) {
          this.#SlackApp.Logger.warn(`Could not post OCR list link to channel: ${error.message}`);
        }
      }

      if(!UserAccessGranted) {
        this.#SlackApp.Logger.warn(`Aborting OCR list setup — user write access denied.`);
        throw new Error('Slack rejected write access for the target user.');
      }
      if(!ChannelAccessGranted) {
        this.#SlackApp.Logger.warn(`Created OCR list ${ListId}, but channel ${ChannelReadAccessID || '-'} could not be granted read access.`);
      }

      return { ListId, ListSchema, Permalink: ListPermalink, Announced };
    } catch(error) {
      this.#SlackApp.Logger.error('Error creating OCR list:', error);
      throw error;
    }
  }

  /**
   * Build the OCR-list schema definition with five columns: Item Number, Item/Task, Amount/Fine, Notes, Status.
   * @returns {Array<any>}
   */
  #BuildOcrListSchemaDefinition() {
    return [
      { key: 'item_number', name: 'Item #', type: 'text', is_primary_column: false },
      { key: 'task', name: 'Item / Task', type: 'text', is_primary_column: true },
      { key: 'amount_fine', name: 'Amount / Fine', type: 'text', is_primary_column: false },
      { key: 'notes', name: 'Notes', type: 'text', is_primary_column: false },
      { key: 'status', name: 'Status', type: 'select', options: { choices: ListsModule.STATUS_CHOICES } },
    ];
  }

  /**
   * Add one OCR-extracted item row to a custom list using its column schema.
   * @param {string} ArgListId The Slack list ID.
   * @param {Object<string, string>} ArgListSchema Key → column_id map from Slack list metadata.
   * @param {{ item_number?: any, text: string, amount?: string|null, notes?: string|null }} ArgItem Extracted item data.
   * @returns {Promise<boolean>} True when the row was created successfully.
   */
  async #CreateOcrListItemAsync(ArgListId, ArgListSchema, ArgItem) {
    const InitialFields = [];

    if(ArgListSchema.item_number != null && ArgItem.item_number != null) {
      const Num = typeof ArgItem.item_number === 'number'
        ? String(ArgItem.item_number)
        : String(ArgItem.item_number).trim();
      InitialFields.push({
        column_id: ArgListSchema.item_number,
        rich_text: [SlackFormatUtils.MrkdwnToRichText(Num)],
      });
    }

    if(ArgListSchema.task != null) {
      const Text = typeof ArgItem.text === 'string' ? ArgItem.text.trim() : '';
      if(Text) {
        InitialFields.push({
          column_id: ArgListSchema.task,
          rich_text: [SlackFormatUtils.MrkdwnToRichText(Text)],
        });
      }
    }

    if(ArgListSchema.amount_fine != null && ArgItem.amount) {
      const Amt = typeof ArgItem.amount === 'string' ? ArgItem.amount.trim() : '';
      if(Amt) {
        InitialFields.push({
          column_id: ArgListSchema.amount_fine,
          rich_text: [SlackFormatUtils.MrkdwnToRichText(Amt)],
        });
      }
    }

    if(ArgListSchema.notes != null && ArgItem.notes) {
      const Nt = typeof ArgItem.notes === 'string' ? ArgItem.notes.trim() : '';
      if(Nt) {
        InitialFields.push({
          column_id: ArgListSchema.notes,
          rich_text: [SlackFormatUtils.MrkdwnToRichText(Nt)],
        });
      }
    }

    // Default to pending status.
    if(ArgListSchema.status != null) {
      InitialFields.push({
        column_id: ArgListSchema.status,
        select: ['pending'],
      });
    }

    if(InitialFields.length === 0) {
      this.#SlackApp.Logger.debug('Skipping empty OCR item with no fields to set.');
      return false;
    }

    try {
      const CreateResponse = /** @type {any} */(await this.#SlackClient.apiCall('slackLists.items.create', {
        list_id: ArgListId,
        initial_fields: InitialFields,
      }));

      this.#SlackApp.Logger.debug(
        `OCR item row created in list ${ArgListId}: ${JSON.stringify(CreateResponse).slice(0, 300)}`
      );
      return !!CreateResponse.item?.id || !!CreateResponse.record_id;
    } catch(error) {
      this.#SlackApp.Logger.error('Error adding OCR item row:', error.message || String(error));
      return false;
    }
  }
}

// export the class.
module.exports = ListsModule;

/**
 * Schema definition for OCR-extracted Slack Lists — used by #BuildOcrListSchemaDefinition.
 * @typedef {Array<{key: string, name: string, type: string, isPrimaryColumn?: boolean, options?: {choices: Array<{value: string, label: string, color: string}>}}>} OcrListSchemaDefinition
 */
