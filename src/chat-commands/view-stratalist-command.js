'use strict';

const {
  ResolveStratalistReferenceInfo,
  FetchStratalistPublicListAsync,
  RenderStratalistListForSlack,
} = require('../stratalist');

const UsageText = 'Usage: `@Sleuth AI view stratalist <list-slug-or-url>`';

/**
 * @param {import('../slack-app')} ArgSlackApp
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo
 * @param {string} ArgReferenceText
 * @param {{
 *   LoadPublicListAsync?: (ArgReferenceText: string) => Promise<import('../stratalist').StratalistFetchResult>,
 *   RenderListForSlack?: (ArgPayload: any, ArgOptions: { TimeZone: string, MaxItems?: number }) => string
 * }} [ArgOptions]
 * @returns {Promise<void>}
 */
async function HandleViewStratalistCommandAsync(ArgSlackApp, ArgEventInfo, ArgReferenceText, ArgOptions = {}) {
  const ReferenceText = String(ArgReferenceText || '').trim();
  if(!ReferenceText) {
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, UsageText);
    return;
  }

  try {
    ResolveStratalistReferenceInfo(ReferenceText);
  } catch(error) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `${UsageText}\n${error.message}`
    );
    return;
  }

  const LoadPublicListAsync = ArgOptions.LoadPublicListAsync || FetchStratalistPublicListAsync;
  const RenderListForSlack = ArgOptions.RenderListForSlack || RenderStratalistListForSlack;

  /** @type {import('../stratalist').StratalistFetchResult} */
  let FetchResult;
  try {
    FetchResult = await LoadPublicListAsync(ReferenceText);
  } catch(error) {
    ArgSlackApp.Logger.error('view stratalist: failed to load public list:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Unable to load that Stratalist list right now.'
    );
    return;
  }

  if(!FetchResult.ok) {
    const ErrorMessage = FetchResult.message || 'Unable to load that Stratalist list right now.';
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ErrorMessage);
    return;
  }

  try {
    const MessageText = RenderListForSlack(FetchResult.payload, {
      TimeZone: ArgSlackApp.WorkspaceInfo.MAIN_TIMEZONE,
    });
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, MessageText);
  } catch(error) {
    ArgSlackApp.Logger.error('view stratalist: failed to render payload:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Unable to render that Stratalist list because the payload was invalid.'
    );
  }
}

module.exports = HandleViewStratalistCommandAsync;
