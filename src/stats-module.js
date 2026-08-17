
// import required modules.
const fs = require('fs').promises;
const { WriteFileDurableAsync } = require('./durable-write');
const path = require('path');
const workspaces = require('./workspaces');

/**
 * Statistics tracked for a workspace.
 * @typedef {Object} WorkspaceStats
 * @property {number} IncomingMessageCount Tracks number of messages sent to the app by Slack.
 * @property {number} IncomingMessageLength Tracks total number of characters for all incoming messages.
 * @property {number} OutgoingMessageCount Tracks number of messages sent by the app to Slack.
 * @property {number} OutgoingMessageLength Tracks total number of characters for all outgoing messages.
 * @property {number} OutgoingGptMessageCount Tracks number of outgoing messages sent to the OpenAI GPT.
 * @property {number} OutgoingGptMessageLength Tracks total number of characters for all outgoing GPT messages.
 * @property {number} IncomingGptMessageCount Tracks number of response messages received from the OpenAI GPT.
 * @property {number} IncomingGptMessageLength Tracks total number of characters for all incoming GPT responses.
 */

class StatsModule {
  /**
   * Slack app instance.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Path to the file where stats are stored on disk.
   * @type {string}
   */
  #StatsFilePath;

  /**
   * Timer ID for the stats auto-save interval.
   * @type {NodeJS.Timeout}
   */
  #StatsTimerID;

  /**
   * Interval in milliseconds at which to save stats to disk.
   * @type {number}
   */
  #StatsSaveInterval = 300000; // 5 minutes.

  /**
   * Indicates if stats data was successfully loaded from disk.
   * @type {boolean}
   */
  #DataLoaded = false;

  /**
   * Error message when stats fail to load.
   * @type {string|null}
   */
  #DataLoadError = null;

  /**
   * Statistics for the workspace.
   * @type {WorkspaceStats}
   */
  Stats = {
    IncomingMessageCount: 0,
    IncomingMessageLength: 0,
    OutgoingMessageCount: 0,
    OutgoingMessageLength: 0,

    OutgoingGptMessageCount: 0,
    OutgoingGptMessageLength: 0,
    IncomingGptMessageCount: 0,
    IncomingGptMessageLength: 0,
  };

  /**
   * Initialize a new instance of the StatsModule with the given Slack app.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   */
  constructor(ArgSlackApp) {
    // save the Slack app instance.
    this.#SlackApp = ArgSlackApp;

    // register app mention handler.
    this.#SlackApp.HandleAppMention(this.#OnAppMentionAsync.bind(this));
  }

  /**
   * Was stats data loaded successfully?
   * @returns {boolean}
   */
  get DataLoaded() { return this.#DataLoaded; }

  /**
   * If DataLoaded is false this holds a short description of why.
   * @returns {string|null}
   */
  get DataLoadError() { return this.#DataLoadError; }

  /**
   * Handle an app mention event from Slack.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Event information.
   * @returns {Promise<boolean>}
   */
  async #OnAppMentionAsync(ArgSlackApp, ArgEventInfo) {
    // check if message matches the show-stats command.
    const CommandText = `${ArgSlackApp.AppMentionString} show-stats`;
    if(ArgEventInfo.text !== CommandText) return false;

    // log the app_mention event.
    ArgSlackApp.Logger.info(`app_mention event handled by StatsModule:`, ArgEventInfo);

    // format stats into natural language text.
    const StatsText = this.#FormatStatsForDisplay();

    // post stats to channel.
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, StatsText);

    // indicate we handled the message.
    return true;
  }

