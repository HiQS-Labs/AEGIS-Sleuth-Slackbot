#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { App } = require('@slack/bolt');
const workspaces = require('../src/workspaces');
const { ExtractGitHubUrls } = require('../src/github-url-utils');

/**
 * Build reminder file path for a workspace.
 * @param {string} ArgWorkspaceName Workspace name.
 * @returns {string}
 */
function BuildReminderFilePath(ArgWorkspaceName) {
  return path.resolve(
    path.join(__dirname, '..', 'data', 'runtime', 'reminders', `${ArgWorkspaceName}_reminders.json`)
  );
}

/**
 * Parse CLI arguments.
 * @param {string[]} ArgArgv Raw argv slice.
 * @returns {{ WorkspaceNames: string[], WriteChanges: boolean, RefreshExisting: boolean, HelpRequested: boolean }}
 */
function ParseArgs(ArgArgv) {
  const WorkspaceNames = [];
  let WriteChanges = false;
  let RefreshExisting = false;
  let HelpRequested = false;

  for(let i = 0; i < ArgArgv.length; i++) {
    const CurrentArg = ArgArgv[i];

    if(CurrentArg === '--workspace') {
      const WorkspaceName = ArgArgv[i + 1];
      if(!WorkspaceName)
        throw new Error('Missing workspace name after --workspace.');

      WorkspaceNames.push(WorkspaceName);
      i++;
      continue;
    }

    if(CurrentArg === '--write') {
      WriteChanges = true;
      continue;
    }

    if(CurrentArg === '--refresh-existing') {
      RefreshExisting = true;
      continue;
    }

    if(CurrentArg === '--help' || CurrentArg === '-h') {
      HelpRequested = true;
      continue;
    }

    throw new Error(`Unknown argument: ${CurrentArg}`);
  }

  return {
    WorkspaceNames,
    WriteChanges,
    RefreshExisting,
    HelpRequested,
  };
}

/**
 * Print CLI usage.
 */
function PrintUsage() {
  console.log('Usage: node scripts/reconstruct-github-reminders.js [--workspace NAME] [--refresh-existing] [--write]');
  console.log('');
  console.log('Options:');
  console.log('  --workspace NAME      limit reconstruction to one workspace. repeat to target multiple workspaces.');
  console.log('  --refresh-existing    re-check reminders that already have GitHubUrls instead of only empty/missing ones.');
  console.log('  --write               persist reconstructed GitHubUrls to reminder JSON files. default is dry-run.');
  console.log('  --help, -h            show this help text.');
}

/**
 * Create a Slack Web API client wrapper for a workspace.
 * @param {import('../src/workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace config.
 * @returns {import('@slack/bolt').App}
 */
function CreateSlackClientApp(ArgWorkspaceInfo) {
  return new App({
    token: ArgWorkspaceInfo.LIVE_TOKEN,
    appToken: ArgWorkspaceInfo.LIVE_APP_TOKEN,
    signingSecret: ArgWorkspaceInfo.LIVE_SIGNING_SECRET,
    socketMode: true,
  });
}

/**
 * Normalize a GitHub URL list.
 * @param {unknown} ArgGitHubUrls Candidate URL list.
 * @returns {string[]}
 */
function NormalizeGitHubUrls(ArgGitHubUrls) {
  if(!Array.isArray(ArgGitHubUrls))
    return [];

  return [...new Set(
    ArgGitHubUrls.filter((ArgUrl) => typeof ArgUrl === 'string' && ArgUrl.length > 0)
  )];
}

/**
 * Compare two GitHub URL lists for equality after normalization.
 * @param {unknown} ArgFirst First list.
 * @param {unknown} ArgSecond Second list.
 * @returns {boolean}
 */
function AreGitHubUrlListsEqual(ArgFirst, ArgSecond) {
  const First = NormalizeGitHubUrls(ArgFirst);
  const Second = NormalizeGitHubUrls(ArgSecond);
  return JSON.stringify(First) === JSON.stringify(Second);
}

/**
 * Decide whether a reminder should be reconstructed.
 * @param {{ GitHubUrls?: string[]|null }} ArgReminder Reminder info.
 * @param {boolean} ArgRefreshExisting Whether to refresh reminders that already have URLs.
 * @returns {boolean}
 */
