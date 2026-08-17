'use strict';

const UsageText = 'Usage: `@Sleuth AI convert text into slack list` with the text in your message, '
  + 'or in the thread after uploading a file or scanning an image.';

/**
 * Handle the `convert text into slack list` command family (GH-64).
 *
 * Consumes text rather than an image, so it composes with `scan image for text`:
 *
 *   image --[scan]--> text --[convert]--> items --> Slack List
 *
 * Extraction reuses the same `ocr-list-extraction-schema.json` shape as the image route so both
 * converge on one item structure, and `ListsModule.CreateListFromExtractedItemsAsync` stays the
 * single materialization seam.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
 * @param {string} ArgSourceText Text supplied after the command, if any.
 * @param {{
 *   ExtractItemsFromTextAsync: (ArgText: string) => Promise<{ ok: boolean, Title?: string, Items?: Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }>, error?: string }>,
 *   MaterializeListAsync: (ArgSlackApp: any, ArgEventInfo: any, ArgTitle: string, ArgItems: any[]) => Promise<boolean>,
 *   LoadThreadContextTextAsync?: (ArgEventInfo: any) => Promise<string>
 * }} ArgDeps Helper callbacks injected from ChatModule.
 * @returns {Promise<void>}
 */
async function HandleConvertToListCommandAsync(ArgSlackApp, ArgEventInfo, ArgSourceText, ArgDeps) {
  const ReplyTS = ArgEventInfo.thread_ts ?? ArgEventInfo.ts;

  let SourceText = String(ArgSourceText || '').trim();

  // Fall back to thread context memory so "convert this into a list" works as a follow-up to an
  // earlier upload or scan, which is how the composed pipeline is actually used.
  if(!SourceText && typeof ArgDeps.LoadThreadContextTextAsync === 'function') {
    try {
      SourceText = String(await ArgDeps.LoadThreadContextTextAsync(ArgEventInfo) || '').trim();
    } catch(contextError) {
      ArgSlackApp.Logger.warn('[convert-to-list] could not load thread context:', contextError);
    }
  }

  if(!SourceText) {
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ReplyTS, UsageText);
    return;
  }

  let Extraction;
  try {
    Extraction = await ArgDeps.ExtractItemsFromTextAsync(SourceText);
  } catch(extractError) {
    ArgSlackApp.Logger.error('[convert-to-list] extraction failed:', extractError);
    // Distinguish a permanent provider misconfiguration from a transient failure, matching the
    // image route's behavior (GH-63) rather than telling the user to retry something that cannot
    // succeed.
    const IsConfigurationFailure = extractError
      && (extractError.code === 'vision_provider_not_configured' || extractError.code === 'provider_not_configured');
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ReplyTS,
      IsConfigurationFailure
        ? "Converting text into a list needs an AI model that isn't configured for this workspace. Ask a workspace admin to check the API keys."
        : 'I could not read that text into a list — please try again later.'
    );
    return;
  }

  const Items = (Extraction && Array.isArray(Extraction.Items)) ? Extraction.Items : [];
  if(!Extraction || !Extraction.ok || Items.length === 0) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ReplyTS,
      "I didn't find any list items in that text."
    );
    return;
  }

  await ArgDeps.MaterializeListAsync(
    ArgSlackApp,
    ArgEventInfo,
    Extraction.Title || 'Extracted List',
    Items
  );
}

module.exports = HandleConvertToListCommandAsync;
