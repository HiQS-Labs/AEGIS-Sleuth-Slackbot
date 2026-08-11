'use strict';

jest.mock('../src/workspace-ai');

const fs = require('fs').promises;
const path = require('path');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');
const RemindersModule = require('../src/reminders-module');
const { MockSlackApp } = require('./mocks/mock-slack-app');

// GH-43 Phase 3 — the task/context split, the grounding constraint, and persisted NotifyIDs, all
// exercised end to end through a real scheduled message rather than against the helpers directly.
//
// Red before this phase: `context` was not in the schema and would have been dropped; an ungrounded
// title was rendered verbatim; and NotifyIDs did not exist as a field.

const RuntimeDir = path.join(__dirname, '..', 'data', 'runtime', 'reminders');
const WorkspaceBase = {
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

/**
 * A long multi-line note so the buried-task gate routes to synthesis. A short message would stay
 * verbatim and the context line is deliberately suppressed on that path.
 */
const LongNote = [
  '<@U_ALPHA> <@U_BETA> root cause: the weekly photo request system could only ever see a small',
  'fixed batch of photos, and once it emailed about a plant it never checked that plant again',
  'over time the batch got fully used up so the system had nothing left to send',
  'i am going to deploy the changes tomorrow morning',
].join('\n');

/**
 * @param {string} ArgSuffix
 * @returns {any}
 */
function MakeWorkspaceInfo(ArgSuffix) {
  return { ...WorkspaceBase, WORKSPACE_NAME: `TaskContextSplit_${ArgSuffix}` };
}

/**
 * @param {string} ArgWorkspaceName
 * @returns {string}
 */
function GetReminderPath(ArgWorkspaceName) {
  return path.join(RuntimeDir, `${ArgWorkspaceName}_reminders.json`);
}

/**
 * @param {string} ArgWorkspaceName
 * @returns {Promise<void>}
 */
async function CleanupAsync(ArgWorkspaceName) {
  const Prefix = `${ArgWorkspaceName}_`;
  try {
    const Entries = await fs.readdir(RuntimeDir);
    await Promise.all(Entries.filter(ArgName => ArgName.startsWith(Prefix)).map(
      ArgName => fs.rm(path.join(RuntimeDir, ArgName), { force: true })
    ));
  } catch(error) {
    if(error.code !== 'ENOENT') throw error;
  }
}

/**
 * Schedule one message and hand back everything worth asserting on.
 * @param {string} ArgSuffix Workspace suffix.
 * @param {any} ArgAiOptions Mock analyzer configuration.
 * @param {string} [ArgText] Message text.
 * @returns {Promise<{stored: any[], onDisk: any[], sent: any[]}>}
 */
async function ScheduleAsync(ArgSuffix, ArgAiOptions, ArgText = LongNote) {
  const WorkspaceInfo = MakeWorkspaceInfo(ArgSuffix);
  ConfigureMockWorkspaceAI(MockWorkspaceAI, {
    extractedDate: { year: 2030, month: 1, day: 1, hour: 9, minute: 0, second: 0 },
    ...ArgAiOptions,
  });
  const SlackApp = new MockSlackApp({ WorkspaceInfo });
  const Reminders = new RemindersModule(SlackApp);

  try {
    await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
    await Reminders.StartAsync();
    await SlackApp.SimulateMessageAsync({
      channel: 'D_SPLIT', channel_type: 'im', user: 'U_SENDER', text: ArgText,
    });
    const Stored = Reminders.GetAllReminders();
    const OnDisk = JSON.parse(await fs.readFile(GetReminderPath(WorkspaceInfo.WORKSPACE_NAME), 'utf8'));
    return { stored: Stored, onDisk: OnDisk, sent: SlackApp.SentMessages };
  } finally {
    await Reminders.StopAsync();
    await CleanupAsync(WorkspaceInfo.WORKSPACE_NAME);
  }
}

describe('GH-43 Phase 3 — task and context are separate fields', () => {
  beforeAll(async () => { await fs.mkdir(RuntimeDir, { recursive: true }); });
  afterEach(() => { MockWorkspaceAI.mockReset(); });

  test('the bullet is the short task and the context renders on its own subordinate line', async () => {
    const { stored } = await ScheduleAsync('context', {
      reminderMessage: 'Deploy the photo request changes',
      actionableLanguage: 'i am going to deploy the changes',
      context: 'the weekly photo request system could only see a small fixed batch',
    });

    expect(stored).toHaveLength(1);
    const Text = stored[0].ReminderMessageText;

    // task and context are on separate lines, and the context is italic + indented, never inline.
    expect(Text).toContain('• Deploy the photo request changes');
    expect(Text).toContain('\n  _the weekly photo request system could only see a small fixed batch_');
    // the bullet line itself must not carry the context
    const BulletLine = Text.split('\n').find((/** @type {string} */ ArgL) => ArgL.startsWith('• '));
    expect(BulletLine).toBe('• Deploy the photo request changes');
    // the full original is still preserved in the blockquote, which normalizes it to one `>` line.
    const QuoteLine = Text.split('\n').find((/** @type {string} */ ArgL) => ArgL.startsWith('>'));
    expect(QuoteLine).toContain('i am going to deploy the changes tomorrow morning');
    expect(QuoteLine).toContain('root cause: the weekly photo request system');
  });

  test('an empty context adds no line at all — not a blank one', async () => {
    const { stored } = await ScheduleAsync('nocontext', {
      reminderMessage: 'Deploy the photo request changes',
      actionableLanguage: 'i am going to deploy the changes',
      context: '',
    });
    const Text = stored[0].ReminderMessageText;
    expect(Text).toContain('• Deploy the photo request changes');
    expect(Text).not.toMatch(/•.*\n\s*_/);
    expect(Text.endsWith('• Deploy the photo request changes')).toBe(true);
  });

  test('THE GROUNDING CONSTRAINT: an invented entity is discarded end to end', async () => {
    const { stored } = await ScheduleAsync('grounding', {
      // "Snowflake" appears nowhere in the message.
      reminderMessage: 'Deploy the Snowflake photo pipeline',
      actionableLanguage: 'i am going to deploy the changes',
      context: 'the Snowflake warehouse was starved of rows',
    });

    const Text = stored[0].ReminderMessageText;
    expect(Text).not.toContain('Snowflake');
    // it falls back to the quoted evidence span rather than dropping the reminder
    expect(Text).toContain('• i am going to deploy the changes');
    // and the ungrounded context is suppressed rather than shown
    expect(Text).not.toContain('warehouse was starved');
  });

  test('a grounded rewrite is still allowed — the constraint is on entities, not phrasing', async () => {
    const { stored } = await ScheduleAsync('rewrite', {
      // every word here appears in the source; the ORDER and wording are new, which is the point.
      reminderMessage: 'Deploy the photo batch changes',
      actionableLanguage: 'i am going to deploy the changes',
    });
    expect(stored[0].ReminderMessageText).toContain('• Deploy the photo batch changes');
  });
});

describe('GH-43 Phase 3 — NotifyIDs are persisted', () => {
  beforeAll(async () => { await fs.mkdir(RuntimeDir, { recursive: true }); });
  afterEach(() => { MockWorkspaceAI.mockReset(); });

  test('addressees of a first-person commitment are kept as notify, not as assignees', async () => {
    const { stored, onDisk, sent } = await ScheduleAsync('notify', {
      reminderMessage: 'Deploy the photo request changes',
      actionableLanguage: 'i am going to deploy the changes',
    });

    // the reported defect, closed: the author owns it and the two addressees do not.
    expect(stored[0].AssigneeIDs).toEqual(['U_SENDER']);
    expect(stored[0].NotifyIDs).toEqual(['U_ALPHA', 'U_BETA']);
    expect(onDisk[0].NotifyIDs).toEqual(['U_ALPHA', 'U_BETA']);

    // notify and assignees are disjoint by construction
    expect(stored[0].NotifyIDs.some((/** @type {string} */ ArgID) => stored[0].AssigneeIDs.includes(ArgID)))
      .toBe(false);

    // a single assignee must NOT borrow GH-22's shared-work phrasing...
    const Confirmation = sent.find((/** @type {any} */ ArgM) => ArgM.text.includes('been scheduled'));
    expect(Confirmation.text).not.toContain('as shared work');
    // ...and the addressees are named as recipients rather than silently dropped
    expect(Confirmation.text).toContain('<@U_ALPHA>, <@U_BETA> were also mentioned');
  });

  test('an explicit shared ask assigns to both and notifies nobody — GH-22 is untouched', async () => {
    const { stored, sent } = await ScheduleAsync(
      'shared',
      { reminderMessage: 'review the release notes', actionableLanguage: 'please review the release notes' },
      '<@U_ALPHA> <@U_BETA> please review the release notes tomorrow',
    );

    expect(stored[0].AssigneeIDs).toEqual(['U_ALPHA', 'U_BETA']);
    expect(stored[0].NotifyIDs).toEqual([]);
    expect(sent.some((/** @type {any} */ ArgM) => ArgM.text.includes('shared work for <@U_ALPHA>, <@U_BETA>')))
      .toBe(true);
    expect(sent.some((/** @type {any} */ ArgM) => ArgM.text.includes('also mentioned'))).toBe(false);
  });

  test('an empty notify set renders no recipients sentence', async () => {
    const { stored, sent } = await ScheduleAsync(
      'solo',
      { reminderMessage: 'Deploy the hotfix', actionableLanguage: "I'll deploy the hotfix" },
      "I'll deploy the hotfix tomorrow morning",
    );
    expect(stored[0].AssigneeIDs).toEqual(['U_SENDER']);
    expect(stored[0].NotifyIDs).toEqual([]);
    expect(sent.some((/** @type {any} */ ArgM) => ArgM.text.includes('also mentioned'))).toBe(false);
  });
});
