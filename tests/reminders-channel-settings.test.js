'use strict';

const fs = require('fs').promises;
const path = require('path');
const RemindersChannelSettings = require('../src/reminders-channel-settings');
const { MockLogger } = require('./mocks/mock-slack-app');

describe('RemindersChannelSettings', () => {
  const TestDir = path.join(__dirname, '..', 'temp', 'test-channel-settings');
  const TestFilePath = path.join(TestDir, 'test_enabled_channels.json');

  beforeEach(async () => {
    // Create test directory if it doesn't exist
    await fs.mkdir(TestDir, { recursive: true });
    // Clean up any existing test file
    try {
      await fs.unlink(TestFilePath);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  afterEach(async () => {
    // Clean up test file
    try {
      await fs.unlink(TestFilePath);
    } catch {
      // File doesn't exist, that's fine
    }
  });

  describe('LoadEnabledChannelsAsync', () => {
    test('loads enabled channels from file', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      // Create a test file with some channels
      const TestChannels = ['C_CHANNEL1', 'C_CHANNEL2', 'C_CHANNEL3'];
      await fs.writeFile(TestFilePath, JSON.stringify(TestChannels), 'utf8');

      await Settings.LoadEnabledChannelsAsync();

      expect(Settings.AreRemindersEnabledForChannel('C_CHANNEL1')).toBe(true);
      expect(Settings.AreRemindersEnabledForChannel('C_CHANNEL2')).toBe(true);
      expect(Settings.AreRemindersEnabledForChannel('C_CHANNEL3')).toBe(true);
      expect(Settings.AreRemindersEnabledForChannel('C_UNKNOWN')).toBe(false);
    });

    test('handles ENOENT gracefully and starts with empty set', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      // File doesn't exist
      await Settings.LoadEnabledChannelsAsync();

      expect(Settings.AreRemindersEnabledForChannel('C_ANY')).toBe(false);
      expect(Logger.InfoMessages.some(msg => msg.includes('no enabled channels file found'))).toBe(true);
    });

    test('handles empty file gracefully', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      // Create an empty file
      await fs.writeFile(TestFilePath, '', 'utf8');

      await Settings.LoadEnabledChannelsAsync();

      expect(Settings.AreRemindersEnabledForChannel('C_ANY')).toBe(false);
      expect(Logger.InfoMessages.some(msg => msg.includes('empty'))).toBe(true);
    });

    test('throws on invalid JSON', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      // Create a file with invalid JSON
      await fs.writeFile(TestFilePath, 'not valid json', 'utf8');

      await expect(Settings.LoadEnabledChannelsAsync()).rejects.toThrow();
    });
  });

  describe('SaveEnabledChannelsAsync', () => {
    test('saves enabled channels to file', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      await Settings.EnableRemindersForChannelAsync('C_CHANNEL1');
      await Settings.EnableRemindersForChannelAsync('C_CHANNEL2');

      // Verify file was written
      const FileContent = await fs.readFile(TestFilePath, 'utf8');
      const Parsed = JSON.parse(FileContent);
      expect(Parsed).toContain('C_CHANNEL1');
      expect(Parsed).toContain('C_CHANNEL2');
    });
  });

  describe('EnableRemindersForChannelAsync', () => {
    test('enables reminders for a channel', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      await Settings.EnableRemindersForChannelAsync('C_TEST');

      expect(Settings.AreRemindersEnabledForChannel('C_TEST')).toBe(true);
    });

    test('does not save twice for duplicate enable', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      await Settings.EnableRemindersForChannelAsync('C_TEST');
      const SaveCountBefore = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;

      await Settings.EnableRemindersForChannelAsync('C_TEST');
      const SaveCountAfter = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;

      expect(SaveCountAfter).toBe(SaveCountBefore);
    });
  });

  describe('DisableRemindersForChannelAsync', () => {
    test('disables reminders for a channel', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      await Settings.EnableRemindersForChannelAsync('C_TEST');
      expect(Settings.AreRemindersEnabledForChannel('C_TEST')).toBe(true);

      await Settings.DisableRemindersForChannelAsync('C_TEST');
      expect(Settings.AreRemindersEnabledForChannel('C_TEST')).toBe(false);
    });

    test('does not save twice for duplicate disable', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      await Settings.EnableRemindersForChannelAsync('C_TEST');
      await Settings.DisableRemindersForChannelAsync('C_TEST');
      const SaveCountBefore = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;

      await Settings.DisableRemindersForChannelAsync('C_TEST');
      const SaveCountAfter = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;

      expect(SaveCountAfter).toBe(SaveCountBefore);
    });
  });

  describe('AreRemindersEnabledForChannel', () => {
    test('returns true for enabled channels', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      await Settings.EnableRemindersForChannelAsync('C_ENABLED');

      expect(Settings.AreRemindersEnabledForChannel('C_ENABLED')).toBe(true);
    });

    test('returns false for disabled channels', async () => {
      const Logger = new MockLogger();
      const Settings = new RemindersChannelSettings({ Logger }, TestFilePath);

      expect(Settings.AreRemindersEnabledForChannel('C_DISABLED')).toBe(false);
    });
  });
});

