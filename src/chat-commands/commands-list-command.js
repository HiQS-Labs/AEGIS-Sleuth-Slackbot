const {
  LoadCommandCatalogSync,
  BuildCommandsReferenceLinesFromCatalog,
} = require('../command-catalog');

/**
 * Handle the `commands` admin command — posts the full admin + user command reference.
 * The content is generated from the command catalog so route docs and the help file can
 * stay on one source of truth.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @returns {Promise<void>}
 */
async function HandleCommandsListAsync(ArgSlackApp, ArgEventInfo) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel, ArgEventInfo.ts,
      'sorry, only workspace admins or owners can view the commands list.'
    );
    return;
  }

  const Lines = BuildCommandsReferenceLinesFromCatalog(
    LoadCommandCatalogSync(),
    ArgSlackApp.AppMentionString
  );

  Lines.push(
    '',
    '*:bell: Reaction Shortcuts*',
    ':alarm_clock: on any message — manually create a reminder for that message',
    ':wrench: on a Sleuth chat/app-mention thread — post chat triage diagnostics for routing, model choice, and context memory',
    ':wrench: on any other message — post reminder triage diagnostics in a child thread',
    ':wastebasket: on a reminder — cancel and delete the reminder',
    ':white_check_mark: on a reminder — mark the reminder as completed',
    ':no_bell: in a thread — stop Sleuth AI auto-responding in this thread',
    ':bell: in a thread — resume Sleuth AI auto-responding in this thread',
  );

  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
}

module.exports = HandleCommandsListAsync;
