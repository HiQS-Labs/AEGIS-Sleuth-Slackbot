'use strict';

const {
  FindRelatedOpenReminders,
  BuildRelatedFootnote,
} = require('../src/connection-surfacing');

const CLIENT_A_CLIENT = {
  ClientName: 'Client A',
  Aliases: ['client-a'],
  ChannelIDs: [],
  ChannelNamePatterns: ['client-a'],
  GitHubRepoPatterns: ['client-a'],
};

function MakeReminder(ArgId, ArgOverrides = {}) {
  return {
    ReminderID: ArgId,
    State: ArgOverrides.State || 'scheduled',
    OriginalChannelName: ArgOverrides.OriginalChannelName ?? null,
    OriginalChannelID: ArgOverrides.OriginalChannelID ?? null,
    GitHubUrls: ArgOverrides.GitHubUrls ?? null,
  };
}

describe('connection surfacing', () => {
  test('surfaces a related open reminder that shares a GitHub URL', () => {
    const Url = 'https://github.com/o/r/pull/47';
    const NewReminders = [MakeReminder('new1', { GitHubUrls: [Url] })];
    const OpenReminders = [
      MakeReminder('new1', { GitHubUrls: [Url] }), // the new one itself — must be excluded.
      MakeReminder('open1', { GitHubUrls: [Url] }),
    ];
    const Items = FindRelatedOpenReminders(NewReminders, OpenReminders, []);
    expect(Items).toEqual([{ Label: 'PR #47', Count: 1 }]);
    expect(BuildRelatedFootnote(Items)).toBe('↳ Related: PR #47 (1 open reminder)');
  });

  test('surfaces a related open reminder that shares a client', () => {
    const NewReminders = [MakeReminder('new1', { OriginalChannelName: 'client-a-eng' })];
    const OpenReminders = [MakeReminder('open1', { OriginalChannelName: 'client-a-design' })];
    const Items = FindRelatedOpenReminders(NewReminders, OpenReminders, [CLIENT_A_CLIENT]);
    expect(Items).toEqual([{ Label: 'Client A', Count: 1 }]);
  });

  test('no footnote when there is nothing related', () => {
    const NewReminders = [MakeReminder('new1', { GitHubUrls: ['https://github.com/o/r/pull/47'] })];
    const OpenReminders = [MakeReminder('open1', { GitHubUrls: ['https://github.com/o/r/pull/999'] })];
    const Items = FindRelatedOpenReminders(NewReminders, OpenReminders, []);
    expect(Items).toEqual([]);
    expect(BuildRelatedFootnote(Items)).toBe('');
  });

  test('footnote is capped at three labels', () => {
    const Urls = ['a', 'b', 'c', 'd'].map(ArgN => `https://github.com/o/r/pull/${ArgN === 'a' ? 1 : ArgN === 'b' ? 2 : ArgN === 'c' ? 3 : 4}`);
    const NewReminders = [MakeReminder('new1', { GitHubUrls: Urls })];
    const OpenReminders = Urls.map((ArgUrl, ArgIndex) => MakeReminder(`open${ArgIndex}`, { GitHubUrls: [ArgUrl] }));
    const Items = FindRelatedOpenReminders(NewReminders, OpenReminders, []);
    expect(Items).toHaveLength(3);
  });

  test('a new reminder is never surfaced as related to itself', () => {
    const Url = 'https://github.com/o/r/pull/47';
    const NewReminders = [MakeReminder('new1', { GitHubUrls: [Url] })];
    const OpenReminders = [MakeReminder('new1', { GitHubUrls: [Url] })];
    expect(FindRelatedOpenReminders(NewReminders, OpenReminders, [])).toEqual([]);
  });

  test('BuildRelatedFootnote appends a remembered-thread count', () => {
    const Items = [{ Label: 'PR #47', Count: 2 }];
    expect(BuildRelatedFootnote(Items, 1)).toBe('↳ Related: PR #47 (2 open reminders), 1 remembered thread');
    expect(BuildRelatedFootnote([], 2)).toBe('↳ Related: 2 remembered threads');
  });
});