function ShouldReconstructReminder(ArgReminder, ArgRefreshExisting) {
  if(ArgRefreshExisting)
    return true;

  return !Array.isArray(ArgReminder.GitHubUrls) || ArgReminder.GitHubUrls.length === 0;
}

/**
 * Read reminder array from disk.
 * @param {string} ArgReminderFilePath Reminder file path.
 * @returns {Promise<object[]>}
 */
async function LoadRemindersAsync(ArgReminderFilePath) {
  const FileContents = await fs.readFile(ArgReminderFilePath, 'utf8');
  const Parsed = JSON.parse(FileContents);
  if(!Array.isArray(Parsed))
    throw new Error('Reminder file did not contain an array.');

  return Parsed;
}

/**
 * Save reminder array to disk.
 * @param {string} ArgReminderFilePath Reminder file path.
 * @param {object[]} ArgReminders Reminders to save.
 * @returns {Promise<void>}
 */
async function SaveRemindersAsync(ArgReminderFilePath, ArgReminders) {
  await fs.writeFile(ArgReminderFilePath, JSON.stringify(ArgReminders, null, 2), 'utf8');
}

/**
 * Attempt to fetch original Slack message text for a reminder.
 * @param {import('@slack/web-api').WebClient} ArgSlackClient Slack web client.
 * @param {{ OriginalChannelID?: string, OriginalMessageID?: string }} ArgReminder Reminder info.
 * @returns {Promise<{ text: string|null, source: 'history'|'replies'|'unavailable', error: string|null }>}
 */
async function FetchOriginalSlackMessageTextAsync(ArgSlackClient, ArgReminder) {
  const OriginalChannelID = ArgReminder.OriginalChannelID;
  const OriginalMessageID = ArgReminder.OriginalMessageID;

  if(!OriginalChannelID || !OriginalMessageID) {
    return {
      text: null,
      source: 'unavailable',
      error: 'missing OriginalChannelID or OriginalMessageID',
    };
  }

  try {
    const HistoryResponse = await ArgSlackClient.conversations.history({
      channel: OriginalChannelID,
      oldest: OriginalMessageID,
      latest: OriginalMessageID,
      inclusive: true,
      limit: 1,
    });

    if(HistoryResponse.ok && HistoryResponse.messages?.length) {
      const ExactHistoryMessage = HistoryResponse.messages.find((ArgMessage) => ArgMessage.ts === OriginalMessageID);
      if(ExactHistoryMessage && typeof ExactHistoryMessage.text === 'string') {
        return {
          text: ExactHistoryMessage.text,
          source: 'history',
          error: null,
        };
      }
    }

    const RepliesResponse = await ArgSlackClient.conversations.replies({
      channel: OriginalChannelID,
      ts: OriginalMessageID,
      inclusive: true,
      limit: 1,
    });

    if(RepliesResponse.ok && RepliesResponse.messages?.length) {
      const ExactReplyMessage = RepliesResponse.messages.find((ArgMessage) => ArgMessage.ts === OriginalMessageID);
      if(ExactReplyMessage && typeof ExactReplyMessage.text === 'string') {
        return {
          text: ExactReplyMessage.text,
          source: 'replies',
          error: null,
        };
      }
    }

    return {
      text: null,
      source: 'unavailable',
      error: 'message not returned by Slack history or replies lookup',
    };
  } catch(error) {
    return {
      text: null,
      source: 'unavailable',
      error: error.message,
    };
  }
}

/**
 * Choose the best GitHub URL list for a reminder.
 * Prefers original Slack message text, then falls back to persisted reminder text,
 * then preserves any existing URLs if both extraction paths are empty.
 *
 * @param {{ GitHubUrls?: string[]|null, ReminderMessageText?: string|null }} ArgReminder Reminder info.
 * @param {string|null} ArgOriginalSlackMessageText Message text fetched from Slack.
 * @returns {{ FinalGitHubUrls: string[], RecoverySource: 'slack-message'|'reminder-text'|'existing'|'none', SlackMessageGitHubUrls: string[], ReminderTextGitHubUrls: string[] }}
 */
