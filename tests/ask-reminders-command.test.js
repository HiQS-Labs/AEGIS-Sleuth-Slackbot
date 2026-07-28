'use strict';

const {
  HandleAskRemindersCommandAsync,
  ParseReminderQuery,
  RenderCitedCandidates,
  StripInternalReminderIds,
} = require('../src/chat-commands/ask-reminders-command');

// data/static/client-channel-mapping.json ships a "client-a" client (ChannelNamePatterns:["client-a"]).

/** A ReminderInfo-shaped active reminder (what RemindersModule.GetAllReminders returns — Date fields). */
function ActiveReminder(ArgOverrides) {
  return {
    ReminderID: ArgOverrides.ReminderID || 'r-active',
    ReminderMessageText: ArgOverrides.ReminderMessageText ?? 'do the thing',
    AssigneeID: ArgOverrides.AssigneeID ?? null,
    OriginalSenderID: ArgOverrides.OriginalSenderID ?? 'U_SENDER',
    OriginalChannelID: ArgOverrides.OriginalChannelID ?? 'C_PUB',
    OriginalMessageID: ArgOverrides.OriginalMessageID ?? 'm-1',
    TargetChannelID: ArgOverrides.TargetChannelID ?? 'C_PUB',
    // Real GetAllReminders() returns Date objects (JSON reviver in reminders-module); the poster calls
    // .getTime() on CreatedOn/ShouldPostOn, so the fixtures must be Dates too.
    CreatedOn: ArgOverrides.CreatedOn ?? new Date('2026-07-14T00:00:00.000Z'),
    ShouldPostOn: ArgOverrides.ShouldPostOn ?? new Date('2026-07-15T16:00:00.000Z'),
    State: ArgOverrides.State ?? 'scheduled',
    clientId: ArgOverrides.clientId ?? null,
  };
}

function MakeSlackApp(ArgOverrides) {
  const ProcessMessage = jest.fn().mockResolvedValue('Here you go: id:r-client-a.');
  return {
    Logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
    PostMessageTextAsync: jest.fn().mockResolvedValue('ts-1'),
    GetPermaLinkAsync: jest.fn().mockResolvedValue('https://slack.example/permalink'),
    WorkspaceInfo: { WORKSPACE_NAME: 'test-workspace', MAIN_TIMEZONE: 'America/Los_Angeles' },
    WorkspaceAI: { ProcessMessageWithTextResponseAsync: ProcessMessage, ComplexModelName: 'gpt-x' },
    // default: all channels public
    IsChannelPrivateAsync: jest.fn().mockResolvedValue(false),
    RemindersModule: {
      GetAllReminders: () => ArgOverrides.active || [],
      GetCompletedRemindersBetween: () => ArgOverrides.completed || [],
    },
    _processMessage: ProcessMessage,
  };
}

const EVENT = { channel: 'C_HERE', ts: '123.456' };

/**
 * The ReminderIDs the canonical poster attached to individual reminder messages (GH-391). The poster
 * stamps each per-reminder message with metadata.event_payload.ReminderIDs = JSON.stringify([id]);
 * summary/section-label posts carry no metadata. This is the user-facing, reaction-actionable output.
 */
function PostedReminderIds(ArgApp) {
  return ArgApp.PostMessageTextAsync.mock.calls
    .map((ArgCall) => ArgCall[3] && ArgCall[3].event_payload && ArgCall[3].event_payload.ReminderIDs)
    .filter(Boolean)
    .flatMap((ArgJson) => JSON.parse(ArgJson));
}

/** Every text string posted to the channel (summary lines, section labels, reminder lines). */
function PostedTexts(ArgApp) {
  return ArgApp.PostMessageTextAsync.mock.calls.map((ArgCall) => String(ArgCall[2] ?? ''));
}

