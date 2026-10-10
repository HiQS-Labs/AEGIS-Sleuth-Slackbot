const fs = require('fs').promises;
const path = require('path');
const { FindUploadedShareMessage, ResolveUploadedMessageInfoAsync } = require('../../scripts/slack-harness-file-upload');

async function RunScenariosAsync(SlackApp, ChannelId, ChatModuleInstance, TargetScenario) {
  const ScenariosDir = path.join(__dirname, 'scenarios');
  let Files = [];
  try {
    Files = await fs.readdir(ScenariosDir);
  } catch(error) {
    if(error.code !== 'ENOENT') throw error;
  }

  const Scenarios = [];
  for(const File of Files) {
    if(File.endsWith('.js')) {
      const Scenario = require(path.join(ScenariosDir, File));
      Scenarios.push(Scenario);
    }
  }

  const ToRun = TargetScenario === 'all' 
    ? Scenarios 
    : Scenarios.filter(s => s.Name === TargetScenario);

  if(ToRun.length === 0) {
    await SlackApp.PostMessageTextAsync(ChannelId, null, `unknown scenario. available: ${Scenarios.map(s => s.Name).join(', ') || 'none'}`);
    return;
  }

  let PassCount = 0, FailCount = 0, SkipCount = 0;
  const ReportLines = [];

  for(const Scenario of ToRun) {
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
    let SeenReplies = [];

    SlackApp.GetConversationMessagesAsync = async function(Channel, Ts, Options) {
      if(Channel === ChannelId && Ts === RootTs) {
        FetchedPagesCount++;
      }
      const Result = await OriginalGetConversationMessages.call(SlackApp, Channel, Ts, Options);
      if(Channel === ChannelId && Ts === RootTs && Result && Result.messages) {
        SeenReplies = SeenReplies.concat(Result.messages);
      }
      return Result;
    };

    SlackApp.GetFileContentAsync = async function(Url) {
      DownloadCount++;
      return await OriginalGetFileContent.call(SlackApp, Url);
    };

    try {
      const Context = {
        SlackApp,
        Channel: ChannelId,
        ThreadTs: RootTs,
        Upload: async (LocalPath, Comment, Name) => {
          const UploadResult = await SlackApp.UploadFileAsync(ChannelId, RootTs, LocalPath, Comment, Name);
          const MessageInfo = await ResolveUploadedMessageInfoAsync(
            SlackApp,
            ChannelId,
            RootTs,
            Comment,
            UploadResult
          );
          return Object.assign({}, UploadResult, MessageInfo);
        },
        Say: async (Text) => {
          return await SlackApp.PostMessageTextAsync(ChannelId, RootTs, Text);
        },
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
            files: []
          };
          
          await SlackApp.SimulateAppMentionAsync(SimulatedEvent);
          return QuestionTs;
        },
        Expect: (Condition, Message) => {
          if(!Condition) throw new Error(`Assertion failed: ${Message}`);
        },
        Fixture: {
          DownloadCount: () => DownloadCount,
          FetchedPagesCount: () => FetchedPagesCount,
          GetReplies: () => SeenReplies
        },
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
      if(error.name === 'SkipScenario') {
        Result.Status = '⏭';
        Result.Evidence = error.message;
        SkipCount++;
      } else {
        Result.Status = '❌';
        Result.Evidence = error.message;
        FailCount++;
      }
    } finally {
      // Restore shadowed methods
      SlackApp.GetConversationMessagesAsync = OriginalGetConversationMessages;
      SlackApp.GetFileContentAsync = OriginalGetFileContent;
      
      try {
        Result.Permalink = await SlackApp.GetPermaLinkAsync(ChannelId, RootTs);
      } catch(e) { }

      // Cleanup memory
      if (ChatModuleInstance) {
        await ChatModuleInstance.ClearThreadMemoryAsync(ChannelId, RootTs);
      }
    }

    let Line = `${Result.Status} ${Result.Name} — ${Result.Evidence}`;
    if (Result.Status === '❌' && Result.Permalink) {
      Line += ` (${Result.Permalink})`;
    }
    ReportLines.push(Line);
  }

  const ExitCode = FailCount > 0 ? 1 : 0;
  const Summary = `Total: ${ToRun.length}, ✅ ${PassCount}, ❌ ${FailCount}, ⏭ ${SkipCount}`;
  ReportLines.push(`*${Summary}*`);

  const FinalReport = ReportLines.join('\n');
  await SlackApp.PostMessageTextAsync(ChannelId, null, FinalReport);
  SlackApp.Logger.info(`[selftest] Report:\n${FinalReport}\nexit_code=${ExitCode}`);
}

module.exports = {
  RunScenariosAsync
};
