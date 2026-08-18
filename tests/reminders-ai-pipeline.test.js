const fs = require('fs');
const path = require('path');
const RemindersAIPipeline = require('../src/reminders-ai-pipeline');
const DateUtils = require('../src/date-utils');
const { MockSlackApp } = require('./mocks/mock-slack-app');

describe('RemindersAIPipeline', () => {
  let Pipeline;
  let MockWorkspaceAI;
  let SlackApp;
  let GetPendingRemindersMock;

  beforeEach(() => {
    SlackApp = new MockSlackApp();
    GetPendingRemindersMock = jest.fn(() => []);
    
    // Mock WorkspaceAI
    MockWorkspaceAI = {
      ProcessMessageWithJsonResponseAsync: jest.fn(),
      ComplexModelName: 'gpt-4o'
    };

    Pipeline = new RemindersAIPipeline(MockWorkspaceAI, SlackApp, GetPendingRemindersMock);
  });

  describe('AnalyzeMessageForRemindersAsync', () => {
    it('should analyze a message and return GPT response', async () => {
      const MockResponse = {
        recommendation: 'schedule',
        rationale: 'This is a task',
        reminders: [{ trigger: 'tomorrow', reminder_text: 'Do something' }]
      };

      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue(MockResponse);

      const Result = await Pipeline.AnalyzeMessageForRemindersAsync('Do something tomorrow');

      expect(Result).toEqual(MockResponse);
      expect(MockWorkspaceAI.ProcessMessageWithJsonResponseAsync).toHaveBeenCalled();
    });

    it('should throw if recommendation is missing', async () => {
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        rationale: 'test',
        reminders: []
      });

      await expect(Pipeline.AnalyzeMessageForRemindersAsync('test')).rejects.toThrow(
        'GPT response is missing recommendation property'
      );
    });

    it('should throw if rationale is missing', async () => {
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        recommendation: 'schedule',
        reminders: []
      });

      await expect(Pipeline.AnalyzeMessageForRemindersAsync('test')).rejects.toThrow(
        'GPT response is missing rationale property'
      );
    });

    it('should throw if reminders is not an array', async () => {
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        recommendation: 'schedule',
        rationale: 'test',
        reminders: 'not an array'
      });

      await expect(Pipeline.AnalyzeMessageForRemindersAsync('test')).rejects.toThrow(
        'GPT response is missing reminders property or it is not an array'
      );
    });

    it('should apply deterministic fallback for direct asks with time triggers', async () => {
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        recommendation: 'ignore',
        rationale: 'No task found',
        reminders: []
      });

      const Result = await Pipeline.AnalyzeMessageForRemindersAsync(
        'Can you please review Development branch and if it is safe push to Production this morning?'
      );

      expect(Result.recommendation).toBe('schedule');
      expect(Result.reminders.length).toBe(1);
      expect(Result.reminders[0].scheduling_trigger).toBe('this morning');
    });

    it('should not override the model ignore when the message uses bare "not" as negation', async () => {
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        recommendation: 'ignore',
        rationale: 'Negation intent',
        reminders: []
      });

      for (const Message of [
        'please not deploy today',
        'can you not ship this morning',
      ]) {
        const Result = await Pipeline.AnalyzeMessageForRemindersAsync(Message);
        expect(Result.recommendation).toBe('ignore');
        expect(Result.reminders).toEqual([]);
      }
    });
  });

  describe('Reminder instructions', () => {
    it('should preserve carry-forward task context for short follow-up clauses', () => {
      const InstructionsPath = path.join(__dirname, '..', 'data', 'static', 'ai', 'reminders-instructions.md');
      const Instructions = fs.readFileSync(InstructionsPath, 'utf8');

      expect(Instructions).toContain('CBDAffs turned off on Client C. Will do Client A tomorrow morning.');
      expect(Instructions).toContain('CBDAffs turn off on Client A');
      expect(Instructions).toContain('will do X');
      expect(Instructions).toContain('same for X');
    });

    it('should instruct the model to ignore weak acknowledgment thread replies even with earlier task context', () => {
      const InstructionsPath = path.join(__dirname, '..', 'data', 'static', 'ai', 'reminders-instructions.md');
      const Instructions = fs.readFileSync(InstructionsPath, 'utf8');

      expect(Instructions).toContain('earlier messages may provide useful context');
      expect(Instructions).toContain("I'll keep that in mind when I get to that plugin.");
      expect(Instructions).toContain("I'm assuming the goal is to be able to reactivate that plugin asap.");
      expect(Instructions).toContain("I'll handle it tomorrow morning");
      expect(Instructions).toContain('Subordinate or hypothetical wording like `when I get to that`');
    });

    it('should include manual force-schedule normalization guidance for question-style requests', () => {
      const InstructionsPath = path.join(
        __dirname, '..', 'data', 'static', 'ai', 'manual-reminder-task-instructions.md'
      );
      const Instructions = fs.readFileSync(InstructionsPath, 'utf8');

      expect(Instructions).toContain('How hard is it to make our Ground Advantage $5 shipping to $6');
      expect(Instructions).toContain('Change Ground Advantage $5 shipping to $6');
    });
  });

  describe('ExtractManualReminderTaskAsync', () => {
    it('should extract a concise task title for manual force-scheduled reminders', async () => {
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        rationale: 'Question wrapper removed and imperative verb inferred.',
        reminder_message: 'Change Ground Advantage $5 shipping to $6',
      });

      const Result = await Pipeline.ExtractManualReminderTaskAsync(
        'How hard is it to make our Ground Advantage $5 shipping to $6'
      );

      expect(Result).toBe('Change Ground Advantage $5 shipping to $6');
      expect(MockWorkspaceAI.ProcessMessageWithJsonResponseAsync).toHaveBeenCalled();
    });
  });

  describe('text-synthesis settings (GH-337 Phase 2)', () => {
    const SynthesisFlags = ['REMINDER_TEXT_SYNTHESIS', 'REMINDER_TEXT_SYNTHESIS_NORMAL', 'REMINDER_TEXT_SYNTHESIS_LONG'];
    const OriginalFlags = Object.fromEntries(SynthesisFlags.map(Name => [Name, process.env[Name]]));
    const ClearFlags = () => SynthesisFlags.forEach(Name => delete process.env[Name]);

    beforeEach(ClearFlags);
    afterEach(() => {
      for(const Name of SynthesisFlags) {
        if(OriginalFlags[Name] === undefined) delete process.env[Name];
        else process.env[Name] = OriginalFlags[Name];
      }
    });

    describe('GetLegacyMasterSynthesisOverride', () => {
      it('returns null when the legacy flag is unset or blank', () => {
        expect(RemindersAIPipeline.GetLegacyMasterSynthesisOverride()).toBeNull();
        for(const Value of ['', '   ']) {
          process.env.REMINDER_TEXT_SYNTHESIS = Value;
          expect(RemindersAIPipeline.GetLegacyMasterSynthesisOverride()).toBeNull();
        }
      });

      it('returns true/false for explicit truthy/falsy values (case/space-insensitive)', () => {
        for(const Value of ['on', 'ON', ' On ', 'true', '1', 'yes', 'enabled'])
          { process.env.REMINDER_TEXT_SYNTHESIS = Value; expect(RemindersAIPipeline.GetLegacyMasterSynthesisOverride()).toBe(true); }
        for(const Value of ['off', 'no', 'false', '0', 'disabled', 'maybe'])
          { process.env.REMINDER_TEXT_SYNTHESIS = Value; expect(RemindersAIPipeline.GetLegacyMasterSynthesisOverride()).toBe(false); }
      });
    });

    describe('per-segment defaults', () => {
      it('Normal synthesis defaults OFF; Long synthesis defaults ON', () => {
        expect(RemindersAIPipeline.IsNormalTextSynthesisEnabled()).toBe(false);
        expect(RemindersAIPipeline.IsLongTextSynthesisEnabled()).toBe(true);
      });

      it('each segment flag is independently overridable', () => {
        process.env.REMINDER_TEXT_SYNTHESIS_NORMAL = 'on';
        process.env.REMINDER_TEXT_SYNTHESIS_LONG = 'off';
        expect(RemindersAIPipeline.IsNormalTextSynthesisEnabled()).toBe(true);
        expect(RemindersAIPipeline.IsLongTextSynthesisEnabled()).toBe(false);
      });
    });

    describe('CountSentences', () => {
      it('counts terminal punctuation groups, floors non-empty run-ons at 1, empty at 0', () => {
        expect(RemindersAIPipeline.CountSentences('Hi there. How are you? Fine!')).toBe(3);
        expect(RemindersAIPipeline.CountSentences('one run on with no terminal punctuation')).toBe(1);
        expect(RemindersAIPipeline.CountSentences('Wait... really?!')).toBe(2);
        expect(RemindersAIPipeline.CountSentences('')).toBe(0);
        expect(RemindersAIPipeline.CountSentences('   ')).toBe(0);
      });

      // GH-43 Phase 2. Red before this phase: every case below returned 1.
      it('treats a hard newline as a thought boundary even with no terminal punctuation', () => {
        expect(RemindersAIPipeline.CountSentences('first line\nsecond line')).toBe(2);
        expect(RemindersAIPipeline.CountSentences('a\nb\nc\nd')).toBe(4);
        // blank lines are separators, not thoughts
        expect(RemindersAIPipeline.CountSentences('first\n\n\nsecond')).toBe(2);
        expect(RemindersAIPipeline.CountSentences('only one line\n')).toBe(1);
      });

      it('counts trailing unpunctuated text on a line as one more thought', () => {
        // "…passed." is one; the unpunctuated clause after it is a second.
        expect(RemindersAIPipeline.CountSentences('Enough time has passed. Emails resume after deploy')).toBe(2);
        // a line that ends punctuated is not double counted
        expect(RemindersAIPipeline.CountSentences('Enough time has passed. Emails resume.')).toBe(2);
        // closing quotes/brackets after the terminal mark still count as punctuated
        expect(RemindersAIPipeline.CountSentences('She said "ship it."')).toBe(1);
      });

      it('THE REPORTED MESSAGE counts 5, not the 3 that routed it to Normal and left it verbatim', () => {
        const Reported = [
          '<@U_A> <@U_B> root cause: the scan only ever saw a small fixed batch of photos.',
          'Over time that batch got used up, so the system had nothing left to send.',
          'We fixed it so the scan now covers all photos. Emails will resume after the next deployment',
          'i am going to deploy the changes tomorrow morning',
        ].join('\n');

        // the shipped rule counted only [.!?] followed by whitespace/end — three marks, so 3.
        const PunctuationOnlyCount = (Reported.match(/[.!?]+(?=\s|$)/g) || []).length;
        expect(PunctuationOnlyCount).toBe(3);
        expect(PunctuationOnlyCount).toBeLessThan(RemindersAIPipeline.LONG_MESSAGE_SENTENCE_THRESHOLD);

        expect(RemindersAIPipeline.CountSentences(Reported)).toBe(5);
        expect(RemindersAIPipeline.CountSentences(Reported)).toBeGreaterThanOrEqual(
          RemindersAIPipeline.LONG_MESSAGE_SENTENCE_THRESHOLD
        );
      });
    });

    describe('IsTaskSynthesisEnabledForText', () => {
      it('routes short messages to Normal (OFF) and long messages to Long (ON) by default', () => {
        expect(RemindersAIPipeline.IsTaskSynthesisEnabledForText('Ship the fix today.')).toBe(false);
        expect(RemindersAIPipeline.IsTaskSynthesisEnabledForText('First. Second. Third. Fourth.')).toBe(true);
      });

      it('honors the LONG_MESSAGE_SENTENCE_THRESHOLD boundary (>= long, < normal)', () => {
        expect(RemindersAIPipeline.CountSentences('One. Two. Three.')).toBe(3); // below threshold → normal
        expect(RemindersAIPipeline.IsTaskSynthesisEnabledForText('One. Two. Three.')).toBe(false);
        expect(RemindersAIPipeline.IsTaskSynthesisEnabledForText('One. Two. Three. Four.')).toBe(true);
      });

      it('lets the legacy master flag override both segments', () => {
        process.env.REMINDER_TEXT_SYNTHESIS = 'off';
        expect(RemindersAIPipeline.IsTaskSynthesisEnabledForText('First. Second. Third. Fourth.')).toBe(false);
        process.env.REMINDER_TEXT_SYNTHESIS = 'on';
        expect(RemindersAIPipeline.IsTaskSynthesisEnabledForText('Ship the fix today.')).toBe(true);
      });
    });

    describe('DescribeSynthesisRouting', () => {
      /**
       * A message of a given length whose only actionable span is short — the "buried task" shape.
       * Deliberately ONE sentence, so the sentence-count rule cannot route it and the ratio gate is
       * the only thing under test.
       * @param {number} ArgLength Target character length.
       * @returns {string}
       */
      function MakeBuriedTaskNote(ArgLength) {
        const Filler = 'context about the incident and what we already ruled out, ';
        return `${Filler.repeat(Math.ceil(ArgLength / Filler.length))}`.slice(0, ArgLength - 20)
          + ' and i will ship it';
      }

      it('reports segment, decision, length, and actionable-span ratio without raw text', () => {
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
          'Heads up team. Lots of context here. More background. Please fix the login bug.',
          [{ actionable_language: 'fix the login bug' }]
        );
        expect(Routing.segment).toBe('long');
        expect(Routing.synthesisOn).toBe(true);
        expect(Routing.sentenceCount).toBe(4);
        expect(Routing.messageLength).toBeGreaterThan(0);
        expect(Routing.actionableSpanRatio).toBeGreaterThan(0);
        expect(Routing.actionableSpanRatio).toBeLessThanOrEqual(1);
        expect(Routing.routedBy).toBe('sentence_count');
      });

      // GH-43 Phase 2 — the buried-task ratio gate. Red before this phase: `routedBy` did not exist
      // and every one of these single-sentence notes routed to Normal (verbatim).
      it('routes a LONG message with a SMALL actionable span to Long, on the ratio alone', () => {
        const Note = MakeBuriedTaskNote(300);
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
          Note, [{ actionable_language: 'i will ship it' }]
        );
        expect(Routing.sentenceCount).toBe(1); // the sentence rule cannot be what routed this
        expect(Routing.actionableSpanRatio).toBeLessThanOrEqual(
          RemindersAIPipeline.BURIED_TASK_MAX_SPAN_RATIO
        );
        expect(Routing.routedBy).toBe('buried_task_ratio');
        expect(Routing.segment).toBe('long');
        expect(Routing.synthesisOn).toBe(true);
      });

      it('a SHORT message with the same low ratio stays Normal — length is load bearing', () => {
        // this is scenario S-05: ratio 0.16, but only 80 chars. A short message with a short task is
        // not a buried task, it is just a short message.
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
          '<@U_A> found the root cause of the queue stall, nice work. I will patch it', [{ actionable_language: "I'll patch it" }]
        );
        expect(Routing.messageLength).toBeLessThan(RemindersAIPipeline.BURIED_TASK_MIN_LENGTH);
        expect(Routing.routedBy).toBe('sentence_count');
        expect(Routing.segment).toBe('normal');
        expect(Routing.synthesisOn).toBe(false);
      });

      it('a long message that IS mostly its own task stays verbatim — the ratio ceiling holds', () => {
        const MostlyTask = `i need to ${'walk through the migration checklist with the team and '.repeat(4)}before friday`;
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
          MostlyTask, [{ actionable_language: MostlyTask }]
        );
        expect(Routing.messageLength).toBeGreaterThanOrEqual(RemindersAIPipeline.BURIED_TASK_MIN_LENGTH);
        expect(Routing.actionableSpanRatio).toBeGreaterThan(
          RemindersAIPipeline.BURIED_TASK_MAX_SPAN_RATIO
        );
        expect(Routing.routedBy).toBe('sentence_count');
        expect(Routing.synthesisOn).toBe(false);
      });

      it('a SYNTHETIC span (force-schedule) is reported but never routed on', () => {
        const Note = MakeBuriedTaskNote(300);
        // force-schedule sets actionable_language to the WHOLE message, pinning the ratio at 1.0.
        const Forced = RemindersAIPipeline.DescribeSynthesisRouting(
          Note, [{ actionable_language: Note }], { SyntheticActionableSpan: true }
        );
        expect(Forced.actionableSpanRatio).toBe(1);
        expect(Forced.spanRatioUsable).toBe(false);
        expect(Forced.routedBy).toBe('sentence_count');
      });

      it('no quoted span at all means no buried-task claim — a 0 ratio is absence of evidence', () => {
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(MakeBuriedTaskNote(300), []);
        expect(Routing.actionableSpanRatio).toBe(0);
        expect(Routing.spanRatioUsable).toBe(false);
        expect(Routing.routedBy).toBe('sentence_count');
        expect(Routing.segment).toBe('normal');
      });

      // GH-51 — the ratio was ROUNDED before the usability gate read it, so `toFixed(2)` collapsed
      // any span under 0.5% of the message to exactly 0 and the gate concluded "no span was quoted".
      // The gate therefore failed hardest on the most deeply buried task, which is the only case it
      // exists to catch. Red before the fix: routedBy === 'sentence_count', spanRatioUsable === false.
      it('a span under 0.5% of a huge note STILL routes by the ratio gate, though it reports as 0', () => {
        // the shape observed in production: a ~7000-char status note carrying one short commitment.
        const Span = 'deploy the changes tomorrow morning';
        const Note = 'Status update on the incident. '.repeat(260) + Span;
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
          Note, [{ actionable_language: Span }]
        );
        expect(Routing.messageLength).toBeGreaterThan(8000);
        // the span really is under 0.5% of the note — which is what makes it round away.
        expect(Span.length / Routing.messageLength).toBeLessThan(0.005);
        // the REPORTED ratio still rounds to 0 — that is the telemetry format, and is fine...
        expect(Routing.actionableSpanRatio).toBe(0);
        // ...but the DECISION must be made on the raw measurement, which is non-zero.
        expect(Routing.spanRatioUsable).toBe(true);
        expect(Routing.routedBy).toBe('buried_task_ratio');
        expect(Routing.segment).toBe('long');
        expect(Routing.synthesisOn).toBe(true);
      });

      it('reported-0 from a tiny span and reported-0 from NO span stay distinguishable', () => {
        // both report actionableSpanRatio === 0; only spanRatioUsable separates them. Without this
        // the two collapse, which is exactly the bug — and it is what made the production
        // `ratio=0` population impossible to interpret from telemetry alone.
        const Span = 'ship it';
        const Note = 'Long note with plenty of surrounding context. '.repeat(120) + Span;

        const TinySpan = RemindersAIPipeline.DescribeSynthesisRouting(Note, [{ actionable_language: Span }]);
        const NoSpan = RemindersAIPipeline.DescribeSynthesisRouting(Note, []);

        expect(TinySpan.actionableSpanRatio).toBe(0);
        expect(NoSpan.actionableSpanRatio).toBe(0);
        expect(TinySpan.spanRatioUsable).toBe(true);
        expect(NoSpan.spanRatioUsable).toBe(false);
        expect(TinySpan.routedBy).toBe('buried_task_ratio');
        expect(NoSpan.routedBy).toBe('sentence_count');
      });

      it('the ratio ceiling is compared on the RAW value, not the rounded one', () => {
        // raw 0.354 exceeds the 0.35 ceiling, but rounds DOWN to exactly 0.35 — which the rounded
        // comparison would have admitted. The threshold should mean what it says.
        const Span = 'x'.repeat(354);
        const Note = Span + 'y'.repeat(646);
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
          Note, [{ actionable_language: Span }]
        );
        expect(Routing.messageLength).toBe(1000);
        expect(Routing.actionableSpanRatio).toBe(0.35);           // rounds TO the ceiling
        expect(0.354).toBeGreaterThan(RemindersAIPipeline.BURIED_TASK_MAX_SPAN_RATIO); // raw exceeds it
        expect(Routing.routedBy).toBe('sentence_count');          // so the gate must NOT claim it
      });

      it('the legacy master flag still overrides the ratio gate, and says so', () => {
        process.env.REMINDER_TEXT_SYNTHESIS = 'off';
        const Routing = RemindersAIPipeline.DescribeSynthesisRouting(
          MakeBuriedTaskNote(300), [{ actionable_language: 'i will ship it' }]
        );
        expect(Routing.routedBy).toBe('master_override');
        expect(Routing.synthesisOn).toBe(false);
      });

      it('IsTaskSynthesisEnabledForText and DescribeSynthesisRouting cannot disagree', () => {
        // Phase 2 inverted the dependency so there is exactly one computation. Before, the predicate
        // was the decision and the facts were computed separately from a different input.
        const Cases = [
          ['Ship it today.', []],
          ['One. Two. Three. Four.', []],
          [MakeBuriedTaskNote(300), [{ actionable_language: 'i will ship it' }]],
          ['a\nb\nc\nd', [{ actionable_language: 'a' }]],
        ];
        for(const [Text, Reminders] of Cases) {
          expect(RemindersAIPipeline.IsTaskSynthesisEnabledForText(Text, /** @type {any} */ (Reminders)))
            .toBe(RemindersAIPipeline.DescribeSynthesisRouting(Text, /** @type {any} */ (Reminders)).synthesisOn);
        }
      });
    });

    describe('IsTextSynthesisEnabled (legacy derived view)', () => {
      it('is ON by default because the Long segment defaults ON', () => {
        expect(RemindersAIPipeline.IsTextSynthesisEnabled()).toBe(true);
      });

      it('follows the legacy master flag when explicitly set', () => {
        process.env.REMINDER_TEXT_SYNTHESIS = 'off';
        expect(RemindersAIPipeline.IsTextSynthesisEnabled()).toBe(false);
      });

      it('is OFF only when both segments are explicitly disabled', () => {
        process.env.REMINDER_TEXT_SYNTHESIS_NORMAL = 'off';
        process.env.REMINDER_TEXT_SYNTHESIS_LONG = 'off';
        expect(RemindersAIPipeline.IsTextSynthesisEnabled()).toBe(false);
      });
    });
  });

  describe('NormalizeOriginalReminderText', () => {
    it('trims and collapses interior whitespace including newlines to single spaces', () => {
      expect(RemindersAIPipeline.NormalizeOriginalReminderText('  Restore   Production\n\nto  Dev  '))
        .toBe('Restore Production to Dev');
    });

    it('returns an empty string for null/undefined/empty input', () => {
      expect(RemindersAIPipeline.NormalizeOriginalReminderText(null)).toBe('');
      expect(RemindersAIPipeline.NormalizeOriginalReminderText(undefined)).toBe('');
      expect(RemindersAIPipeline.NormalizeOriginalReminderText('   \n  ')).toBe('');
    });

    it('preserves the message wording verbatim apart from whitespace', () => {
      expect(RemindersAIPipeline.NormalizeOriginalReminderText("Ok, I'll restore Production to Dev now"))
        .toBe("Ok, I'll restore Production to Dev now");
    });
  });

  describe('ExtractDateWithGptAsync', () => {
    it('should extract a date from a scheduling trigger', async () => {
      const MockResponse = {
        year: 2026,
        month: 3,
        day: 26,
        hour: 10,
        minute: 0,
        second: 0,
        rationale: 'Extracted tomorrow at 10 AM'
      };

      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue(MockResponse);

      const Result = await Pipeline.ExtractDateWithGptAsync('tomorrow at 10 AM');

      expect(Result.success).toBe(true);
      expect(Result.date).toBeInstanceOf(Date);
      expect(Result.phrase).toBe('tomorrow at 10 AM');
    });

    it('should return failure if year is 0', async () => {
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        year: 0,
        month: 0,
        day: 0,
        hour: 0,
        minute: 0,
        second: 0,
        rationale: 'Could not extract date'
      });

      const Result = await Pipeline.ExtractDateWithGptAsync('invalid date');

      expect(Result.success).toBe(false);
      expect(Result.date).toBeNull();
    });

    it('should adjust past dates forward by 24 hours', async () => {
      // Create a date that is definitely in the past (yesterday at this time)
      const PastDate = new Date();
      PastDate.setUTCDate(PastDate.getUTCDate() - 1); // yesterday

      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        year: PastDate.getUTCFullYear(),
        month: PastDate.getUTCMonth() + 1,
        day: PastDate.getUTCDate(),
        hour: PastDate.getUTCHours(),
        minute: PastDate.getUTCMinutes(),
        second: 0,
        rationale: 'Past date'
      });

      const Result = await Pipeline.ExtractDateWithGptAsync('yesterday');

      expect(Result.success).toBe(true);
      expect(Result.wasAdjustedForward).toBe(true);
    });

    it('should keep same-day intent for past "this morning" trigger', async () => {
      const PastDate = new Date();
      PastDate.setUTCHours(8, 0, 0, 0);
      PastDate.setUTCDate(PastDate.getUTCDate() - 1);

      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        year: PastDate.getUTCFullYear(),
        month: PastDate.getUTCMonth() + 1,
        day: PastDate.getUTCDate(),
        hour: PastDate.getUTCHours(),
        minute: PastDate.getUTCMinutes(),
        second: 0,
        rationale: 'This morning'
      });

      const Result = await Pipeline.ExtractDateWithGptAsync('this morning');

      expect(Result.success).toBe(true);
      expect(Result.wasAdjustedForward).toBe(false);
    });

    it('should apply jitter for calendar-digit triggers but not explicit clock times', async () => {
      // Math.random() = 0 → jitter offset = floor(0 * 91) - 45 = -45 min, deterministic.
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const AnchorResponse = {
        year: 2026,
        month: 6,
        day: 20,
        hour: 8,
        minute: 0,
        second: 0,
        rationale: 'morning anchor'
      };

      // "June 20 morning" — calendar digit must not suppress jitter
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue(AnchorResponse);
      const JitteredResult = await Pipeline.ExtractDateWithGptAsync('June 20 morning');
      expect(JitteredResult.success).toBe(true);
      expect(JitteredResult.date.getUTCMinutes()).not.toBe(0);

      // "morning at 8" — explicit clock time must block jitter
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue(AnchorResponse);
      const ExactResult = await Pipeline.ExtractDateWithGptAsync('morning at 8');
      expect(ExactResult.success).toBe(true);
      expect(ExactResult.date.getUTCMinutes()).toBe(0);

      jest.restoreAllMocks();
    });

    it('schedules "for tonight" sent at 20:57 for today even with a forced negative jitter draw (GH-87)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-18T20:57:00-07:00'));
      // Math.random() = 0 yields maximum negative jitter (-45 min)
      jest.spyOn(Math, 'random').mockReturnValue(0);

      const AnchorResponse = {
        year: 2026,
        month: 8,
        day: 18,
        hour: 21,
        minute: 0,
        second: 0,
        rationale: 'tonight anchor at 9 PM'
      };

      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue(AnchorResponse);
      const Result = await Pipeline.ExtractDateWithGptAsync('for tonight, can you review this PR');

      expect(Result.success).toBe(true);
      expect(Result.wasAdjustedForward).toBe(false);

      const MainTzOffset = DateUtils.GetTimeZoneOffsetInMinutes(SlackApp.WorkspaceInfo.MAIN_TIMEZONE);
      const LocalScheduledDay = new Date(Result.date.getTime() + (MainTzOffset * 60 * 1000)).getUTCDate();
      expect(LocalScheduledDay).toBe(18);
      expect(Result.date.getTime()).toBeGreaterThanOrEqual(new Date().getTime());

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('schedules "tonight" sent at 23:00 soon rather than the next night (GH-87)', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-18T23:00:00-07:00'));

      const AnchorResponse = {
        year: 2026,
        month: 8,
        day: 18,
        hour: 21,
        minute: 0,
        second: 0,
        rationale: 'tonight anchor at 9 PM'
      };

      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue(AnchorResponse);
      const Result = await Pipeline.ExtractDateWithGptAsync('tonight');

      expect(Result.success).toBe(true);
      expect(Result.wasAdjustedForward).toBe(false);

      const MainTzOffset = DateUtils.GetTimeZoneOffsetInMinutes(SlackApp.WorkspaceInfo.MAIN_TIMEZONE);
      const LocalScheduledDay = new Date(Result.date.getTime() + (MainTzOffset * 60 * 1000)).getUTCDate();
      expect(LocalScheduledDay).toBe(18);
      expect(Result.date.getTime()).toBe(new Date().getTime() + 20000);

      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    it('property test: across full jitter range, no fuzzy anchor changes calendar day relative to anchor (GH-87)', () => {
      const Anchors = [
        { phrase: 'morning', hour: 8 },
        { phrase: 'noon', hour: 12 },
        { phrase: 'afternoon', hour: 14 },
        { phrase: 'late afternoon', hour: 17 },
        { phrase: 'evening', hour: 18 },
        { phrase: 'tonight', hour: 21 },
        { phrase: 'later tonight', hour: 22 },
      ];

      const Timezones = [-480, -420, 0, 60, 330, 540]; // UTC-8, UTC-7, UTC, UTC+1, UTC+5.5, UTC+9

      for(const TzOffset of Timezones) {
        for(const Anchor of Anchors) {
          const AnchorUtc = new Date(Date.UTC(2026, 7, 18, Anchor.hour, 0, 0));
          // Convert from local anchor to UTC
          AnchorUtc.setUTCMinutes(AnchorUtc.getUTCMinutes() - TzOffset);

          const CurrentUtc = new Date(AnchorUtc.getTime() - (5 * 60 * 1000)); // 5 min before anchor

          // Test across all 91 discrete jitter outcomes (-45 to +45)
          for(let JitterStep = 0; JitterStep <= 90; JitterStep++) {
            const RandomVal = JitterStep / 90.999;
            jest.spyOn(Math, 'random').mockReturnValue(RandomVal);

            const Jittered = RemindersAIPipeline.ApplyPresentationJitter(
              AnchorUtc,
              Anchor.phrase,
              CurrentUtc,
              TzOffset
            );

            // Local calendar day of anchor vs jittered
            const LocalAnchorDay = new Date(AnchorUtc.getTime() + (TzOffset * 60 * 1000)).getUTCDate();
            const LocalJitteredDay = new Date(Jittered.getTime() + (TzOffset * 60 * 1000)).getUTCDate();

            expect(LocalJitteredDay).toBe(LocalAnchorDay);
            expect(Jittered.getTime()).toBeGreaterThanOrEqual(CurrentUtc.getTime());

            jest.restoreAllMocks();
          }
        }
      }
    });
  });

  describe('CheckForDuplicateReminderAsync', () => {
    it('should return schedule when no existing reminders', async () => {
      GetPendingRemindersMock.mockReturnValue([]);

      const NewReminder = {
        ReminderID: 'new-1',
        OriginalMessageID: 'msg-1',
        ReminderMessageText: 'Do something'
      };

      const Result = await Pipeline.CheckForDuplicateReminderAsync(NewReminder);

      expect(Result.recommendation).toBe('schedule');
      expect(Result.rationale).toContain('No existing reminders');
      expect(Result.matched_by).toBeNull();
    });

    it('should return ignore when duplicate by OriginalMessageID', async () => {
      const ExistingReminder = {
        ReminderID: 'existing-1',
        OriginalMessageID: 'msg-1',
        ReminderMessageText: 'Do something'
      };

      GetPendingRemindersMock.mockReturnValue([ExistingReminder]);

      const NewReminder = {
        ReminderID: 'new-1',
        OriginalMessageID: 'msg-1',
        ReminderMessageText: 'Do something'
      };

      const Result = await Pipeline.CheckForDuplicateReminderAsync(NewReminder);

      expect(Result.recommendation).toBe('ignore');
      expect(Result.rationale).toContain('same OriginalMessageID');
      expect(Result.matched_by).toBe('message_id');
    });

    it('should return schedule when no duplicate by OriginalMessageID', async () => {
      const ExistingReminder = {
        ReminderID: 'existing-1',
        OriginalMessageID: 'msg-1',
        ReminderMessageText: 'Do something'
      };

      GetPendingRemindersMock.mockReturnValue([ExistingReminder]);

      const NewReminder = {
        ReminderID: 'new-1',
        OriginalMessageID: 'msg-2',
        ReminderMessageText: 'Do something else'
      };

      const Result = await Pipeline.CheckForDuplicateReminderAsync(NewReminder);

      expect(Result.recommendation).toBe('schedule');
      expect(Result.rationale).toContain('same Slack thread');
      expect(MockWorkspaceAI.ProcessMessageWithJsonResponseAsync).not.toHaveBeenCalled();
    });

    it('should run semantic deduplication for a reply to a thread with an existing reminder', async () => {
      const ExistingReminder = {
        ReminderID: 'existing-root',
        OriginalMessageID: 'thread-root',
        OriginalThreadTs: null,
        ReminderMessageText: 'Key task(s):\n• Post some screenshots',
      };
      const NewReminder = {
        ReminderID: 'new-reply',
        OriginalMessageID: 'thread-reply',
        OriginalThreadTs: 'thread-root',
        ReminderMessageText: 'Key task(s):\n• Post some screenshots',
      };
      GetPendingRemindersMock.mockReturnValue([ExistingReminder]);
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        recommendation: 'ignore',
        rationale: 'Both reminders ask to post some screenshots.',
      });

      const Result = await Pipeline.CheckForDuplicateReminderAsync(NewReminder);

      expect(Result.recommendation).toBe('ignore');
      expect(Result.matched_by).toBe('semantic');
      expect(MockWorkspaceAI.ProcessMessageWithJsonResponseAsync).toHaveBeenCalledTimes(1);
      const DedupInput = JSON.parse(MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0][0]);
      expect(DedupInput.dedup_context).toEqual({ same_thread: true });
      expect(DedupInput.existing_reminders).toEqual([ExistingReminder]);
    });

    it('should allow a distinct follow-up task in the same thread', async () => {
      const ExistingReminder = {
        ReminderID: 'existing-root',
        OriginalMessageID: 'thread-root',
        ReminderMessageText: 'Key task(s):\n• Post some screenshots',
      };
      const NewReminder = {
        ReminderID: 'new-reply',
        OriginalMessageID: 'thread-reply',
        OriginalThreadTs: 'thread-root',
        ReminderMessageText: 'Key task(s):\n• Review the launch checklist',
      };
      GetPendingRemindersMock.mockReturnValue([ExistingReminder]);
      MockWorkspaceAI.ProcessMessageWithJsonResponseAsync.mockResolvedValue({
        recommendation: 'schedule',
        rationale: 'Review the launch checklist is distinct from posting screenshots.',
      });

      const Result = await Pipeline.CheckForDuplicateReminderAsync(NewReminder);

      expect(Result.recommendation).toBe('schedule');
      expect(Result.matched_by).toBe('semantic');
      expect(MockWorkspaceAI.ProcessMessageWithJsonResponseAsync).toHaveBeenCalledTimes(1);
    });

    it('should not run semantic deduplication for a different thread', async () => {
      const ExistingReminder = {
        ReminderID: 'existing-root',
        OriginalMessageID: 'first-thread-root',
        ReminderMessageText: 'Key task(s):\n• Post some screenshots',
      };
      const NewReminder = {
        ReminderID: 'new-reply',
        OriginalMessageID: 'second-thread-reply',
        OriginalThreadTs: 'second-thread-root',
        ReminderMessageText: 'Key task(s):\n• Post some screenshots',
      };
      GetPendingRemindersMock.mockReturnValue([ExistingReminder]);

      const Result = await Pipeline.CheckForDuplicateReminderAsync(NewReminder);

      expect(Result.recommendation).toBe('schedule');
      expect(MockWorkspaceAI.ProcessMessageWithJsonResponseAsync).not.toHaveBeenCalled();
    });
  });
});
