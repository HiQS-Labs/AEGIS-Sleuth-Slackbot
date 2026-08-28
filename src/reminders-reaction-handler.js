'use strict';

const ContextResolution = require('./reminder-context-resolution');

/**
 * Handles emoji reactions that drive user-initiated reminder lifecycle transitions.
 * Manages white_check_mark (complete), alarm_clock (schedule), and wastebasket (delete) reactions.
 */
class RemindersReactionHandler {
  /**
   * Slack app instance for logging and message operations.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Callback to get the current pending reminders queue.
   * @type {() => Array<any>}
   */
  #GetPendingReminders;

  /**
   * Callback to delete reminders from the queue.
   * @type {(ArgReminderIDs: string[], ArgReason?: string) => Promise<void>}
   */
  #DeleteRemindersAsync;

  /**
   * Callback to schedule reminders for a message. The trailing four arguments carry context
   * resolved by reminder-context-resolution.js (GH-143 Phase 2) — omitted, they default to the
   * un-enriched behavior this path had before.
   * @type {(ArgMessageText: string, ArgChannelID: string, ArgTimestamp: string, ArgUserID: string, ArgForceSchedule: boolean, ArgThreadTS?: string|null, ArgLiveReplyText?: string|null, ArgUsedEnrichedThreadContext?: boolean, ArgEnrichment?: {SourceTs: string|null, Path: string}|null) => Promise<boolean>}
   */
  #TryScheduleRemindersAsync;

  /**
   * Callback to transition a reminder to a new state.
   * @type {(ArgReminder: any, ArgNextState: string, ArgReason: string) => void}
   */
  #TransitionReminderState;

  /**
   * Callback to post a reminder triage diagnostic in-thread.
   * @type {(ArgChannelID: string, ArgTimestamp: string, ArgReactingUserID: string) => Promise<boolean>}
   */
  #PostReminderTriageAsync;

  /**
   * Callback to persist a false-positive training example when the user trashes a reminder.
   * Optional — when absent the wastebasket flow skips saving without error.
   * @type {((ArgExample: Object) => Promise<void>)|null}
   */
  #SaveTrashedExampleAsync;

  /**
   * Reminder state constants from RemindersModule.
   * @type {Object<string, string>}
   */
  #ReminderState;

  /**
   * Initialize the reaction handler with dependent modules and callbacks.
   * @param {import('./slack-app')} ArgSlackApp Slack app instance.
   * @param {Object} ArgDependencyBag Dependency bag with callbacks and references.
   * @param {() => Array<any>} ArgDependencyBag.GetPendingReminders Callback to get pending reminders queue.
   * @param {(ArgReminderIDs: string[], ArgReason?: string) => Promise<void>} ArgDependencyBag.DeleteRemindersAsync Callback to delete reminders; ArgReason ('completed'|'canceled'|'dead-letter') drives the Slack List fan-out.
   * @param {(ArgMessageText: string, ArgChannelID: string, ArgTimestamp: string, ArgUserID: string, ArgForceSchedule: boolean, ArgThreadTS?: string|null, ArgLiveReplyText?: string|null, ArgUsedEnrichedThreadContext?: boolean, ArgEnrichment?: {SourceTs: string|null, Path: string}|null) => Promise<boolean>} ArgDependencyBag.TryScheduleRemindersAsync Callback to schedule reminders (GH-143: the trailing four carry resolved context).
   * @param {(ArgChannelID: string, ArgTimestamp: string, ArgReactingUserID: string) => Promise<boolean>} [ArgDependencyBag.PostReminderTriageAsync] Callback to post reminder triage diagnostics.
   * @param {((ArgExample: Object) => Promise<void>)|null} [ArgDependencyBag.SaveTrashedExampleAsync] Callback to persist a false-positive training example.
   * @param {(ArgReminder: any, ArgNextState: string, ArgReason: string) => void} ArgDependencyBag.TransitionReminderState FSM state transition callback.
   * @param {Object<string, string>} ArgDependencyBag.ReminderState Reminder state constants.
   */
  constructor(ArgSlackApp, ArgDependencyBag) {
    this.#SlackApp = ArgSlackApp;
    this.#GetPendingReminders = ArgDependencyBag.GetPendingReminders;
    this.#DeleteRemindersAsync = ArgDependencyBag.DeleteRemindersAsync;
    this.#TryScheduleRemindersAsync = ArgDependencyBag.TryScheduleRemindersAsync;
    this.#TransitionReminderState = ArgDependencyBag.TransitionReminderState;
    this.#ReminderState = ArgDependencyBag.ReminderState;
    this.#PostReminderTriageAsync = ArgDependencyBag.PostReminderTriageAsync;
    this.#SaveTrashedExampleAsync = ArgDependencyBag.SaveTrashedExampleAsync || null;
  }

