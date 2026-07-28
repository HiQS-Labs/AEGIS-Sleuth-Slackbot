'use strict';

const SlackFormatUtils = require('../slack-format-utils');
const { GetThreadMemoryDb, SearchThreadMemoriesAsync } = require('../thread-memory');

const SNIPPET_LENGTH = 150;

/**
 * Format a captured-at ISO timestamp as a short, scannable date (e.g. "Jun 3").
 * @param {string} ArgIso
 * @returns {string}
 */
function FormatShortDate(ArgIso) {
  const Date_ = new Date(ArgIso);
  if(Number.isNaN(Date_.getTime())) return ArgIso;
  return Date_.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Build a single result block for a recall hit.
 * @param {number} ArgIndex Zero-based hit index.
 * @param {import('../thread-memory').ThreadMemoryHit} ArgHit
 * @param {string} ArgChannelLabel Channel label, e.g. "#payments-team".
 * @param {string} ArgPermalink
 * @returns {string}
 */
function BuildResultBlock(ArgIndex, ArgHit, ArgChannelLabel, ArgPermalink) {
  const Lines = [`${ArgIndex + 1}. ${ArgChannelLabel} · <@${ArgHit.CapturedBy}> · ${FormatShortDate(ArgHit.CapturedAt)}`];
  if(ArgHit.GitHubRefs.length > 0)
    Lines.push(`   ${ArgHit.GitHubRefs.map(ArgRef => ArgRef.ref).join(', ')}`);
  const Snippet = ArgHit.RawText.slice(0, SNIPPET_LENGTH).replace(/\s+/g, ' ').trim();
  const Ellipsis = ArgHit.RawText.length > SNIPPET_LENGTH ? '…' : '';
  Lines.push(`   "${Snippet}${Ellipsis}"`);
  Lines.push(`   → ${ArgPermalink}`);
  return Lines.join('\n');
}

/**
 * Handle `@Sleuth recall <query>` — hybrid keyword + semantic search over this workspace's remembered
 * threads. Replies in-thread, under the invoking mention, with a single scannable message of ranked
 * results and Slack permalinks. Memories are isolated per workspace, so results never cross workspaces.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgQuery The user's recall query (with the `recall ` prefix stripped).
 * @returns {Promise<void>}
 */
async function HandleRecallCommandAsync(ArgSlackApp, ArgEventInfo, ArgQuery) {
  if(!process.env.GOOGLE_API_KEY) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Recall requires GOOGLE_API_KEY to be configured.'
    );
    return;
  }

  const Query = (ArgQuery || '').trim();
  if(!Query) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'What should I recall? Try: `@Sleuth recall checkout flow`'
    );
    return;
  }

  try {
    const Db = GetThreadMemoryDb();
    const Hits = await SearchThreadMemoriesAsync(Db, ArgSlackApp.TeamId || 'unknown', Query);

    if(Hits.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `No remembered threads match '${Query}'. Use 'remember above' at the end of a relevant thread.`
      );
      return;
    }

    const Blocks = [];
    for(let Index = 0; Index < Hits.length; Index++) {
      const Hit = Hits[Index];
      const ChannelName = await ArgSlackApp.GetChannelNameAsync(Hit.ChannelId);
      const ChannelLabel = ChannelName ? `#${ChannelName}` : Hit.ChannelId;
      const Permalink = await ArgSlackApp.GetPermaLinkAsync(Hit.ChannelId, Hit.ThreadTs);
      Blocks.push(BuildResultBlock(Index, Hit, ChannelLabel, Permalink));
    }

    const Header = `*Found ${Hits.length} thread${Hits.length === 1 ? '' : 's'} matching "${Query}"*`;
    const Message = SlackFormatUtils.NormalizeUserMentionsToMrkdwn(`${Header}\n\n${Blocks.join('\n\n')}`);

    // reply in-thread, under the invoking mention, so results don't clutter the main channel.
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Message);
  } catch(error) {
    ArgSlackApp.Logger.error('recall failed:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "Sorry — couldn't complete that recall. Check the logs."
    );
  }
}

module.exports = HandleRecallCommandAsync;
module.exports.BuildResultBlock = BuildResultBlock;
module.exports.FormatShortDate = FormatShortDate;
