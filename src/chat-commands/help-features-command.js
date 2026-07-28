const fs = require('fs').promises;
const path = require('path');
const {
  LoadCommandCatalogSync,
  BuildHelpMarkdownFromCatalog,
} = require('../command-catalog');

/**
 * @param {string} ArgText
 * @returns {string}
 */
function NormalizeHelpQueryText(ArgText) {
  return String(ArgText || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} ArgQueryText
 * @returns {boolean}
 */
function IsGenericSearchGuidanceQuery(ArgQueryText) {
  const NormalizedQuery = NormalizeHelpQueryText(ArgQueryText);
  if(!/\b(search|find|lookup|look up)\b/.test(NormalizedQuery)) return false;
  if(/\b(web|google|gemini|notion|reminder|reminders|task|tasks|todo|todos|channel|here|my)\b/.test(NormalizedQuery))
    return false;

  const ResidualQuery = NormalizedQuery
    .replace(/\b(help|features|search|find|lookup|look up|look|up|for|about|something|things|stuff|me)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return ResidualQuery.length === 0 || ResidualQuery.split(' ').length <= 1;
}

/**
 * @param {import('../slack-app')} ArgSlackApp
 * @param {string} [ArgRationale]
 * @returns {string[]}
 */
function BuildGenericSearchHelpLines(ArgSlackApp, ArgRationale = '') {
  const AppMentionString = ArgSlackApp.AppMentionString;
  /** @type {string[]} */
  const Lines = [
    '*Help Mode:* `search` can mean a few different Sleuth commands.',
    'Try one of these exact commands:',
    `- Web: \`${AppMentionString} web-search <topic>\``,
    `- Google / Gemini: \`${AppMentionString} gemini-search <topic>\``,
    `- Reminders: \`${AppMentionString} search reminders <keywords>\``,
    `- Notion: \`${AppMentionString} notion search <keywords>\``,
  ];
  if(ArgRationale) Lines.push(`_Why:_ ${ArgRationale}`);
  return Lines;
}

/**
 * Handle the `help` / `features` command — loads the generated HELP.md from the static data
 * directory and posts it to the channel. When extra text is supplied after `help`/`features`,
 * switch into suggestion-only intent-resolution mode so "help switch models" acts like a
 * safer, guidance-oriented `rmm`.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {{
 *   QueryText?: string,
 *   ResolveIntentAsync?: (ArgRequestText: string, ArgOptions?: Object) => Promise<import('../command-intent-resolver').RmmResolutionResult>,
 *   BuildChannelModelStatus?: (ArgChannelID: string) => { override: string|null, defaultModel: string, effectiveModel: string, lines: string[] }
 * }} [ArgOptions]
 * @returns {Promise<void>}
 */
async function HandleHelpFeaturesCommandAsync(ArgSlackApp, ArgEventInfo, ArgOptions = {}) {
  const QueryText = String(ArgOptions.QueryText || '').trim();
  if(QueryText.length > 0 && ArgOptions.ResolveIntentAsync && ArgOptions.BuildChannelModelStatus) {
    const ChannelModelStatus = ArgOptions.BuildChannelModelStatus(ArgEventInfo.channel);
    const Resolution = await ArgOptions.ResolveIntentAsync(QueryText, {
      ChannelID: ArgEventInfo.channel,
      ChannelModelStatus,
      RequestMode: 'suggest',
    });

    if(IsGenericSearchGuidanceQuery(QueryText)) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        BuildGenericSearchHelpLines(ArgSlackApp, Resolution.Rationale).join('\n')
      );
      return;
    }

    if(Resolution.NeedsClarification || (!Resolution.CanonicalCommand && !Resolution.SyntaxTemplate) || !Resolution.CatalogEntry) {
      const Lines = [
        '*Help Mode:* I need one clarification before I can point you at the right Sleuth command.',
        Resolution.ClarificationQuestion,
      ];
      if(Resolution.Rationale) Lines.push(`_Reason:_ ${Resolution.Rationale}`);
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
      return;
    }

    const PermissionLine = Resolution.CatalogEntry.Permission === 'admin'
      ? '_Requires workspace admin or owner access._'
      : '_Available to any workspace user._';

    // Discovery path: LLM picked an intent but the user did not supply the argument
    // (e.g. "help how do I change models?"). Show the syntax template with placeholders.
    if(!Resolution.CanonicalCommand && Resolution.SyntaxTemplate) {
      const TemplateCommand = `${ArgSlackApp.AppMentionString} ${Resolution.SyntaxTemplate}`;
      const Lines = [
        `*Best matching command:* \`${TemplateCommand}\``,
        PermissionLine,
        'Replace the bracketed placeholders with your values, then send the command.',
      ];
      if(Resolution.Rationale) Lines.push(`_Why:_ ${Resolution.Rationale}`);
      Lines.push(`_Confidence:_ ${Math.round(Resolution.Confidence * 100)}%`);
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
      return;
    }

    const ExactCommand = `${ArgSlackApp.AppMentionString} ${Resolution.CanonicalCommand}`;
    const Lines = [
      `*Best matching command:* \`${ExactCommand}\``,
      PermissionLine,
    ];
    if(Resolution.NormalizationNotes.length > 0)
      Lines.push(`_Normalized:_ ${Resolution.NormalizationNotes.join(', ')}`);
    if(Resolution.Rationale) Lines.push(`_Why:_ ${Resolution.Rationale}`);
    Lines.push(`_Confidence:_ ${Math.round(Resolution.Confidence * 100)}%`);

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
    return;
  }

  try {
    const TargetFilePath = path.join(__dirname, '..', '..', 'data', 'static', 'HELP.md');
    const FeaturesText = await fs.readFile(TargetFilePath, 'utf8');
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FeaturesText);
  } catch(error) {
    ArgSlackApp.Logger.error("error in OnHelpFeaturesCommandAsync:", error);
    try {
      const GeneratedHelpText = BuildHelpMarkdownFromCatalog(
        LoadCommandCatalogSync(),
        ArgSlackApp.AppMentionString
      );
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, GeneratedHelpText);
    } catch(fallbackError) {
      ArgSlackApp.Logger.error('error building fallback help text from command catalog:', fallbackError);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel, ArgEventInfo.ts, 'sorry, unable to load features documentation at this time.'
      );
    }
  }
}

module.exports = HandleHelpFeaturesCommandAsync;
