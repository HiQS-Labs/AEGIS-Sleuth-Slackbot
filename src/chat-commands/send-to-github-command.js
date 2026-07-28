'use strict';

const { CaptureThreadAsync } = require('../thread-memory');
const { FileGithubIssueAsync, ISSUE_REPO } = require('../github-issue-filer');

/**
 * Build the GitHub issue body from a captured thread record.
 * @param {import('../thread-memory').ThreadMemoryRecord} ArgRecord Captured thread.
 * @param {string|null} ArgPermalink Slack thread permalink, when available.
 * @param {string} ArgReportedByName Display name of the user who filed the issue.
 * @returns {string}
 */
function BuildIssueBody(ArgRecord, ArgPermalink, ArgReportedByName) {
  const Lines = [
    '## Slack thread report',
    '',
    `**Workspace:** ${ArgRecord.WorkspaceName || ArgRecord.WorkspaceId}`,
    `**Channel:** #${ArgRecord.ChannelName || ArgRecord.ChannelId}`,
    `**Reported by:** ${ArgReportedByName}`,
    `**Captured at:** ${ArgRecord.CapturedAt}`,
    `**Messages:** ${ArgRecord.MessageCount}`,
  ];

  if(ArgPermalink) {
    Lines.push('');
    Lines.push(`[View Slack thread](${ArgPermalink})`);
  }

  if(ArgRecord.GitHubRefs.length > 0) {
    Lines.push('');
    Lines.push('**GitHub refs in thread:**');
    for(const Ref of ArgRecord.GitHubRefs)
      Lines.push(`- [${Ref.ref}](${Ref.url})`);
  }

  Lines.push('');
  Lines.push('## Transcript');
  Lines.push('');
  Lines.push('```');
  Lines.push(ArgRecord.RawText);
  Lines.push('```');
  Lines.push('');
  Lines.push('---');
  Lines.push('_Filed from Slack by Sleuth_');

  return Lines.join('\n');
}

/**
 * Resolve whether the command has prior thread context to capture. Slack only sets thread_ts on
 * thread replies — a channel-level @mention opens a thread in the UI after Sleuth replies, but still
 * lacks thread_ts and has no prior messages to capture.
 * @param {import('../slack-app')} ArgSlackApp
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo
 * @returns {Promise<{ threadRootTs: string, eventForCapture: import('../slack-app').AppMentionEventInfo }|null>}
 */
async function ResolveCaptureContextAsync(ArgSlackApp, ArgEventInfo) {
  const ThreadRootTs = ArgEventInfo.thread_ts || ArgEventInfo.ts;
  const Messages = await ArgSlackApp.GetConversationMessagesAsync(ArgEventInfo.channel, ThreadRootTs);
  const HasPriorMessages = Messages.some(ArgMessage => ArgMessage.ts !== ArgEventInfo.ts);
  if(!HasPriorMessages) return null;

  const EventForCapture = ArgEventInfo.thread_ts
    ? ArgEventInfo
    : { ...ArgEventInfo, thread_ts: ThreadRootTs };

  return { threadRootTs: ThreadRootTs, eventForCapture: EventForCapture };
}

/**
 * Handle `@Sleuth AI send to github` — capture the current Slack thread and file a GitHub issue on
 * the configured issue repo (SLEUTH_ISSUE_REPO) with the transcript as evidence.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} [ArgTitleText] Optional issue title from inline text after the command.
 * @returns {Promise<void>}
 */
async function HandleSendToGithubCommandAsync(ArgSlackApp, ArgEventInfo, ArgTitleText) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can send to github.'
    );
    return;
  }

  try {
    const CaptureContext = await ResolveCaptureContextAsync(ArgSlackApp, ArgEventInfo);
    if(!CaptureContext) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "Reply in thread to the conversation you want to capture, then run `send to github` from that thread reply. A channel-level @mention has no prior messages to file."
      );
      return;
    }

    const Record = await CaptureThreadAsync(ArgSlackApp, CaptureContext.eventForCapture, {
      excludeMessageTs: ArgEventInfo.ts,
    });
    const Permalink = await ArgSlackApp.GetPermaLinkAsync(ArgEventInfo.channel, CaptureContext.threadRootTs);
    const ReportedByName = (await ArgSlackApp.GetUserDisplayNameAsync(ArgEventInfo.user))
      || ArgEventInfo.user
      || 'Unknown';

    const Title = ArgTitleText?.trim()
      || `Slack report — #${Record.ChannelName || ArgEventInfo.channel} — ${new Date().toISOString().slice(0, 10)}`;
    const Body = BuildIssueBody(Record, Permalink, ReportedByName);

    const Result = await FileGithubIssueAsync(ArgSlackApp.WorkspaceInfo, Title, Body, {
      Repo: ISSUE_REPO,
    });

    if(Result.ok) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `Filed GitHub issue #${Result.number}: ${Result.htmlUrl}`
      );
      return;
    }

    if(Result.reason === 'no-pat') {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'cannot file a GitHub issue: `GITHUB_PAT` is not configured for this workspace.'
      );
      return;
    }

    if(Result.reason === 'forbidden') {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "couldn't file the GitHub issue: `GITHUB_PAT` lacks permission (filing issues requires `issues:write` scope)."
      );
      return;
    }

    if(Result.reason === 'github-error') {
      ArgSlackApp.Logger.warn(`[send-to-github] GitHub API returned ${Result.status} for ${Result.apiUrl}`);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `couldn't file the GitHub issue (GitHub returned ${Result.status}). Check the logs.`
      );
      return;
    }

    ArgSlackApp.Logger.error('[send-to-github] failed:', Result.error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Sorry — couldn't file the GitHub issue. Check the logs."
    );
  } catch(error) {
    ArgSlackApp.Logger.error('[send-to-github] failed:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Sorry — couldn't file the GitHub issue. Check the logs."
    );
  }
}

module.exports = HandleSendToGithubCommandAsync;
module.exports.BuildIssueBody = BuildIssueBody;
module.exports.ISSUE_REPO = ISSUE_REPO;
