'use strict';

const {
  GetThreadMemoryDb,
  CaptureThreadAsync,
  SaveThreadMemoryAsync,
  ThreadAlreadyRemembered,
} = require('../thread-memory');

/**
 * Handle `@Sleuth remember above` — capture the current Slack thread into the searchable thread-memory
 * store. Additive and self-contained: touches neither the reminder FSM nor the RAG index. Available in
 * every workspace; memories are isolated per workspace via the team ID.
 *
 * Degrades gracefully without GOOGLE_API_KEY: the thread is still stored, just not yet searchable.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @returns {Promise<void>}
 */
async function HandleRememberAboveCommandAsync(ArgSlackApp, ArgEventInfo) {
  // require a thread — "remember above" only makes sense at the end of a conversation.
  if(!ArgEventInfo.thread_ts) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Use 'remember above' at the end of a Slack thread."
    );
    return;
  }

  let Db;
  try {
    Db = GetThreadMemoryDb();
  } catch(error) {
    ArgSlackApp.Logger.error('remember-above: failed to open thread-memory store:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Sorry — couldn't open the memory store. Check the logs."
    );
    return;
  }

  const WorkspaceId = ArgSlackApp.TeamId || 'unknown';

  // idempotency: never store the same thread twice for a workspace.
  if(ThreadAlreadyRemembered(Db, WorkspaceId, ArgEventInfo.thread_ts)) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Already remembered this thread.'
    );
    return;
  }

  try {
    const Record = await CaptureThreadAsync(ArgSlackApp, ArgEventInfo);
    const ApiKey = process.env.GOOGLE_API_KEY;
    const { Embedded } = await SaveThreadMemoryAsync(Db, Record, ApiKey);

    if(!Embedded) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Thread saved (search unavailable — GOOGLE_API_KEY not configured).'
      );
      return;
    }

    const RefsSuffix = Record.GitHubRefs.length > 0
      ? `, refs: ${Record.GitHubRefs.map(ArgRef => ArgRef.ref).join(', ')}`
      : '';
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Remembered. ${Record.MessageCount} messages, ${Record.Participants.length} participants${RefsSuffix}. (via \`remember above\`)`
    );
  } catch(error) {
    ArgSlackApp.Logger.error('remember-above: capture failed:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Sorry — couldn't remember this thread. Check the logs."
    );
  }
}

module.exports = HandleRememberAboveCommandAsync;
