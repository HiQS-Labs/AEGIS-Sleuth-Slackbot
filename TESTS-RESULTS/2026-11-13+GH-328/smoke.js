const U = require(process.cwd() + '/src/reminders-display-utils.js');
const App = { WorkspaceInfo: { MAIN_TIMEZONE: 'UTC', WORKSPACE_NAME: 'smoke-ws' }, BotUserID: 'U_BOT',
  GetPermaLinkAsync: async (c, m) => `https://x.slack.com/archives/${c}/p${m.replace('.', '')}` };
const Base = { OriginalMessageID: '1.2', CreatedOn: new Date(Date.now() - 15 * 864e5), ShouldPostOn: new Date('2026-11-14T06:59:00Z'), AssigneeID: 'U_OWNER' };
(async () => {
  const Cases = [
    ['main: mapped client, plain title', { ...Base, OriginalChannelID: 'C_CLIENT_A', ReminderMessageText: '<@U1>, please follow up on this:\n\nKey task(s):\n• Automate new meeting summaries and transcripts in GitHub issue #865 with Grok Bot' }, {}],
    ['adjacent: title already led by client name', { ...Base, OriginalChannelID: 'C_CLIENT_A', ReminderMessageText: '<@U1>, please follow up on this:\n\nKey task(s):\n• Client A - Automate meeting summaries' }, {}],
    ['adjacent: unmapped channel', { ...Base, OriginalChannelID: 'C_OTHER', ReminderMessageText: '<@U1>, please follow up on this:\n\nKey task(s):\n• Automate meeting summaries' }, {}],
    ['adjacent: multi-task delivery', { ...Base, OriginalChannelID: 'C_CLIENT_A', ReminderMessageText: '<@U1>, please follow up on this:\n\nKey task(s):\n• Review invoice 485\n• Review invoice 483' }, { IncludeAllKeyTasks: true }],
  ];
  for (const [Name, R, Opts] of Cases) console.log(`${Name}\n  ${(await U.BuildCompactTextForReminder(App, R, 'C', undefined, Opts)).replace(/\n/g, '\n  ')}`);
})();