  /**
   * Start the stats system.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    // compute the stats directory path and ensure it exists.
    const StatsDirPath = workspaces.GetSubdirPath('stats');
    await fs.mkdir(StatsDirPath, { recursive: true });

    // sanity check directory permissions by writing/deleting a temp file.
    try {
      const TestPath = path.join(StatsDirPath, `.tmp_${Date.now()}`);
      await fs.writeFile(TestPath, 'test');
      await fs.unlink(TestPath);
    } catch(error) {
      this.#SlackApp.Logger.warn('stats directory is not writable:', error);
    }

    // compute the file path for the stats file.
    const WorkspaceName = this.#SlackApp.WorkspaceInfo.WORKSPACE_NAME;
    this.#StatsFilePath = path.join(StatsDirPath, `${WorkspaceName}_stats.json`);

    // attempt to load existing stats from disk.
    try {
      this.#DataLoadError = null;
      this.#SlackApp.Logger.info('loading stats from file:', this.#StatsFilePath);
      const StatsData = await fs.readFile(this.#StatsFilePath, 'utf8');
      const Parsed = JSON.parse(StatsData);
      if(typeof Parsed === 'object' && Parsed && Object.keys(Parsed).length > 0) {
        this.Stats = { ...this.Stats, ...Parsed };
        this.#DataLoaded = true;
        this.#DataLoadError = null;
        this.#SlackApp.Logger.info('loaded stats from file:', this.Stats);
      } else {
        this.#SlackApp.Logger.warn('stats file is empty or invalid, using defaults.');
        this.#DataLoaded = false;
        this.#DataLoadError = 'empty or invalid data';
      }
    } catch(error) {
      if(error.code === 'ENOENT') {
        this.#SlackApp.Logger.warn('no stats file found, starting with default values.');
        this.#DataLoadError = 'file not found';
      } else {
        this.#SlackApp.Logger.warn('failed to read stats file:', error);
        this.#DataLoadError = error.message;
      }
      this.#DataLoaded = false;
    }

    // start the stats timer to periodically save stats to disk.
    this.#StatsTimerID = setTimeout(async function SaveStatsAsync() {
      // save stats to disk and log any errors.
      try {
        await this.#SaveAsync();
      } catch(error) {
        this.#SlackApp.Logger.error("error while saving stats:", error);
      }

      // schedule the next stats save.
      this.#StatsTimerID = setTimeout(SaveStatsAsync.bind(this), this.#StatsSaveInterval);
    }.bind(this), this.#StatsSaveInterval);
  }

  /**
   * Stop the stats system.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    // clear the stats timer and save stats to disk one last time.
    clearTimeout(this.#StatsTimerID);
    await this.#SaveAsync();
  }

  /**
   * Save the stats to disk asynchronously.
   * @returns {Promise<void>}
   */
  async #SaveAsync() {
    try {
      // convert the stats object to a JSON string.
      const StatsData = JSON.stringify(this.Stats, null, 2);

      // write the stats to disk.
      await WriteFileDurableAsync(this.#StatsFilePath, StatsData); // crash-atomic (GH-12)
    } catch(error) {
      this.#SlackApp.Logger.error("failed to save stats file:", error);
      throw error;
    }
  }

  /**
   * Format stats as natural language text for display in Slack.
   * @returns {string} 
   */
  #FormatStatsForDisplay() {
    return `Number of incoming messages: ${this.Stats.IncomingMessageCount}\n` +
           `Total length of incoming messages: ${this.#FormatKilobytes(this.Stats.IncomingMessageLength)} KB\n\n` +
           `Number of outgoing messages: ${this.Stats.OutgoingMessageCount}\n` +
           `Total length of outgoing messages: ${this.#FormatKilobytes(this.Stats.OutgoingMessageLength)} KB\n\n` +
           `Number of GPT messages sent: ${this.Stats.OutgoingGptMessageCount}\n` +
           `Total length of GPT messages: ${this.#FormatKilobytes(this.Stats.OutgoingGptMessageLength)} KB\n\n` +
           `Number of GPT responses received: ${this.Stats.IncomingGptMessageCount}\n` +
           `Total length of GPT responses: ${this.#FormatKilobytes(this.Stats.IncomingGptMessageLength)} KB`;
  }

  /**
   * Convert character count to kilobytes with 2 decimal places.
   * @param {number} ArgCharacterCount Number of characters to convert.
   * @returns {string}
   */
  #FormatKilobytes(ArgCharacterCount) {
    return (ArgCharacterCount / 1024).toFixed(2);
  }
}

// export the class.
module.exports = StatsModule;

