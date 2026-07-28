'use strict';

const {
  ClusterRemindersByRelationship,
  RenderClusteredReminders,
  GitHubRefFromUrl,
} = require('../src/reminder-clustering');

const CLIENT_A_CLIENT = {
  ClientName: 'Client A',
  Aliases: ['client-a'],
  ChannelIDs: [],
  ChannelNamePatterns: ['client-a'],
  GitHubRepoPatterns: ['client-a'],
};

/** Build a minimal reminder for clustering. */
function MakeReminder(ArgId, ArgOverrides = {}) {
  return {
    ReminderID: ArgId,
    State: ArgOverrides.State || 'scheduled',
    ReminderMessageText: ArgOverrides.ReminderMessageText || `Task ${ArgId}`,
    OriginalChannelName: ArgOverrides.OriginalChannelName ?? null,
    OriginalChannelID: ArgOverrides.OriginalChannelID ?? null,
    GitHubUrls: ArgOverrides.GitHubUrls ?? null,
  };
}

describe('reminder clustering', () => {
  test('GitHubRefFromUrl labels PRs and issues', () => {
    expect(GitHubRefFromUrl('https://github.com/o/r/pull/47')).toBe('PR #47');
    expect(GitHubRefFromUrl('https://github.com/o/r/issues/52')).toBe('#52');
  });

  test('reminders sharing a GitHub URL cluster together', () => {
    const Url = 'https://github.com/o/r/pull/47';
    const Reminders = [
      MakeReminder('r1', { GitHubUrls: [Url], ReminderMessageText: 'Fix checkout validation bug' }),
      MakeReminder('r2', { GitHubUrls: [Url], ReminderMessageText: 'Review PR #47 changes' }),
    ];
    const Clusters = ClusterRemindersByRelationship(Reminders, []);
    expect(Clusters).toHaveLength(1);
    expect(Clusters[0].Kind).toBe('github');
    expect(Clusters[0].Label).toBe('PR #47');
    expect(Clusters[0].Reminders).toHaveLength(2);
  });

  test('reminders matching the same client cluster together', () => {
    const Reminders = [
      MakeReminder('r1', { OriginalChannelName: 'client-a-eng' }),
      MakeReminder('r2', { OriginalChannelName: 'client-a-design' }),
    ];
    const Clusters = ClusterRemindersByRelationship(Reminders, [CLIENT_A_CLIENT]);
    expect(Clusters).toHaveLength(1);
    expect(Clusters[0].Kind).toBe('client');
    expect(Clusters[0].Label).toBe('Client A');
    expect(Clusters[0].Reminders).toHaveLength(2);
  });

  test('a lone GitHub reminder forms a valid single-member cluster that renders', () => {
    const Reminders = [
      MakeReminder('r1', { GitHubUrls: ['https://github.com/o/r/pull/99'], ReminderMessageText: 'Ship release' }),
    ];
    const Clusters = ClusterRemindersByRelationship(Reminders, []);
    expect(Clusters).toHaveLength(1);
    expect(Clusters[0].Reminders).toHaveLength(1);
    const Rendered = RenderClusteredReminders(Clusters);
    expect(Rendered).toContain('*PR #99* (1)');
    expect(Rendered).toContain('1. Ship release');
  });

  test('Ungrouped reminders always render last', () => {
    const Reminders = [
      MakeReminder('r1', { OriginalChannelName: null, ReminderMessageText: 'Loose task' }),
      MakeReminder('r2', { GitHubUrls: ['https://github.com/o/r/pull/47'] }),
      MakeReminder('r3', { GitHubUrls: ['https://github.com/o/r/pull/47'] }),
    ];
    const Clusters = ClusterRemindersByRelationship(Reminders, []);
    expect(Clusters[0].Kind).toBe('github');
    expect(Clusters.at(-1).Kind).toBe('other');
    expect(Clusters.at(-1).Reminders[0].ReminderID).toBe('r1');
  });

  test('flat output (no headers) when no relationships exist', () => {
    const Reminders = [
      MakeReminder('r1', { ReminderMessageText: 'Book team lunch' }),
      MakeReminder('r2', { ReminderMessageText: 'Renew domain' }),
    ];
    const Clusters = ClusterRemindersByRelationship(Reminders, [CLIENT_A_CLIENT]);
    expect(Clusters).toHaveLength(1);
    expect(Clusters[0].Kind).toBe('other');

    const Rendered = RenderClusteredReminders(Clusters);
    expect(Rendered).not.toContain('*');
    expect(Rendered).toBe('  1. Book team lunch\n  2. Renew domain');
  });

  test('clusters are ordered by size descending with continuous numbering', () => {
    const PrUrl = 'https://github.com/o/r/pull/47';
    const Reminders = [
      MakeReminder('r1', { OriginalChannelName: 'client-a-eng' }),
      MakeReminder('r2', { GitHubUrls: [PrUrl] }),
      MakeReminder('r3', { GitHubUrls: [PrUrl] }),
      MakeReminder('r4', { GitHubUrls: [PrUrl] }),
    ];
    const Clusters = ClusterRemindersByRelationship(Reminders, [CLIENT_A_CLIENT]);
    // github cluster (3) should sort before the client cluster (1).
    expect(Clusters[0].Kind).toBe('github');
    expect(Clusters[0].Reminders).toHaveLength(3);
    const Rendered = RenderClusteredReminders(Clusters);
    expect(Rendered).toContain('*PR #47* (3)');
    expect(Rendered).toContain('*Client A* (1)');
  });
});
