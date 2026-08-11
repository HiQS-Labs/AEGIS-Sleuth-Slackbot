'use strict';

const fs = require('fs').promises;
const path = require('path');
const DateUtils = require('./date-utils');
const { DecideAsync } = require('./ai-decision');

// deduplication decision spec. Prompt assets and validation live with the shared decision helper;
// only the payload shaping below is dedup-specific.
const DedupDecisionSpec = Object.freeze({
  Name: 'reminder-dedup',
  InstructionsFile: 'reminders-dedup-instructions.md',
  SchemaFile: 'reminders-dedup-schema.json',
  RequiredFields: ['recommendation', 'rationale'],
});

/**
 * Validate a reminder-analysis response, throwing the exact messages this path has always thrown.
 *
 * GH-44 Phase 3: these three checks used to sit inline after the model call. They live in the spec's
 * `Validate` hook now so they run INSIDE `DecideAsync` — which keeps the messages byte-identical for
 * the tests that assert them (`tests/reminders-ai-pipeline.test.js:48/59/71`) while letting the
 * decision corpus classify the record `invalid` instead of recording a false `ok`.
 *
 * `RequiredFields` is deliberately EMPTY for this spec: a populated list makes `HasRequiredFields`
 * fail first and throw `DecideAsync`'s generic "Invalid reminder-analysis response…", which would
 * take those three tests red. It also cannot express the type half of these checks — it treats
 * `recommendation: 123` as present. (Caught by agy in the GH-44 plan relay, round 1.)
 * @param {any} ArgResponse Parsed model response.
 * @returns {void}
 */
function ValidateReminderAnalysis(ArgResponse) {
  if(!('recommendation' in ArgResponse) || (typeof ArgResponse.recommendation !== 'string'))
    throw new Error('GPT response is missing recommendation property or it is not a string.');

  if(!('rationale' in ArgResponse) || (typeof ArgResponse.rationale !== 'string'))
    throw new Error('GPT response is missing rationale property or it is not a string.');

  if(!('reminders' in ArgResponse) || !Array.isArray(ArgResponse.reminders))
    throw new Error('GPT response is missing reminders property or it is not an array.');
}

/**
 * Single-message reminder analysis decision. Same prompt, schema, and (default) model as before the
 * GH-44 migration — only the plumbing moved.
 */
const MultiTaskExtractionDecisionSpec = Object.freeze({
  Name: 'multi-task-extraction',
  InstructionsFile: 'multi-task-extraction-instructions.md',
  SchemaFile: 'multi-task-extraction-schema.json',
  // presence-only; the array/shape check below is the real gate, same as it was pre-migration.
  RequiredFields: [],
  // this path has always used the complex model — the reason AiDecisionSpec grew ModelName.
  ModelName: null, // set per-call in ExtractMultiTaskCandidatesAsync (see WithComplexModel below)
  PromptVersion: 'multi-task-v1',
  SchemaVersion: 'multi-task-schema-v1',
  /**
   * @param {any} ArgResponse
   * @returns {void}
   */
  Validate: (ArgResponse) => {
    if(!ArgResponse || !Array.isArray(ArgResponse.candidates))
      throw new Error('Multi-task extraction: invalid response from model.');
  },
  /**
   * @param {any} ArgInput Serialized prompt payload.
   * @param {any} ArgResponse Extraction result.
   * @returns {object}
   */
  DebugFacts: (ArgInput, ArgResponse) => {
    const Candidates = /** @type {any[]} */ (((ArgResponse && ArgResponse.candidates) || []));
    return {
      candidateCount: Candidates.length,
      highConfidence: Candidates.filter((/** @type {any} */ ArgC) => ArgC && ArgC.confidence === 'high').length,
      lowConfidence: Candidates.filter((/** @type {any} */ ArgC) => ArgC && ArgC.confidence === 'low').length,
      flagged: Candidates.filter((/** @type {any} */ ArgC) => ArgC && ArgC.flag).length,
      duplicatesOfOpenReminders: Candidates.filter((/** @type {any} */ ArgC) => ArgC && ArgC.duplicateOpenReminderID).length,
    };
  },
});

/**
 * The multi-task spec bound to a concrete model name. The model is a per-workspace runtime value, so
 * it cannot be frozen into the module-level spec; this returns a shallow clone carrying it.
 * @param {string} ArgModelName Model to pin (the workspace's complex model).
 * @returns {import('./ai-decision').AiDecisionSpec}
 */
function WithComplexModel(ArgModelName) {
  return { ...MultiTaskExtractionDecisionSpec, ModelName: ArgModelName };
}

const ReminderAnalysisDecisionSpec = Object.freeze({
  Name: 'reminder-analysis',
  InstructionsFile: 'reminders-instructions.md',
  SchemaFile: 'reminders-schema.json',
  RequiredFields: [],
  Validate: ValidateReminderAnalysis,
  PromptVersion: 'reminders-v1',
  SchemaVersion: 'reminders-schema-v1',
  /**
   * Facts a human needs to explain why this message rendered the reminder it did. These are the
   * GH-337 Phase 4 routing facts, which until now existed only in a server log line.
   * @param {any} ArgInput Original message text.
   * @param {any} ArgResponse Analysis result.
   * @returns {object}
   */
  DebugFacts: (ArgInput, ArgResponse) => {
    const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
      RemindersAIPipeline.NormalizeOriginalReminderText(typeof ArgInput === 'string' ? ArgInput : ''),
      (ArgResponse && ArgResponse.reminders) || [],
    );
    return {
      ...Routing,
      recommendation: (ArgResponse && ArgResponse.recommendation) || null,
      candidateCount: ((ArgResponse && ArgResponse.reminders) || []).length,
    };
  },
});

