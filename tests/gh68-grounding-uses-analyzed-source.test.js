'use strict';

/**
 * GH-68 — the grounding guard must measure against what the ANALYZER saw.
 *
 * GH-55 prepends thread context so the model can resolve a pronominal reply. GH-43's grounding
 * guard then validated the resulting title against the *un-enriched reply only*, so every
 * antecedent-derived term counted as invented, the title was discarded, and the reminder fell back
 * to the verbatim sentence. Both features were individually correct and cancelled out exactly:
 * `enrichment=thread_context ... synthesis=on task_source=ai_synthesized_task_title` in telemetry,
 * verbatim text on screen, plus three `discarding an ungrounded reminder title` warnings.
 */

const ReminderDisplaySelection = require('../src/reminder-display-selection');

// The live reply — pronominal and self-insufficient, exactly as posted.
const LiveReply = 'can you do this by tomorrow morning?';

// What GH-55 actually hands the analyzer: the antecedent plus the reply.
const AnalyzedSource = [
  'multi message text extraction and synthesis work.',
  'Can you demo something that works to have the AI review all messages in a thread and then'
    + ' synthesize the reminder message to extract and transform an improved reminder instead of'
    + ' just the command text?',
  LiveReply,
].join('\n');

// A title the model can only write by reading the antecedent.
const Candidate = {
  reminder_message: 'Demo AI thread review that synthesizes an improved reminder',
  actionable_language: 'can you do this by tomorrow morning',
};

describe('GH-68: grounding source includes the analyzed thread context', () => {
  test('THE PIN — an antecedent-derived title survives when grounded against the analyzed source', () => {
    const Selection = ReminderDisplaySelection.SelectTaskText(
      Candidate, LiveReply, true, AnalyzedSource,
    );

    expect(Selection.ungroundedTerms).toEqual([]);
    expect(Selection.text).toBe(Candidate.reminder_message);
    expect(Selection.text).not.toBe(LiveReply);
  });

  test('NEGATIVE CONTROL — the same title IS discarded when only the reply is grounded on', () => {
    // This is the pre-fix behavior. If this ever passes, the widening has been reverted and the
    // first test would be proving nothing.
    const Selection = ReminderDisplaySelection.SelectTaskText(
      Candidate, LiveReply, true, /* no analyzed source */ '',
    );

    expect(Selection.ungroundedTerms.length).toBeGreaterThan(0);
    expect(Selection.text).not.toBe(Candidate.reminder_message);
  });

  test('the guard still rejects a title naming something in NEITHER the reply nor the context', () => {
    const Invented = {
      reminder_message: 'Migrate the Postgres cluster to Aurora before the audit',
      actionable_language: 'can you do this by tomorrow morning',
    };
    const Selection = ReminderDisplaySelection.SelectTaskText(
      Invented, LiveReply, true, AnalyzedSource,
    );

    // The whole point of GH-43 is preserved: widening the source must not disable the check.
    expect(Selection.ungroundedTerms.length).toBeGreaterThan(0);
    expect(Selection.text).not.toBe(Invented.reminder_message);
  });

  test('the verbatim path is untouched — synthesis off still shows the user wording', () => {
    const Selection = ReminderDisplaySelection.SelectTaskText(
      Candidate, LiveReply, false, AnalyzedSource,
    );
    expect(Selection.source).toBe('verbatim');
    expect(Selection.text).toBe(LiveReply);
  });

  test('EVERY render path must ground identically — the digest/triage agreement invariant', () => {
    // reminders-module.js:1721 states the scheduling digest and the :wrench: triage view "agree by
    // construction" because both funnel through the same selector. That only holds if both pass the
    // same grounding source. The first version of this fix threaded it into the scheduling render
    // and NOT into triage or either dedupe, so the two views disagreed — caught in adjudication
    // after a reviewer cleared it with "No missed call sites found".
    //
    // This asserts the property directly: given the same candidate and routing, a path that grounds
    // against the analyzed source must not render differently from another that does.
    const Digest = ReminderDisplaySelection.SelectTaskText(Candidate, LiveReply, true, AnalyzedSource);
    const Triage = ReminderDisplaySelection.SelectTaskText(Candidate, LiveReply, true, AnalyzedSource);
    expect(Triage.text).toBe(Digest.text);

    // And the failure mode it guards: one path omitting the source diverges from one that passes it.
    const Divergent = ReminderDisplaySelection.SelectTaskText(Candidate, LiveReply, true, '');
    expect(Divergent.text).not.toBe(Digest.text);
  });

  test('context line grounds against the analyzed source too', () => {
    // The guard only extracts entity-like terms (capitalized names, identifiers, numbers), so the
    // context must name one — "AI" — for this to exercise grounding at all. An all-lowercase
    // string yields no terms and passes trivially, which is not a test.
    const WithContext = { ...Candidate, context: 'AI reviews the whole thread first' };

    expect(
      ReminderDisplaySelection.SelectContextLine(WithContext, LiveReply, true, AnalyzedSource).suppressedBy
    ).not.toBe('ungrounded');
    expect(
      ReminderDisplaySelection.SelectContextLine(WithContext, LiveReply, true, '').suppressedBy
    ).toBe('ungrounded');
  });
});
