'use strict';

const fs = require('fs').promises;
const path = require('path');
const {
  ParseStratalistImportCommandText,
  FetchStratalistPublicListAsync,
  NormalizeStratalistPayload,
} = require('../src/stratalist-import');

/**
 * @param {string[]} ArgArgv
 * @returns {{
 *   CommandText: string|null,
 *   FixtureFilePath: string|null,
 *   DefaultAssigneeId: string,
 *   WorkspaceTimeZone: string,
 *   HelpRequested: boolean
 * }}
 */
function ParseArgs(ArgArgv) {
  let CommandText = null;
  let FixtureFilePath = null;
  let DefaultAssigneeId = 'U_IMPORTER';
  let WorkspaceTimeZone = 'America/Los_Angeles';
  let HelpRequested = false;

  for(let Index = 0; Index < ArgArgv.length; Index++) {
    const CurrentArg = ArgArgv[Index];

    if(CurrentArg === '--command') {
      CommandText = ArgArgv[++Index] || null;
      continue;
    }

    if(CurrentArg === '--fixture-file') {
      FixtureFilePath = ArgArgv[++Index] || null;
      continue;
    }

    if(CurrentArg === '--default-assignee') {
      DefaultAssigneeId = ArgArgv[++Index] || DefaultAssigneeId;
      continue;
    }

    if(CurrentArg === '--timezone') {
      WorkspaceTimeZone = ArgArgv[++Index] || WorkspaceTimeZone;
      continue;
    }

    if(CurrentArg === '--help' || CurrentArg === '-h') {
      HelpRequested = true;
      continue;
    }

    throw new Error(`Unknown argument: ${CurrentArg}`);
  }

  return {
    CommandText,
    FixtureFilePath,
    DefaultAssigneeId,
    WorkspaceTimeZone,
    HelpRequested,
  };
}

/**
 * @returns {void}
 */
function PrintUsage() {
  console.log('Usage: node scripts/stratalist-import-spike.js --command "import <url> [assign ...] [undated ...]" [options]');
  console.log('');
  console.log('Options:');
  console.log('  --command TEXT           mention-stripped import command text (required).');
  console.log('  --fixture-file PATH      read payload JSON from a local fixture instead of fetching live.');
  console.log('  --default-assignee ID    fallback Slack user ID for default/me assignment.');
  console.log('  --timezone TZ            workspace timezone for date-only normalization.');
  console.log('  --help, -h               show this help text.');
}

/**
 * @param {string|null} ArgAssigneeToken
 * @param {'default'|'me'|'explicit'} ArgAssigneeMode
 * @param {string} ArgDefaultAssigneeId
 * @returns {string}
 */
function ResolveAssigneeId(ArgAssigneeToken, ArgAssigneeMode, ArgDefaultAssigneeId) {
  if(ArgAssigneeMode === 'explicit' && ArgAssigneeToken) return ArgAssigneeToken.replace(/^<@|>$/g, '');
  return ArgDefaultAssigneeId;
}

/**
 * @param {{
 *   CommandText: string|null,
 *   FixtureFilePath: string|null,
 *   DefaultAssigneeId: string,
 *   WorkspaceTimeZone: string,
 *   HelpRequested: boolean
 * }} ArgOptions
 * @returns {Promise<void>}
 */
async function MainAsync(ArgOptions) {
  if(ArgOptions.HelpRequested) {
    PrintUsage();
    return;
  }

  if(!ArgOptions.CommandText)
    throw new Error('Argument --command is required.');

  const ParsedCommand = ParseStratalistImportCommandText(ArgOptions.CommandText);
  if(!ParsedCommand.success) {
    process.stdout.write(JSON.stringify(ParsedCommand, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }

  let Payload;
  if(ArgOptions.FixtureFilePath) {
    const FixtureText = await fs.readFile(path.resolve(ArgOptions.FixtureFilePath), 'utf8');
    Payload = JSON.parse(FixtureText);
  } else {
    const FetchResult = await FetchStratalistPublicListAsync(ParsedCommand.shareUrl);
    if(!FetchResult.ok) {
      process.stdout.write(JSON.stringify(FetchResult, null, 2) + '\n');
      process.exitCode = 1;
      return;
    }
    Payload = FetchResult.payload;
  }

  const AssigneeID = ResolveAssigneeId(
    ParsedCommand.assigneeToken,
    ParsedCommand.assigneeMode,
    ArgOptions.DefaultAssigneeId
  );

  const Normalized = NormalizeStratalistPayload(Payload, {
    WorkspaceTimeZone: ArgOptions.WorkspaceTimeZone,
    AssigneeID,
    UndatedFallbackText: ParsedCommand.undatedFallbackText,
  });

  process.stdout.write(JSON.stringify({
    ParsedCommand,
    AssigneeID,
    WorkspaceTimeZone: ArgOptions.WorkspaceTimeZone,
    ResultSummary: {
      listSlug: Normalized.ListSlug,
      importCandidates: Normalized.ImportCandidates.length,
      skippedCompleted: Normalized.SkippedCompletedItems.length,
      skippedTrashed: Normalized.SkippedTrashedItems.length,
      skippedUndated: Normalized.SkippedUndatedItems.length,
      warnings: Normalized.Warnings.length,
    },
    FirstImportCandidate: Normalized.ImportCandidates[0] || null,
    Warnings: Normalized.Warnings,
  }, null, 2) + '\n');
}

if(require.main === module) {
  MainAsync(ParseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ParseArgs,
  ResolveAssigneeId,
  MainAsync,
};
