#!/usr/bin/env node
'use strict';

/**
 * Replay a Slack thread through the REAL reminder pipeline — real handlers, real context
 * resolver, real model call — and check what task text and assignee come out.
 *
 * ## The gap this closes
 *
 * Every GH-143 defect was found by a human typing a thread into Slack, screenshotting the result,
 * and pasting it back; four rounds of that located one bug. The unit suite could not have caught
 * any of them, because it asserts PLUMBING — which path fired, which flag was set, who was
 * assigned — and stubs the model. The failures were all in the two layers it stubs out: what
 * context gets assembled, and what the analyzer writes when it reads that context.
 *
 * This harness exercises exactly those two layers with no Slack workspace involved.
 *
 * ## Why not post to Slack
 *
 * Tried, and rejected on evidence: Slack stamps a `bot_id` on messages sent with an app-owned
 * user token, and the resolver skips any message carrying `bot_id` when collecting antecedents.
 * A posted thread is therefore invisible as context — the run "passes" while testing nothing.
 * Making it work would mean loosening the production bot filter to accommodate a test, which is
 * backwards. Synthetic events reach the same handlers with none of that.
 *
 * ## What is real and what is not
 *
 * Real: the handler chain, admission gates, context resolver, analyzer prompt, model call,
 * display selection, ownership resolution. Not real: the Slack transport and the message store
 * (a temp SLEUTH_DATA_DIR, deleted on exit). It cannot catch a Slack-transport bug, and does not
 * claim to.
 *
 * Usage:
 *   OPENAI_API_KEY_FILE=~/secrets/sleuth/Open-AI-Sleuth-Aug-2026.txt \
 *   node utils/reminder-replay.js utils/replay-scenarios.json
 *
 * Exit code is 0 only when every expectation held, so this is usable as a gate.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');

function ExpandHome(ArgPath) {
  return ArgPath.startsWith('~') ? path.join(os.homedir(), ArgPath.slice(1)) : ArgPath;
}

function ReadApiKey() {
  if(process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const KeyFile = process.env.OPENAI_API_KEY_FILE;
  if(!KeyFile) {
    console.error('reminder-replay: set OPENAI_API_KEY or OPENAI_API_KEY_FILE — this harness makes a REAL model call.');
    process.exit(1);
  }
  // Key files in this project are sometimes `NAME=value`, sometimes the bare key.
  const Raw = fs.readFileSync(ExpandHome(KeyFile), 'utf8').trim();
  const Match = Raw.match(/(sk-[A-Za-z0-9_\-]+)/);
  if(!Match) {
    console.error(`reminder-replay: no sk- key found in ${KeyFile}.`);
    process.exit(1);
  }
  return Match[1];
}

/** Isolate every write. Set BEFORE requiring the app modules — workspaces reads it at load. */
const DataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reminder-replay-'));
process.env.SLEUTH_DATA_DIR = DataDir;
process.env.OPENAI_API_KEY = ReadApiKey();
// The behaviours under test are the flagged ones; a replay with them off tests the old code.
process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED || 'on';
process.env.REACTION_CONTEXT_RESOLUTION_ENABLED = process.env.REACTION_CONTEXT_RESOLUTION_ENABLED || 'on';

// The shared Slack mock builds two file helpers with `jest.fn().mockResolvedValue(...)`. Rather
// than edit a file the whole suite depends on, supply the two methods it uses — the harness is the
// guest here, and a five-line shim is cheaper than a shared-mock refactor.
if(!globalThis.jest) {
  globalThis.jest = {
    fn: () => {
      let Resolved;
      const Stub = async () => Resolved;
      Stub.mockResolvedValue = (ArgValue) => { Resolved = ArgValue; return Stub; };
      return Stub;
    },
  };
}

const RemindersModule = require('../src/reminders-module');
const { MockSlackApp } = require('../tests/mocks/mock-slack-app');

const CHANNEL = 'C_REPLAY';

