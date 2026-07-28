/**
 * Represents one synchronized Slack List and its local sync state.
 *
 * The shared workspace list and each durable per-user list are both ListContext
 * instances, so list-operation primitives can be written once and reused across
 * list kinds instead of branching on a hard-coded single list.
 */
class ListContext {
  /**
   * @param {{
   *   ListId?: string|null,
   *   Schema?: Object<string, string>|null,
   *   ItemCache?: Map<string, string>,
   *   LastSync?: Date|null,
   *   Kind?: 'shared'|'user',
   *   OwnerUserID?: string|null,
   *   AccessChannelID?: string|null,
   *   DisplayTitle?: string|null,
   *   DeleteRowOnComplete?: boolean
   * }} ArgFields
   */
  constructor(ArgFields = {}) {
    /** @type {string|null} Slack list ID. */
    this.ListId = ArgFields.ListId ?? null;

    /** @type {Object<string, string>|null} Field key -> Slack column ID. */
    this.Schema = ArgFields.Schema ?? null;

    /** @type {Map<string, string>} ReminderID -> Slack row ID. */
    this.ItemCache = ArgFields.ItemCache instanceof Map ? ArgFields.ItemCache : new Map();

    /**
     * Row ID -> raw row payload, used only for poll change detection.
     * Not persisted; rebuilt on the first poll after restart.
     * @type {Map<string, any>}
     */
    this.ListItemsCache = new Map();

    /** @type {Date|null} Timestamp of the last successful poll. */
    this.LastSync = ArgFields.LastSync ?? null;

    /** @type {'shared'|'user'} List kind — drives policy without string-branching at call sites. */
    this.Kind = ArgFields.Kind ?? 'shared';

    /** @type {string|null} Owner Slack user ID (per-user lists only). */
    this.OwnerUserID = ArgFields.OwnerUserID ?? null;

    /** @type {string|null} Channel granted read access to this list. */
    this.AccessChannelID = ArgFields.AccessChannelID ?? null;

    /** @type {string|null} Last-known display title (cosmetic; the registry key is the user ID). */
    this.DisplayTitle = ArgFields.DisplayTitle ?? null;

    /**
     * Whether completing a reminder deletes its row (shared list, preserves legacy behavior)
     * or keeps it as a history record (per-user list).
     * @type {boolean}
     */
    this.DeleteRowOnComplete = ArgFields.DeleteRowOnComplete ?? (this.Kind !== 'user');

    /**
     * Row IDs Sleuth just wrote; skipped on the next poll so the bot's own writes are
     * not mistaken for user edits. Not persisted.
     * @type {Set<string>}
     */
    this.EchoSuppressRowIds = new Set();
  }

  /**
   * Whether this context points at a live Slack list.
   * @returns {boolean}
   */
  get IsReady() {
    return typeof this.ListId === 'string' && this.ListId.length > 0 && !!this.Schema;
  }

  /**
   * Record an outbound write so the next poll does not treat it as an inbound user edit.
   * Updates the change-detection baseline in place as a belt-and-suspenders guard in case
   * the suppression set is lost (e.g. a crash between the write and the next poll).
   * @param {string} ArgRowId Slack row ID that was written.
   * @param {any} [ArgRowSnapshot] Optional fresh raw row to seed into the detection cache.
   */
  MarkRowEchoSuppressed(ArgRowId, ArgRowSnapshot = null) {
    if(typeof ArgRowId !== 'string' || ArgRowId.length === 0) {
      return;
    }
    this.EchoSuppressRowIds.add(ArgRowId);
    if(ArgRowSnapshot && typeof ArgRowSnapshot === 'object') {
      this.ListItemsCache.set(ArgRowId, ArgRowSnapshot);
    }
  }

  /**
   * Serialize the persistable fields of this context for the on-disk cache.
   * `ListItemsCache` and `EchoSuppressRowIds` are intentionally excluded.
   * @returns {object}
   */
  ToCacheEntry() {
    return {
      listId: this.ListId,
      listSchema: this.Schema,
      itemCache: Object.fromEntries(this.ItemCache),
      lastSync: this.LastSync ? this.LastSync.toISOString() : null,
      ownerUserID: this.OwnerUserID,
      accessChannelID: this.AccessChannelID,
      displayTitle: this.DisplayTitle
    };
  }

  /**
   * Rebuild a context from a persisted cache entry.
   * @param {{listId?: string|null, listSchema?: Object<string,string>|null, itemCache?: Object<string,string>|null, lastSync?: string|null, ownerUserID?: string|null, accessChannelID?: string|null, displayTitle?: string|null}} ArgEntry Persisted entry produced by {@link ListContext#ToCacheEntry}.
   * @param {'shared'|'user'} ArgKind List kind.
   * @returns {ListContext}
   */
  static FromCacheEntry(ArgEntry, ArgKind) {
    return new ListContext({
      ListId: ArgEntry.listId ?? null,
      Schema: ArgEntry.listSchema ?? null,
      ItemCache: ArgEntry.itemCache ? new Map(Object.entries(ArgEntry.itemCache)) : new Map(),
      LastSync: ArgEntry.lastSync ? new Date(ArgEntry.lastSync) : null,
      Kind: ArgKind,
      OwnerUserID: ArgEntry.ownerUserID ?? null,
      AccessChannelID: ArgEntry.accessChannelID ?? null,
      DisplayTitle: ArgEntry.displayTitle ?? null
    });
  }
}

module.exports = ListContext;
