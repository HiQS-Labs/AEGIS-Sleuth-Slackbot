
'use strict';

/**
 * A text file uploaded earlier in a thread (MD, TXT, JSON, ...) is loaded as thread context memory
 * when a later @mention in that thread carries no file of its own.
 */

jest.mock('../src/workspace-ai', () => jest.fn().mockImplementation((WorkspaceInfo) => ({
  WorkspaceInfo,
  DefaultModelName: 'gpt-4o-mini',
  ComplexModelName: 'gpt-4o',
  ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({}),
  ProcessMessageWithTextResponseAsync: jest.fn().mockResolvedValue('mock response'),
  LoadChannelModelsAsync: jest.fn().mockResolvedValue(undefined),
  GetChannelModelName: jest.fn().mockReturnValue(null),
})));

const fs = require('fs');
const path = require('path');
const { MockSlackApp } = require('./mocks/mock-slack-app');
const ChatModule = require('../src/chat-module');

const JsonContent = fs.readFileSync(path.join(__dirname, 'fixtures', 'thread-upload-tracking.json'), 'utf8');

const WorkspaceInfo = {
  WORKSPACE_NAME: 'ThreadLookbackWorkspace',
  LIVE_TOKEN: 'xoxb-test',
  OPENAI_API_KEY: 'test-openai-key',
};

const JsonFile = {
  name: 'tracking.json',
  mimetype: 'application/json',
  filetype: 'json',
  size: JsonContent.length,
  url_private: 'https://files.slack.com/tracking.json',
  url_private_download: 'https://files.slack.com/tracking.json?dl=1',
};

const PngFile = {
  name: 'shot.png',
  mimetype: 'image/png',
  size: 1000,
  url_private: 'https://files.slack.com/shot.png',
};

function Setup(ArgThreadMessages) {
  const SlackApp = new MockSlackApp({
    WorkspaceInfo,
    ThreadMessagesById: { 'C1:100.1': ArgThreadMessages },
  });
  SlackApp.GetFileContentAsync.mockResolvedValue(JsonContent);
  const Chat = new ChatModule(SlackApp, {}, {}, null, null, null);
  return { SlackApp, Chat };
}

const Mention = (SlackApp, Extra = {}) => SlackApp.SimulateAppMentionAsync({
  channel: 'C1',
  user: 'U2',
  ts: '100.9',
  thread_ts: '100.1',
  text: `${SlackApp.AppMentionString} ${Extra.text ?? ''}`,
  files: [],
});

