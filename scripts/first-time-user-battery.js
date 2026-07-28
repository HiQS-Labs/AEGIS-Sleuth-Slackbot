'use strict';

// First-time-user question battery — drives the REAL ChatModule (real WorkspaceAI / real LLM)
// through the MockSlackApp wrapper and prints Sleuth's actual reply to each question.
//
// Unlike tests/chat-module.integration.test.js (which hard-mocks WorkspaceAI), this harness uses
// the live provider so the captured answers are byte-for-byte what a first-time user would see.
// Run it on a box where the workspace config + OPENAI_API_KEY exist (e.g. the Vultr dev server):
//
//   node scripts/first-time-user-battery.js [WorkspaceName]
//
// Side-effect profile: posts go to the in-memory mock (never real Slack). RemindersModule is
// constructed but NOT started (no timers, no disk writes, empty reminders = the first-time state).
// The real LLM IS called for free-chat questions (~2 cheap calls). Stats mutate in-memory only.

// minimal jest shim so MockSlackApp's `jest.fn().mockResolvedValue('')` works outside Jest.
if(typeof global.jest === 'undefined') {
  global.jest = {
    fn: () => {
      const Stub = async () => '';
      Stub.mockResolvedValue = () => Stub;
      return Stub;
    },
  };
}

const workspaces = require('../src/workspaces');
const ChatModule = require('../src/chat-module');
const RemindersModule = require('../src/reminders-module');
const { MockSlackApp } = require('../tests/mocks/mock-slack-app');

// minimal stats shape the ChatModule constructor + WorkspaceAI token accounting expect.
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

// the battery — each question is chosen to land on a different rung of the dispatch ladder.
const Battery = [
  { id: 1, rung: 'AI-chat fallback',          text: 'what can you do?' },
  { id: 2, rung: 'AI-chat / help',            text: 'how do I set a reminder?' },
  { id: 3, rung: 'unsupported-reminder intercept', text: 'remind me to pay the invoices tomorrow at 9am' },
  { id: 4, rung: 'model-identity guard',      text: 'what model are you running?' },
  { id: 5, rung: 'command router → reminders', text: 'show my reminders' },
];

/**
 * Run the full battery against a single workspace and print the captured replies.
 * @param {string} ArgWorkspaceName Workspace to load and drive.
 * @returns {Promise<void>}
 */
async function RunBatteryForWorkspaceAsync(ArgWorkspaceName) {
  const WorkspaceInfo = await workspaces.LoadWorkspaceInfoByNameAsync(ArgWorkspaceName);

  const SlackApp = new MockSlackApp({
    WorkspaceInfo,
    AppMentionString: '<@UBOTDEV>',
    AdminUsers: [],
  });

  // construct RemindersModule BEFORE ChatModule so its app-mention handler is checked first
  // (mirrors src/app.js construction order). Not started → empty reminders = the first-time state.
  const Reminders = new RemindersModule(SlackApp);
  const Chat = new ChatModule(SlackApp, EmptyWorkspaceStats, Reminders, null, null);
  await Chat.StartAsync();

  console.log('================================================================');
  console.log(`WORKSPACE: ${ArgWorkspaceName}`);
  console.log(`DEFAULT MODEL: ${Chat.WorkspaceAI.DefaultModelName}  |  COMPLEX: ${Chat.WorkspaceAI.ComplexModelName}`);
  console.log('================================================================\n');

  for(const Item of Battery) {
    const TextBefore = SlackApp.SentMessages.length;
    const BlockBefore = SlackApp.SentBlockMessages.length;
    let WasHandled = false;
    let CaptureError = null;

    try {
      WasHandled = await SlackApp.SimulateAppMentionAsync({
        channel: 'C_FIRSTTIME',
        user: 'U_FIRSTTIME',
        text: `${SlackApp.AppMentionString} ${Item.text}`,
      });
    } catch(error) {
      CaptureError = error;
    }

    const NewTexts = SlackApp.SentMessages.slice(TextBefore);
    const NewBlocks = SlackApp.SentBlockMessages.slice(BlockBefore);

    console.log(`---- Q${Item.id} [expected rung: ${Item.rung}] ----`);
    console.log(`USER: @Sleuth ${Item.text}`);
    console.log(`handled=${WasHandled}  text-replies=${NewTexts.length}  block-replies=${NewBlocks.length}`);
    if(CaptureError) console.log(`ERROR: ${CaptureError.message}`);
    for(const Sent of NewTexts)
      console.log(`SLEUTH (text):\n${Sent.text}\n`);
    for(const Block of NewBlocks) {
      console.log(`SLEUTH (blocks fallback text):\n${Block.text}`);
      const ButtonLabels = (Block.blocks || [])
        .flatMap((B) => B.elements || [])
        .map((E) => (E.text && E.text.text) || E.action_id)
        .filter(Boolean);
      if(ButtonLabels.length) console.log(`  [block actions: ${ButtonLabels.join(', ')}]`);
      console.log('');
    }
    console.log('');
  }
}

/**
 * Entry point — resolve the target workspace(s) and run the battery.
 * @returns {Promise<void>}
 */
async function MainAsync() {
  const Requested = process.argv[2] || null;
  const AllNames = await workspaces.EnumerateWorkspaceNamesAsync();
  if(AllNames.length === 0) {
    console.error('No workspaces found under data/runtime/workspaces. Run this on a configured server.');
    process.exit(2);
  }

  const Target = Requested || AllNames[0];
  if(!AllNames.includes(Target)) {
    console.error(`Workspace "${Target}" not found. Available: ${AllNames.join(', ')}`);
    process.exit(2);
  }

  if(AllNames.length > 1 && !Requested)
    console.log(`(note: ${AllNames.length} workspaces present; running only "${Target}". Pass a name to override.)\n`);

  await RunBatteryForWorkspaceAsync(Target);
  // explicit exit: kills any provider keep-alive sockets so the harness does not hang.
  process.exit(0);
}

MainAsync().catch((error) => {
  console.error('battery harness failed:', error);
  process.exit(1);
});
