const { BaseModule } = require('../base-module');
const Runner = require('./runner');

/**
 * @typedef {import('../slack-app')} SlackApp
 * @typedef {import('../chat-module')} ChatModule
 */

class SelftestModule extends BaseModule {
  /** @type {string} */
  #QAChannelId;
  /** @type {ChatModule|null} */
  #ChatModuleInstance = null;
  /** @type {boolean} */
  #IsRunning = false;

  /**
   * @param {SlackApp} ArgSlackApp
   * @param {string} ArgQAChannelId
   */
  constructor(ArgSlackApp, ArgQAChannelId) {
    super(ArgSlackApp);
    this.#QAChannelId = ArgQAChannelId;
    this.RegisterAppMention(this.#HandleAppMentionAsync.bind(this));
  }

  /**
   * @param {SlackApp} ArgSlackApp
   * @param {string} [ArgEnvChannel]
   * @returns {SelftestModule|null}
   */
  static Create(ArgSlackApp, ArgEnvChannel) {
    if(!ArgEnvChannel) return null;
    return new SelftestModule(ArgSlackApp, ArgEnvChannel);
  }

  /**
   * @param {ChatModule} ArgChatModule 
   */
  SetChatModule(ArgChatModule) {
    this.#ChatModuleInstance = ArgChatModule;
  }

  /**
   * @param {SlackApp} ArgSlackApp 
   * @param {any} ArgEventInfo 
   */
  async #HandleAppMentionAsync(ArgSlackApp, ArgEventInfo) {
    const Text = ArgEventInfo.text || '';
    const NormalizedText = Text.replace(this.SlackApp.AppMentionString, '').trim();

    const Match = NormalizedText.match(/^selftest\s+(\S+)/);
    if(!Match) {
      return false; // not a selftest command
    }

    if(ArgEventInfo.channel !== this.#QAChannelId) {
      try {
        await this.SlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ArgEventInfo.thread_ts || ArgEventInfo.ts,
          'selftest is dev-only'
        );
      } catch(error) {
        this.Logger.error('failed to post dev-only refusal:', error.message);
      }
      return true;
    }

    if(this.#IsRunning) {
      return true; // silently ignore re-entrant execution
    }

    this.#IsRunning = true;
    const ScenarioArg = Match[1];

    try {
      await Runner.RunScenariosAsync(this.SlackApp, this.#QAChannelId, this.#ChatModuleInstance, ScenarioArg, ArgEventInfo.thread_ts || ArgEventInfo.ts);
    } catch(error) {
      this.Logger.error('selftest runner failed:', error.message);
    } finally {
      this.#IsRunning = false;
    }

    return true;
  }
}

module.exports = SelftestModule;