describe('earlier thread file look-back', () => {
  test('a JSON uploaded in an earlier message is downloaded and loaded', async () => {
    const { SlackApp } = Setup([
      { user: 'U1', text: 'sharing the export', ts: '100.1', files: [JsonFile] },
      { user: 'U2', text: 'thanks', ts: '100.5' },
    ]);

    const Handled = await Mention(SlackApp, { text: '' });

    expect(Handled).toBe(true);
    expect(SlackApp.GetFileContentAsync).toHaveBeenCalledWith(JsonFile.url_private_download);
    expect(SlackApp.SentMessages.map((M) => M.text).join('\n')).toContain('loaded *tracking.json*');
  });

  test('with a question, the file is loaded without a confirmation post', async () => {
    const { SlackApp } = Setup([{ user: 'U1', text: 'export', ts: '100.1', files: [JsonFile] }]);

    await Mention(SlackApp, { text: 'which tracking accounts are listed?' });

    expect(SlackApp.GetFileContentAsync).toHaveBeenCalledTimes(1);
    expect(SlackApp.SentMessages.map((M) => M.text).join('\n')).not.toContain('loaded *tracking.json*');
  });

  test('does not download again once the thread already has context memory', async () => {
    const { SlackApp } = Setup([{ user: 'U1', text: 'export', ts: '100.1', files: [JsonFile] }]);

    await Mention(SlackApp, { text: 'first question' });
    await Mention(SlackApp, { text: 'second question' });

    expect(SlackApp.GetFileContentAsync).toHaveBeenCalledTimes(1);
  });

  test('earlier non-text files are ignored without a rejection post', async () => {
    const { SlackApp } = Setup([{ user: 'U1', text: 'pic', ts: '100.1', files: [PngFile] }]);

    await Mention(SlackApp, { text: 'what is in the thread?' });

    expect(SlackApp.GetFileContentAsync).not.toHaveBeenCalled();
    expect(SlackApp.SentMessages.map((M) => M.text).join('\n')).not.toContain('I can only read text-based files');
  });

  test('a file on the mention itself still wins over the look-back', async () => {
    const { SlackApp } = Setup([{ user: 'U1', text: 'export', ts: '100.1', files: [JsonFile] }]);
    const Own = { ...JsonFile, name: 'own.json', url_private_download: 'https://files.slack.com/own.json?dl=1' };

    await SlackApp.SimulateAppMentionAsync({
      channel: 'C1', user: 'U2', ts: '100.9', thread_ts: '100.1',
      text: `${SlackApp.AppMentionString} check this`, files: [Own],
    });

    expect(SlackApp.GetFileContentAsync).toHaveBeenCalledWith(Own.url_private_download);
    expect(SlackApp.GetFileContentAsync).not.toHaveBeenCalledWith(JsonFile.url_private_download);
  });

  test('an oversized earlier file is skipped quietly and never blocks the mention', async () => {
    const Big = { ...JsonFile, name: 'huge.json', size: 10 * 1024 * 1024 };
    const { SlackApp } = Setup([{ user: 'U1', text: 'export', ts: '100.1', files: [Big] }]);

    await Mention(SlackApp, { text: 'what is in the thread?' });

    expect(SlackApp.GetFileContentAsync).not.toHaveBeenCalled();
    expect(SlackApp.SentMessages.map((M) => M.text).join('\n')).not.toContain('too large');
  });

  test('an earlier file that fails to download posts no rejection and does not block the mention', async () => {
    const { SlackApp } = Setup([{ user: 'U1', text: 'export', ts: '100.1', files: [JsonFile] }]);
    SlackApp.GetFileContentAsync.mockRejectedValue(new Error('403'));
    const Ai = require('../src/workspace-ai').mock.results.at(-1).value;

    await Mention(SlackApp, { text: 'what is in the thread?' });

    expect(SlackApp.SentMessages.map((M) => M.text).join('\n')).not.toContain("couldn't download");
    expect(Ai.ProcessMessageWithTextResponseAsync).toHaveBeenCalled();
  });

  test('a registered command still routes after an earlier file is hydrated', async () => {
    const { SlackApp } = Setup([{ user: 'U1', text: 'export', ts: '100.1', files: [JsonFile] }]);
    const Ai = require('../src/workspace-ai').mock.results.at(-1).value;

    await Mention(SlackApp, { text: 'show-channel-model' });

    expect(SlackApp.GetFileContentAsync).toHaveBeenCalledTimes(1);
    expect(SlackApp.SentMessages.map((M) => M.text).join('\n')).toContain('model');
    expect(Ai.ProcessMessageWithTextResponseAsync).not.toHaveBeenCalled();
  });

  test('a file uploaded after the mention is never picked', async () => {
    const Later = { ...JsonFile, name: 'future.json', url_private_download: 'https://files.slack.com/future.json?dl=1' };
    const { SlackApp } = Setup([
      { user: 'U1', text: 'export', ts: '100.1', files: [JsonFile] },
      { user: 'U3', text: 'newer', ts: '101.5', files: [Later] },
    ]);

    await Mention(SlackApp, { text: 'which accounts?' });

    expect(SlackApp.GetFileContentAsync).toHaveBeenCalledWith(JsonFile.url_private_download);
    expect(SlackApp.GetFileContentAsync).not.toHaveBeenCalledWith(Later.url_private_download);
  });

  test('a failed thread lookup falls back to normal handling', async () => {
    const { SlackApp } = Setup([]);
    SlackApp.GetConversationMessagesAsync = jest.fn().mockRejectedValue(new Error('ratelimited'));

    await expect(Mention(SlackApp, { text: 'hello' })).resolves.not.toThrow();
    expect(SlackApp.GetFileContentAsync).not.toHaveBeenCalled();
  });
});