describe('ParseReminderQuery', () => {
  const opts = { clients: [{ ClientID: 'client-a', ClientName: 'Client A', Aliases: ['client-a'] }], nowMs: Date.parse('2026-07-15T19:00:00Z'), timezone: 'America/Los_Angeles' };

  test('extracts assignee mentions, client, and a time window', () => {
    const q = ParseReminderQuery('what did <@U0MIKE> have last week for Client A', opts);
    expect(q.userIds).toEqual(['U0MIKE']);
    expect(q.clientId).toBe('client-a');
    expect(q.timeLabel).toBe('last week');
    expect(q.timeWindow.startMs).toBe(Date.parse('2026-07-06T07:00:00Z'));
  });

  test('no filters when nothing matches', () => {
    const q = ParseReminderQuery('how are things going', opts);
    expect(q.userIds).toBeNull();
    expect(q.clientId).toBeNull();
    expect(q.timeWindow).toBeNull();
  });

  test('routes creator intent to senderIds; keeps assignee for "have" queries (#380)', () => {
    const co = { ...opts, selfUserId: 'U_ME' };

    const created = ParseReminderQuery('what tasks did I create yesterday?', co);
    expect(created.senderIds).toEqual(['U_ME']); // first-person creator → self
    expect(created.userIds).toBeNull();
    expect(created.timeLabel).toBe('yesterday');

    const byMatt = ParseReminderQuery('what did <@U0MATT> create?', co);
    expect(byMatt.senderIds).toEqual(['U0MATT']); // mentioned creator
    expect(byMatt.userIds).toBeNull();

    const assignee = ParseReminderQuery('what does <@U0MATT> have for Client A?', co);
    expect(assignee.userIds).toEqual(['U0MATT']); // "have" → assignee, unchanged
    expect(assignee.senderIds).toBeNull();

    const passive = ParseReminderQuery('what was created yesterday?', co);
    expect(passive.senderIds).toBeNull(); // no subject → no user filter, just the time window
    expect(passive.userIds).toBeNull();
  });
});

describe('RenderCitedCandidates', () => {
  test('does not crash on a completed candidate with a NaN timestamp (malformed completedMs)', () => {
    // AssembleCandidates emits timestampMs: NaN for a completion whose completedMs is not a number,
    // and NaN passes FilterCandidates' time guard — so the renderer must not new Date(NaN).toISOString().
    const line = RenderCitedCandidates([
      { id: 'r-bad', text: 'orphaned completion', isCompleted: true, timestampMs: Number.NaN, assigneeId: 'U1', clientId: 'client-a' },
    ]);
    expect(line).toContain('COMPLETED id:r-bad');
    expect(line).not.toContain('completedAt:'); // omitted rather than throwing
  });

  test('renders completedAt for a valid completed timestamp', () => {
    const line = RenderCitedCandidates([
      { id: 'r-ok', text: 'done', isCompleted: true, timestampMs: Date.parse('2026-07-10T00:00:00Z') },
    ]);
    expect(line).toContain('completedAt:2026-07-10T00:00:00.000Z');
  });
});

describe('StripInternalReminderIds (GH-391)', () => {
  test('removes id: citations (parenthesized or bare) and keeps the prose', () => {
    expect(StripInternalReminderIds('Ship it (id:abc-123) today')).toBe('Ship it today');
    expect(StripInternalReminderIds('id:r-1 do the thing')).toBe('do the thing');
    expect(StripInternalReminderIds('nothing to strip here')).toBe('nothing to strip here');
  });

  test('strips a space after the colon and bracketed ids without leaving residue (consult review)', () => {
    expect(StripInternalReminderIds('id: r-1 do the thing')).toBe('do the thing'); // space after colon
    expect(StripInternalReminderIds('[id:r-1] do the thing')).toBe('do the thing'); // no leftover []
    expect(StripInternalReminderIds('Done ID:ABC-9')).toBe('Done'); // case-insensitive, trailing
  });

  test('is a no-op on non-strings', () => {
    expect(StripInternalReminderIds(null)).toBeNull();
    expect(StripInternalReminderIds(undefined)).toBeUndefined();
  });
});

