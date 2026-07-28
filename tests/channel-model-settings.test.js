'use strict';

const fs = require('fs').promises;
const path = require('path');
const ChannelModelSettings = require('../src/channel-model-settings');
const { MockLogger } = require('./mocks/mock-slack-app');

describe('ChannelModelSettings', () => {
  const TestDir = path.join(__dirname, '..', 'temp', 'test-channel-model-settings');
  const TestFilePath = path.join(TestDir, 'test_channel_models.json');

  beforeEach(async () => {
    await fs.mkdir(TestDir, { recursive: true });
    try {
      await fs.unlink(TestFilePath);
    } catch {
      // file does not exist, fine.
    }
  });

  afterEach(async () => {
    try {
      await fs.unlink(TestFilePath);
    } catch {
      // file does not exist, fine.
    }
  });

  describe('LoadAsync', () => {
    test('loads channel model overrides from a JSON object file', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await fs.writeFile(
        TestFilePath,
        JSON.stringify({ C_CHANNEL1: 'gpt-4o', C_CHANNEL2: 'gpt-4-turbo' }),
        'utf8'
      );

      await Settings.LoadAsync();

      expect(Settings.GetModelForChannel('C_CHANNEL1')).toBe('gpt-4o');
      expect(Settings.GetModelForChannel('C_CHANNEL2')).toBe('gpt-4-turbo');
      expect(Settings.GetModelForChannel('C_UNKNOWN')).toBeNull();
    });

    test('handles ENOENT gracefully and starts with no overrides', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await Settings.LoadAsync();

      expect(Settings.GetModelForChannel('C_ANY')).toBeNull();
      expect(Logger.InfoMessages.some(msg => msg.includes('no channel models file found'))).toBe(true);
    });

    test('handles empty file gracefully', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await fs.writeFile(TestFilePath, '', 'utf8');

      await Settings.LoadAsync();

      expect(Settings.GetModelForChannel('C_ANY')).toBeNull();
      expect(Logger.InfoMessages.some(msg => msg.includes('empty'))).toBe(true);
    });

    test('warns and starts empty when file is a JSON array instead of an object', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await fs.writeFile(TestFilePath, JSON.stringify(['unexpected']), 'utf8');

      await Settings.LoadAsync();

      expect(Settings.GetModelForChannel('C_ANY')).toBeNull();
      expect(Logger.WarnMessages.some(msg => msg.includes('not a JSON object'))).toBe(true);
    });

    test('throws on invalid JSON', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await fs.writeFile(TestFilePath, 'not valid json', 'utf8');

      await expect(Settings.LoadAsync()).rejects.toThrow();
    });
  });

  describe('SetModelForChannelAsync', () => {
    test('persists the override to disk as a JSON object', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await Settings.SetModelForChannelAsync('C_CHANNEL1', 'gpt-4o');
      await Settings.SetModelForChannelAsync('C_CHANNEL2', 'gpt-4-turbo');

      const FileContent = await fs.readFile(TestFilePath, 'utf8');
      const Parsed = JSON.parse(FileContent);
      expect(Parsed).toEqual({ C_CHANNEL1: 'gpt-4o', C_CHANNEL2: 'gpt-4-turbo' });
    });

    test('does not save twice when the override value is unchanged', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await Settings.SetModelForChannelAsync('C_TEST', 'gpt-4o');
      const SaveCountBefore = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;

      await Settings.SetModelForChannelAsync('C_TEST', 'gpt-4o');
      const SaveCountAfter = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;

      expect(SaveCountAfter).toBe(SaveCountBefore);
    });

    test('writes again when the override value changes', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await Settings.SetModelForChannelAsync('C_TEST', 'gpt-4o');
      await Settings.SetModelForChannelAsync('C_TEST', 'gpt-4-turbo');

      expect(Settings.GetModelForChannel('C_TEST')).toBe('gpt-4-turbo');
      const Parsed = JSON.parse(await fs.readFile(TestFilePath, 'utf8'));
      expect(Parsed).toEqual({ C_TEST: 'gpt-4-turbo' });
    });
  });

  describe('ClearModelForChannelAsync', () => {
    test('removes an existing override and persists the change', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await Settings.SetModelForChannelAsync('C_TEST', 'gpt-4o');
      expect(Settings.GetModelForChannel('C_TEST')).toBe('gpt-4o');

      await Settings.ClearModelForChannelAsync('C_TEST');
      expect(Settings.GetModelForChannel('C_TEST')).toBeNull();

      const Parsed = JSON.parse(await fs.readFile(TestFilePath, 'utf8'));
      expect(Parsed).toEqual({});
    });

    test('does not save when there is nothing to clear', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      const SaveCountBefore = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;
      await Settings.ClearModelForChannelAsync('C_NEVER_SET');
      const SaveCountAfter = Logger.InfoMessages.filter(msg => msg.includes('saved')).length;

      expect(SaveCountAfter).toBe(SaveCountBefore);
    });
  });

  describe('concurrent writes', () => {
    test('serialized saves persist the latest in-memory state when calls overlap', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      // fire a burst of overlapping writes without awaiting between them. The serialization guard
      // must ensure the on-disk JSON ends up matching the latest in-memory state.
      const Pending = [
        Settings.SetModelForChannelAsync('C_TEST', 'gpt-4o'),
        Settings.SetModelForChannelAsync('C_TEST', 'gpt-4-turbo'),
        Settings.SetModelForChannelAsync('C_TEST', 'gpt-5'),
        Settings.SetModelForChannelAsync('C_OTHER', 'gpt-4o-mini'),
      ];
      await Promise.all(Pending);

      const Parsed = JSON.parse(await fs.readFile(TestFilePath, 'utf8'));
      expect(Parsed).toEqual({ C_TEST: 'gpt-5', C_OTHER: 'gpt-4o-mini' });
      expect(Settings.GetModelForChannel('C_TEST')).toBe('gpt-5');
    });
  });

  describe('ListAll', () => {
    test('returns a snapshot of all overrides as a plain object', async () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      await Settings.SetModelForChannelAsync('C_A', 'gpt-4o');
      await Settings.SetModelForChannelAsync('C_B', 'gpt-4-turbo');

      expect(Settings.ListAll()).toEqual({ C_A: 'gpt-4o', C_B: 'gpt-4-turbo' });
    });

    test('returns an empty object when no overrides are set', () => {
      const Logger = new MockLogger();
      const Settings = new ChannelModelSettings({ Logger }, TestFilePath);

      expect(Settings.ListAll()).toEqual({});
    });
  });
});
