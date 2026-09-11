'use strict';

const fs = require('fs').promises;
const path = require('path');
const RemindersDndSettings = require('../src/reminders-dnd-settings');
const { MockLogger } = require('./mocks/mock-slack-app');

describe('RemindersDndSettings', () => {
  const TestDir = path.join(__dirname, '..', 'temp', 'test-dnd-settings');
  const TestFilePath = path.join(TestDir, 'test_dnd.json');

  beforeEach(async () => {
    await fs.mkdir(TestDir, { recursive: true });
    try {
      await fs.unlink(TestFilePath);
    } catch {
      // File doesn't exist, fine
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(TestFilePath);
    } catch {
      // Clean up
    }
  });

  describe('LoadAsync', () => {
    test('loads workspace and channel DND settings from file', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);

      const TestData = {
        workspace: true,
        channels: ['C_CH1', 'C_CH2']
      };
      await fs.writeFile(TestFilePath, JSON.stringify(TestData), 'utf8');

      await Settings.LoadAsync();

      expect(Settings.IsWorkspaceDnd()).toBe(true);
      expect(Settings.IsChannelDnd('C_CH1')).toBe(true);
      expect(Settings.IsChannelDnd('C_CH2')).toBe(true);
      expect(Settings.IsChannelDnd('C_CH3')).toBe(false);
      expect(Settings.HasAnyDndActive()).toBe(true);
      expect(Settings.GetDndChannelIds()).toEqual(['C_CH1', 'C_CH2']);
    });

    test('handles ENOENT gracefully and defaults to false/empty', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);

      await Settings.LoadAsync();

      expect(Settings.IsWorkspaceDnd()).toBe(false);
      expect(Settings.IsChannelDnd('C_ANY')).toBe(false);
      expect(Settings.HasAnyDndActive()).toBe(false);
      expect(Settings.GetDndChannelIds()).toEqual([]);
    });

    test('handles empty file gracefully', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);

      await fs.writeFile(TestFilePath, '   \n  ', 'utf8');
      await Settings.LoadAsync();

      expect(Settings.IsWorkspaceDnd()).toBe(false);
      expect(Settings.GetDndChannelIds()).toEqual([]);
    });
  });

  describe('Toggles & Persistence', () => {
    test('toggles workspace DND on and off with persistence', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);
      await Settings.LoadAsync();

      expect(Settings.IsWorkspaceDnd()).toBe(false);

      await Settings.SetWorkspaceDndAsync(true);
      expect(Settings.IsWorkspaceDnd()).toBe(true);
      expect(Settings.IsDndActiveForChannel('C_ANY')).toBe(true);

      // Verify reloaded from disk
      const Settings2 = new RemindersDndSettings({ Logger }, TestFilePath);
      await Settings2.LoadAsync();
      expect(Settings2.IsWorkspaceDnd()).toBe(true);

      await Settings.SetWorkspaceDndAsync(false);
      expect(Settings.IsWorkspaceDnd()).toBe(false);

      await Settings2.LoadAsync();
      expect(Settings2.IsWorkspaceDnd()).toBe(false);
    });

    test('toggles channel DND on and off with persistence', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);
      await Settings.LoadAsync();

      await Settings.SetChannelDndAsync('C_SPECIFIC', true);
      expect(Settings.IsChannelDnd('C_SPECIFIC')).toBe(true);
      expect(Settings.IsDndActiveForChannel('C_SPECIFIC')).toBe(true);
      expect(Settings.IsDndActiveForChannel('C_OTHER')).toBe(false);

      // Verify reloaded from disk
      const Settings2 = new RemindersDndSettings({ Logger }, TestFilePath);
      await Settings2.LoadAsync();
      expect(Settings2.IsChannelDnd('C_SPECIFIC')).toBe(true);
      expect(Settings2.GetDndChannelIds()).toEqual(['C_SPECIFIC']);

      await Settings.SetChannelDndAsync('C_SPECIFIC', false);
      expect(Settings.IsChannelDnd('C_SPECIFIC')).toBe(false);
      expect(Settings.GetDndChannelIds()).toEqual([]);

      await Settings2.LoadAsync();
      expect(Settings2.IsChannelDnd('C_SPECIFIC')).toBe(false);
    });

    test('IsDndActiveForChannel checks both channel and workspace', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);
      await Settings.LoadAsync();

      expect(Settings.IsDndActiveForChannel('C1')).toBe(false);

      await Settings.SetChannelDndAsync('C1', true);
      expect(Settings.IsDndActiveForChannel('C1')).toBe(true);
      expect(Settings.IsDndActiveForChannel('C2')).toBe(false);

      await Settings.SetWorkspaceDndAsync(true);
      expect(Settings.IsDndActiveForChannel('C1')).toBe(true);
      expect(Settings.IsDndActiveForChannel('C2')).toBe(true);
    });

    test('validates and sanitizes malformed persisted values', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);

      // Non-boolean workspace and mixed non-string channels
      const MalformedData = {
        workspace: 'true', // string, not boolean
        channels: ['C_VALID', '', null, 123, '   ', 'C_VALID2']
      };
      await fs.writeFile(TestFilePath, JSON.stringify(MalformedData), 'utf8');

      await Settings.LoadAsync();

      expect(Settings.IsWorkspaceDnd()).toBe(false); // String 'true' ignored, treated as false
      expect(Settings.GetDndChannelIds()).toEqual(['C_VALID', 'C_VALID2']);
      expect(Settings.IsChannelDnd('C_VALID')).toBe(true);
      expect(Settings.IsChannelDnd('')).toBe(false);
    });

    test('rolls back in-memory state when SetWorkspaceDndAsync save fails', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersDndSettings({ Logger }, TestFilePath);
      await Settings.LoadAsync();
      expect(Settings.IsWorkspaceDnd()).toBe(false);

      // Make SaveAsync fail by pointing to an invalid directory path
      const InvalidSettings = new RemindersDndSettings({ Logger }, '/invalid/dir/path/file.json');
      await expect(InvalidSettings.SetWorkspaceDndAsync(true)).rejects.toThrow();
      expect(InvalidSettings.IsWorkspaceDnd()).toBe(false);
    });

    test('rolls back in-memory state when SetChannelDndAsync save fails', async () => {
      const Logger = new MockLogger();
      const InvalidSettings = new RemindersDndSettings({ Logger }, '/invalid/dir/path/file.json');
      expect(InvalidSettings.IsChannelDnd('C_FAIL')).toBe(false);

      await expect(InvalidSettings.SetChannelDndAsync('C_FAIL', true)).rejects.toThrow();
      expect(InvalidSettings.IsChannelDnd('C_FAIL')).toBe(false);
      expect(InvalidSettings.GetDndChannelIds()).toEqual([]);
    });
  });
});

