
// import required modules.
const GitHubSyncModule = require('./github-sync-module');
const { ResolveMentionsForExternalDisplayAsync } = require('./slack-message-pipeline');
const { DecideAsync } = require('./ai-decision');

/**
 * @typedef {import('./slack-app')} SlackApp
 * @typedef {import('./slack-app').MessageEventInfo} MessageEventInfo
 * @typedef {import('./reminders-module').ReminderInfo} ReminderInfo
 */

// triggers used to stop relaying a thread to GitHub. Any thread reply containing
// one of these emojis or matching the text command is treated as a stop signal.
// Emoji codepoints are matched directly so the optional U+FE0F variation selector
// after `\u{23F9}` does not affect detection.
const STOP_RELAY_EMOJIS = Object.freeze([
  '\u{1F6D1}', // 🛑 stop sign.
  '\u{23F9}',  // ⏹ stop button (with or without FE0F variation selector).
]);
const STOP_RELAY_TEXT_PATTERN = /\bstop\s+relay\b/i;

// GH-37: reaction names that stop the relay when a human adds one. The relay already marks every
// relayed message with :octocat:, so the reaction a user is looking at is the one they click to stop
// it — no separate emoji to remember. `octocat` is a custom Slack emoji, so a workspace that lacks
// it simply never shows the affordance; `github` is accepted as the common alias.
const STOP_RELAY_REACTIONS = Object.freeze(['octocat', 'github']);

// GH-37: relevance decision spec for the relay gate. Being in the same thread is not evidence that
// a reply belongs on a linked issue, so each reply is scored against each linked task before it
// leaves Slack.
const RELAY_RELEVANCE_SPEC = Object.freeze({
  Name: 'github-relay-relevance',
  InstructionsFile: 'github-relay-relevance-instructions.md',
  SchemaFile: 'github-relay-relevance-schema.json',
  RequiredFields: ['decision', 'confidence', 'rationale'],
});

// a relay decision below this confidence is treated as a skip. Deliberately asymmetric: a wrong
// relay is a public GitHub comment a human deletes by hand, a wrong skip costs nothing because the
// message stays in Slack and still becomes its own reminder.
const RELAY_CONFIDENCE_THRESHOLD = 0.7;

// returned when the model errors or answers unusably, so an AI outage cannot post a wrong comment.
const RELAY_GATE_FALLBACK = Object.freeze({
  decision: 'skip',
  confidence: 0,
  rationale: 'relevance gate unavailable, defaulting to skip',
});

/**
 * Decide whether a Slack message should stop the GitHub relay for its thread.
 * @param {string} ArgMessageText Message text to inspect.
 * @returns {boolean}
 */
function ContainsStopRelayTrigger(ArgMessageText) {
  if(!ArgMessageText) return false;
  for(const Emoji of STOP_RELAY_EMOJIS)
    if(ArgMessageText.includes(Emoji)) return true;
  return STOP_RELAY_TEXT_PATTERN.test(ArgMessageText);
}

/**
 * Relays Slack thread messages to GitHub issue/PR comments for monitored reminders.
 */
class GitHubCommentRelay {
  /**
   * Slack app instance.
   * @type {SlackApp}
   */
  #SlackApp;

  /**
   * Getter for the pending reminders queue.
   * @type {() => ReminderInfo[]}
   */
  #GetPendingReminders;

  /**
   * Callback to persist the reminders queue after relay state changes.
   * @type {() => Promise<void>}
   */
  #SaveRemindersAsync;

  /**
   * Getter for the workspace AI client used by the relevance gate.
   * Resolved lazily: RemindersModule constructs this relay before it creates WorkspaceAI in
   * StartAsync, so capturing the instance at construction time would capture undefined.
   * @type {() => (import('./workspace-ai')|null)}
   */
  #GetWorkspaceAI;

