'use strict';

const ContextResolution = require('../src/reminder-context-resolution');

// GH-143 Phase 2. Red before this module existed: four entry paths each decided enrichment for
// themselves, two did the lookback and two did not, so the same sentence produced a synthesized,
// correctly-owned task through one door and a verbatim, wrongly-owned one through another.

/** A SlackApp stub whose thread/channel history is whatever the test hands it. */
function MakeSlackApp({ Thread = [], Channel = [] } = {}) {
  return {
    Logger: { info: () => {}, warn: () => {}, error: () => {} },
    GetConversationMessagesAsync: async () => Thread,
    GetRecentChannelMessagesAsync: async () => Channel,
  };
}

const PARENT = { user: 'U_NOEL', text: 'Could you please file a new GH issue?', ts: '100.0001' };
const REPLY = { user: 'U_SAM', text: "<@U_NOEL> can do I'll work on it today", ts: '100.0002' };

describe('reference detection', () => {
  test.each([
    ["can do I'll work on it today", 'vague_completion'],
    ['can you follow up on it tomorrow', 'vague_reference'],
    ['see above, will handle by friday', 'above_reference'],
    ['per above — needs doing monday', 'above_reference'],
    ['get it done by monday', 'object_position_pronoun'],
  ])('%s → %s', (ArgText, ArgShape) => {
    expect(ContextResolution.DescribeReferenceShape(ArgText)).toBe(ArgShape);
    expect(ContextResolution.NeedsEarlierContext(ArgText)).toBe(true);
  });

  test('a self-contained task needs no earlier context', () => {
    expect(ContextResolution.DescribeReferenceShape('deploy the release friday')).toBeNull();
    expect(ContextResolution.NeedsEarlierContext('deploy the release friday')).toBe(false);
  });

  test('a pronoun in SUBJECT position is small talk, not a reference', () => {
    expect(ContextResolution.NeedsEarlierContext('it will rain on friday')).toBe(false);
  });
});

