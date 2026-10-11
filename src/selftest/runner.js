const fs = require('fs').promises;
const path = require('path');
const p = '../../scripts/slack-harness-file-upload';
const { FindUploadedShareMessage, ResolveUploadedMessageInfoAsync } = require(p);

/**
 * @typedef {import('../slack-app')} SlackApp
 * @typedef {import('../chat-module')} ChatModule
 */

/**
 * @param {SlackApp} SlackApp 
 * @param {string} ChannelId 
 * @param {ChatModule|null} ChatModuleInstance 
 * @param {string} TargetScenario 
 * @param {string} [InitiatingThreadTs]
 */
async function RunScenariosAsync(SlackApp, ChannelId, ChatModuleInstance, TargetScenario, InitiatingThreadTs) {
  const ScenariosDir = path.join(__dirname, 'scenarios');
  /** @type {string[]} */
  let Files = [];
  try {
    Files = await fs.readdir(ScenariosDir);
  } catch(error) {
    if(error.code !== 'ENOENT') {
      const Msg = `Failed to read scenarios: ${error.message}`;
      try {
        await SlackApp.PostMessageTextAsync(ChannelId, InitiatingThreadTs || null, Msg);
      } catch(postError) {
        SlackApp.Logger.error('selftest runner failed to post load-error report:', postError.message);
      }
      SlackApp.Logger.info(`[selftest] Report:\n[selftest] ${Msg}\n[selftest] exit_code=1`);
      return;
    }
  }

  const Scenarios = [];
  try {
    for(const File of Files) {
      if(File.endsWith('.js')) {
        const Scenario = require(path.join(ScenariosDir, File));
        Scenarios.push(Scenario);
      }
    }
  } catch (error) {
    const Msg = `Failed to load scenarios: ${error.message}`;
    try {
      await SlackApp.PostMessageTextAsync(ChannelId, InitiatingThreadTs || null, Msg);
    } catch(postError) {
      SlackApp.Logger.error('selftest runner failed to post load-error report:', postError.message);
    }
    SlackApp.Logger.info(`[selftest] Report:\n[selftest] ${Msg}\n[selftest] exit_code=1`);
    return;
  }

  const ToRun = TargetScenario === 'all' 
    ? Scenarios 
    : Scenarios.filter(s => s.Name === TargetScenario);

  if(ToRun.length === 0) {
    const Msg = `unknown scenario. available: ${Scenarios.map(s => s.Name).join(', ') || 'none'}`;
    try {
      await SlackApp.PostMessageTextAsync(ChannelId, InitiatingThreadTs || null, Msg);
    } catch(error) {
      SlackApp.Logger.error('selftest runner failed to post unknown-scenario report:', error.message);
    }
    SlackApp.Logger.info(`[selftest] Report:\n[selftest] ${Msg}\n[selftest] exit_code=1`);
    return;
  }

  let PassCount = 0, FailCount = 0, SkipCount = 0;
  const ReportLines = [];

  for(const Scenario of ToRun) {
    /** @type {{ Status: string, Name: string, Evidence: string, Permalink: string|null }} */
    let Result = { Status: '❌', Name: Scenario.Name, Evidence: 'Unknown error', Permalink: null };
    
    // Create scenario root
    let RootTs = null;
    try {
      RootTs = await SlackApp.PostMessageTextAsync(ChannelId, null, `selftest: running scenario ${Scenario.Name}`);
    } catch(error) {
      Result.Evidence = `Failed to create root message: ${error.message}`;
      ReportLines.push(`${Result.Status} ${Result.Name} — ${Result.Evidence}`);
      FailCount++;
      continue;
    }

    // Shadow methods
    const OriginalGetConversationMessages = SlackApp.GetConversationMessagesAsync;
    const OriginalGetFileContent = SlackApp.GetFileContentAsync;
    let DownloadCount = 0;
    let FetchedPagesCount = 0;
    /** @type {any[]} */
    let GetConversationMessagesCalls = [];
    const FixtureUrls = new Set();

    SlackApp.GetConversationMessagesAsync = async function(Channel, Ts, Options) {
      if(Channel === ChannelId && Ts === RootTs) {
        FetchedPagesCount++;
        GetConversationMessagesCalls.push(Options || {});
      }
      return await OriginalGetConversationMessages.call(SlackApp, Channel, Ts, Options);
    };

    SlackApp.GetFileContentAsync = async function(Url) {
      if (Url && FixtureUrls.has(Url)) {
        DownloadCount++;
      }
      return await OriginalGetFileContent.call(SlackApp, Url);
    };

    try {
      const Context = {
        SlackApp,
        Channel: ChannelId,
        ThreadTs: RootTs,
        /** 
         * @param {string} LocalPath 
         * @param {string} Comment 
         * @param {string} Name 
         */
        Upload: async (LocalPath, Comment, Name) => {
          const UploadResult = await SlackApp.UploadFileAsync(ChannelId, RootTs, LocalPath, Comment, Name);
          const MessageInfo = await ResolveUploadedMessageInfoAsync(
            SlackApp,
            ChannelId,
            RootTs,
            Comment,
            UploadResult
          );
          if (UploadResult && UploadResult.File) {
            if (UploadResult.File.url_private_download) FixtureUrls.add(UploadResult.File.url_private_download);
            if (UploadResult.File.url_private) FixtureUrls.add(UploadResult.File.url_private);
          }
          return Object.assign({}, UploadResult, MessageInfo);
        },
        /** @param {string} Text */
        Say: async (Text) => {
          return await SlackApp.PostMessageTextAsync(ChannelId, RootTs, Text);
        },
        /** @param {string} Text */
        Mention: async (Text) => {
          let PostedText = Text ? Text : 'selftest bare baseline';
          const QuestionTs = await SlackApp.PostMessageTextAsync(ChannelId, RootTs, PostedText);
          
          let SimulatedText = Text ? `${SlackApp.AppMentionString} ${Text}` : SlackApp.AppMentionString;
          
          const SimulatedEvent = {
            type: 'app_mention',
            user: 'U_SLEUTH_SELFTEST',
            ts: QuestionTs,
            channel: ChannelId,
            thread_ts: RootTs,
            text: SimulatedText,
            /** @type {any[]} */
            files: []
          };
          
          await SlackApp.SimulateAppMentionAsync(SimulatedEvent);
          return QuestionTs;
        },
        /** 
         * @param {boolean} Condition 
         * @param {string} Message 
         */
        Expect: (Condition, Message) => {
          if(!Condition) throw new Error(`Assertion failed: ${Message}`);
        },
        Fixture: {
          DownloadCount: () => DownloadCount,
          FetchedPagesCount: () => FetchedPagesCount,
          GetConversationMessagesCalls: () => GetConversationMessagesCalls,
          GetRepliesAsync: async () => {
            const result = await OriginalGetConversationMessages.call(SlackApp, ChannelId, RootTs);
            return result ? result : [];
          }
        },
        /** @param {string} Reason */
        Skip: (Reason) => {
          const e = new Error(Reason);
          e.name = 'SkipScenario';
          throw e;
        }
      };

      await Scenario.Run(Context);
      
      Result.Status = '✅';
      Result.Evidence = 'Passed';
      PassCount++;
    } catch(error) {
      if(error && error.name === 'SkipScenario') {
        Result.Status = '⏭';
        Result.Evidence = error.message;
        SkipCount++;
      } else {
        Result.Status = '❌';
        Result.Evidence = error ? error.message : 'Unknown error';
        FailCount++;
      }
    } finally {
      // Restore shadowed methods
      SlackApp.GetConversationMessagesAsync = OriginalGetConversationMessages;
      SlackApp.GetFileContentAsync = OriginalGetFileContent;
      
      try {
        Result.Permalink = await SlackApp.GetPermaLinkAsync(ChannelId, RootTs);
      } catch(e) { }

      try {
        // Cleanup memory
        if (ChatModuleInstance) {
          await ChatModuleInstance.ClearThreadMemoryAsync(ChannelId, RootTs);
        }
      } catch (cleanupError) {
        if (Result.Status === '✅' || Result.Status === '⏭') {
          if (Result.Status === '✅') PassCount--;
          if (Result.Status === '⏭') SkipCount--;
          Result.Status = '❌';
          FailCount++;
          Result.Evidence = `Cleanup failed: ${cleanupError.message}`;
        } else {
          Result.Evidence += ` (Cleanup failed: ${cleanupError.message})`;
        }
      }
    }

    let Line = `${Result.Status} ${Result.Name} — ${Result.Evidence}`;
    if (Result.Permalink) {
      Line += ` (<${Result.Permalink}|root>)`;
    }
    ReportLines.push(Line);
  }

  let ExitCode = FailCount > 0 ? 1 : 0;
  const Summary = `Total: ${ToRun.length}, ✅ ${PassCount}, ❌ ${FailCount}, ⏭ ${SkipCount}`;
  ReportLines.push(`*${Summary}*`);

  const FinalReport = ReportLines.join('\n');
  try {
    await SlackApp.PostMessageTextAsync(ChannelId, InitiatingThreadTs || null, FinalReport);
  } catch(error) {
    SlackApp.Logger.error('selftest runner failed to post report:', error.message);
    ReportLines.push(`Report delivery failed: ${error.message}`);
    ExitCode = 1;
  }
  
  const LogLines = ReportLines.map(line => `[selftest] ${line}`);
  LogLines.unshift(`[selftest] Report:`);
  LogLines.push(`[selftest] exit_code=${ExitCode}`);
  SlackApp.Logger.info(LogLines.join('\n'));
}

module.exports = {
  RunScenariosAsync
};