  /**
   * Initialize a new GitHub comment relay.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {() => ReminderInfo[]} ArgGetPendingReminders Getter for pending reminders.
   * @param {() => Promise<void>} ArgSaveRemindersAsync Callback to persist reminders to disk.
   * @param {() => (import('./workspace-ai')|null)} [ArgGetWorkspaceAI] Getter for the workspace AI
   * client. Omitted in tests that never exercise the relevance gate.
   */
  constructor(ArgSlackApp, ArgGetPendingReminders, ArgSaveRemindersAsync, ArgGetWorkspaceAI) {
    if(typeof ArgSaveRemindersAsync !== 'function')
      throw new Error('[github-comment-relay] ArgSaveRemindersAsync callback is required');
    this.#SlackApp = ArgSlackApp;
    this.#GetPendingReminders = ArgGetPendingReminders;
    this.#SaveRemindersAsync = ArgSaveRemindersAsync;
    this.#GetWorkspaceAI = typeof ArgGetWorkspaceAI === 'function' ? ArgGetWorkspaceAI : () => null;
  }

  /**
   * Find the pending reminders in a thread that are linked to a GitHub issue or PR.
   *
   * OriginalThreadTs is the root thread ts, set when the original message was itself a thread reply.
   * Fall back to OriginalMessageID for top-level messages and legacy reminders without it.
   *
   * @param {string} ArgThreadTs Root thread timestamp.
   * @param {string} ArgChannelID Channel the thread lives in.
   * @returns {ReminderInfo[]}
   */
  #FindMonitoredReminders(ArgThreadTs, ArgChannelID) {
    return this.#GetPendingReminders().filter(ArgReminder =>
      (ArgReminder.OriginalThreadTs ?? ArgReminder.OriginalMessageID) === ArgThreadTs &&
      ArgReminder.OriginalChannelID === ArgChannelID &&
      Array.isArray(ArgReminder.GitHubUrls) &&
      ArgReminder.GitHubUrls.length > 0
    );
  }

  /**
   * Stop the GitHub relay for a thread and acknowledge it in Slack.
   *
   * Shared by both stop paths: the 🛑 / ⏹ / "stop relay" message trigger and the GH-37 reaction
   * trigger. Acknowledgement waits on a successful save so a user is only told the relay stopped
   * when that will survive a restart.
   *
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {ReminderInfo[]} ArgReminders Reminders in the thread to mark stopped.
   * @param {string} ArgChannelID Channel to acknowledge in.
   * @param {string} ArgAckMessageTS Message timestamp to acknowledge on.
   * @param {string} ArgThreadTs Root thread timestamp, for logging.
   * @returns {Promise<void>}
   */
  async #StopRelayAsync(ArgSlackApp, ArgReminders, ArgChannelID, ArgAckMessageTS, ArgThreadTs) {
    // mark all matching reminders as relay-stopped in memory.
    for(const StoppedReminder of ArgReminders)
      StoppedReminder.GitHubRelayStopped = true;

    // persist the stopped state; only acknowledge with a reaction when the save succeeds
    // so users know the stop will survive an app restart.
    let SaveSucceeded = false;
    try {
      await this.#SaveRemindersAsync();
      SaveSucceeded = true;
    } catch(error) {
      this.#SlackApp.Logger.error('[github-comment-relay] failed to save relay-stopped state:', error);
    }

    if(SaveSucceeded) {
      await ArgSlackApp.AddReactionAsync(ArgChannelID, ArgAckMessageTS, 'no_entry_sign');
      this.#SlackApp.Logger.info(
        `[github-comment-relay] relay stopped for thread ${ArgThreadTs} in channel ${ArgChannelID}`
      );
    }
  }

  /**
   * Handle a Slack reaction and stop the thread's GitHub relay when a user adds the relay emoji.
   *
   * GH-37: the relay already marks each relayed message with :octocat:, so clicking that same
   * reaction is the discoverable way to stop it — 🛑 / ⏹ still work and are unchanged.
   *
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Reaction event payload.
   * @returns {Promise<boolean>} Always false so downstream reaction handlers still run.
   */
  async OnReactionAddedAsync(ArgSlackApp, ArgEventInfo) {
    try {
      if(!STOP_RELAY_REACTIONS.includes(ArgEventInfo?.reaction)) return false;

      // the relay adds this very reaction itself after a successful post. Without this guard the
      // bot's own acknowledgement would immediately stop the relay it just started.
      if(!ArgEventInfo.user || ArgEventInfo.user === ArgSlackApp.BotUserID) return false;

      // check that the workspace has a GitHub PAT configured.
      if(!ArgSlackApp.WorkspaceInfo.GITHUB_PAT) return false;

      const ChannelID = ArgEventInfo.item?.channel;
      const MessageTS = ArgEventInfo.item?.ts;
      if(!ChannelID || !MessageTS) return false;

      // a reaction event carries no thread context, and item.ts is usually a reply rather than the
      // thread root the reminders are keyed on, so resolve the root before matching.
      const ThreadTs = await ArgSlackApp.GetMessageThreadTsAsync(ChannelID, MessageTS);
      if(!ThreadTs) return false;

      const MatchingReminders = this.#FindMonitoredReminders(ThreadTs, ChannelID);
      if(MatchingReminders.length === 0) return false;

      // already stopped — nothing to do, and no second acknowledgement.
      if(MatchingReminders.every(ArgR => ArgR.GitHubRelayStopped)) return false;

      await this.#StopRelayAsync(ArgSlackApp, MatchingReminders, ChannelID, MessageTS, ThreadTs);

    } catch(error) {
      this.#SlackApp.Logger.error('[github-comment-relay] unexpected error handling reaction:', error);
    }

    // never consume the reaction — the reminders module still needs to see it.
    return false;
  }

  /**
   * Select which linked reminders a follow-up message actually belongs to.
   *
   * GH-37: thread membership alone used to authorize the relay, so a brand-new task posted in a
   * thread was commented onto the earlier task's issue. Each reminder is scored independently, so a
   * reply is relayed only to the issues it is genuinely about rather than to every issue in the
   * thread.
   *
   * @param {ReminderInfo[]} ArgReminders Reminders in this thread that carry GitHub URLs.
   * @param {string} ArgMessageText Follow-up message text.
   * @returns {Promise<ReminderInfo[]>} Reminders whose linked issues should receive the comment.
   */
  async #SelectRelevantRemindersAsync(ArgReminders, ArgMessageText) {
    const WorkspaceAI = this.#GetWorkspaceAI();

    // no AI client means the gate cannot run. Fail closed rather than relaying unscored.
    if(!WorkspaceAI) {
      this.#SlackApp.Logger.warn(
        '[github-comment-relay] no workspace AI available for the relevance gate; skipping relay'
      );
      return [];
    }

    const Scored = await Promise.all(ArgReminders.map(async ArgReminder => {
      const Decision = await DecideAsync(
        WorkspaceAI,
        RELAY_RELEVANCE_SPEC,
        {
          linked_task: {
            task_text: ArgReminder.ReminderMessageText,
            github_urls: ArgReminder.GitHubUrls ?? [],
          },
          follow_up_message: ArgMessageText,
        },
        { Fallback: RELAY_GATE_FALLBACK, Logger: this.#SlackApp.Logger },
      );

      const Confidence = typeof Decision.confidence === 'number' ? Decision.confidence : 0;
      const ShouldRelay = Decision.decision === 'relay' && Confidence >= RELAY_CONFIDENCE_THRESHOLD;

      this.#SlackApp.Logger.info(
        `[github-comment-relay] relevance gate for reminder ${ArgReminder.ReminderID}: ` +
        `${ShouldRelay ? 'relay' : 'skip'} (decision=${Decision.decision}, ` +
        `confidence=${Confidence}) — ${Decision.rationale}`
      );

      return ShouldRelay ? ArgReminder : null;
    }));

    return /** @type {ReminderInfo[]} */ (Scored.filter(ArgEntry => ArgEntry !== null));
  }

  /**
   * Handle a Slack message event and relay thread replies to GitHub when applicable.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {MessageEventInfo} ArgEventInfo Message event payload.
   * @returns {Promise<boolean>} Always false so downstream handlers still run.
   */
  async OnMessageAsync(ArgSlackApp, ArgEventInfo) {
    try {
      // only process thread replies (thread_ts present and different from ts).
      if(!ArgEventInfo.thread_ts || ArgEventInfo.thread_ts === ArgEventInfo.ts) return false;

      // skip bot's own messages.
      if(!ArgEventInfo.user || ArgEventInfo.user === ArgSlackApp.BotUserID) return false;

      // check that the workspace has a GitHub PAT configured.
      const WorkspacePat = ArgSlackApp.WorkspaceInfo.GITHUB_PAT;
      if(!WorkspacePat) return false;

      const MatchingReminders = this.#FindMonitoredReminders(ArgEventInfo.thread_ts, ArgEventInfo.channel);

      if(MatchingReminders.length === 0) return false;

      // check if any matching reminder has already had its relay stopped.
      // all reminders sharing this thread share the same stop state — check the first one.
      if(MatchingReminders.some(ArgR => ArgR.GitHubRelayStopped)) return false;

      const MessageText = typeof ArgEventInfo.text === 'string' ? ArgEventInfo.text : '';

      // check whether this message contains a stop-relay trigger (🛑, ⏹, or "stop relay").
      if(ContainsStopRelayTrigger(MessageText)) {
        await this.#StopRelayAsync(
          ArgSlackApp, MatchingReminders, ArgEventInfo.channel, ArgEventInfo.ts, ArgEventInfo.thread_ts
        );
        return false;
      }

      // skip messages with no text (e.g. file-share-only, message_changed subtypes).
      if(!MessageText) return false;

      // GH-37: being in the thread is not enough — the reply must actually be about a linked task.
      const RelevantReminders = await this.#SelectRelevantRemindersAsync(MatchingReminders, MessageText);

      // nothing to relay. The message still falls through to RemindersModule below, which schedules
      // it as its own reminder when it is a new task.
      if(RelevantReminders.length === 0) {
        this.#SlackApp.Logger.info(
          `[github-comment-relay] no linked task matched this reply in thread ${ArgEventInfo.thread_ts}; not relaying`
        );
        return false;
      }

      // collect unique GitHub URLs across the reminders this reply is actually about.
      const UniqueUrls = [...new Set(RelevantReminders.flatMap(ArgR => ArgR.GitHubUrls ?? []))];

      // resolve the Slack user's display name. GH-432: fall back to a plain `@id` (not `<@id>`) on
      // lookup failure — this comment leaves Slack's rendering context, so the raw mrkdwn token
      // would show up verbatim to a GitHub reader instead of a resolved-or-fallback mention.
      const DisplayName = await ArgSlackApp.GetUserDisplayNameAsync(ArgEventInfo.user) || `@${ArgEventInfo.user}`;

      // determine whether this is the first relayed message for the reminders being relayed to.
      const IsFirstRelay = RelevantReminders.every(ArgR => !ArgR.GitHubRelayStarted);

      // fetch the Slack thread permalink when this is the first relay so GitHub readers can navigate back.
      let SlackThreadUrl = null;
      if(IsFirstRelay) {
        SlackThreadUrl = await ArgSlackApp.GetPermaLinkAsync(ArgEventInfo.channel, ArgEventInfo.thread_ts);
      }

      // GH-432: resolve raw `<@U...>` mentions in the message body before it leaves Slack — Slack's
      // own client resolves them, a GitHub comment does not (same class of bug as GH-428).
      const ResolvedMessageText = await ResolveMentionsForExternalDisplayAsync(ArgSlackApp, MessageText);

      // build the GitHub comment body.
      const CommentBody = this.#BuildCommentBody(DisplayName, ResolvedMessageText, SlackThreadUrl);

      // post the comment to each GitHub issue/PR.
      let SuccessCount = 0;
      for(const Url of UniqueUrls) {
        const Posted = await this.#PostGitHubCommentAsync(Url, CommentBody, WorkspacePat);
        if(Posted) SuccessCount++;
      }

      if(SuccessCount > 0) {
        // add a reaction to the Slack message to confirm relay.
        await ArgSlackApp.AddReactionAsync(ArgEventInfo.channel, ArgEventInfo.ts, 'octocat');

        // mark the relayed-to reminders as relay-started after the first successful post.
        if(IsFirstRelay) {
          for(const StartedReminder of RelevantReminders)
            StartedReminder.GitHubRelayStarted = true;

          try {
            await this.#SaveRemindersAsync();
          } catch(error) {
            this.#SlackApp.Logger.error('[github-comment-relay] failed to save relay-started state:', error);
          }
        }
      }

    } catch(error) {
      this.#SlackApp.Logger.error('[github-comment-relay] unexpected error:', error);
    }

    // never consume the message — let downstream handlers process it too.
    return false;
  }

  /**
   * Build a formatted GitHub comment body. `ArgMessageText` must already be resolved via
   * `ResolveMentionsForExternalDisplayAsync` (GH-432) — this just lays out the quote block, it does
   * not touch mention markup.
   * @param {string} ArgDisplayName Slack user display name.
   * @param {string} ArgMessageText Original Slack message text, mentions already resolved.
   * @param {string|null} ArgSlackThreadUrl Slack thread permalink to include on first relay (null to omit).
   * @returns {string}
   */
  #BuildCommentBody(ArgDisplayName, ArgMessageText, ArgSlackThreadUrl) {
    const Lines = [
      `**${ArgDisplayName}** (via Slack):`,
      '',
      `> ${ArgMessageText.replace(/\n/g, '\n> ')}`,
    ];

    if(ArgSlackThreadUrl) {
      Lines.push('');
      Lines.push(`[View Slack thread](${ArgSlackThreadUrl})`);
    }

    Lines.push('');
    Lines.push('---');
    Lines.push('_Relayed from Slack by Sleuth_');

    return Lines.join('\n');
  }

  /**
   * Post a comment to a GitHub issue or pull request.
   * @param {string} ArgGitHubUrl GitHub issue or PR URL.
   * @param {string} ArgCommentBody Comment body text (Markdown).
   * @param {string} ArgWorkspacePat GitHub personal access token.
   * @returns {Promise<boolean>} True if the comment was posted successfully.
   */
  async #PostGitHubCommentAsync(ArgGitHubUrl, ArgCommentBody, ArgWorkspacePat) {
    const ParsedUrl = GitHubSyncModule.ParseGitHubUrl(ArgGitHubUrl);
    if(!ParsedUrl) {
      this.#SlackApp.Logger.warn(`[github-comment-relay] could not parse GitHub URL: ${ArgGitHubUrl}`);
      return false;
    }

    // both issues and PRs use the issues comment endpoint.
    const ApiUrl = `https://api.github.com/repos/${ParsedUrl.owner}/${ParsedUrl.repo}/issues/${ParsedUrl.number}/comments`;

    try {
      const Response = await fetch(ApiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ArgWorkspacePat}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body: ArgCommentBody }),
      });

      if(Response.status === 201) {
        this.#SlackApp.Logger.info(`[github-comment-relay] comment posted to ${ArgGitHubUrl}`);
        return true;
      }

      this.#SlackApp.Logger.warn(`[github-comment-relay] GitHub API returned ${Response.status} for ${ApiUrl}`);
      return false;
    } catch(/** @type {any} */ error) {
      this.#SlackApp.Logger.warn(`[github-comment-relay] network error posting to ${ApiUrl}:`, error);
      return false;
    }
  }
}

// export the class.
module.exports = GitHubCommentRelay;