/**
 * Return a stable identity for the Slack thread that produced a reminder.
 * root messages have no OriginalThreadTs, so their own message ID is the thread identity.
 * @param {import('./reminders-module').ReminderInfo} ArgReminderInfo
 * @returns {string|null}
 */
function GetReminderThreadIdentity(ArgReminderInfo) {
  const OriginalThreadTs = ArgReminderInfo?.OriginalThreadTs;
  if(typeof OriginalThreadTs === 'string' && OriginalThreadTs.trim()) return OriginalThreadTs;

  const OriginalMessageID = ArgReminderInfo?.OriginalMessageID;
  if(typeof OriginalMessageID === 'string' && OriginalMessageID.trim()) return OriginalMessageID;

  return null;
}

// import typedefs from workspace-ai.js to avoid duplication.
/**
 * @typedef {import('./workspace-ai').ResponseSchema} ResponseSchema
 */

/**
 * Represents the components of a datetime and the rationale for how they were computed or extracted by the GPT.
 * @typedef {Object} GptDateExtractionResult
 * @property {number} year Extracted or computed year component of the date.
 * @property {number} month Extracted or computed month component of the date (1-based, i.e. January is 1).
 * @property {number} day Extracted or computed day component of the date.
 * @property {number} hour Extracted or computed hour component in 24-hour format.
 * @property {number} minute Extracted or computed minute component.
 * @property {number} second Extracted or computed second component.
 * @property {string} rationale Detailed explanation of how and why the extracted or computed values were arrived at.
 */

/**
 * Represents the result of extracting a date from a scheduling trigger using the GPT model.
 * @typedef {Object} DateExtractionResult
 * @property {boolean} success Was the date successfully extracted?
 * @property {Date|null} date Extracted date, or null if extraction failed.
 * @property {string} phrase Phrase that was used to extract the date.
 * @property {boolean} [wasAdjustedForward] True if the date was in the past and pushed forward.
 */

/**
 * Represents a multi-task extraction candidate from thread analysis.
 * @typedef {Object} MultiTaskCandidate
 * @property {number} taskIndex
 * @property {string} title
 * @property {number[]} sourceMessageNumbers
 * @property {string[]} sourceTs
 * @property {string|null} assigneeID
 * @property {string|null} deadline
 * @property {'explicit'|'convention'|'blank'} deadlineResolution
 * @property {'high'|'low'} confidence
 * @property {string|null} flag
 * @property {string|null} duplicateOpenReminderID
 */

/** @typedef {{ slackApps: any[], remindersModules: any[], workspaceAIs: any[] }} SleuthAskRemindersRegistry */

/**
 * Result of analyzing a thread into candidate tasks.
 * @typedef {Object} MultiTaskExtractionResult
 * @property {MultiTaskCandidate[]} candidates
 * @property {string} rationale
 */

/**
 * Information about a reminder extracted from a message by the GPT model.
 * @typedef {Object} GptReminderInfo
 * @property {string} actionable_language Verbatim quotation of the actionable language detected in the message.
 * @property {string} scheduling_trigger Verbatim quotation of the trigger associated with the actionable language.
 * @property {string} reminder_message Brief reminder of the actionable task that a user should perform.
 */

/**
 * Represents the response from the GPT model when analyzing a message for reminders.
 * @typedef {Object} GptReminderResponse
 * @property {'schedule' | 'ignore'} recommendation Indicates whether a reminder should be scheduled or ignored.
 * @property {string} rationale Explanation for the recommendation, used for debugging and informing users.
 * @property {GptReminderInfo[]} reminders Array of GptReminderInfo objects (empty if 'recommendation' is 'ignore').
 */

/**
 * Manual reminder task title synthesized for a force-scheduled reminder.
 * @typedef {Object} GptManualReminderTaskResponse
 * @property {string} rationale Explanation for the inferred task title.
 * @property {string} reminder_message Concise reminder task title.
 */

/**
 * Manages AI-powered reminder analysis, date extraction, and deduplication.
 * Owns all GPT interactions and instruction/schema loading for the reminder pipeline.
 */
class RemindersAIPipeline {
  // NOTE (GH-44 Phase 3): the reminder-analysis instructions/schema fields that used to live here
  // are gone. That path now goes through `ai-decision.js`, which owns its own cached asset loading
  // from the same two files — keeping a second copy here would have been exactly the duplication
  // this consolidation exists to remove. The remaining fields below still back un-migrated paths.

  /**
   * Date extraction instructions.
   * @type {string}
   */
  #DateExtractionInstructions;

  /**
   * Date extraction schema.
   * @type {ResponseSchema}
   */
  #DateExtractionSchema;

  /**
   * Manual reminder task extraction instructions.
   * @type {string}
   */
  #ManualReminderTaskInstructions;

  /**
   * Trashed-examples analysis instructions for the weekly false-positive report.
   * @type {string}
   */
  #TrashedExamplesInstructions;

  /**
   * Manual reminder task extraction schema.
   * @type {ResponseSchema}
   */
  #ManualReminderTaskSchema;

  /**
   * WorkspaceAI instance for GPT interactions.
   * @type {import('./workspace-ai')}
   */
  #WorkspaceAI;

  /**
   * SlackApp instance for logging and workspace info.
   * @type {import('./slack-app')}
   */
  #SlackApp;

  /**
   * Callback to get pending reminders for deduplication.
   * @type {Function}
   */
  #GetPendingReminders;

