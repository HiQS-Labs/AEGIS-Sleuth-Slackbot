'use strict';

const { SelectImageAttachment } = require('../context-file-classifier');

const UsageText = 'Usage: upload an image and say `@Sleuth AI scan image for text`.';

/**
 * Handle the `scan image for text` / `ocr image for text` command family (GH-64).
 *
 * Explicit counterpart to the natural-language OCR path. The extraction itself is delegated to
 * ChatModule's OCR runner so both routes share one implementation — this command exists to make
 * the capability addressable and discoverable (`rmm`, `help`, the commands list), not to add a
 * second extraction pipeline.
 *
 * Unlike the list route, this returns the extracted text only and creates nothing.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event payload.
 * @param {{
 *   ExtractTextFromImageAsync: (ArgSlackApp: any, ArgEventInfo: any) => Promise<{ ok: boolean, Title?: string, Items?: Array<{ item_number?: any, text: string, amount?: string|null, notes?: string|null }>, error?: string }>
 * }} ArgDeps Helper callbacks injected from ChatModule.
 * @returns {Promise<void>}
 */
async function HandleScanImageCommandAsync(ArgSlackApp, ArgEventInfo, ArgDeps) {
  const ReplyTS = ArgEventInfo.thread_ts ?? ArgEventInfo.ts;

  if(!SelectImageAttachment(ArgEventInfo.files)) {
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ReplyTS, UsageText);
    return;
  }

  const Result = await ArgDeps.ExtractTextFromImageAsync(ArgSlackApp, ArgEventInfo);
  if(!Result || !Result.ok) {
    // The extractor has already posted a specific message for every failure it knows about
    // (no image, download failure, provider not configured, zero items). Staying silent here
    // avoids a second, vaguer message contradicting it.
    return;
  }

  const Items = Array.isArray(Result.Items) ? Result.Items : [];
  if(Items.length === 0) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ReplyTS,
      "I didn't find any text in that image."
    );
    return;
  }

  const Lines = [];
  if(Result.Title) Lines.push(`*${Result.Title}*`);
  for(const Item of Items) {
    const Amount = Item.amount ? ` — ${Item.amount}` : '';
    Lines.push(`• ${Item.text}${Amount}`);
  }
  Lines.push('');
  Lines.push('_Say `convert text into slack list` if you want this as a Slack List._');

  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ReplyTS, Lines.join('\n'));
}

module.exports = HandleScanImageCommandAsync;
