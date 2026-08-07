const fs = require('fs');
const path = require('path');
const RemindersAIPipeline = require('../src/reminders-ai-pipeline');
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