  /**
   * Handle reaction added event by dispatching to appropriate handler.
   * Signature matches OnSlackReactionAddedAsync — ArgSlackApp is accepted for contract
   * compatibility but this.#SlackApp is used internally.
   * @param {import('./slack-app')} _ArgSlackApp Slack app instance (unused — this.#SlackApp used instead).
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Event info.
   * @returns {Promise<boolean>} True if reaction was handled, false otherwise.
   */
  async OnReactionAddedAsync(_ArgSlackApp, ArgEventInfo) {
    // handle white check mark reactions.
    if(ArgEventInfo.reaction === 'white_check_mark')
      return await this.#HandleWhiteCheckMarkReactionAsync(ArgEventInfo);

    // handle alarm clock reactions.
    if(ArgEventInfo.reaction === 'alarm_clock')
      return await this.#HandleAlarmClockReactionAsync(ArgEventInfo);

    // handle wastebasket reactions.
    if(ArgEventInfo.reaction === 'wastebasket')
      return await this.#HandleWastebasketReactionAsync(ArgEventInfo);

    // handle wrench reactions.
    if(ArgEventInfo.reaction === 'wrench')
      return await this.#HandleWrenchReactionAsync(ArgEventInfo);

    // ignore other reactions.
    this.#SlackApp.Logger.info("RemindersReactionHandler ignoring reaction:", ArgEventInfo.reaction);
    return false;
  }

