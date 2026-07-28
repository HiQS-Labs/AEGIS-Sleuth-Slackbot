'use strict';

/**
 * Handle the `rmm` / `rmm ifl` command family. `rmm` suggests the closest exact Sleuth command;
 * `rmm ifl` executes only pre-authorized commands after the same intent-resolution pass.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgRequestText Natural-language request after the `rmm` prefix.
 * @param {boolean} ArgExecuteIfLucky Whether this is the `rmm ifl` execution mode.
 * @param {{
 *   ResolveIntentAsync: (ArgRequestText: string, ArgOptions?: Object) => Promise<import('../command-intent-resolver').RmmResolutionResult>,
 *   ExecuteCanonicalCommandAsync: (ArgCanonicalCommand: string) => Promise<boolean>,
 *   BuildChannelModelStatus: (ArgChannelID: string) => { override: string|null, defaultModel: string, effectiveModel: string, lines: string[] }
 * }} ArgDeps Helper callbacks injected from ChatModule.
 * @returns {Promise<void>}
 */
async function HandleRmmCommandAsync(
  ArgSlackApp,
  ArgEventInfo,
  ArgRequestText,
  ArgExecuteIfLucky,
  ArgDeps
) {
  const RequestText = String(ArgRequestText || '').trim();
  if(RequestText.length === 0) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Usage: `@Sleuth AI rmm <what you want>` or `@Sleuth AI rmm ifl <what you want>`.'
    );
    return;
  }

  const ChannelModelStatus = ArgDeps.BuildChannelModelStatus(ArgEventInfo.channel);
  const Resolution = await ArgDeps.ResolveIntentAsync(RequestText, {
    ChannelID: ArgEventInfo.channel,
    ChannelModelStatus,
    RequestMode: ArgExecuteIfLucky ? 'execute' : 'suggest',
  });

  if(Resolution.NeedsClarification || (!Resolution.CanonicalCommand && !Resolution.SyntaxTemplate) || !Resolution.CatalogEntry) {
    const Lines = [
      '*RMM:* I need one clarification before I can map that cleanly.',
      Resolution.ClarificationQuestion,
    ];
    if(Resolution.Rationale) Lines.push(`_Reason:_ ${Resolution.Rationale}`);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
    return;
  }

  const PermissionLine = Resolution.CatalogEntry.Permission === 'admin'
    ? '_Requires workspace admin or owner access._'
    : '_Available to any workspace user._';

  // Discovery path — LLM picked an intent but the user did not supply the argument
  // (e.g. "how do I change models?"). Show the syntax with placeholders rather than
  // demanding clarification or trying to execute. Always degrades `rmm ifl` to a
  // suggestion since there is no concrete command to run yet.
  if(!Resolution.CanonicalCommand && Resolution.SyntaxTemplate) {
    const TemplateCommand = `${ArgSlackApp.AppMentionString} ${Resolution.SyntaxTemplate}`;
    const Lines = [
      `*Closest command:* \`${TemplateCommand}\``,
      PermissionLine,
      'Replace the bracketed placeholders with your values, then send the command.',
    ];
    if(Resolution.Rationale) Lines.push(`_Why:_ ${Resolution.Rationale}`);
    Lines.push(`_Confidence:_ ${Math.round(Resolution.Confidence * 100)}%`);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
    return;
  }

  const ExactCommand = `${ArgSlackApp.AppMentionString} ${Resolution.CanonicalCommand}`;

  if(!ArgExecuteIfLucky) {
    const Lines = [
      `*Closest command:* \`${ExactCommand}\``,
      PermissionLine,
    ];
    if(Resolution.NormalizationNotes.length > 0)
      Lines.push(`_Normalized:_ ${Resolution.NormalizationNotes.join(', ')}`);
    if(Resolution.Rationale) Lines.push(`_Why:_ ${Resolution.Rationale}`);
    Lines.push(`_Confidence:_ ${Math.round(Resolution.Confidence * 100)}%`);
    if(Resolution.CatalogEntry.CanExecuteWithIfl)
      Lines.push(`To run it for you next time: \`${ArgSlackApp.AppMentionString} rmm ifl ${RequestText}\``);

    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
    return;
  }

  if(!Resolution.CatalogEntry.CanExecuteWithIfl) {
    const Lines = [
      `*Closest command:* \`${ExactCommand}\``,
      'I can suggest this command, but it is not pre-authorized for `rmm ifl` execution.',
    ];
    if(Resolution.Rationale) Lines.push(`_Why:_ ${Resolution.Rationale}`);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Lines.join('\n'));
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    `On it — running \`${ExactCommand}\``
  );

  const WasExecuted = await ArgDeps.ExecuteCanonicalCommandAsync(Resolution.CanonicalCommand);
  if(!WasExecuted) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `I resolved that to \`${ExactCommand}\`, but Sleuth could not execute it through the current command router.`
    );
  }
}

module.exports = HandleRmmCommandAsync;
