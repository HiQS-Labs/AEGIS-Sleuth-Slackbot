/* eslint-disable jest/no-conditional-expect */
'use strict';

const RemindersReactionHandler = require('../src/reminders-reaction-handler');

// Mock SlackApp
class MockSlackApp {
  constructor() {
    this.Logger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    };
    this.DeleteMessageAsync = jest.fn();
  }
  async GetMessageMetadataAsync(ArgChannelID, ArgTimestamp) {
    return this.MessageMetadata;
  }
  async GetConversationMessagesAsync(ArgChannelID, ArgTimestamp) {
    return this.ThreadMessages || [];
  }
}

describe('RemindersReactionHandler', () => {
  let Handler;
  let MockSlackAppInstance;
  let DependencyBag;

  beforeEach(() => {
    MockSlackAppInstance = new MockSlackApp();
    DependencyBag = {
      GetPendingReminders: jest.fn(),
      DeleteRemindersAsync: jest.fn(),
      TryScheduleRemindersAsync: jest.fn(),
      PostReminderTriageAsync: jest.fn(),
      TransitionReminderState: jest.fn(),
      ReminderState: {
        Completed: 'completed',
        Canceled: 'canceled',
        Scheduled: 'scheduled',
      },
    };
    Handler = new RemindersReactionHandler(MockSlackAppInstance, DependencyBag);
  });

  describe('OnReactionAddedAsync', () => {
    it('should dispatch white_check_mark to white check mark handler', async () => {
      const EventInfo = {
        reaction: 'white_check_mark',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = {
        event_type: 'sleuth-ai-reminder-ids',
        event_payload: {
          ReminderIDs: JSON.stringify(['R1', 'R2']),
        },
      };

      DependencyBag.GetPendingReminders.mockReturnValue([
        { ReminderID: 'R1' },
        { ReminderID: 'R2' },
      ]);

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.DeleteRemindersAsync).toHaveBeenCalledWith(['R1', 'R2'], 'completed');
    });

    it('should dispatch alarm_clock to alarm clock handler', async () => {
      const EventInfo = {
        reaction: 'alarm_clock',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.ThreadMessages = [
        {
          text: 'remember to do this tomorrow',
          user: 'U123',
        },
      ];

      DependencyBag.TryScheduleRemindersAsync.mockResolvedValue(true);

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.TryScheduleRemindersAsync).toHaveBeenCalledWith(
        'remember to do this tomorrow',
        'C123',
        '1234567890.000100',
        'U123',
        true
      );
    });

    it('should dispatch wastebasket to wastebasket handler', async () => {
      const EventInfo = {
        reaction: 'wastebasket',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = {
        event_type: 'sleuth-ai-reminder-ids',
        event_payload: {
          ReminderIDs: JSON.stringify(['R1', 'R2']),
        },
      };

      DependencyBag.GetPendingReminders.mockReturnValue([
        { ReminderID: 'R1' },
        { ReminderID: 'R2' },
      ]);

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.DeleteRemindersAsync).toHaveBeenCalledWith(['R1', 'R2'], 'canceled');
    });

    it('should dispatch wrench to reminder triage handler', async () => {
      const EventInfo = {
        reaction: 'wrench',
        user: 'U_TRIAGE',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      DependencyBag.PostReminderTriageAsync.mockResolvedValue(true);

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.PostReminderTriageAsync).toHaveBeenCalledWith(
        'C123',
        '1234567890.000100',
        'U_TRIAGE'
      );
    });

    it('should return false for unknown reactions', async () => {
      const EventInfo = {
        reaction: 'unknown_emoji',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(false);
      expect(MockSlackAppInstance.Logger.info).toHaveBeenCalledWith(
        'RemindersReactionHandler ignoring reaction:',
        'unknown_emoji'
      );
    });
  });

  describe('White Check Mark Handler', () => {
    it('should complete reminders when white check mark is added to reminder message', async () => {
      const EventInfo = {
        reaction: 'white_check_mark',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = {
        event_type: 'sleuth-ai-reminder-ids',
        event_payload: {
          ReminderIDs: JSON.stringify(['R1', 'R2']),
        },
      };

      const Reminder1 = { ReminderID: 'R1' };
      const Reminder2 = { ReminderID: 'R2' };

      DependencyBag.GetPendingReminders.mockReturnValue([Reminder1, Reminder2]);

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.TransitionReminderState).toHaveBeenCalledWith(
        Reminder1,
        'completed',
        'terminal: white_check_mark'
      );
      expect(DependencyBag.TransitionReminderState).toHaveBeenCalledWith(
        Reminder2,
        'completed',
        'terminal: white_check_mark'
      );
      expect(DependencyBag.DeleteRemindersAsync).toHaveBeenCalledWith(['R1', 'R2'], 'completed');
    });

    it('should ignore white check mark on non-reminder messages', async () => {
      const EventInfo = {
        reaction: 'white_check_mark',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = null;

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(false);
      expect(MockSlackAppInstance.Logger.info).toHaveBeenCalledWith(
        'ignoring white check mark reaction since message is not a reminder message.'
      );
    });

    // Slack List fan-out on completion now lives in RemindersModule#DeleteRemindersAsync
    // (routed by the 'completed' reason); the reaction handler no longer talks to ListsModule.
  });

  describe('Alarm Clock Handler', () => {
    it('should schedule reminders when alarm clock is added', async () => {
      const EventInfo = {
        reaction: 'alarm_clock',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.ThreadMessages = [
        {
          text: 'remember to do this tomorrow',
          user: 'U123',
        },
      ];

      DependencyBag.TryScheduleRemindersAsync.mockResolvedValue(true);

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.TryScheduleRemindersAsync).toHaveBeenCalledWith(
        'remember to do this tomorrow',
        'C123',
        '1234567890.000100',
        'U123',
        true // force scheduling
      );
    });

    it('should return false when original message not found', async () => {
      const EventInfo = {
        reaction: 'alarm_clock',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.ThreadMessages = []; // no messages

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(false);
      expect(MockSlackAppInstance.Logger.error).toHaveBeenCalledWith(
        'could not find original message for alarm clock reaction.'
      );
    });

    it('should pass force scheduling flag to scheduler', async () => {
      const EventInfo = {
        reaction: 'alarm_clock',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.ThreadMessages = [
        {
          text: 'no deadline mentioned here',
          user: 'U123',
        },
      ];

      DependencyBag.TryScheduleRemindersAsync.mockResolvedValue(true);

      await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      // Verify that force scheduling is true (last parameter)
      expect(DependencyBag.TryScheduleRemindersAsync.mock.calls[0][4]).toBe(true);
    });
  });

  describe('Wastebasket Handler', () => {
    it('should delete reminders when wastebasket is added to reminder message', async () => {
      const EventInfo = {
        reaction: 'wastebasket',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = {
        event_type: 'sleuth-ai-reminder-ids',
        event_payload: {
          ReminderIDs: JSON.stringify(['R1', 'R2']),
        },
      };

      const Reminder1 = { ReminderID: 'R1' };
      const Reminder2 = { ReminderID: 'R2' };

      DependencyBag.GetPendingReminders.mockReturnValue([Reminder1, Reminder2]);

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.TransitionReminderState).toHaveBeenCalledWith(
        Reminder1,
        'canceled',
        'terminal: wastebasket'
      );
      expect(DependencyBag.TransitionReminderState).toHaveBeenCalledWith(
        Reminder2,
        'canceled',
        'terminal: wastebasket'
      );
      expect(DependencyBag.DeleteRemindersAsync).toHaveBeenCalledWith(['R1', 'R2'], 'canceled');
    });

    it('should delete the feedback message after deleting reminders', async () => {
      const EventInfo = {
        reaction: 'wastebasket',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = {
        event_type: 'sleuth-ai-reminder-ids',
        event_payload: {
          ReminderIDs: JSON.stringify(['R1']),
        },
      };

      DependencyBag.GetPendingReminders.mockReturnValue([{ ReminderID: 'R1' }]);

      await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(MockSlackAppInstance.DeleteMessageAsync).toHaveBeenCalledWith('C123', '1234567890.000100');
    });

    it('should ignore wastebasket on non-reminder messages', async () => {
      const EventInfo = {
        reaction: 'wastebasket',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = null;

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(false);
      expect(MockSlackAppInstance.Logger.info).toHaveBeenCalledWith(
        'ignoring wastebasket reaction since message is not a reminder feedback message.'
      );
    });
  });

  describe('Metadata Edge Cases', () => {
    it('should handle invalid JSON in reminder IDs', async () => {
      const EventInfo = {
        reaction: 'white_check_mark',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = {
        event_type: 'sleuth-ai-reminder-ids',
        event_payload: {
          ReminderIDs: 'invalid json',
        },
      };

      expect(async () => {
        await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);
      }).rejects.toThrow();
    });

    it('should handle reminder not found in queue', async () => {
      const EventInfo = {
        reaction: 'white_check_mark',
        item: {
          channel: 'C123',
          ts: '1234567890.000100',
        },
      };

      MockSlackAppInstance.MessageMetadata = {
        event_type: 'sleuth-ai-reminder-ids',
        event_payload: {
          ReminderIDs: JSON.stringify(['R1', 'R2']),
        },
      };

      DependencyBag.GetPendingReminders.mockReturnValue([]); // empty queue

      const Result = await Handler.OnReactionAddedAsync(MockSlackAppInstance, EventInfo);

      expect(Result).toBe(true);
      expect(DependencyBag.DeleteRemindersAsync).toHaveBeenCalledWith(['R1', 'R2'], 'completed');
      expect(DependencyBag.TransitionReminderState).not.toHaveBeenCalled(); // no reminders to transition
    });
  });
});
