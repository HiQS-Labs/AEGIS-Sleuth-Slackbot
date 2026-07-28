/**
 * Handle the `restart` admin command.
 *
 * Sends SIGINT to the current process after posting a confirmation, which triggers the existing
 * graceful-shutdown path in app.js (saves state, posts shutdown notification, exits cleanly).
 * nodemon (dev) and systemd (prod) auto-restart the process from there.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @returns {Promise<void>}
 */
async function HandleRestartCommandAsync(ArgSlackApp, ArgEventInfo) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can restart the app.'
    );
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    'Restarting Sleuth… :arrows_counterclockwise:'
  );

  // wait briefly so the confirmation message is delivered before the socket closes.
  await new Promise(resolve => setTimeout(resolve, 1000));

  // flag this as a restart request so the SIGINT handler in app.js exits with code 1.
  // nodemon only auto-restarts on non-zero exit codes; exit(0) is treated as a clean stop.
  // systemd with Restart=always restarts on any exit code so this is safe in production too.
  process.env.SLEUTH_RESTART_REQUESTED = '1';

  // send SIGINT to self — the graceful-shutdown handler in app.js takes over from here.
  process.kill(process.pid, 'SIGINT');
}

module.exports = HandleRestartCommandAsync;
