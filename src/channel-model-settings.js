'use strict';

const fs = require('fs').promises;
const { WriteFileDurableAsync } = require('./durable-write');

/**
 * Manages per-channel OpenAI model overrides for chat replies.
 * Owns one JSON file per workspace mapping channel IDs to model names.
 * Channels with no entry fall back to the workspace default model.
 */
class ChannelModelSettings {
  /**
   * Path to the file storing channel model overrides.
   * @type {string}
   */
  #FilePath;

  /**
   * Map of channel ID to override model name.
   * @type {Map<string, string>}
   */
  #ModelsByChannel = new Map();

  /**
   * Slack app instance for logging.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Tail of the serialized save chain. Concurrent SaveAsync calls queue onto this promise so disk
   * writes complete in FIFO order and a slow earlier write cannot overwrite a newer one.
   * @type {Promise<void>}
   */
  #PendingSavePromise = Promise.resolve();

  /**
   * Initialize the channel model settings manager.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance for logging.
   * @param {string} ArgFilePath Path to the channel models JSON file.
   */
  constructor(ArgSlackApp, ArgFilePath) {
    this.#SlackApp = ArgSlackApp;
    this.#FilePath = ArgFilePath;
  }

  /**
   * Load channel model overrides from disk.
   * @returns {Promise<void>}
   */
  async LoadAsync() {
    try {
      // read and parse the channel models file.
      const FileText = await fs.readFile(this.#FilePath, 'utf8');

      // if the file is empty or just whitespace, start with an empty map.
      if(!FileText.trim()) {
        this.#SlackApp.Logger.info("channel models file is empty, starting with no overrides.");
        this.#ModelsByChannel = new Map();
        return;
      }

      const Parsed = JSON.parse(FileText);
      if(Parsed && typeof Parsed === 'object' && !Array.isArray(Parsed)) {
        this.#ModelsByChannel = new Map(Object.entries(Parsed));
      } else {
        this.#SlackApp.Logger.warn("channel models file is not a JSON object, starting with no overrides.");
        this.#ModelsByChannel = new Map();
      }

      this.#SlackApp.Logger.info("loaded", this.#ModelsByChannel.size, "channel model overrides from file.");
    } catch(error) {
      // if the file does not exist, log a message and start empty, otherwise propagate the error.
      if(error.code === 'ENOENT') {
        this.#SlackApp.Logger.info("no channel models file found, starting with no overrides.");
        this.#ModelsByChannel = new Map();
      } else {
        this.#SlackApp.Logger.error("failed to read channel models file:", error);
        throw error;
      }
    }
  }

  /**
   * Save channel model overrides to disk. Concurrent calls are serialized through a single chained
   * promise so writes complete in the order they were requested, preventing a slow earlier write
   * from overwriting a newer in-memory state.
   * @returns {Promise<void>}
   */
  async SaveAsync() {
    // chain this save onto the pending tail. running the next write on both fulfilled and rejected
    // upstream outcomes prevents one failed write from poisoning every subsequent save attempt;
    // the per-call await below still surfaces this call's own error to its caller.
    /** @returns {Promise<void>} */
    const RunNextAsync = () => this.#WriteCurrentStateAsync();
    const Next = this.#PendingSavePromise.then(RunNextAsync, RunNextAsync);
    this.#PendingSavePromise = Next;
    await Next;
  }

  /**
   * Snapshot the current in-memory state and write it to disk. Always serializes the latest map
   * contents at write-time so a queued write reflects any subsequent in-memory mutations.
   * @returns {Promise<void>}
   */
  async #WriteCurrentStateAsync() {
    try {
      if(!this.#FilePath) {
        this.#SlackApp.Logger.warn("skipping channel models save because file path is not initialized.");
        return;
      }

      // convert the Map to a plain object and write JSON.
      const PlainObject = Object.fromEntries(this.#ModelsByChannel);
      const FileText = JSON.stringify(PlainObject, null, 2);
      await WriteFileDurableAsync(this.#FilePath, FileText); // crash-atomic (GH-12)
      this.#SlackApp.Logger.info("saved", this.#ModelsByChannel.size, "channel model overrides to file.");
    } catch(error) {
      // log and propagate the error if saving fails.
      this.#SlackApp.Logger.error("failed to save channel models file:", error);
      throw error;
    }
  }

  /**
   * Get the model override for a channel, or null if no override is set.
   * @param {string} ArgChannelID Channel ID to look up.
   * @returns {string|null}
   */
  GetModelForChannel(ArgChannelID) {
    return this.#ModelsByChannel.get(ArgChannelID) || null;
  }

  /**
   * Set a model override for a channel and persist if the value changed.
   * @param {string} ArgChannelID Channel ID to update.
   * @param {string} ArgModelName Model name to use for that channel.
   * @returns {Promise<void>}
   */
  async SetModelForChannelAsync(ArgChannelID, ArgModelName) {
    // skip the disk write when the requested override matches the current one.
    if(this.#ModelsByChannel.get(ArgChannelID) === ArgModelName) return;
    this.#ModelsByChannel.set(ArgChannelID, ArgModelName);
    await this.SaveAsync();
  }

  /**
   * Clear the model override for a channel and persist if an entry existed.
   * @param {string} ArgChannelID Channel ID to clear.
   * @returns {Promise<void>}
   */
  async ClearModelForChannelAsync(ArgChannelID) {
    // skip the disk write when there is nothing to clear.
    if(!this.#ModelsByChannel.has(ArgChannelID)) return;
    this.#ModelsByChannel.delete(ArgChannelID);
    await this.SaveAsync();
  }

  /**
   * Snapshot of all current channel model overrides as a plain object.
   * @returns {Object<string, string>}
   */
  ListAll() {
    return Object.fromEntries(this.#ModelsByChannel);
  }
}

module.exports = ChannelModelSettings;
