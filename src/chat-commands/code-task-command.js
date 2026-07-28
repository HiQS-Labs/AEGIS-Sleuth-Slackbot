'use strict';

// `code-task` admin command: relay a freeform code-change request from Slack to Claude Code Cloud.
//
// Flow: admin gate → Claude synthesis (freeform → TaskSpec) → dispatch (write task file and/or
// open a labeled issue) → confirm in-thread. The cloud session opens a PR; the feedback poll in
// code-task-relay-module posts the session/PR link back into this thread when it lands.

const Synthesis = require('../code-task-synthesis');
const { ResolveCodeTaskConfig, DispatchCodeTaskAsync } = require('../code-task-relay-module');

const AuditTag = { Tag: 'code-task' };

/**
 * Strip the bot mention and the leading `code-task` keyword, returning the freeform request with
 * its original casing/formatting intact (the router matches on normalized text, but the synthesis
 * should see what the user actually wrote).
 * @param {import('../slack-app')} ArgSlackApp
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo
 * @returns {string}
 */
function ExtractRequestText(ArgSlackApp, ArgEventInfo) {
  const WithoutMention = (ArgEventInfo.text || '').replace(ArgSlackApp.AppMentionString, '').trim();
  return WithoutMention.replace(/^code-?task\b[:\s-]*/i, '').trim();
}

/**
 * Handle the `code-task` admin command.
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event info.
 * @param {{ WorkspaceAI: import('../workspace-ai') }} ArgDeps Dependencies.
 * @returns {Promise<void>}
 */
async function HandleCodeTaskCommandAsync(ArgSlackApp, ArgEventInfo, ArgDeps) {
  /** @param {string} ArgText */
  const Reply = (ArgText) => ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ArgText, undefined, AuditTag);

  // admin gate (same as run-tests).
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await Reply('sorry, only workspace admins or owners can dispatch code tasks to Claude Code Cloud.');
    return;
  }

  const RequestText = ExtractRequestText(ArgSlackApp, ArgEventInfo);
  if(!RequestText) {
    await Reply('what change should I dispatch? Try: `@Sleuth code-task add a retry to the GitHub sync fetch`.');
    return;
  }

  const Config = ResolveCodeTaskConfig(ArgSlackApp);
  if(!Config.enabled) {
    await Reply('the code-task relay is not enabled for this workspace (needs `CODE_TASK_RELAY_ENABLED` + a GitHub PAT). Ask an owner to enable it.');
    return;
  }

  await Reply(':hammer_and_wrench: Synthesizing your request into a task spec…');

  // ── Claude synthesis: freeform → structured TaskSpec ──
  let Spec;
  try {
    Spec = await Synthesis.SynthesizeTaskSpecAsync(ArgDeps.WorkspaceAI, RequestText, { defaultRepo: Config.defaultRepo });
  } catch(error) {
    ArgSlackApp.Logger.error('[code-task] synthesis failed:', error);
    await Reply('I could not synthesize that request into a task spec. Check the logs and try rephrasing.');
    return;
  }

  // ── Dispatch to the configured surface(s) ──
  let Result;
  try {
    Result = await DispatchCodeTaskAsync({
      githubClient: Config.githubClient,
      spec: Spec,
      origin: { channel: ArgEventInfo.channel, threadTs: ArgEventInfo.ts, user: ArgEventInfo.user },
      config: Config,
    });
  } catch(error) {
    ArgSlackApp.Logger.error('[code-task] dispatch failed:', error);
    await Reply(`I synthesized the task but could not dispatch it: ${error.message ?? error}`);
    return;
  }

  // ── Confirm ──
  const Lines = [
    `:white_check_mark: *Task dispatched to Claude Code Cloud* (mode: \`${Config.triggerMode}\`)`,
    `• *${Spec.title}*`,
    `• Target: \`${Spec.target_repo}\` → branch \`${Spec.target_branch}\` (PR only)`,
    `• Task id: \`${Result.taskId}\``,
  ];
  if(Result.fileUrl) Lines.push(`• Queued for desktop: ${Result.fileUrl}`);
  if(Result.issueUrl) Lines.push(`• GitHub issue: ${Result.issueUrl}`);
  if(typeof Spec.confidence === 'number') Lines.push(`• Synthesis confidence: ${Spec.confidence}`);
  if(Spec.open_questions.length) {
    Lines.push('• Open questions (cloud will use reasonable defaults):');
    for(const Question of Spec.open_questions) Lines.push(`   – ${Question}`);
  }
  Lines.push('_I\'ll post the cloud session and PR link here when it reports back._');

  await Reply(Lines.join('\n'));
}

module.exports = HandleCodeTaskCommandAsync;
module.exports.ExtractRequestText = ExtractRequestText;