describe('ResolveContextAsync', () => {
  const FlagNames = ['CHANNEL_ANTECEDENT_LOOKBACK_ENABLED', 'REACTION_CONTEXT_RESOLUTION_ENABLED'];
  const Original = Object.fromEntries(FlagNames.map(ArgName => [ArgName, process.env[ArgName]]));
  beforeEach(() => FlagNames.forEach(ArgName => delete process.env[ArgName]));
  afterEach(() => {
    for(const Name of FlagNames) {
      if(Original[Name] === undefined) delete process.env[Name];
      else process.env[Name] = Original[Name];
    }
  });

  test('THE PRODUCTION CASE: a thread reply pointing backward is enriched with its antecedent', async () => {
    const SlackApp = MakeSlackApp({ Thread: [PARENT, REPLY] });
    const Result = await ContextResolution.ResolveContextAsync(SlackApp, {
      channel: 'C1', ts: REPLY.ts, thread_ts: PARENT.ts, user: REPLY.user, text: REPLY.text,
    });

    expect(Result.enriched).toBe(true);
    expect(Result.text).toContain(PARENT.text);          // the ask the reply refers to
    expect(Result.text).toContain(REPLY.text);
    expect(Result.liveReplyText).toBe(REPLY.text);       // ownership needs the reply ALONE
    expect(Result.enrichment).toEqual({ SourceTs: PARENT.ts, Path: 'vague_completion_in_thread' });
    expect(Result.prependedCount).toBe(1);
  });

  test('prepends at most three preceding human messages, oldest first', async () => {
    const Thread = [
      { user: 'U_A', text: 'one', ts: '1' }, { user: 'U_A', text: 'two', ts: '2' },
      { user: 'U_A', text: 'three', ts: '3' }, { user: 'U_A', text: 'four', ts: '4' },
      { user: 'U_B', text: 'will do it today', ts: '5' },
    ];
    const Result = await ContextResolution.ResolveContextAsync(MakeSlackApp({ Thread }), {
      channel: 'C1', ts: '5', thread_ts: '1', user: 'U_B', text: 'will do it today',
    });
    expect(Result.prependedCount).toBe(ContextResolution.THREAD_LOOKBACK_MAX_MESSAGES);
    expect(Result.text.startsWith('two\nthree\nfour\n')).toBe(true);
    expect(Result.text).not.toContain('one');
  });

  test('bot messages are never used as antecedents', async () => {
    const Thread = [
      { user: 'U_BOT', text: 'Tasks for Today:', ts: '1', bot_id: 'B1' },
      { user: 'U_B', text: 'will do it today', ts: '2' },
    ];
    const Result = await ContextResolution.ResolveContextAsync(MakeSlackApp({ Thread }), {
      channel: 'C1', ts: '2', thread_ts: '1', user: 'U_B', text: 'will do it today',
    });
    expect(Result.enriched).toBe(false);
    expect(Result.decidedBy).toBe('no_antecedent');
  });

  test('a self-contained message is left alone even inside a thread', async () => {
    const Result = await ContextResolution.ResolveContextAsync(MakeSlackApp({ Thread: [PARENT, REPLY] }), {
      channel: 'C1', ts: REPLY.ts, thread_ts: PARENT.ts, user: 'U_SAM', text: 'deploy the release friday',
    });
    expect(Result.enriched).toBe(false);
    expect(Result.decidedBy).toBe('no_reference');
    expect(Result.text).toBe('deploy the release friday');
  });

  test('RequireReference:false enriches anyway — the reaction path, where the human asserted intent', async () => {
    const Result = await ContextResolution.ResolveContextAsync(
      MakeSlackApp({ Thread: [PARENT, REPLY] }),
      { channel: 'C1', ts: REPLY.ts, thread_ts: PARENT.ts, user: 'U_SAM', text: 'ship the thing' },
      { RequireReference: false, PathPrefix: 'alarm_clock_reaction' }
    );
    expect(Result.enriched).toBe(true);
    expect(Result.enrichment?.Path).toBe('alarm_clock_reaction_in_thread');
  });

  test('outside a thread the channel walk stays behind its kill switch', async () => {
    const Channel = [{ user: 'U_SAM', text: 'file the GH issue please', ts: '99' }];
    const EventInfo = { channel: 'C1', ts: '100', thread_ts: null, user: 'U_SAM', text: 'will do it today' };

    const Off = await ContextResolution.ResolveContextAsync(MakeSlackApp({ Channel }), EventInfo);
    expect(Off.enriched).toBe(false);
    expect(Off.decidedBy).toBe('channel_lookback_disabled');

    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = 'on';
    const On = await ContextResolution.ResolveContextAsync(MakeSlackApp({ Channel }), EventInfo);
    expect(On.enriched).toBe(true);
    expect(On.enrichment?.Path).toBe('vague_completion_in_channel');
  });

  test('channel antecedents require participant continuity, not just recency', async () => {
    process.env.CHANNEL_ANTECEDENT_LOOKBACK_ENABLED = 'on';
    const Channel = [{ user: 'U_STRANGER', text: 'unrelated chatter', ts: '99' }];
    const Result = await ContextResolution.ResolveContextAsync(MakeSlackApp({ Channel }), {
      channel: 'C1', ts: '100', thread_ts: null, user: 'U_SAM', text: 'will do it today',
    });
    expect(Result.enriched).toBe(false);
  });

  test('a lookback failure loses the context, never the reminder', async () => {
    const SlackApp = MakeSlackApp();
    SlackApp.GetConversationMessagesAsync = async () => { throw new Error('slack down'); };
    const Result = await ContextResolution.ResolveContextAsync(SlackApp, {
      channel: 'C1', ts: '2', thread_ts: '1', user: 'U_B', text: 'will do it today',
    });
    expect(Result.enriched).toBe(false);
    expect(Result.decidedBy).toBe('fetch_failed');
    expect(Result.text).toBe('will do it today');   // still schedulable
  });

  test('the reaction kill switch defaults ON and is explicitly disablable', () => {
    expect(ContextResolution.IsReactionContextResolutionEnabled()).toBe(true);
    process.env.REACTION_CONTEXT_RESOLUTION_ENABLED = 'off';
    expect(ContextResolution.IsReactionContextResolutionEnabled()).toBe(false);
  });
});