describe('HandleAskRemindersCommandAsync', () => {
  test('narrows to the client and renders open matches as individual reactable messages (GH-391)', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-client-a', clientId: 'client-a', OriginalChannelID: 'C_PUB', ReminderMessageText: 'ship client-a plugin upgrades' }),
        ActiveReminder({ ReminderID: 'r-acme', clientId: 'acme', OriginalChannelID: 'C_PUB', ReminderMessageText: 'acme billing' }),
      ],
    });
    await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");

    // Open results render via the canonical poster — no model blob, no raw ids user-facing.
    expect(app._processMessage).not.toHaveBeenCalled();
    const posted = PostedReminderIds(app);
    expect(posted).toContain('r-client-a');
    expect(posted).not.toContain('r-acme'); // narrowed by client
    expect(PostedTexts(app).join('\n')).not.toMatch(/id:r-/); // no debug ids leaked to the channel
  });

  test('caps the open render to avoid flooding the channel and says so (consult review)', async () => {
    // 16 open client-a reminders > the 15-message cap.
    const active = [];
    for(let i = 0; i < 16; i++) {
      active.push(ActiveReminder({
        ReminderID: `r-${i}`,
        clientId: 'client-a',
        OriginalChannelID: 'C_PUB',
        ShouldPostOn: new Date(Date.UTC(2026, 6, 15, 8, i)), // distinct, so "soonest-due" ordering is real
      }));
    }
    const app = MakeSlackApp({ active });
    await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");

    const posted = PostedReminderIds(app);
    expect(posted).toHaveLength(15); // capped — not 16 individual messages
    expect(new Set(posted).size).toBe(15); // no dupes
    expect(PostedTexts(app).join('\n')).toContain('Showing the 15 soonest-due of 16 open tasks');
  });

  test('creator query filters by sender (assignor), not assignee (#380)', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-mine', clientId: 'client-a', OriginalSenderID: 'U_ME', AssigneeID: 'U_SOMEONE', OriginalChannelID: 'C_PUB', ReminderMessageText: 'ship client-a thing I raised' }),
        ActiveReminder({ ReminderID: 'r-theirs', clientId: 'client-a', OriginalSenderID: 'U_OTHER', AssigneeID: 'U_ME', OriginalChannelID: 'C_PUB', ReminderMessageText: 'client-a thing assigned to me' }),
      ],
    });
    // Event from U_ME. "what did I create for client-a?" → senderId==U_ME + client client-a, no time.
    await HandleAskRemindersCommandAsync(app, { channel: 'C_HERE', ts: '123.456', user: 'U_ME' }, 'what did I create for client-a?');

    const posted = PostedReminderIds(app);
    expect(posted).toContain('r-mine');    // created by me
    expect(posted).not.toContain('r-theirs'); // assigned to me but created by someone else — excluded
  });

  test('empty result short-circuits with a canned reply and NO model call', async () => {
    const app = MakeSlackApp({
      active: [ActiveReminder({ ReminderID: 'r-acme', clientId: 'acme', OriginalChannelID: 'C_PUB' })],
    });
    await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");

    expect(app._processMessage).not.toHaveBeenCalled();
    const [, , text] = app.PostMessageTextAsync.mock.calls[0];
    expect(text).toMatch(/no matching tasks/i);
  });

  test('a private-channel reminder is excluded from a public-channel query', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-client-a-pub', clientId: 'client-a', OriginalChannelID: 'C_PUB' }),
        ActiveReminder({ ReminderID: 'r-client-a-priv', clientId: 'client-a', OriginalChannelID: 'C_SECRET' }),
      ],
    });
    app.IsChannelPrivateAsync = jest.fn().mockImplementation((id) => Promise.resolve(id === 'C_SECRET'));

    await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");

    const posted = PostedReminderIds(app);
    expect(posted).toContain('r-client-a-pub');
    expect(posted).not.toContain('r-client-a-priv'); // private channel scoped out
  });

  test('a private-channel reminder IS included when the asking user is a member (need-to-know)', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-client-a-pub', clientId: 'client-a', OriginalChannelID: 'C_PUB' }),
        ActiveReminder({ ReminderID: 'r-client-a-priv', clientId: 'client-a', OriginalChannelID: 'C_SECRET' }),
      ],
    });
    app.IsChannelPrivateAsync = jest.fn().mockImplementation((id) => Promise.resolve(id === 'C_SECRET'));
    // The asker (U_MEMBER) belongs to C_SECRET but no other private channel.
    app.IsUserChannelMemberAsync = jest.fn().mockImplementation((ch, user) => Promise.resolve(ch === 'C_SECRET' && user === 'U_MEMBER'));

    await HandleAskRemindersCommandAsync(app, { channel: 'C_HERE', ts: '123.456', user: 'U_MEMBER' }, "what's open for client-a?");

    const posted = PostedReminderIds(app);
    expect(posted).toContain('r-client-a-pub');
    expect(posted).toContain('r-client-a-priv'); // member of the private channel → visible
    expect(app.IsUserChannelMemberAsync).toHaveBeenCalledWith('C_SECRET', 'U_MEMBER');
  });

  test('a private-channel reminder stays excluded when the asking user is NOT a member', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-client-a-pub', clientId: 'client-a', OriginalChannelID: 'C_PUB' }),
        ActiveReminder({ ReminderID: 'r-client-a-priv', clientId: 'client-a', OriginalChannelID: 'C_SECRET' }),
      ],
    });
    app.IsChannelPrivateAsync = jest.fn().mockImplementation((id) => Promise.resolve(id === 'C_SECRET'));
    app.IsUserChannelMemberAsync = jest.fn().mockResolvedValue(false); // not a member of any private channel

    await HandleAskRemindersCommandAsync(app, { channel: 'C_HERE', ts: '123.456', user: 'U_OUTSIDER' }, "what's open for client-a?");

    const posted = PostedReminderIds(app);
    expect(posted).toContain('r-client-a-pub');
    expect(posted).not.toContain('r-client-a-priv'); // non-member never sees the private channel's task
  });

  test('an unresolved membership check fails closed (private channel stays excluded)', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-client-a-priv', clientId: 'client-a', OriginalChannelID: 'C_SECRET' }),
      ],
    });
    app.IsChannelPrivateAsync = jest.fn().mockResolvedValue(true);
    app.IsUserChannelMemberAsync = jest.fn().mockResolvedValue(null); // membership API inconclusive

    await HandleAskRemindersCommandAsync(app, { channel: 'C_HERE', ts: '123.456', user: 'U_MAYBE' }, "what's open for client-a?");

    expect(PostedReminderIds(app)).not.toContain('r-client-a-priv'); // null membership → treated not-a-member
  });

  test('the command channel is always allowed even if private', async () => {
    const app = MakeSlackApp({
      active: [ActiveReminder({ ReminderID: 'r-here', clientId: 'client-a', OriginalChannelID: 'C_HERE' })],
    });
    app.IsChannelPrivateAsync = jest.fn().mockResolvedValue(true); // everything private, incl. C_HERE

    await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");

    expect(PostedReminderIds(app)).toContain('r-here');
  });

  test('prompts for a question when the query is empty', async () => {
    const app = MakeSlackApp({});
    await HandleAskRemindersCommandAsync(app, EVENT, '   ');
    expect(app.PostMessageTextAsync).toHaveBeenCalledTimes(1);
    expect(app._processMessage).not.toHaveBeenCalled();
  });

  test('simulated conversations.info failure with a WARM cache entry keeps matched set unchanged', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-warm', clientId: 'client-a', OriginalChannelID: 'C_WARM' }),
      ],
    });
    // first, resolve successfully to warm the cache.
    app.IsChannelPrivateAsync = jest.fn().mockResolvedValue(false);
    app.WorkspaceInfo = { WORKSPACE_NAME: 'test-warm-workspace', MAIN_TIMEZONE: 'America/Los_Angeles' };

    const res1 = await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");
    expect(res1.unresolvedCount).toBe(0);
    expect(PostedReminderIds(app)).toContain('r-warm');

    // second run: conversations.info fails (returns null or throws), but because of the warm cache, it is still public.
    app.IsChannelPrivateAsync = jest.fn().mockResolvedValue(null);
    app.PostMessageTextAsync.mockClear();

    const res2 = await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");
    expect(res2.unresolvedCount).toBe(0);
    expect(PostedReminderIds(app)).toContain('r-warm'); // warm cache keeps it public → still rendered
  });

  test('a cold or errored lookup still excludes and returns unresolved status', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-cold', clientId: 'client-a', OriginalChannelID: 'C_COLD' }),
      ],
    });
    // cold lookup fails (returns null).
    app.IsChannelPrivateAsync = jest.fn().mockResolvedValue(null);
    app.WorkspaceInfo = { WORKSPACE_NAME: 'test-cold-workspace', MAIN_TIMEZONE: 'America/Los_Angeles' };

    const res = await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");
    expect(res.unresolvedCount).toBe(1);
    // because C_COLD is unresolved, it is treated as private (fail-closed), so active reminder in C_COLD is excluded.
    // result has no active candidate channels allowed, so empty matches.
    expect(res.matchedCount).toBe(0);
    expect(app._processMessage).not.toHaveBeenCalled();

    // verify correct "may be incomplete" error message was sent.
    const lastMessage = app.PostMessageTextAsync.mock.calls[app.PostMessageTextAsync.mock.calls.length - 1][2];
    expect(lastMessage).toContain("Couldn't verify 1 channel(s) right now — results may be incomplete, try again.");
  });

  test('genuine empty results with all resolved returns standard copy', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-resolved', clientId: 'other-client', OriginalChannelID: 'C_RESOLVED' }),
      ],
    });
    // resolved as public (false).
    app.IsChannelPrivateAsync = jest.fn().mockResolvedValue(false);
    app.WorkspaceInfo = { WORKSPACE_NAME: 'test-empty-workspace', MAIN_TIMEZONE: 'America/Los_Angeles' };

    // ask for client-a, which has no reminders.
    const res = await HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?");
    expect(res.unresolvedCount).toBe(0);
    expect(res.matchedCount).toBe(0);
    expect(app._processMessage).not.toHaveBeenCalled();

    const lastMessage = app.PostMessageTextAsync.mock.calls[app.PostMessageTextAsync.mock.calls.length - 1][2];
    expect(lastMessage).toBe('No matching tasks found for that query.');
  });

  test('a completed-history query keeps a prose answer but strips internal ids (GH-391)', async () => {
    const app = MakeSlackApp({
      active: [],
      completed: [
        { reminderId: 'r-done', summary: 'shipped client-a plugin v4', clientId: 'client-a', assigneeID: 'U_MATT', sourceChannelID: 'C_PUB', completedMs: Date.parse('2026-07-10T00:00:00Z') },
      ],
    });
    app._processMessage.mockResolvedValue('Alex finished it (id:r-done) last week.');

    // No open matches → the completed-history path phrases with the model, but ids never surface.
    const res = await HandleAskRemindersCommandAsync(app, EVENT, 'what was completed for client-a?');
    expect(res.matchedCount).toBe(1);
    expect(app._processMessage).toHaveBeenCalledTimes(1);

    const posted = PostedTexts(app).join('\n');
    expect(posted).toContain('Alex finished it');
    expect(posted).not.toMatch(/id:r-done/); // internal id stripped from user-facing output
    expect(PostedReminderIds(app)).toEqual([]); // completed items are not reaction-actionable messages
  });

  test('contains channel_not_found failures in both the main reply and the catch reply', async () => {
    const app = MakeSlackApp({
      active: [
        ActiveReminder({ ReminderID: 'r-client-a', clientId: 'client-a', OriginalChannelID: 'C_PUB' }),
      ],
    });
    app.WorkspaceInfo = { WORKSPACE_NAME: 'hardening-workspace', MAIN_TIMEZONE: 'America/Los_Angeles' };
    app.PostMessageTextAsync = jest.fn().mockRejectedValue(new Error('Failed to post message: channel_not_found'));

    await expect(HandleAskRemindersCommandAsync(app, EVENT, "what's open for client-a?")).resolves.toEqual({
      matchedCount: 0,
      unresolvedCount: 0,
    });

    // GH-391: open results post via the poster (summary attempt = call #1, throws), then the catch
    // block's fallback reply = call #2. The model is no longer invoked for an open-reminder listing.
    expect(app.PostMessageTextAsync).toHaveBeenCalledTimes(2);
    expect(app._processMessage).not.toHaveBeenCalled();

    const ErrorLogMessages = app.Logger.error.mock.calls.map((ArgCall) => String(ArgCall[0]));
    expect(ErrorLogMessages[0]).toContain('ask-reminders failed (workspace=hardening-workspace channel=C_HERE command=ask-reminders):');
    expect(ErrorLogMessages[1]).toContain('ask-reminders fallback reply failed (workspace=hardening-workspace channel=C_HERE command=ask-reminders originalError="Failed to post message: channel_not_found"):');
    expect(ErrorLogMessages[2]).toContain('ask-reminders fallback delivery unavailable (workspace=hardening-workspace channel=C_HERE command=ask-reminders originalError="Failed to post message: channel_not_found"): no DM or ephemeral SlackApp helper is available.');
  });
});