const WorkspaceInfo = {
  WORKSPACE_NAME: 'ReplayWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-replay',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-replay',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

const EmptyWorkspaceStats = {
  IncomingMessageCount: 0, IncomingMessageLength: 0,
  OutgoingMessageCount: 0, OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0, OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0, IncomingGptMessageLength: 0,
};

/**
 * Build the thread Slack would return, with real-looking timestamps in order.
 * @param {Array<{user: string, text: string}>} ArgMessages
 * @param {number} ArgBaseSeconds
 */
function BuildThread(ArgMessages, ArgBaseSeconds) {
  return ArgMessages.map((ArgMessage, ArgIndex) => ({
    user: ArgMessage.user,
    text: ArgMessage.text,
    ts: `${ArgBaseSeconds + ArgIndex}.000100`,
    thread_ts: `${ArgBaseSeconds}.000100`,
  }));
}

/**
 * Run one scenario end to end and return what the pipeline produced.
 * @param {any} ArgScenario
 */
async function RunScenarioAsync(ArgScenario) {
  const BaseSeconds = 1800000000;
  const Thread = BuildThread([...(ArgScenario.thread || []), ArgScenario.event], BaseSeconds);
  const LiveMessage = Thread[Thread.length - 1];
  const RootTs = Thread[0].ts;

  const SlackApp = new MockSlackApp({
    WorkspaceInfo,
    // Enabling reminders is creator/admin-gated. Without this the enable command is refused and
    // every scenario reports "no reminder scheduled" — a silent pass-as-fail that says nothing
    // about the code under test.
    AdminUsers: ['U_ADMIN'],
    // Both keys: the resolver walks by thread root, the reaction path looks the message up by ts.
    ThreadMessagesById: {
      [`${CHANNEL}:${RootTs}`]: Thread,
      [`${CHANNEL}:${LiveMessage.ts}`]: [LiveMessage],
    },
  });

  const Reminders = new RemindersModule(SlackApp);
  await Reminders.StartAsync(EmptyWorkspaceStats);
  // Auto-scheduling is per-channel and off by default; without this the message path returns early
  // and the scenario silently tests nothing.
  await SlackApp.SimulateAppMentionAsync({
    channel: CHANNEL, user: 'U_ADMIN', text: `${SlackApp.AppMentionString} AI enable reminders`,
  });

  const IsThreadReply = Thread.length > 1;
  if(ArgScenario.kind === 'reaction') {
    await SlackApp.SimulateReactionAsync?.('alarm_clock', { channel: CHANNEL, ts: LiveMessage.ts, user: 'U_REACTOR' });
  } else if(ArgScenario.kind === 'app_mention') {
    await SlackApp.SimulateAppMentionAsync({
      channel: CHANNEL, user: LiveMessage.user, text: LiveMessage.text,
      ts: LiveMessage.ts, thread_ts: IsThreadReply ? RootTs : undefined,
    });
  } else {
    await SlackApp.SimulateMessageAsync({
      channel: CHANNEL, user: LiveMessage.user, text: LiveMessage.text,
      ts: LiveMessage.ts, thread_ts: IsThreadReply ? RootTs : undefined,
    });
  }

  if(process.env.REPLAY_DEBUG) {
    for(const Sent of SlackApp.SentMessages || []) console.log(`   [slack] ${String(Sent.text).slice(0, 160)}`);
  }

  // Grade the BULLETS from the confirmation message, not `ReminderMessageText`. The stored text is
  // the whole composed body — quoted source, context line and all — so grading it would score the
  // prepended context as if it were the task, and a "no reminder should contain X" expectation
  // would fail on the quote of X rather than on the task. The bullet is what a person reads.
  const Assignees = Reminders.GetAllReminders()
    .flatMap((/** @type {any} */ ArgReminder) => ArgReminder.AssigneeIDs || [ArgReminder.AssigneeID].filter(Boolean));
  const Confirmation = (SlackApp.SentMessages || [])
    .map((/** @type {any} */ ArgSent) => String(ArgSent.text || ''))
    .find((/** @type {string} */ ArgText) => ArgText.includes('Tasks for'));
  const Bullets = (Confirmation || '')
    .split('\n')
    .filter((/** @type {string} */ ArgLine) => ArgLine.trim().startsWith('•'))
    .map((/** @type {string} */ ArgLine) => ArgLine.replace(/^\s*•\s*/, '').replace(/^Sleuth\s+-\s*/, '').trim());
  const Produced = Bullets.map((/** @type {string} */ ArgText) => ({ text: ArgText, assignees: Assignees }));
  await Reminders.StopAsync();
  return Produced;
}

/**
 * Grade one scenario. Every expectation is optional; a scenario with none is a "show me what
 * happens" run rather than a gate.
 */
function Grade(ArgScenario, ArgProduced) {
  const Failures = [];
  const AllText = ArgProduced.map((/** @type {any} */ ArgItem) => ArgItem.text).join('\n');
  const Expect = ArgScenario.expect || {};

  for(const Needle of Expect.taskContains || [])
    if(!AllText.toLowerCase().includes(Needle.toLowerCase()))
      Failures.push(`expected some reminder to mention "${Needle}"`);

  for(const Needle of Expect.taskNotContains || [])
    if(AllText.toLowerCase().includes(Needle.toLowerCase()))
      Failures.push(`no reminder should contain "${Needle}"`);

  // A task title that is really the whole source message pasted back is the GH-143 defect shape,
  // and it slips past a "contains" check every time — the needle IS in there, buried.
  if(Expect.maxTaskLength !== undefined)
    for(const Item of ArgProduced)
      if(Item.text.length > Expect.maxTaskLength)
        Failures.push(`task is ${Item.text.length} chars, over the ${Expect.maxTaskLength} limit — likely the source message pasted back`);

  if(Expect.reminderCount !== undefined && ArgProduced.length !== Expect.reminderCount)
    Failures.push(`expected ${Expect.reminderCount} reminder(s), got ${ArgProduced.length}`);

  if(Expect.assignee) {
    const Assignees = new Set(ArgProduced.flatMap((/** @type {any} */ ArgItem) => ArgItem.assignees));
    if(!Assignees.has(Expect.assignee))
      Failures.push(`expected assignee ${Expect.assignee}, got ${[...Assignees].join(', ') || 'none'}`);
  }

  return Failures;
}

async function MainAsync() {
  const ScenarioPath = process.argv[2] || path.join(__dirname, 'replay-scenarios.json');
  const Parsed = JSON.parse(fs.readFileSync(ExpandHome(ScenarioPath), 'utf8'));
  const Scenarios = Array.isArray(Parsed) ? Parsed : [Parsed];

  let FailedCount = 0;
  for(const Scenario of Scenarios) {
    console.log(`\n── ${Scenario.name}`);
    for(const Message of Scenario.thread || []) console.log(`   ${Message.user}: ${Message.text}`);
    console.log(`   ${Scenario.event.user}: ${Scenario.event.text}   <- the live message`);

    let Produced = [];
    try {
      Produced = await RunScenarioAsync(Scenario);
    } catch(error) {
      console.log(`   ERROR: ${error.message}`);
      FailedCount++;
      continue;
    }

    if(Produced.length === 0) console.log('   (no reminder scheduled)');
    for(const Item of Produced) console.log(`   -> "${Item.text}"  [${Item.assignees.join(', ') || 'unassigned'}]`);

    const Failures = Grade(Scenario, Produced);
    if(Failures.length === 0) {
      console.log('   PASS');
    } else {
      FailedCount++;
      for(const Failure of Failures) console.log(`   FAIL: ${Failure}`);
    }
  }

  await fsp.rm(DataDir, { recursive: true, force: true });
  console.log(`\n${Scenarios.length - FailedCount}/${Scenarios.length} scenarios passed`);
  process.exit(FailedCount === 0 ? 0 : 1);
}

MainAsync().catch(async (ArgError) => {
  await fsp.rm(DataDir, { recursive: true, force: true });
  console.error(`reminder-replay: ${ArgError.stack || ArgError.message}`);
  process.exit(1);
});
