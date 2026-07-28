/**
 * Handle the `run daily digest` admin command — force-runs the daily digest immediately,
 * bypassing the duplicate-run guard. Workspace admins/owners only.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {import('../reminders-module')|null} ArgRemindersModule Reminders module that owns the
 *   digest run; null/undefined when the workspace is configured without reminders.
 * @returns {Promise<void>}
 */
async function HandleRunDailyDigestCommandAsync(ArgSlackApp, ArgEventInfo, ArgRemindersModule) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can force-run the daily digest.'
    );
    return;
  }

  if(!ArgRemindersModule) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'daily digest is unavailable — reminders module is not loaded.'
    );
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    ':spiral_calendar_pad: Running daily digest now…'
  );

  try {
    await ArgRemindersModule.RunDailyDigestNowAsync();
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      ':white_check_mark: Daily digest complete. Check the reminder channel for the output.'
    );
  } catch(error) {
    ArgSlackApp.Logger.error('error running daily digest on demand:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'daily digest failed. Check application logs for details.'
    );
  }
}

module.exports = HandleRunDailyDigestCommandAsync;
