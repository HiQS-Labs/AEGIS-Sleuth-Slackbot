const { BaseModule } = require('../base-module');
const Runner = require('./runner');

class SelftestModule extends BaseModule {
  #QAChannelId;
  #ChatModuleInstance = null;
  #IsRunning = false;

  constructor(ArgSlackApp, ArgQAChannelId) {
    super(ArgSlackApp);
    this.#QAChannelId = ArgQAChannelId;
    this.RegisterAppMention(this.#HandleAppMentionAsync.bind(this));
  }

  static Create(ArgSlackApp, ArgEnvChannel) {
    if(!ArgEnvChannel) return null;
    return new SelftestModule(ArgSlackApp, ArgEnvChannel);
  }

  SetChatModule(ArgChatModule) {
    this.#ChatModuleInstance = ArgChatModule;
  }

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
      await Runner.RunScenariosAsync(this.SlackApp, this.#QAChannelId, this.#ChatModuleInstance, ScenarioArg);
    } catch(error) {
      this.Logger.error('selftest runner failed:', error.message);
    } finally {
      this.#IsRunning = false;
    }

    return true;
  }
}

module.exports = SelftestModule;
