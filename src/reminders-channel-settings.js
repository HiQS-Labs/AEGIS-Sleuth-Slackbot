'use strict';

const fs = require('fs').promises;
const { WriteFileDurableAsync } = require('./durable-write');

/**
 * Manages per-channel reminder enable/disable settings.
 * Owns the enabled channels JSON file and provides methods to query and update channel settings.
 */
class RemindersChannelSettings {
  /**
   * Path to the file tracking which channels have reminders enabled.
   * @type {string}
   */
  #EnabledChannelsFilePath;

  /**
   * Set of channel IDs where reminders are enabled.
   * @type {Set<string>}
   */
  #EnabledChannels = new Set();

  /**
   * Slack app instance for logging.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Whether the last load found no file at all (as opposed to an empty one). A deployed workspace
   * with reminders but no file has lost its channel list (GH-271); RemindersModule reports that.
   * @type {boolean}
   */
  #FileMissingAtLoad = false;

  /**
   * Initialize the channel settings manager.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance for logging.
   * @param {string} ArgFilePath Path to the enabled channels JSON file.
   */
  constructor(ArgSlackApp, ArgFilePath) {
    this.#SlackApp = ArgSlackApp;
    this.#EnabledChannelsFilePath = ArgFilePath;
  }

  /**
   * Load enabled channels from disk.
   * @returns {Promise<void>}
   */
  async LoadEnabledChannelsAsync() {
    this.#FileMissingAtLoad = false;
    try {
      // read and parse the enabled channels file.
      const EnabledChannelsJSON = await fs.readFile(this.#EnabledChannelsFilePath, 'utf8');

      // if the file is empty or just whitespace, start with an empty list.
      if (!EnabledChannelsJSON.trim()) {
        this.#SlackApp.Logger.info("enabled channels file is empty, starting with empty list.");
        this.#EnabledChannels = new Set();
        return;
      }

      this.#EnabledChannels = new Set(JSON.parse(EnabledChannelsJSON));
      this.#SlackApp.Logger.info("loaded", this.#EnabledChannels.size, "enabled channels from file.");
    } catch(error) {
      // if the file does not exist, log a message and start with an empty list, otherwise propagate the error.
      if(error.code === 'ENOENT') {
        // normal for a brand-new workspace, but it also turns auto-scheduling OFF in every channel,
        // so it must not read as routine (GH-271: a deleted file went unnoticed for 28 hours).
        this.#SlackApp.Logger.warn(
          `no enabled channels file at ${this.#EnabledChannelsFilePath}: auto-scheduling is OFF in every channel.`
        );
        this.#EnabledChannels = new Set(); // this means reminders are disabled everywhere by default.
        this.#FileMissingAtLoad = true;
      } else {
        this.#SlackApp.Logger.error("failed to read enabled channels file:", error);
        throw error;
      }
    }
  }

  /**
   * Whether the last load found no enabled-channels file at all.
   * @returns {boolean}
   */
  get FileMissingAtLoad() {
    return this.#FileMissingAtLoad;
  }

  /**
   * Save enabled channels to disk asynchronously.
   * @returns {Promise<void>}
   */
  async SaveEnabledChannelsAsync() {
    try {
      if(!this.#EnabledChannelsFilePath) {
        this.#SlackApp.Logger.warn("skipping enabled channels save because enabled channels file path is not initialized.");
        return;
      }

      // convert enabled channels to JSON string and save.
      const EnabledChannelsJSON = JSON.stringify(Array.from(this.#EnabledChannels), null, 2);
      await WriteFileDurableAsync(this.#EnabledChannelsFilePath, EnabledChannelsJSON); // crash-atomic (GH-12)
      this.#SlackApp.Logger.info("saved", this.#EnabledChannels.size, "enabled channels to file.");
    } catch(error) {
      // log and propagate the error if saving fails.
      this.#SlackApp.Logger.error("failed to save enabled channels file:", error);
      throw error;
    }
  }

  /**
   * Check if reminders are enabled for a channel.
   * @param {string} ArgChannelID Channel ID to check.
   * @returns {boolean}
   */
  AreRemindersEnabledForChannel(ArgChannelID) {
    return this.#EnabledChannels.has(ArgChannelID);
  }

  /**
   * Enable reminders for a channel.
   * @param {string} ArgChannelID Channel ID to enable.
   * @returns {Promise<void>}
   */
  async EnableRemindersForChannelAsync(ArgChannelID) {
    // enable reminders for the specified channel if they are not already enabled. NOTE: while using
    // a Set object would ignore duplicates, we still check for existence to avoid unnecessary disk
    // writes caused by the SaveEnabledChannelsAsync() method.
    if(!this.AreRemindersEnabledForChannel(ArgChannelID)) {
      this.#EnabledChannels.add(ArgChannelID);
      await this.SaveEnabledChannelsAsync();
    }
  }

  /**
   * Disable reminders for a channel.
   * @param {string} ArgChannelID Channel ID to disable.
   * @returns {Promise<void>}
   */
  async DisableRemindersForChannelAsync(ArgChannelID) {
    // disable reminders for the specified channel if they are currently enabled (helps avoid unnecessary
    // disk writes caused by the SaveEnabledChannelsAsync() method).
    if(this.AreRemindersEnabledForChannel(ArgChannelID)) {
      this.#EnabledChannels.delete(ArgChannelID);
      await this.SaveEnabledChannelsAsync();
    }
  }
}

module.exports = RemindersChannelSettings;

