'use strict';

// Reminder thread battery — drives the REAL RemindersModule (real WorkspaceAI / real LLM) through
// the MockSlackApp wrapper, replaying a scripted multi-turn Slack thread and printing Sleuth's
// actual message-event handling (auto-schedule, the "above"/vague-reference enrichment paths,
// TASK_ABOVE_SHORTHAND_PATTERN, etc.) turn by turn.
//
// Built for GH-424: `scripts/slack-harness-post.js` cannot be used for this — it posts through the
// live bot token, and Slack Bolt's default `ignoreSelf: true` middleware silently drops any event
// authored by the bot's own user ID before ANY handler (including RemindersModule#OnMessageAsync)
// ever sees it. This harness sidesteps Slack transport entirely, the same way
// scripts/first-time-user-battery.js already does for app_mention/chat commands.
//
// Unlike tests/reminders-integration.test.js (which mocks WorkspaceAI), this harness uses the real
// provider so captured behavior matches what a real thread would produce. Run it on a box where the
// workspace config + provider API key exist (e.g. the Vultr dev server):
//
//   node scripts/reminder-thread-battery.js --workspace neochrome-dev --scenario path/to/scenario.json
//
// Scenario file shape:
//   {
//     "channel": "C_HARNESS",           // optional, defaults to "C_HARNESS"
//     "channelType": "im",              // optional, defaults to "im" (DM) so the per-channel
//                                       // enabled-reminders gate never needs pre-setup (GH-412)
//     "turns": [
//       { "user": "U_NOEL", "text": "let's run to the park" },
//       { "user": "U_NOEL", "text": "Can you also bring some food" },
//       { "user": "U_NOEL", "text": "please see above and meet at the park at 2 PM tomorrow" }
//     ]
//   }
//
// Side-effect profile: Slack posts never leave this process (MockSlackApp records them in-memory
// as SentMessages/SentBlockMessages). RemindersModule IS started (real ChannelSettings/AIPipeline)
// but against a throwaway, pid-suffixed workspace name (`<workspace>-test-harness-<pid>`), so its
// disk-backed persistence (reminders/enabled-channels/counter/completed/events-ledger files) never
// touches the real workspace's runtime files and never collides across concurrent invocations —
// those throwaway files are deleted again when the harness exits (before AND after the run). The
// real LLM IS called for turns that reach AI extraction (real API cost/latency, same as
// first-time-user-battery.js). A turn whose SimulateMessageAsync call throws is still printed in
// full, but the process exits non-zero afterward — this is not swallowed into a green run.

// minimal jest shim so MockSlackApp's `jest.fn().mockResolvedValue('')` works outside Jest —
// same shim scripts/first-time-user-battery.js uses. Without it, `require('../tests/mocks/mock-slack-app')`
// throws `jest is not defined` under plain `node`, which is this script's only documented invocation.
if(typeof global.jest === 'undefined') {
  global.jest = {
    fn: () => {
      const Stub = async () => '';
      Stub.mockResolvedValue = () => Stub;
      return Stub;
    },
  };
}

const fs = require('fs').promises;
const path = require('path');
const Workspaces = require('../src/workspaces');
const RemindersModule = require('../src/reminders-module');
const { MockSlackApp } = require('../tests/mocks/mock-slack-app');

const DEFAULT_CHANNEL = 'C_HARNESS';
const DEFAULT_CHANNEL_TYPE = 'im';
const BASE_TS_SECONDS = 1700000000;
const TS_STEP_SECONDS = 5;