  /**
   * Decision-corpus capture config, or null for no capture (the default). GH-44.
   * @type {{Store: {append: Function}, Workspace: string, Mode?: string}|null}
   */
  #DecisionCapture = null;

  /**
   * Create a new RemindersAIPipeline instance.
   * @param {import('./workspace-ai')} ArgWorkspaceAI WorkspaceAI instance.
   * @param {import('./slack-app')} ArgSlackApp SlackApp instance.
   * @param {Function} ArgGetPendingReminders Callback that returns pending reminders array.
   */
  constructor(ArgWorkspaceAI, ArgSlackApp, ArgGetPendingReminders) {
    this.#WorkspaceAI = ArgWorkspaceAI;
    this.#SlackApp = ArgSlackApp;
    this.#GetPendingReminders = ArgGetPendingReminders;
  }

  /**
   * Enable (or with null, disable) decision-corpus capture for this pipeline's AI decisions.
   * Off by default: constructed pipelines capture nothing until an operator wires a store in, so
   * this is additive to every existing call site. GH-44.
   * @param {{Store: {append: Function}, Workspace: string, Mode?: string}|null} ArgCapture
   * @returns {void}
   */
  SetDecisionCapture(ArgCapture) {
    this.#DecisionCapture = ArgCapture || null;
  }

  /**
   * Load instructions and schema files from disk if not already loaded.
   * @returns {Promise<void>}
   */
  async LoadInstructionsAndSchemaAsync() {
    // build the base path dynamically (this assumes we are in the /src folder and are looking for the files in
    // the /data/static/ai folder, both of which are rooted in the project folder).
    const BasePath = path.join(__dirname, '..', 'data', 'static', 'ai');

    // (GH-44 Phase 3) reminders-instructions.md / reminders-schema.json are no longer read here —
    // ai-decision.js loads and caches them for the reminder-analysis decision.

    // load the manual reminder task extraction instructions if not already loaded.
    if(!this.#ManualReminderTaskInstructions) {
      const ManualReminderTaskInstructionsPath = path.join(BasePath, 'manual-reminder-task-instructions.md');
      this.#ManualReminderTaskInstructions = await fs.readFile(ManualReminderTaskInstructionsPath, 'utf8');
    }

    // load the manual reminder task extraction schema if not already loaded.
    if(!this.#ManualReminderTaskSchema) {
      const ManualReminderTaskSchemaPath = path.join(BasePath, 'manual-reminder-task-schema.json');
      const ManualReminderTaskSchemaContent = await fs.readFile(ManualReminderTaskSchemaPath, 'utf8');
      this.#ManualReminderTaskSchema = JSON.parse(ManualReminderTaskSchemaContent);
    }

    // deduplication assets are loaded and cached on demand by the shared ai-decision helper.

    // load the date extraction instructions if not already loaded.
    if(!this.#DateExtractionInstructions) {
      const DateExtractionInstructionsPath = path.join(BasePath, 'date-extraction-instructions.md');
      this.#DateExtractionInstructions = await fs.readFile(DateExtractionInstructionsPath, 'utf8');
    }

    // load the date extraction schema if not already loaded.
    if(!this.#DateExtractionSchema) {
      const DateExtractionSchemaPath = path.join(BasePath, 'date-extraction-schema.json');
      const DateExtractionSchemaContent = await fs.readFile(DateExtractionSchemaPath, 'utf8');
      this.#DateExtractionSchema = JSON.parse(DateExtractionSchemaContent);
    }

    // load the trashed-examples analysis instructions if not already loaded.
    if(!this.#TrashedExamplesInstructions) {
      const TrashedExamplesInstructionsPath = path.join(BasePath, 'trashed-examples-instructions.md');
      this.#TrashedExamplesInstructions = await fs.readFile(TrashedExamplesInstructionsPath, 'utf8');
    }
  }

  /**
   * Analyze a message for reminders using the OpenAI API.
   * @param {string} ArgMessageText Message text to analyze.
   * @returns {Promise<GptReminderResponse>}
   */
  async AnalyzeMessageForRemindersAsync(ArgMessageText) {
    // GH-44 Phase 3: routed through the shared decision chokepoint. Prompt assets, the model call,
    // and the three structural checks (now ValidateReminderAnalysis) all live behind DecideAsync, so
    // this path gets corpus capture for free while its errors stay byte-identical. No fallback is
    // configured — the caller has always owned this throw.
    const AnalysisResult = /** @type {GptReminderResponse} */(
      await DecideAsync(this.#WorkspaceAI, ReminderAnalysisDecisionSpec, ArgMessageText, {
        Capture: this.#DecisionCapture,
        Logger: this.#SlackApp && this.#SlackApp.Logger,
      })
    );

    // apply deterministic fallback for direct asks with explicit time terms if the model recommended ignore.
    if(AnalysisResult.recommendation === 'ignore') {
      const DeterministicFallback = this.#BuildDeterministicFallbackReminder(ArgMessageText);
      if(DeterministicFallback) {
        this.#SlackApp.Logger.info('deterministic reminder fallback activated for direct request with time trigger.');
        return DeterministicFallback;
      }
    }