function BuildReconstructedGitHubUrls(ArgReminder, ArgOriginalSlackMessageText) {
  const ExistingGitHubUrls = NormalizeGitHubUrls(ArgReminder.GitHubUrls);
  const SlackMessageGitHubUrls = ExtractGitHubUrls(ArgOriginalSlackMessageText);
  const ReminderTextGitHubUrls = ExtractGitHubUrls(ArgReminder.ReminderMessageText || '');

  if(SlackMessageGitHubUrls.length > 0) {
    return {
      FinalGitHubUrls: SlackMessageGitHubUrls,
      RecoverySource: 'slack-message',
      SlackMessageGitHubUrls,
      ReminderTextGitHubUrls,
    };
  }

  if(ReminderTextGitHubUrls.length > 0) {
    return {
      FinalGitHubUrls: ReminderTextGitHubUrls,
      RecoverySource: 'reminder-text',
      SlackMessageGitHubUrls,
      ReminderTextGitHubUrls,
    };
  }

  if(ExistingGitHubUrls.length > 0) {
    return {
      FinalGitHubUrls: ExistingGitHubUrls,
      RecoverySource: 'existing',
      SlackMessageGitHubUrls,
      ReminderTextGitHubUrls,
    };
  }

  return {
    FinalGitHubUrls: [],
    RecoverySource: 'none',
    SlackMessageGitHubUrls,
    ReminderTextGitHubUrls,
  };
}

/**
 * Process one workspace reminder file.
 * @param {import('../src/workspaces').WorkspaceInfo} ArgWorkspaceInfo Workspace config.
 * @param {{ WriteChanges: boolean, RefreshExisting: boolean }} ArgOptions Options.
 * @returns {Promise<{ WorkspaceName: string, ReminderCount: number, ExaminedCount: number, UpdatedCount: number, SlackRecoveredCount: number, ReminderTextRecoveredCount: number, ExistingPreservedCount: number, EmptyCount: number, ErrorCount: number, WroteChanges: boolean, ReminderFilePath: string }>}
 */
async function ProcessWorkspaceAsync(ArgWorkspaceInfo, ArgOptions) {
  const WorkspaceName = ArgWorkspaceInfo.WORKSPACE_NAME;
  const ReminderFilePath = BuildReminderFilePath(WorkspaceName);

  try {
    await fs.access(ReminderFilePath);
  } catch {
    return {
      WorkspaceName,
      ReminderCount: 0,
      ExaminedCount: 0,
      UpdatedCount: 0,
      SlackRecoveredCount: 0,
      ReminderTextRecoveredCount: 0,
      ExistingPreservedCount: 0,
      EmptyCount: 0,
      ErrorCount: 0,
      WroteChanges: false,
      ReminderFilePath,
    };
  }

  const Reminders = await LoadRemindersAsync(ReminderFilePath);
  const SlackClientApp = CreateSlackClientApp(ArgWorkspaceInfo);
  const SlackClient = SlackClientApp.client;
  let ExaminedCount = 0;
  let UpdatedCount = 0;
  let SlackRecoveredCount = 0;
  let ReminderTextRecoveredCount = 0;
  let ExistingPreservedCount = 0;
  let EmptyCount = 0;
  let ErrorCount = 0;

  for(const CurrentReminder of Reminders) {
    if(!ShouldReconstructReminder(CurrentReminder, ArgOptions.RefreshExisting))
      continue;

    ExaminedCount++;
    const SlackMessageLookup = await FetchOriginalSlackMessageTextAsync(SlackClient, CurrentReminder);
    if(SlackMessageLookup.error)
      ErrorCount++;

    const Reconstruction = BuildReconstructedGitHubUrls(CurrentReminder, SlackMessageLookup.text);
    const ExistingGitHubUrls = NormalizeGitHubUrls(CurrentReminder.GitHubUrls);

    if(Reconstruction.RecoverySource === 'slack-message') SlackRecoveredCount++;
    if(Reconstruction.RecoverySource === 'reminder-text') ReminderTextRecoveredCount++;
    if(Reconstruction.RecoverySource === 'existing') ExistingPreservedCount++;
    if(Reconstruction.RecoverySource === 'none') EmptyCount++;

    if(!AreGitHubUrlListsEqual(ExistingGitHubUrls, Reconstruction.FinalGitHubUrls)) {
      CurrentReminder.GitHubUrls = Reconstruction.FinalGitHubUrls;
      UpdatedCount++;
    } else if(!Array.isArray(CurrentReminder.GitHubUrls)) {
      CurrentReminder.GitHubUrls = Reconstruction.FinalGitHubUrls;
      UpdatedCount++;
    }
  }

  if(ArgOptions.WriteChanges && UpdatedCount > 0)
    await SaveRemindersAsync(ReminderFilePath, Reminders);

  return {
    WorkspaceName,
    ReminderCount: Reminders.length,
    ExaminedCount,
    UpdatedCount,
    SlackRecoveredCount,
    ReminderTextRecoveredCount,
    ExistingPreservedCount,
    EmptyCount,
    ErrorCount,
    WroteChanges: ArgOptions.WriteChanges && UpdatedCount > 0,
    ReminderFilePath,
  };
}