const EmptyWorkspaceStats = {
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
 * Parse CLI arguments.
 * @param {string[]} ArgArgv Raw argv slice.
 * @returns {{ WorkspaceName: string|null, ScenarioPath: string|null, KeepData: boolean, HelpRequested: boolean }}
 */
function ParseArgs(ArgArgv) {
  let WorkspaceName = null;
  let ScenarioPath = null;
  let KeepData = false;
  let HelpRequested = false;

  for(let i = 0; i < ArgArgv.length; i++) {
    const CurrentArg = ArgArgv[i];

    if(CurrentArg === '--workspace') {
      WorkspaceName = ArgArgv[++i] || null;
      if(!WorkspaceName) throw new Error('Missing workspace name after --workspace.');
      continue;
    }

    if(CurrentArg === '--scenario') {
      ScenarioPath = ArgArgv[++i] || null;
      if(!ScenarioPath) throw new Error('Missing file path after --scenario.');
      continue;
    }

    if(CurrentArg === '--keep-data') {
      KeepData = true;
      continue;
    }

    if(CurrentArg === '--help' || CurrentArg === '-h') {
      HelpRequested = true;
      continue;
    }

    throw new Error(`Unknown argument: ${CurrentArg}`);
  }

  return { WorkspaceName, ScenarioPath, KeepData, HelpRequested };
}

/**
 * Print CLI usage.
 */
function PrintUsage() {
  console.log('Usage: node scripts/reminder-thread-battery.js --workspace NAME --scenario PATH [--keep-data]');
  console.log('');
  console.log('Options:');
  console.log('  --workspace NAME   real workspace to borrow model/API config from (required).');
  console.log('  --scenario PATH    JSON scenario file describing the thread turns (required).');
  console.log('  --keep-data        do not delete the throwaway harness workspace runtime files on exit.');
  console.log('  --help, -h         show this help text.');
}

/**
 * Load and validate the scenario file.
 * @param {string} ArgScenarioPath Path to the scenario JSON file.
 * @returns {Promise<{ channel: string, channelType: string|undefined, turns: Array<{ user: string, text: string }> }>}
 */
async function LoadScenarioAsync(ArgScenarioPath) {
  const RawText = await fs.readFile(path.resolve(ArgScenarioPath), 'utf8');
  const Scenario = JSON.parse(RawText);

  if(!Array.isArray(Scenario.turns) || Scenario.turns.length === 0)
    throw new Error('Scenario file must have a non-empty "turns" array.');

  for(const Turn of Scenario.turns) {
    if(typeof Turn.text !== 'string' || Turn.text.trim().length === 0)
      throw new Error('Every scenario turn needs a non-empty "text" field.');
  }

  return {
    channel: Scenario.channel || DEFAULT_CHANNEL,
    channelType: 'channelType' in Scenario ? Scenario.channelType : DEFAULT_CHANNEL_TYPE,
    turns: Scenario.turns.map((ArgTurn) => ({ user: ArgTurn.user || 'U_HARNESS', text: ArgTurn.text })),
  };
}

/**
 * Build the file paths RemindersModule persists to for a given workspace name.
 * @param {string} ArgWorkspaceName Workspace name.
 * @returns {string[]}
 */
function GetReminderRuntimeFilePaths(ArgWorkspaceName) {
  const RemindersDirPath = Workspaces.GetSubdirPath('reminders');
  const EventsDirPath = Workspaces.GetSubdirPath('events');
  return [
    path.join(RemindersDirPath, `${ArgWorkspaceName}_reminders.json`),
    path.join(RemindersDirPath, `${ArgWorkspaceName}_reminder_counter.json`),
    path.join(RemindersDirPath, `${ArgWorkspaceName}_enabled_channels.json`),
    path.join(RemindersDirPath, `${ArgWorkspaceName}_completed.json`),
    path.join(EventsDirPath, `${ArgWorkspaceName}_events.jsonl`),
  ];
}

/**
 * Delete the throwaway harness workspace's runtime files.
 * @param {string} ArgWorkspaceName Workspace name.
 * @returns {Promise<void>}
 */
async function CleanupRuntimeFilesAsync(ArgWorkspaceName) {
  await Promise.all(
    GetReminderRuntimeFilePaths(ArgWorkspaceName).map((ArgPath) => fs.rm(ArgPath, { force: true }))
  );
}

/**
 * Build a Slack-shaped ts string for the given turn index.
 * @param {number} ArgTurnIndex Zero-based turn index.
 * @returns {string}
 */
function MakeTurnTS(ArgTurnIndex) {
  return `${BASE_TS_SECONDS + ArgTurnIndex * TS_STEP_SECONDS}.000000`;
}

/**
 * Run the scripted scenario against a throwaway instance of the real RemindersModule.
 * @param {string} ArgWorkspaceName Real workspace to borrow config from.
 * @param {{ channel: string, channelType: string|undefined, turns: Array<{ user: string, text: string }> }} ArgScenario Parsed scenario.
 * @param {boolean} ArgKeepData Skip cleanup of throwaway runtime files when true.
 * @returns {Promise<void>}
 */
async function RunScenarioAsync(ArgWorkspaceName, ArgScenario, ArgKeepData) {
  const RealWorkspaceInfo = await Workspaces.LoadWorkspaceInfoByNameAsync(ArgWorkspaceName);
  // pid-suffixed so concurrent invocations (or a stale name from a prior crashed run) never
  // collide or load/delete each other's throwaway state.
  const HarnessWorkspaceInfo = {
    ...RealWorkspaceInfo,
    WORKSPACE_NAME: `${RealWorkspaceInfo.WORKSPACE_NAME}-test-harness-${process.pid}`,
  };
  // start clean even though the pid suffix already makes collisions vanishingly unlikely —
  // cheap insurance against pid reuse or a hand-crafted --keep-data name reused deliberately.
  await CleanupRuntimeFilesAsync(HarnessWorkspaceInfo.WORKSPACE_NAME);

  // the full scenario is known upfront, so the entire turn list (including turns not yet
  // "simulated") can be pre-loaded as the thread fixture — #CollectPrecedingHumanThreadMessagesAsync
  // only ever looks backward from the current turn's own index, so later turns are inert until
  // their own SimulateMessageAsync call runs.
  const ThreadTS = MakeTurnTS(0);
  const ThreadMessages = ArgScenario.turns.map((ArgTurn, ArgIndex) => ({
    user: ArgTurn.user,
    text: ArgTurn.text,
    ts: MakeTurnTS(ArgIndex),
    thread_ts: ThreadTS,
    bot_id: undefined,
    reactions: [],
  }));

  const SlackApp = new MockSlackApp({
    WorkspaceInfo: HarnessWorkspaceInfo,
    AdminUsers: [],
    ThreadMessagesById: {
      [`${ArgScenario.channel}:${ThreadTS}`]: ThreadMessages,
    },
  });

  const Reminders = new RemindersModule(SlackApp);
  await Reminders.StartAsync(EmptyWorkspaceStats);

  console.log('================================================================');
  console.log(`WORKSPACE: ${ArgWorkspaceName}  (harness data isolated under "${HarnessWorkspaceInfo.WORKSPACE_NAME}")`);
  console.log(`COMPLEX MODEL (reminder extraction): ${Reminders.WorkspaceAI ? Reminders.WorkspaceAI.ComplexModelName : '(n/a)'}`);
  console.log('================================================================\n');

  const TurnErrors = [];
  try {
    for(let TurnIndex = 0; TurnIndex < ArgScenario.turns.length; TurnIndex++) {
      const Turn = ArgScenario.turns[TurnIndex];
      const TextBefore = SlackApp.SentMessages.length;
      const BlockBefore = SlackApp.SentBlockMessages.length;
      let WasHandled = false;
      let CaptureError = null;

      const EventInfo = {
        channel: ArgScenario.channel,
        user: Turn.user,
        ts: MakeTurnTS(TurnIndex),
        thread_ts: TurnIndex === 0 ? undefined : ThreadTS,
        text: Turn.text,
        channel_type: ArgScenario.channelType,
      };

      try {
        WasHandled = await SlackApp.SimulateMessageAsync(EventInfo);
      } catch(error) {
        CaptureError = error;
        TurnErrors.push({ turnIndex: TurnIndex, error });
      }

      const NewTexts = SlackApp.SentMessages.slice(TextBefore);
      const NewBlocks = SlackApp.SentBlockMessages.slice(BlockBefore);

      console.log(`---- Turn ${TurnIndex + 1}/${ArgScenario.turns.length} ----`);
      console.log(`${Turn.user}: ${Turn.text}`);
      console.log(`handled=${WasHandled}  text-replies=${NewTexts.length}  block-replies=${NewBlocks.length}`);
      if(CaptureError) console.log(`ERROR: ${CaptureError.message}`);
      for(const Sent of NewTexts) console.log(`SLEUTH:\n${Sent.text}\n`);
      for(const Block of NewBlocks) console.log(`SLEUTH (blocks fallback text):\n${Block.text}\n`);
      console.log('');
    }

    const AllReminders = Reminders.GetAllReminders();
    console.log('================================================================');
    console.log(`SCHEDULED REMINDERS (${AllReminders.length}):`);
    console.log('================================================================');
    for(const Reminder of AllReminders) {
      console.log(`- "${Reminder.ReminderMessageText}"`);
      console.log(`  assignee=${Reminder.AssigneeID || '(none)'}  postOn=${Reminder.ShouldPostOn}  state=${Reminder.State || 'scheduled'}`);
    }
    if(AllReminders.length === 0) console.log('(none)');
  } finally {
    await Reminders.StopAsync();
    if(!ArgKeepData) await CleanupRuntimeFilesAsync(HarnessWorkspaceInfo.WORKSPACE_NAME);
  }

  // surface turn failures as a real non-zero exit instead of a clean-looking run — printed
  // above already; this just stops a broken pipeline from reading as green to callers/CI.
  if(TurnErrors.length > 0) {
    throw new Error(
      `${TurnErrors.length} of ${ArgScenario.turns.length} turn(s) threw: ` +
      TurnErrors.map(({ turnIndex, error }) => `turn ${turnIndex + 1} (${error.message})`).join('; ')
    );
  }
}

/**
 * Entry point for the CLI.
 * @returns {Promise<void>}
 */
async function MainAsync() {
  const Options = ParseArgs(process.argv.slice(2));

  if(Options.HelpRequested) {
    PrintUsage();
    return;
  }

  if(!Options.WorkspaceName) throw new Error('Argument --workspace is required.');
  if(!Options.ScenarioPath) throw new Error('Argument --scenario is required.');

  const Scenario = await LoadScenarioAsync(Options.ScenarioPath);
  await RunScenarioAsync(Options.WorkspaceName, Scenario, Options.KeepData);

  // explicit exit: kills any provider keep-alive sockets so the harness does not hang.
  process.exit(0);
}

if(require.main === module) {
  MainAsync().catch((error) => {
    console.error('reminder thread battery failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  ParseArgs,
  LoadScenarioAsync,
  GetReminderRuntimeFilePaths,
  CleanupRuntimeFilesAsync,
  MakeTurnTS,
  RunScenarioAsync,
};