    // return the analysis result.
    return AnalysisResult;
  }

  /**
   * Infer a concise task title for a manually force-scheduled reminder.
   * @param {string} ArgMessageText Original Slack message text.
   * @returns {Promise<string>}
   */
  async ExtractManualReminderTaskAsync(ArgMessageText) {
    await this.LoadInstructionsAndSchemaAsync();

    const TaskResult = /** @type {GptManualReminderTaskResponse} */(
      await this.#WorkspaceAI.ProcessMessageWithJsonResponseAsync(
        ArgMessageText, this.#ManualReminderTaskInstructions, this.#ManualReminderTaskSchema
      )
    );

    if(!TaskResult || typeof TaskResult !== 'object')
      throw new Error('GPT manual reminder task response is missing or invalid.');

    if(typeof TaskResult.rationale !== 'string')
      throw new Error('GPT manual reminder task response is missing rationale.');

    if(typeof TaskResult.reminder_message !== 'string')
      throw new Error('GPT manual reminder task response is missing reminder_message.');

    const ReminderMessage = TaskResult.reminder_message.trim();
    if(ReminderMessage.length === 0)
      throw new Error('GPT manual reminder task response returned an empty reminder_message.');

    this.#SlackApp.Logger.info('manual reminder task rationale:', TaskResult.rationale);
    return ReminderMessage;
  }

  /**
   * Sentence count at or above which a message is routed to the "Longer" synthesis segment
   * (Phase 2 of GH-337). Below it, the message is "Normal" length. Tuned from telemetry; see
   * the per-message structured log emitted alongside `task_source`.
   * @type {number}
   */
  static LONG_MESSAGE_SENTENCE_THRESHOLD = 4;

  /**
   * Parse an env flag into an explicit boolean tri-state. Returns true/false when the flag is set
   * to a recognized truthy/falsy token, or null when unset/blank so callers can apply a default.
   * @param {string} ArgEnvName Environment variable name.
   * @returns {boolean|null}
   */
  static #ReadFlagTriState(ArgEnvName) {
    const Raw = (process.env[ArgEnvName] || '').trim().toLowerCase();
    if(Raw === '') return null;
    if(Raw === 'on' || Raw === 'true' || Raw === '1' || Raw === 'yes' || Raw === 'enabled') return true;
    return false;
  }

  /**
   * Legacy master flag for AI "task title" synthesis. DEPRECATED in favor of the two length-aware
   * segment flags (`REMINDER_TEXT_SYNTHESIS_NORMAL` / `REMINDER_TEXT_SYNTHESIS_LONG`, see
   * {@link IsTaskSynthesisEnabledForText}). Retained only as an explicit override for existing
   * deployments: when `REMINDER_TEXT_SYNTHESIS` is set it forces BOTH segments on/off; when unset
   * the per-segment defaults apply. Returns null when unset so the override can be distinguished.
   * @returns {boolean|null}
   */
  static GetLegacyMasterSynthesisOverride() {
    return RemindersAIPipeline.#ReadFlagTriState('REMINDER_TEXT_SYNTHESIS');
  }

  /**
   * Whether synthesis is enabled for "Normal" (short) messages. Controlled by
   * `REMINDER_TEXT_SYNTHESIS_NORMAL`; default OFF — keep everyday tasks verbatim so short, already
   * clean messages are never rewritten by an LLM.
   * @returns {boolean}
   */
  static IsNormalTextSynthesisEnabled() {
    const Flag = RemindersAIPipeline.#ReadFlagTriState('REMINDER_TEXT_SYNTHESIS_NORMAL');
    return Flag === null ? false : Flag;
  }

  /**
   * Whether synthesis is enabled for "Longer" messages. Controlled by `REMINDER_TEXT_SYNTHESIS_LONG`;
   * default ON — collapse long FYI/status notes down to the buried actionable task instead of
   * dumping the whole message verbatim into the reminder bullet.
   * @returns {boolean}
   */
  static IsLongTextSynthesisEnabled() {
    const Flag = RemindersAIPipeline.#ReadFlagTriState('REMINDER_TEXT_SYNTHESIS_LONG');
    return Flag === null ? true : Flag;
  }

  /**
   * Count sentences in a message using terminal punctuation, with a floor of 1 for any non-empty
   * run-on text (so a long unpunctuated FYI still counts as content, not zero). Used to route a
   * message to the Normal vs Longer synthesis segment.
   * @param {string} ArgText Message text.
   * @returns {number}
   */
  static CountSentences(ArgText) {
    const Text = (ArgText || '').trim();
    if(!Text) return 0;
    const TerminalMatches = Text.match(/[.!?]+(?=\s|$)/g);
    return Math.max(TerminalMatches ? TerminalMatches.length : 0, 1);
  }

  /**
   * Decide whether the displayed reminder task should be SYNTHESIZED (analyzer brief) or kept
   * VERBATIM for a given original message, routing by sentence count to the Normal/Longer segment
   * (Phase 2 of GH-337). A set legacy master flag overrides both segments for back-compat.
   * Detection, date extraction, dedup, and triage are unaffected either way — only displayed text.
   * @param {string} ArgOriginalText Normalized original Slack message text.
   * @returns {boolean} True to synthesize, false to keep verbatim.
   */
  static IsTaskSynthesisEnabledForText(ArgOriginalText) {
    const MasterOverride = RemindersAIPipeline.GetLegacyMasterSynthesisOverride();
    if(MasterOverride !== null) return MasterOverride;

    const SentenceCount = RemindersAIPipeline.CountSentences(ArgOriginalText);
    return SentenceCount >= RemindersAIPipeline.LONG_MESSAGE_SENTENCE_THRESHOLD
      ? RemindersAIPipeline.IsLongTextSynthesisEnabled()
      : RemindersAIPipeline.IsNormalTextSynthesisEnabled();
  }

  /**
   * Structured synthesis-routing facts for a message, for telemetry and display-source logging
   * (Phase 4 of GH-337). No raw message text is included — only a length and a derived ratio.
   * @param {string} ArgOriginalText Normalized original Slack message text.
   * @param {GptReminderInfo[]} [ArgReminders] Reminder candidates, used for the actionable-span ratio.
   * @returns {{ sentenceCount: number, segment: 'normal'|'long', synthesisOn: boolean, messageLength: number, actionableSpanRatio: number }}
   */
  static DescribeSynthesisRouting(ArgOriginalText, ArgReminders = []) {
    const Original = (ArgOriginalText || '').trim();
    const SentenceCount = RemindersAIPipeline.CountSentences(Original);
    const Segment = SentenceCount >= RemindersAIPipeline.LONG_MESSAGE_SENTENCE_THRESHOLD ? 'long' : 'normal';

    // actionable-span ratio: longest quoted actionable span across candidates / message length.
    // Low ratio on a long message = a small buried task in a big note — the case synthesis targets.
    const LongestSpan = (ArgReminders || []).reduce((ArgMax, ArgReminder) => {
      const SpanLength = (ArgReminder?.actionable_language || '').trim().length;
      return SpanLength > ArgMax ? SpanLength : ArgMax;
    }, 0);
    const ActionableSpanRatio = Original.length > 0
      ? Math.min(1, Number((LongestSpan / Original.length).toFixed(2)))
      : 0;

    return {
      sentenceCount: SentenceCount,
      segment: Segment,
      synthesisOn: RemindersAIPipeline.IsTaskSynthesisEnabledForText(Original),
      messageLength: Original.length,
      actionableSpanRatio: ActionableSpanRatio,
    };
  }

  /**
   * Whether the AI "task title" synthesis is enabled at all under the current configuration.
   * DEPRECATED master view retained for the force-schedule LLM-call gate and any legacy callers:
   * true when the legacy master flag is on, or when EITHER length segment defaults/​resolves to on.
   * Prefer {@link IsTaskSynthesisEnabledForText} for per-message decisions.
   * @returns {boolean}
   */
  static IsTextSynthesisEnabled() {
    const MasterOverride = RemindersAIPipeline.GetLegacyMasterSynthesisOverride();
    if(MasterOverride !== null) return MasterOverride;
    return RemindersAIPipeline.IsNormalTextSynthesisEnabled() || RemindersAIPipeline.IsLongTextSynthesisEnabled();
  }

  /**
   * Normalize an original Slack message into a single-line task text: trim, strip leading/trailing
   * quote markers, and collapse all interior whitespace (including newlines) to single spaces. Used
   * as the displayed reminder text when synthesis is OFF, so the "Key task(s)" bullet stays one line
   * while the full multi-line original remains preserved verbatim in the reminder's blockquote.
   * @param {string} ArgText Original message text.
   * @returns {string}
   */
  static NormalizeOriginalReminderText(ArgText) {
    return (ArgText || '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Detect a direct ask paired with an explicit time trigger using a cheap regex heuristic.
   * Rejects negation/cancellation phrases so "please don't deploy today" returns null.
   * Shared by the deterministic fallback and the disabled-channel discovery hint reaction
   * so both paths use the same matcher (no AI calls).
   * @param {string} ArgMessageText Message text to scan.
   * @returns {{ trigger: string, actionableLanguage: string }|null}
   */
  static DetectDirectAskWithTimeTrigger(ArgMessageText) {
    const MessageText = (ArgMessageText || '').trim();
    if(!MessageText) return null;

    const HasDirectAsk = /\b(can you|could you|please|pls|kindly)\b/i.test(MessageText);
    const TriggerMatch = MessageText.match(/\b(this morning|today|tonight|tomorrow|by eod|eod)\b/i);
    if(!HasDirectAsk || !TriggerMatch) return null;

    // reject negation/cancellation intents — the model's `ignore` recommendation is correct for
    // phrases like "please don't deploy today", "pls cancel tomorrow's rollout", or bare
    // "can you not ship this morning".
    const HasNegation = /\b(don'?t|do not|not|never|cannot|can't|won'?t|will not|shouldn'?t|stop|cancel|hold off|skip|ignore|no need|nevermind|never mind)\b/i.test(MessageText);
    if(HasNegation) return null;

    return {
      trigger: TriggerMatch[1].toLowerCase(),
      actionableLanguage: MessageText.replace(/\?+$/, '').trim(),
    };
  }

  /**
   * Build deterministic fallback reminder for direct requests that include time triggers.
   * @param {string} ArgMessageText Original message text.
   * @returns {GptReminderResponse|null}
   */
  #BuildDeterministicFallbackReminder(ArgMessageText) {
    const Detection = RemindersAIPipeline.DetectDirectAskWithTimeTrigger(ArgMessageText);
    if(!Detection) return null;

    return {
      recommendation: 'schedule',
      rationale: 'Deterministic fallback: direct request with explicit time trigger should be scheduled.',
      reminders: [{
        actionable_language: Detection.actionableLanguage,
        scheduling_trigger: Detection.trigger,
        reminder_message: Detection.actionableLanguage,
      }]
    };
  }

  /**
   * Build structured triage diagnostics for reminder analysis and date extraction.
   *
   * GH-44 Phase 5: also returns the decision's `debugFacts` — the same bag the corpus records —
   * so the `:wrench:` view can explain WHY the output looks the way it does (which synthesis segment
   * the message routed to, and whether synthesis was on) rather than only WHAT was decided. Sourced
   * from the spec's own extractor, so this stays correct if the facts change.
   * @param {string} ArgMessageText Message to triage.
   * @returns {Promise<{analysis: GptReminderResponse, dateExtractions: DateExtractionResult[], debugFacts: object|null}>}
   */
  async GetReminderTriageAsync(ArgMessageText) {
    const AnalysisResult = await this.AnalyzeMessageForRemindersAsync(ArgMessageText);
    const DateExtractions = [];

    for(const CurrentReminder of AnalysisResult.reminders) {
      const DateExtraction = await this.ExtractDateWithGptAsync(CurrentReminder.scheduling_trigger);
      DateExtractions.push(DateExtraction);
    }

    // best effort: a debug-fact bug must never break the triage view it was meant to illuminate.
    let DebugFacts = null;
    try {
      DebugFacts = ReminderAnalysisDecisionSpec.DebugFacts(ArgMessageText, AnalysisResult);
    } catch(error) {
      DebugFacts = null;
    }

    return {
      analysis: AnalysisResult,
      dateExtractions: DateExtractions,
      debugFacts: DebugFacts,
    };
  }

  /**
   * Extract a date using the OpenAI API from the given scheduling trigger.
   * @param {string} ArgSchedulingTrigger Scheduling trigger extracted by the AnalyzeMessageForRemindersAsync method.
   * @returns {Promise<DateExtractionResult>}
   */
  async ExtractDateWithGptAsync(ArgSchedulingTrigger) {
    // ensure AI system instructions and schema are loaded.
    await this.LoadInstructionsAndSchemaAsync();

    // get and save the current time in UTC to compare against the extracted date later. NOTE: we do this early and save
    // the value so that if we are debugging and stepping through the code, time is essentially frozen at this point and
    // extraction won't fail due to the extracted date being in the past by the time we reach the end of this function.
    const CurrentUtcDate = new Date();

    // get the current date in the main time zone to use as the BASE DATE for extraction.
    const LocalizedBaseDate = DateUtils.GetLocalizedUtcDate(this.#SlackApp.WorkspaceInfo.MAIN_TIMEZONE, CurrentUtcDate);

    // get the time zone offset in minutes for the main time zone. This is used to adjust the extracted date to UTC and
    // is passed to the GPT model as part of the input text to ensure the model can also perform adjustments when dealing
    // with explicit time zones in the scheduling trigger (e.g. "tomorrow at 8:00 AM EST").
    const MainTimeZoneOffsetInMinutes = DateUtils.GetTimeZoneOffsetInMinutes(this.#SlackApp.WorkspaceInfo.MAIN_TIMEZONE);

    // compose the input text to be processed by the GPT model. NOTE: we remove the "GMT" suffix from the base date
    // since it has been localized to the main time zone and we don't want to confuse the GPT model with the time zone
    // suffix; in essence, the base date should be treated as a local time in the time zone given by BASE OFFSET.
    const InputText = [
      `BASE DATE: ${LocalizedBaseDate.toUTCString().replace(" GMT", "")}`,
      `BASE OFFSET: ${MainTimeZoneOffsetInMinutes}`,
      `INPUT PHRASE: ${ArgSchedulingTrigger}`
    ].join('\n');

    // send the input text to the GPT model for processing and wait for the response. NOTE: we use the complex model
    // here rather than the default model since the date extraction task is more complex and requires a larger model
    // to handle the additional complexity.
    const GptExtractionResult = /** @type {GptDateExtractionResult} */(
      await this.#WorkspaceAI.ProcessMessageWithJsonResponseAsync(
        InputText, this.#DateExtractionInstructions, this.#DateExtractionSchema, this.#WorkspaceAI.ComplexModelName
      )
    );

    // log rationale for date extraction to help with debugging.
    this.#SlackApp.Logger.info("date extraction rationale:", GptExtractionResult.rationale);

    // if the year component is 0, it means the GPT model could not extract a valid date so we return a failure result.
    if(GptExtractionResult.year === 0)
      return { success: false, date: null, phrase: "" };

    // construct a UTC date object from the extracted date components. NOTE: months are zero-based in JavaScript so we
    // subtract 1 from the month component to get the correct month value. We use Date.UTC() to ensure the date components
    // are interpreted as UTC values and not local time values.
    const ExtractedDate = new Date(Date.UTC(
      GptExtractionResult.year, GptExtractionResult.month - 1, GptExtractionResult.day,
      GptExtractionResult.hour, GptExtractionResult.minute, GptExtractionResult.second
    ));

    // convert the extracted date back to UTC to ensure consistency with the rest of the app. NOTE: we subtract the
    // time zone offset in minutes to get the correct UTC date; if the offset was ahead of UTC this shifts the date
    // back to UTC, and if the offset was behind UTC (i.e. negative) this shifts the date forward to UTC. The native
    // behaviour of the setUTCMinutes() method is quite handy here since it automatically adjusts the date if the
    // minutes value is out of range (e.g. setting minutes to -30 will adjust the date to the previous hour and set
    // the minutes to 30).
    ExtractedDate.setUTCMinutes(ExtractedDate.getUTCMinutes() - MainTimeZoneOffsetInMinutes);

    // apply random jitter (±45 min) when the trigger is a fuzzy time-of-day keyword with no specific clock time.
    // Strip "12 noon" first so its digit doesn't block jitter for that anchor phrase.
    // Explicit clock forms that DO block jitter: HH:MM, digit+AM/PM, military time, preposition+bare-hour,
    // or a keyword immediately followed by a bare hour (e.g. "morning 8", "tonight 9"). Calendar-only digits
    // like ordinals ("the 18th"), slash-dates ("6/20"), or month-day pairs are ignored by these patterns.
    const TriggerNoonFree = ArgSchedulingTrigger.replace(/\b12\s+noon\b/gi, 'noon');
    const HasExplicitClockTime = (
      /\d{1,2}:\d{2}/.test(TriggerNoonFree) ||
      /\d{1,2}(:\d{2})?\s*(am|pm)/i.test(TriggerNoonFree) ||
      /\b\d{3,4}\s*hrs?\b/i.test(TriggerNoonFree) ||
      /\b(at|by|before|until)\s+\d{1,2}\b/i.test(TriggerNoonFree) ||
      /\b(morning|afternoon|noon|evening|night|tonight|later tonight|late afternoon)\s+\d{1,2}\b/i.test(TriggerNoonFree)
    );
    if (!HasExplicitClockTime && /\b(morning|afternoon|noon|12 noon|evening|night|tonight|later tonight|late afternoon)\b/i.test(ArgSchedulingTrigger)) {
      ExtractedDate.setUTCMinutes(ExtractedDate.getUTCMinutes() + Math.floor(Math.random() * 91) - 45);
    }

    // when users explicitly say "this morning", favor immediate same-day handling over next-day rollover.
    const ShouldKeepSameDayWhenPast = /\bthis morning\b/i.test(ArgSchedulingTrigger);

    // check if the extracted date is in the past and needs to be pushed forward.
    let wasAdjustedForward = false;
    if(ExtractedDate.getTime() < CurrentUtcDate.getTime()) {
      if(ShouldKeepSameDayWhenPast) {
        ExtractedDate.setTime(CurrentUtcDate.getTime());
        this.#SlackApp.Logger.info(
          `date was in the past for "${ArgSchedulingTrigger}", keeping same-day intent and scheduling immediately.`
        );
      } else {
      // push it forward by 24 hours to schedule for tomorrow at the same time.
      // This handles cases like "12 noon today" posted at 2 PM - it will be scheduled for 12 noon tomorrow.
        ExtractedDate.setUTCDate(ExtractedDate.getUTCDate() + 1);
        wasAdjustedForward = true;
        this.#SlackApp.Logger.info(`date was in the past (${ArgSchedulingTrigger}), pushing forward to tomorrow: ${ExtractedDate.toUTCString()}`);
      }
    }

    // if the extracted date is due too soon (i.e. less than N seconds from now), we should push it out to N seconds
    // from now to avoid reminders being posted immediately. This check happens after the past date adjustment.
    const SecondsForTooSoon = 20;
    const FutureDateThatIsNotTooSoon = new Date(CurrentUtcDate.getTime() + (SecondsForTooSoon * 1000));
    if(ExtractedDate.getTime() < FutureDateThatIsNotTooSoon.getTime()) {
      ExtractedDate.setUTCSeconds(ExtractedDate.getUTCSeconds() + SecondsForTooSoon);
      this.#SlackApp.Logger.info(`date is too soon, pushing out by ${SecondsForTooSoon} seconds`);
    }

    // return the extracted date and the scheduling trigger used for extraction.
    return { success: true, date: ExtractedDate, phrase: ArgSchedulingTrigger, wasAdjustedForward };
  }

  /**
   * Check if a reminder is a duplicate of any existing reminders.
   * @param {import('./reminders-module').ReminderInfo} ArgReminderInfo Reminder to check.
   * @returns {Promise<{recommendation: 'schedule'|'ignore', rationale: string, matched_by: 'message_id'|'semantic'|null}>}
   */
  async CheckForDuplicateReminderAsync(ArgReminderInfo) {
    // ensure AI system instructions and schema are loaded.
    await this.LoadInstructionsAndSchemaAsync();

    // get the list of pending reminders other than the one being checked.
    const PendingReminders = this.#GetPendingReminders();
    const ExistingReminders = PendingReminders.filter(
      /** @param {import('./reminders-module').ReminderInfo} ArgExistingReminder */
      (ArgExistingReminder) => ArgExistingReminder.ReminderID !== ArgReminderInfo.ReminderID
    );

    // if there are no existing reminders that haven't been posted yet, we can schedule this one.
    if(ExistingReminders.length === 0) {
      return {
        recommendation: 'schedule',
        rationale: 'No existing reminders to check for duplication.',
        matched_by: null,
      };
    }

    // Fast check: is there already a reminder for this exact Slack message?
    const FoundDuplicateByMessageID = ExistingReminders.find(
      /** @param {import('./reminders-module').ReminderInfo} reminder */
      (reminder) => reminder.OriginalMessageID === ArgReminderInfo.OriginalMessageID
    );
    if (FoundDuplicateByMessageID) {
      return {
        recommendation: 'ignore',
        rationale: `Reminder with same OriginalMessageID (${ArgReminderInfo.OriginalMessageID}) already exists.`,
        matched_by: 'message_id',
      };
    }

    // a root message's own timestamp is its thread identity; a reply carries that root timestamp
    // in OriginalThreadTs. Only same-thread candidates need semantic comparison: this avoids an
    // extra AI call for unrelated reminders while closing the reply-timestamp bypass from GH-27.
    const NewReminderThreadIdentity = GetReminderThreadIdentity(ArgReminderInfo);
    const SameThreadReminders = NewReminderThreadIdentity
      ? ExistingReminders.filter(
        /** @param {import('./reminders-module').ReminderInfo} ArgExistingReminder */
        ArgExistingReminder => GetReminderThreadIdentity(ArgExistingReminder) === NewReminderThreadIdentity
      )
      : [];

    if(SameThreadReminders.length === 0) {
      return {
        recommendation: 'schedule',
        rationale: 'No duplicate reminder found in the same Slack thread.',
        matched_by: null,
      };
    }

    // compare only reminders from the same thread. A thread may contain more than one real task,
    // so the model still decides from the Key task(s) content whether this is a duplicate.
    const InputJson = JSON.stringify({
      dedup_context: { same_thread: true },
      existing_reminders: SameThreadReminders,
      new_reminder: ArgReminderInfo,
    }, null, 2);

    // send the reminders to the GPT model for deduplication analysis. No fallback is configured, so
    // an unusable response still throws to this caller exactly as it did before the helper existed.
    const DedupResult = /** @type {{recommendation: 'schedule'|'ignore', rationale: string}} */ (
      await DecideAsync(this.#WorkspaceAI, DedupDecisionSpec, InputJson, { Capture: this.#DecisionCapture })
    );

    // return the deduplication result.
    return { ...DedupResult, matched_by: 'semantic' };
  }

  /**
   * Analyze a whole thread into an ordered candidate-task list.
   * Uses the Complex model. Each candidate maps back to source message id(s),
   * carries a confidence level, and is never invented (verbatim-safe).
   * Low-confidence candidates are flagged, not dropped.
   * @param {Array<{ts: string, user: string, text: string}>} ArgThreadMessages Chronological thread messages (human only).
   * @param {string} ArgClientId Client ID for operator defaults lookup (may be null).
   * @param {Array<{ReminderID: string, ReminderMessageText: string}>} ArgOpenReminders Live open reminders for dedup flagging.
   * @param {Array<{reminderId: string, summary: string|null, assigneeID: string|null, completedMs: number}>} [ArgCompletedReminders] Recent completions for dedup context.
   * @returns {Promise<MultiTaskExtractionResult>}
   */
  async ExtractMultiTaskCandidatesAsync(ArgThreadMessages, ArgClientId, ArgOpenReminders, ArgCompletedReminders) {
    await this.LoadInstructionsAndSchemaAsync();

    const { GetClientDefaults } = require('./client-mapping');
    const Defaults = GetClientDefaults(ArgClientId);
    const DefaultAssigneeID = Defaults.DefaultAssigneeID || null;
    const DeadlineConvention = Defaults.DeadlineConvention || null;

    // Build a numbered transcript so the model can reference message IDs.
    const Transcript = ArgThreadMessages.map((ArgMsg, ArgIndex) => {
      return `[msg:${ArgIndex + 1} user:${ArgMsg.user} ts:${ArgMsg.ts}] ${ArgMsg.text}`;
    }).join('\n');

    const OpenRemindersSummary = (ArgOpenReminders || [])
      .slice(0, 50)
      .map(ArgR => `- [id:${ArgR.ReminderID}] ${ArgR.ReminderMessageText}`) // RENDER-OK: model-input only — open-reminder dedup context inside the extraction prompt, never posted to a user (GH-391)
      .join('\n');

    const DefaultsBlock = [
      DefaultAssigneeID ? `DefaultAssigneeID: ${DefaultAssigneeID}` : 'DefaultAssigneeID: (none)',
      DeadlineConvention ? `DeadlineConvention: ${DeadlineConvention}` : 'DeadlineConvention: (none)',
    ].join('\n');

    // GH-44 Phase 4: the system prompt and response schema moved to
    // data/static/ai/multi-task-extraction-{instructions.md,schema.json}, byte-identical to the
    // inline literals they replace. They were invisible to scripts/validate-ai-prompts.js while
    // inline, so this prompt had never been validated; it is registered in EXPECTED_PAIRS now.
    const InputText = `OPERATOR DEFAULTS:\n${DefaultsBlock}\n\nTHREAD TRANSCRIPT:\n${Transcript}\n\nOPEN REMINDERS (for dedup check):\n${OpenRemindersSummary || '(none)'}`;

    // The array-shape check that used to sit below the call is now the spec's Validate hook, so it
    // runs inside the chokepoint and throws the same message while the corpus records `invalid`.
    const Result = /** @type {MultiTaskExtractionResult} */ (
      await DecideAsync(
        this.#WorkspaceAI,
        WithComplexModel(this.#WorkspaceAI.ComplexModelName),
        InputText,
        { Capture: this.#DecisionCapture, Logger: this.#SlackApp && this.#SlackApp.Logger },
      )
    );

    // Apply default assignee to any candidate missing one.
    for(const Candidate of Result.candidates) {
      if(!Candidate.assigneeID && DefaultAssigneeID)
        Candidate.assigneeID = DefaultAssigneeID;
    }

    return Result;
  }

  /**
   * Analyze a batch of trashed-reminder examples and return a Slack-formatted pattern summary
   * with concrete rule suggestions for reminders-instructions.md.
   * Uses the complex model for higher-quality synthesis.
   * @param {Array<{OriginalMessageText: string|null, ScheduledReminderText: string}>} ArgExamples
   * @returns {Promise<string>} Slack-formatted analysis text.
   */
  async AnalyzeTrashedExamplesAsync(ArgExamples) {
    await this.LoadInstructionsAndSchemaAsync();

    const ExamplesText = ArgExamples.map((e, i) => {
      const MsgText = e.OriginalMessageText ? `"${e.OriginalMessageText}"` : '(original message unavailable)';
      return `Example ${i + 1}:\n- Original message: ${MsgText}\n- What was scheduled: ${e.ScheduledReminderText || '(unknown)'}`;
    }).join('\n\n');

    const InputText = `Here are ${ArgExamples.length} false-positive example${ArgExamples.length === 1 ? '' : 's'}:\n\n${ExamplesText}`;

    const Response = await this.#WorkspaceAI.ProcessMessageWithTextResponseAsync(
      InputText, this.#TrashedExamplesInstructions, this.#WorkspaceAI.ComplexModelName
    );

    if(!Response || !Response.trim())
      throw new Error('Empty response from LLM for trashed-examples analysis.');

    return Response.trim();
  }
}

module.exports = RemindersAIPipeline;