/**
 * Resolve workspace names for a run.
 * @param {string[]} ArgRequestedWorkspaceNames Requested names.
 * @returns {Promise<string[]>}
 */
async function ResolveWorkspaceNamesAsync(ArgRequestedWorkspaceNames) {
  if(ArgRequestedWorkspaceNames.length > 0)
    return ArgRequestedWorkspaceNames;

  return await workspaces.EnumerateWorkspaceNamesAsync();
}

/**
 * Run the reconstruction CLI.
 * @returns {Promise<void>}
 */
async function RunAsync() {
  const Options = ParseArgs(process.argv.slice(2));
  if(Options.HelpRequested) {
    PrintUsage();
    return;
  }

  const WorkspaceNames = await ResolveWorkspaceNamesAsync(Options.WorkspaceNames);
  if(WorkspaceNames.length === 0) {
    console.log('No workspaces found.');
    return;
  }

  console.log(Options.WriteChanges
    ? 'GitHub reminder reconstruction running in write mode.'
    : 'GitHub reminder reconstruction running in dry-run mode. Pass --write to persist changes.');

  const Results = [];
  for(const CurrentWorkspaceName of WorkspaceNames) {
    const WorkspaceInfo = await workspaces.LoadWorkspaceInfoByNameAsync(CurrentWorkspaceName);
    const Result = await ProcessWorkspaceAsync(WorkspaceInfo, Options);
    Results.push(Result);

    console.log('');
    console.log(`[${Result.WorkspaceName}] ${Result.ReminderCount} reminders loaded from ${Result.ReminderFilePath}`);
    console.log(`  examined: ${Result.ExaminedCount}`);
    console.log(`  updated: ${Result.UpdatedCount}${Result.WroteChanges ? ' (written)' : ''}`);
    console.log(`  recovered from Slack message: ${Result.SlackRecoveredCount}`);
    console.log(`  recovered from reminder text fallback: ${Result.ReminderTextRecoveredCount}`);
    console.log(`  preserved existing URLs: ${Result.ExistingPreservedCount}`);
    console.log(`  remained empty: ${Result.EmptyCount}`);
    console.log(`  lookup errors: ${Result.ErrorCount}`);
  }

  const TotalExamined = Results.reduce((ArgTotal, ArgResult) => ArgTotal + ArgResult.ExaminedCount, 0);
  const TotalUpdated = Results.reduce((ArgTotal, ArgResult) => ArgTotal + ArgResult.UpdatedCount, 0);
  const TotalSlackRecovered = Results.reduce((ArgTotal, ArgResult) => ArgTotal + ArgResult.SlackRecoveredCount, 0);
  const TotalReminderTextRecovered = Results.reduce((ArgTotal, ArgResult) => ArgTotal + ArgResult.ReminderTextRecoveredCount, 0);
  const TotalErrors = Results.reduce((ArgTotal, ArgResult) => ArgTotal + ArgResult.ErrorCount, 0);

  console.log('');
  console.log('Summary');
  console.log(`  examined: ${TotalExamined}`);
  console.log(`  updated: ${TotalUpdated}`);
  console.log(`  recovered from Slack message: ${TotalSlackRecovered}`);
  console.log(`  recovered from reminder text fallback: ${TotalReminderTextRecovered}`);
  console.log(`  lookup errors: ${TotalErrors}`);
}

if(require.main === module) {
  RunAsync().catch((error) => {
    console.error(`GitHub reminder reconstruction failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  AreGitHubUrlListsEqual,
  BuildReconstructedGitHubUrls,
  NormalizeGitHubUrls,
  ParseArgs,
  ShouldReconstructReminder,
};

