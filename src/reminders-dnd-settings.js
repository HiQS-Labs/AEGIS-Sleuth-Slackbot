'use strict';

const fs = require('fs').promises;
const { WriteFileDurableAsync } = require('./durable-write');

/**
 * Manages Do Not Disturb (DND) / Silent Mode settings for reminders.
 * Supports both a workspace-level toggle and individual channel-level toggles.
 * Persists state durably to a JSON file in data/runtime/reminders/.
 */
class RemindersDndSettings {
  /**
   * Path to the file storing DND settings.
   * @type {string}
   */
  #FilePath;

  /**
   * Whether DND is enabled for the entire workspace.
   * @type {boolean}
   */
  #WorkspaceDnd = false;

  /**
   * Set of channel IDs where DND is enabled.
   * @type {Set<string>}
   */
  #ChannelDnd = new Set();

  /**
   * Slack app instance for logging.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Tail of serialized save chain to prevent concurrent write collisions.
   * @type {Promise<void>}
   */
  #PendingSavePromise = Promise.resolve();

  /**
   * Initialize DND settings.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance for logging.
   * @param {string} ArgFilePath Path to the DND settings JSON file.
   */
  constructor(ArgSlackApp, ArgFilePath) {
    this.#SlackApp = ArgSlackApp;
    this.#FilePath = ArgFilePath;
  }

  /**
   * Load DND settings from disk.
   * @returns {Promise<void>}
   */
  async LoadAsync() {
    try {
      const FileText = await fs.readFile(this.#FilePath, 'utf8');
      if(!FileText.trim()) {
        this.#WorkspaceDnd = false;
        this.#ChannelDnd = new Set();
        return;
      }

      const Parsed = JSON.parse(FileText);
      if(Parsed && typeof Parsed === 'object' && !Array.isArray(Parsed)) {
        this.#WorkspaceDnd = Boolean(Parsed.workspace);
        this.#ChannelDnd = new Set(Array.isArray(Parsed.channels) ? Parsed.channels : []);
      } else {
        this.#WorkspaceDnd = false;
        this.#ChannelDnd = new Set();
      }

      this.#SlackApp.Logger.info(
        `loaded DND settings: workspace=${this.#WorkspaceDnd}, ${this.#ChannelDnd.size} channels`
      );
    } catch(error) {
      if(error.code === 'ENOENT') {
        this.#SlackApp.Logger.info('no DND settings file found, starting with DND disabled.');
        this.#WorkspaceDnd = false;
        this.#ChannelDnd = new Set();
      } else {
        this.#SlackApp.Logger.error('failed to read DND settings file:', error);
        throw error;
      }
    }
  }

  /**
   * Save DND settings to disk durably. Concurrent calls are serialized.
   * @returns {Promise<void>}
   */
  async SaveAsync() {
    const RunNextAsync = async () => {
      if(!this.#FilePath) return;
      const Data = {
        workspace: this.#WorkspaceDnd,
        channels: Array.from(this.#ChannelDnd)
      };
      await WriteFileDurableAsync(this.#FilePath, JSON.stringify(Data, null, 2));
    };

    const Next = this.#PendingSavePromise.then(RunNextAsync, RunNextAsync);
    this.#PendingSavePromise = Next;
    await Next;
  }

  /**
   * Check if DND is enabled for the entire workspace.
   * @returns {boolean}
   */
  IsWorkspaceDnd() {
    return this.#WorkspaceDnd;
  }

  /**
   * Check if DND is enabled for a specific channel.
   * @param {string} ArgChannelID Channel ID to check.
   * @returns {boolean}
   */
  IsChannelDnd(ArgChannelID) {
    if(!ArgChannelID) return false;
    return this.#ChannelDnd.has(ArgChannelID);
  }

  /**
   * Check if DND is active for a channel (either channel-level or workspace-level).
   * @param {string} ArgChannelID Channel ID to check.
   * @returns {boolean}
   */
  IsDndActiveForChannel(ArgChannelID) {
    return this.#WorkspaceDnd || this.IsChannelDnd(ArgChannelID);
  }

  /**
   * Check if any DND setting is active (workspace or any channel).
   * @returns {boolean}
   */
  HasAnyDndActive() {
    return this.#WorkspaceDnd || this.#ChannelDnd.size > 0;
  }

  /**
   * Return a list of channel IDs that have channel-level DND enabled.
   * @returns {string[]}
   */
  GetDndChannelIds() {
    return Array.from(this.#ChannelDnd);
  }

  /**
   * Set workspace-level DND.
   * @param {boolean} ArgEnabled Whether workspace DND should be enabled.
   * @returns {Promise<void>}
   */
  async SetWorkspaceDndAsync(ArgEnabled) {
    const NextState = Boolean(ArgEnabled);
    if(this.#WorkspaceDnd !== NextState) {
      this.#WorkspaceDnd = NextState;
      await this.SaveAsync();
      this.#SlackApp.Logger.info(`workspace DND set to ${NextState}`);
    }
  }

  /**
   * Set channel-level DND.
   * @param {string} ArgChannelID Channel ID to update.
   * @param {boolean} ArgEnabled Whether channel DND should be enabled.
   * @returns {Promise<void>}
   */
  async SetChannelDndAsync(ArgChannelID, ArgEnabled) {
    if(!ArgChannelID) return;
    const NextState = Boolean(ArgEnabled);
    const CurrentlyEnabled = this.#ChannelDnd.has(ArgChannelID);

    if(NextState && !CurrentlyEnabled) {
      this.#ChannelDnd.add(ArgChannelID);
      await this.SaveAsync();
      this.#SlackApp.Logger.info(`channel DND enabled for ${ArgChannelID}`);
    } else if(!NextState && CurrentlyEnabled) {
      this.#ChannelDnd.delete(ArgChannelID);
      await this.SaveAsync();
      this.#SlackApp.Logger.info(`channel DND disabled for ${ArgChannelID}`);
    }
  }
}

module.exports = RemindersDndSettings;