  /**
   * Handle white check mark reaction by completing associated reminders.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Event info.
   * @returns {Promise<boolean>}
   */
  async #HandleWhiteCheckMarkReactionAsync(ArgEventInfo) {
    // get metadata for the message that was reacted to.
    const MessageMetadata = await this.#SlackApp.GetMessageMetadataAsync(
      ArgEventInfo.item.channel, ArgEventInfo.item.ts
    );

    // check if this is a reminder message by verifying metadata exists and has expected type.
    if(!MessageMetadata || MessageMetadata.event_type !== 'sleuth-ai-reminder-ids') {
      this.#SlackApp.Logger.info("ignoring white check mark reaction since message is not a reminder message.");
      return false; // return false to indicate that the reaction wasn't handled.
    }

    // extract reminder IDs from metadata and convert back from JSON string.
    const ReminderIDs = /** @type {string[]}*/(
      JSON.parse(/** @type {string} */(
        MessageMetadata.event_payload['ReminderIDs']
      ))
    );
    this.#SlackApp.Logger.info("completing reminders:", ReminderIDs);

    // delete the reminders from the queue and indicate that the reaction was handled.
    // the 'completed' reason routes the Slack List fan-out through HandleReminderCompletedAsync,
    // which marks each row done (and keeps it on per-user lists as a history record).
    const PendingReminders = this.#GetPendingReminders();
    for(const ReminderID of ReminderIDs) {
      const ReminderToComplete = PendingReminders.find(ArgReminder => ArgReminder.ReminderID === ReminderID);
      if(ReminderToComplete)
        this.#TransitionReminderState(ReminderToComplete, this.#ReminderState.Completed, 'terminal: white_check_mark');
    }

    await this.#DeleteRemindersAsync(ReminderIDs, 'completed');
    return true;
  }

  /**
   * Handle alarm clock reaction by scheduling reminder for the message and return true on success.
   * NOTE: This handler intentionally bypasses the scheduler's snooze guard because the alarm_clock
   * reaction represents explicit user intent to schedule a reminder, regardless of snooze settings.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Event info.
   * @returns {Promise<boolean>}
   */
  async #HandleAlarmClockReactionAsync(ArgEventInfo) {
    // get the thread for the message that was reacted to.
    const ThreadMessages = await this.#SlackApp.GetConversationMessagesAsync(
      ArgEventInfo.item.channel, ArgEventInfo.item.ts
    );

    // find the original message - it should be the first one in the thread.
    const OriginalMessage = ThreadMessages[0];
    if(!OriginalMessage) {
      this.#SlackApp.Logger.error("could not find original message for alarm clock reaction.");
      return false; // return false to indicate that the reaction wasn't handled.
    }

    // GH-143 Phase 2: resolve earlier context through the SAME resolver every other entry path
    // uses. This path had none, which is how the reported case reached the queue verbatim and
    // wrongly owned: a reaction on "can do, I'll work on it today" carries the whole task in the
    // message it is replying to. This path's ADMISSION rule is the reaction itself — a human
    // placing :alarm_clock: has already asserted the message is a task — so there is nothing to
    // gate before the call.
    /** @type {import('./reminder-context-resolution').ResolvedContext} */
    let Context = {
      enriched: false, text: OriginalMessage.text, liveReplyText: OriginalMessage.text,
      enrichment: null, prependedCount: 0, decidedBy: 'reaction_resolution_disabled',
    };
    const ReactionContextEnabled = ContextResolution.IsReactionContextResolutionEnabled();
    if(ReactionContextEnabled) {
      Context = await ContextResolution.ResolveContextAsync(
        this.#SlackApp,
        {
          channel: ArgEventInfo.item.channel,
          ts: ArgEventInfo.item.ts,
          thread_ts: OriginalMessage.thread_ts ?? null,
          user: OriginalMessage.user,
          text: OriginalMessage.text,
        },
        { PathPrefix: 'alarm_clock_reaction' }
      );
    }
    this.#SlackApp.Logger.info(
      `reaction schedule: path=alarm_clock enrichment=${Context.decidedBy}` +
      ` prepended_messages=${Context.prependedCount} antecedent_ts=${Context.enrichment?.SourceTs || 'none'}`
    );

    // attempt to schedule reminders for the message.
    // NOTE: Snooze guard bypass: force scheduling if no scheduling triggers are found in the message.
    return await this.#TryScheduleRemindersAsync(
      Context.text, ArgEventInfo.item.channel, ArgEventInfo.item.ts, OriginalMessage.user,
      true, // force scheduling if no scheduling triggers are found in the message.
      // Gated with the kill switch: before GH-143 this path passed 5 arguments, so a thread_ts
      // passed here with the switch OFF would persist OriginalThreadTs on reaction-created
      // reminders and change downstream consumers. Off must mean byte-identical to before.
      ReactionContextEnabled ? (OriginalMessage.thread_ts ?? null) : null,
      Context.liveReplyText,
      Context.enriched,
      Context.enrichment
    );
  }

  /**
   * Handle wastebasket reaction by deleting associated reminders and feedback message then return true on success.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Event info.
   * @returns {Promise<boolean>}
   */
  async #HandleWastebasketReactionAsync(ArgEventInfo) {
    // get metadata for the message that was reacted to.
    const MessageMetadata = await this.#SlackApp.GetMessageMetadataAsync(
      ArgEventInfo.item.channel, ArgEventInfo.item.ts
    );

    // check if this is a reminder feedback message by verifying that the metadata exists and has the expected type.
    if(!MessageMetadata || MessageMetadata.event_type !== 'sleuth-ai-reminder-ids') {
      this.#SlackApp.Logger.info("ignoring wastebasket reaction since message is not a reminder feedback message.");
      return false; // return false to indicate that the reaction wasn't handled.
    }

    // extract reminder IDs from metadata and convert back from JSON string.
    const ReminderIDs = /** @type {string[]}*/(
      JSON.parse(/** @type {string} */(
        MessageMetadata.event_payload['ReminderIDs']
      ))
    );
    this.#SlackApp.Logger.info("deleting reminders:", ReminderIDs);

    // save a false-positive training example before the reminders are removed from the queue.
    const PendingReminders = this.#GetPendingReminders();
    if(this.#SaveTrashedExampleAsync)
      await this.#TrySaveTrashedExamplesAsync(ArgEventInfo, ReminderIDs, PendingReminders);
    for(const ReminderID of ReminderIDs) {
      const ReminderToCancel = PendingReminders.find(ArgReminder => ArgReminder.ReminderID === ReminderID);
      if(ReminderToCancel)
        this.#TransitionReminderState(ReminderToCancel, this.#ReminderState.Canceled, 'terminal: wastebasket');
    }

    await this.#DeleteRemindersAsync(ReminderIDs, 'canceled');

    // delete the feedback message to indicate success. NOTE: at this point we don't care if the feedback message
    // gets deleted successfully or not since the reminders have already been deleted and the user's intention has
    // been fulfilled (they can always delete the feedback message manually if it remains in the channel).
    await this.#SlackApp.DeleteMessageAsync(ArgEventInfo.item.channel, ArgEventInfo.item.ts);
    return true;
  }

  /**
   * Fetch the original triggering message and save a false-positive training example.
   * Wrapped in a top-level try/catch — a failure here must never block the wastebasket delete flow.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Event info.
   * @param {string[]} ArgReminderIDs IDs of the reminders being deleted.
   * @param {Array<any>} ArgPendingReminders Current snapshot of the pending reminders queue.
   * @returns {Promise<void>}
   */
  async #TrySaveTrashedExamplesAsync(ArgEventInfo, ArgReminderIDs, ArgPendingReminders) {
    try {
      const MatchedReminders = ArgReminderIDs
        .map(id => ArgPendingReminders.find(r => r.ReminderID === id))
        .filter(Boolean);

      if(MatchedReminders.length === 0) return;

      const First = MatchedReminders[0];
      const ChannelID = First.OriginalChannelID || ArgEventInfo.item.channel;
      // For thread replies OriginalThreadTs is the root; for top-level messages use OriginalMessageID.
      const ThreadRootTs = First.OriginalThreadTs || First.OriginalMessageID;

      let OriginalMessageText = null;
      try {
        const ThreadMessages = await this.#SlackApp.GetConversationMessagesAsync(ChannelID, ThreadRootTs);
        const TargetMessage = First.OriginalThreadTs
          ? ThreadMessages.find(m => m.ts === First.OriginalMessageID)
          : ThreadMessages[0];
        OriginalMessageText = TargetMessage?.text || null;
      } catch(FetchError) {
        this.#SlackApp.Logger.warn('trashed-example: could not fetch original message text:', FetchError);
      }

      const Example = {
        TrashedAt: new Date().toISOString(),
        OriginalMessageText,
        OriginalChannelID: ChannelID,
        OriginalMessageID: First.OriginalMessageID,
        OriginalSenderID: First.OriginalSenderID,
        TrashedByUserID: ArgEventInfo.user,
        ScheduledReminderText: MatchedReminders.map(r => r.ReminderMessageText).join('\n---\n'),
      };

      await this.#SaveTrashedExampleAsync(Example);
      this.#SlackApp.Logger.info('trashed-example: saved false-positive training example for message:', First.OriginalMessageID);
    } catch(error) {
      this.#SlackApp.Logger.warn('trashed-example: failed to save training example (non-fatal):', error);
    }
  }

  /**
   * Handle wrench reaction by posting reminder triage diagnostics in a child thread.
   * @param {import('./slack-app').ReactionAddedEventInfo} ArgEventInfo Event info.
   * @returns {Promise<boolean>}
   */
  async #HandleWrenchReactionAsync(ArgEventInfo) {
    if(!this.#PostReminderTriageAsync) {
      this.#SlackApp.Logger.warn('reminder triage requested but PostReminderTriageAsync is not configured.');
      return false;
    }

    return await this.#PostReminderTriageAsync(ArgEventInfo.item.channel, ArgEventInfo.item.ts, ArgEventInfo.user);
  }
}

module.exports = RemindersReactionHandler;
