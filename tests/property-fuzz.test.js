'use strict';

// GH-169: seeded property test over the two pure text functions, plus a malformed-Slack-event
// corpus through MockSlackApp. No new dependency: the generator is a ten-line mulberry32.
//
// Replay any failure in one command:  PROPERTY_SEED=<n> npx jest tests/property-fuzz.test.js
// The seed is printed in every describe name, so a CI log carries it.

jest.mock('../src/workspace-ai');

const { MarkdownToMrkdwn } = require('../src/markdown-to-mrkdwn');
const {
  LoadCommandIntentAssetsAsync,
  NormalizeDirectCommandTextAsync,
  ResolveModelAliasAsync,
} = require('../src/command-intent-resolver');
const NormalizationConfig = require('../data/static/ai/command-normalization.json');
const MockWorkspaceAI = require('../src/workspace-ai');
const { ConfigureMockWorkspaceAI } = require('./mocks/mock-workspace-ai');
const { MockSlackApp } = require('./mocks/mock-slack-app');
const ChatModule = require('../src/chat-module');
const RemindersModule = require('../src/reminders-module');

// ---------------------------------------------------------------------------------------------
// seed + generator
// ---------------------------------------------------------------------------------------------

/** The seed: PROPERTY_SEED from the environment, else the clock. */
const Seed = (() => {
  const FromEnv = Number.parseInt(process.env.PROPERTY_SEED || '', 10);
  return Number.isFinite(FromEnv) ? FromEnv >>> 0 : (Date.now() >>> 0);
})();

/**
 * mulberry32 — a 32-bit seeded PRNG, deterministic per seed.
 * @param {number} ArgSeed
 * @returns {() => number} Uniform in [0, 1).
 */
function Mulberry32(ArgSeed) {
  let State = ArgSeed >>> 0;
  return () => {
    State = (State + 0x6D2B79F5) >>> 0;
    let T = State;
    T = Math.imul(T ^ (T >>> 15), T | 1);
    T ^= T + Math.imul(T ^ (T >>> 7), T | 61);
    return ((T ^ (T >>> 14)) >>> 0) / 4294967296;
  };
}

// the families, each with an explicit weight so none is starved. The zero-width, bidi, surrogate
// and delimiter vectors are the high-yield ones from the XYZ-forge GH-299 soak.
const AsciiPrintable = Array.from({ length: 94 }, (_, ArgIndex) => String.fromCharCode(33 + ArgIndex));
const AsciiNonLetters = AsciiPrintable.filter((ArgChar) => !/[a-z]/i.test(ArgChar));
const Metachars = ['*', '_', '~', '`', '#', '[', ']', '(', ')', '<', '>', '|', '-', '+', '!', '\\'];
const Whitespace = [' ', '  ', '\t', '\n', '\n\n', ' \n '];
const ZeroWidth = ['\u200B', '\u200C', '\u200D'];
const BidiOverride = ['\u202E', '\u202D'];
const Surrogates = ['\uD83D', '\uDE00', '\u{1F600}', '\u{1F44D}\u{1F3FD}', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'];
const Delimiters = ['"', '""', "'", "''", '```', '```\n', '[[[[', ']]]]', '<', '((((', '**', '***', '[a](http://x'];

/** @type {Array<[string[], number]>} */
const AllFamilies = [
  [AsciiPrintable, 40], [Metachars, 20], [Whitespace, 15], [ZeroWidth, 5], [BidiOverride, 3],
  [Surrogates, 7], [Delimiters, 10],
];

/** Families with no ASCII letters at all — no model alias can match inside such a draw. */
const LetterFreeDelimiters = Delimiters.filter((ArgToken) => !/[a-z]/i.test(ArgToken));
/** @type {Array<[string[], number]>} */
const LetterFreeFamilies = [
  [AsciiNonLetters, 40], [Metachars, 20], [Whitespace, 15], [ZeroWidth, 5], [BidiOverride, 3],
  [Surrogates, 7], [LetterFreeDelimiters, 10],
];

/**
 * Draw one string of roughly ArgLength code units by concatenating weighted family picks.
 * @param {() => number} ArgRng
 * @param {number} ArgLength
 * @param {Array<[string[], number]>} ArgFamilies
 * @returns {string}
 */
function Draw(ArgRng, ArgLength, ArgFamilies) {
  const TotalWeight = ArgFamilies.reduce((ArgSum, [, ArgWeight]) => ArgSum + ArgWeight, 0);
  let Out = '';
  while(Out.length < ArgLength) {
    let Roll = ArgRng() * TotalWeight;
    for(const [ArgPool, ArgWeight] of ArgFamilies) {
      Roll -= ArgWeight;
      if(Roll > 0) continue;
      Out += ArgPool[Math.floor(ArgRng() * ArgPool.length)];
      break;
    }
  }
  return Out;
}

// per-draw wall-clock bounds. 4k: measured ~1ms isolated, so 50ms is a 50x margin. 40k: the
// quadratic link regex measured 593ms isolated and 1638ms inside the full parallel `npm test` on
// 2026-09-05 (CPU contention across jest workers), so 5000ms absorbs a loaded runner while a real
// catastrophic-backtracking regression, which grows superlinearly, still trips it.
const Bound4kMs = 50;
const Bound40kMs = 5000;
const BoundResolverMs = 20;

/**
 * Time one call and fail with the seed and draw label in the message when it exceeds the bound.
 * @param {() => any} ArgFn
 * @param {number} ArgBoundMs
 * @param {string} ArgLabel
 * @returns {any} Whatever ArgFn returned.
 */
function TimedUnder(ArgFn, ArgBoundMs, ArgLabel) {
  const Started = process.hrtime.bigint();
  const Result = ArgFn();
  const ElapsedMs = Number(process.hrtime.bigint() - Started) / 1e6;
  if(!(ElapsedMs < ArgBoundMs))
    throw new Error(`${ArgLabel} took ${ElapsedMs.toFixed(1)}ms (bound ${ArgBoundMs}ms) — replay with PROPERTY_SEED=${Seed}`);
  return Result;
}

/**
 * Async twin of TimedUnder.
 * @param {() => Promise<any>} ArgFn
 * @param {number} ArgBoundMs
 * @param {string} ArgLabel
 * @returns {Promise<any>}
 */
async function TimedUnderAsync(ArgFn, ArgBoundMs, ArgLabel) {
  const Started = process.hrtime.bigint();
  const Result = await ArgFn();
  const ElapsedMs = Number(process.hrtime.bigint() - Started) / 1e6;
  if(!(ElapsedMs < ArgBoundMs))
    throw new Error(`${ArgLabel} took ${ElapsedMs.toFixed(1)}ms (bound ${ArgBoundMs}ms) — replay with PROPERTY_SEED=${Seed}`);
  return Result;
}

// ---------------------------------------------------------------------------------------------
// block 1 — MarkdownToMrkdwn
// ---------------------------------------------------------------------------------------------

/**
 * Append a fenced block carrying content that WOULD be rewritten outside a fence. The random body
 * may itself contain an odd number of fence lines, which would invert fence parity, so close it
 * first when needed.
 * @param {string} ArgBody
 * @param {number} ArgIndex
 * @returns {{ Input: string, Sentinel: string }}
 */
function WithFencedSentinel(ArgBody, ArgIndex) {
  const OpenFences = ArgBody.split('\n').filter((ArgLine) => /^\s*```/.test(ArgLine)).length;
  const Closer = OpenFences % 2 === 1 ? '\n```' : '';
  const Sentinel = `**FENCE_SENTINEL_${ArgIndex}** [x](https://example.com/y) # not a heading`;
  return { Input: `${ArgBody}${Closer}\n\`\`\`\n${Sentinel}\n\`\`\`\n`, Sentinel };
}

describe(`GH-169 MarkdownToMrkdwn property (PROPERTY_SEED=${Seed})`, () => {
  test(`200 draws at 4k: never throws, returns a string, fenced content untouched, <${Bound4kMs}ms each`, () => {
    const Rng = Mulberry32(Seed);
    for(let Index = 0; Index < 200; Index++) {
      const { Input, Sentinel } = WithFencedSentinel(Draw(Rng, 4000, AllFamilies), Index);
      const Out = TimedUnder(() => MarkdownToMrkdwn(Input), Bound4kMs, `MarkdownToMrkdwn draw ${Index} (4k)`);
      expect(typeof Out).toBe('string');
      expect(Out).toContain(Sentinel);
    }
  });

  test(`5 draws at 40k: never throws, <${Bound40kMs}ms each`, () => {
    const Rng = Mulberry32(Seed ^ 0x40000);
    for(let Index = 0; Index < 5; Index++) {
      const { Input, Sentinel } = WithFencedSentinel(Draw(Rng, 40000, AllFamilies), Index);
      const Out = TimedUnder(() => MarkdownToMrkdwn(Input), Bound40kMs, `MarkdownToMrkdwn draw ${Index} (40k)`);
      expect(typeof Out).toBe('string');
      expect(Out).toContain(Sentinel);
    }
  });

  // the link regex at src/markdown-to-mrkdwn.js:41 is quadratic on unbalanced brackets (593ms at
  // 40k measured on 2026-09-04). These fixed inputs hit that path on every run regardless of seed,
  // so the bound is a lasting ReDoS tripwire and not a seed-dependent lottery.
  test.each([
    ['40k nested brackets', '['.repeat(20000) + ']'.repeat(20000)],
    ['4000 unclosed links', '[a](http://x'.repeat(4000)],
    ['40k nested parens after a bracket', '[' + '('.repeat(20000) + ')'.repeat(19999)],
    ['20k heading spaces then a hash', '# x' + ' '.repeat(20000) + '#'],
  ])(`deterministic 40k ReDoS tripwire: %s stays under ${Bound40kMs}ms`, (ArgLabel, ArgInput) => {
    const Out = TimedUnder(() => MarkdownToMrkdwn(ArgInput), Bound40kMs, `MarkdownToMrkdwn fixed case "${ArgLabel}"`);
    expect(typeof Out).toBe('string');
  });

  test('negative control: the bound helper fails loudly and names the seed', () => {
    expect(() => TimedUnder(() => MarkdownToMrkdwn('# x'), 0, 'control')).toThrow(/PROPERTY_SEED=/);
  });
});

// ---------------------------------------------------------------------------------------------
// block 2 — NormalizeDirectCommandTextAsync and ResolveModelAliasAsync (GH-168)
// ---------------------------------------------------------------------------------------------

describe(`GH-169 command normalizer + alias resolver property (PROPERTY_SEED=${Seed})`, () => {
  // both entries read their JSON assets from disk on first use; warm that up so the per-draw
  // bound measures regex work, not filesystem contention.
  beforeAll(async () => {
    await LoadCommandIntentAssetsAsync();
  });

  test('cold smoke: both public entries load their assets and return their stated shapes', async () => {
    const Normalized = await NormalizeDirectCommandTextAsync('help');
    expect(typeof Normalized.NormalizedText).toBe('string');
    expect(Array.isArray(Normalized.Notes)).toBe(true);
    const Resolved = await ResolveModelAliasAsync('help');
    expect(typeof Resolved.ModelId).toBe('string');
    expect(Resolved.Note).toBeNull();
  });

  test(`200 draws at 2k through NormalizeDirectCommandTextAsync: shape holds, Notes empty, <${BoundResolverMs}ms each`, async () => {
    const Rng = Mulberry32(Seed ^ 0x2000);
    for(let Index = 0; Index < 200; Index++) {
      const Input = Draw(Rng, 2000, AllFamilies);
      const Result = await TimedUnderAsync(
        () => NormalizeDirectCommandTextAsync(Input), BoundResolverMs, `NormalizeDirectCommandTextAsync draw ${Index}`
      );
      expect(Result).toBeDefined();
      expect(typeof Result.NormalizedText).toBe('string');
      expect(Array.isArray(Result.Notes)).toBe(true);
      // GH-168: aliases are no longer substituted inside free text, so Notes is always empty here.
      expect(Result.Notes).toEqual([]);
    }
  });

  test(`200 letter-free draws through ResolveModelAliasAsync: refused (no note), stable on re-resolve, <${BoundResolverMs}ms each`, async () => {
    const Rng = Mulberry32(Seed ^ 0x3000);
    for(let Index = 0; Index < 200; Index++) {
      const Input = Draw(Rng, 200, LetterFreeFamilies);
      const First = await TimedUnderAsync(
        () => ResolveModelAliasAsync(Input), BoundResolverMs, `ResolveModelAliasAsync junk draw ${Index}`
      );
      expect(typeof First.ModelId).toBe('string');
      expect(First.Note).toBeNull();
      expect(First.ModelId).not.toMatch(/[a-z]/i);
      // a refused value stays refused, and re-resolving it changes nothing but whitespace: the
      // sanitizer trims BEFORE it strips single quotes (SanitizeSingleQuotedValue), so a quote
      // next to a space leaves a double or edge space behind on the first pass and the second
      // pass collapses it. The command regex never delivers quoted values, so that is an
      // observation, not a contract; the exact relation is asserted so a change to it shows.
      const Second = await ResolveModelAliasAsync(First.ModelId);
      expect(Second.Note).toBeNull();
      expect(Second.ModelId).toBe(First.ModelId.replace(/\s+/g, ' ').trim());
    }
  });

  test('every ModelAliases row resolves to its pin in four spellings, and refuses with junk appended', async () => {
    const Rows = NormalizationConfig.ModelAliases;
    expect(Rows.length).toBeGreaterThan(0);
    for(const Row of Rows) {
      const Spellings = [
        Row.Match,
        Row.Match.toUpperCase(),
        Row.Match.replace(/ /g, '  '),
        `'${Row.Match}'`,
      ];
      for(const Spelling of Spellings) {
        const Result = await ResolveModelAliasAsync(Spelling);
        expect({ Spelling, ...Result }).toEqual({ Spelling, ModelId: Row.Replace, Note: expect.stringContaining(`-> ${Row.Replace}`) });
      }
      // GH-168 contract: whole value only — an alias with anything appended is a refusal, not a guess.
      const Refused = await ResolveModelAliasAsync(`${Row.Match} zzz`);
      expect(Refused.Note).toBeNull();
      expect(Refused.ModelId).not.toBe(Row.Replace);
      // every pin is a fixed point of the resolver.
      const Pin = await ResolveModelAliasAsync(Row.Replace);
      expect(Pin).toEqual({ ModelId: Row.Replace, Note: null });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// block 3 — malformed Slack events through MockSlackApp
// ---------------------------------------------------------------------------------------------

/** Minimal stats shape required by the ChatModule constructor. */
const EmptyWorkspaceStats = {
  IncomingMessageCount: 0,
  IncomingMessageLength: 0,
  OutgoingMessageCount: 0,
  OutgoingMessageLength: 0,
  OutgoingGptMessageCount: 0,
  OutgoingGptMessageLength: 0,
  IncomingGptMessageCount: 0,
  IncomingGptMessageLength: 0,
};

const Long40k = 'x'.repeat(40000);

// text values production can deliver as a string. src/slack-app.js:1600 drops a non-string
// `text` on `message` before dispatch; `app_mention` passes `text` through raw (:1543).
const StringTextShapes = [
  ['empty string', ''],
  ['whitespace only', '   \t  '],
  ['40k chars', Long40k],
  ['NUL byte', 'hello\u0000world'],
  ['lone high surrogate', 'ok \uD83D'],
  ['lone low surrogate', '\uDE00 ok'],
  ['RTL override', '\u202Eremind me tomorrow'],
  ['ZWJ family emoji only', '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'],
  ['single astral emoji only', '\u{1F600}'],
  ['zero-width run', '\u200B\u200C\u200D'],
  ['unbalanced brackets', '[[[[remind]]]] me'],
];

describe(`GH-169 malformed Slack event corpus through MockSlackApp (PROPERTY_SEED=${Seed})`, () => {
  /** @type {unknown[]} */
  const Unhandled = [];
  const OnUnhandled = (ArgReason) => { Unhandled.push(ArgReason); };

  beforeAll(() => {
    process.on('unhandledRejection', OnUnhandled);
    ConfigureMockWorkspaceAI(MockWorkspaceAI, { recommendation: 'ignore' });
  });

  afterAll(() => {
    process.off('unhandledRejection', OnUnhandled);
  });

  /**
   * Build a fresh app with the real ChatModule and RemindersModule registered (not started), the
   * same way scripts/first-time-user-battery.js does.
   * @returns {MockSlackApp}
   */
  function BuildApp() {
    const SlackApp = new MockSlackApp({ AppMentionString: '<@UBOT123>' });
    const Reminders = new RemindersModule(SlackApp);
    // eslint-disable-next-line no-new
    new ChatModule(SlackApp, EmptyWorkspaceStats, Reminders, null, null);
    return SlackApp;
  }

  /**
   * The three-part invariant: the dispatch resolves, no handler threw into the chain's catch, and
   * nothing rejected unhandled. A handler throw is caught and logged by #DispatchHandlersAsync
   * (mirroring src/slack-app.js:1524-1530, :1561-1570, :1643-1648), so the log entry is the only
   * trace it leaves. A promise a handler starts and does not await rejects on a LATER turn, so the
   * assertion waits one macrotask before reading either trace.
   * @param {MockSlackApp} ArgSlackApp
   * @param {string} ArgLabel
   * @param {() => Promise<boolean>} ArgDispatch
   * @returns {Promise<void>}
   */
  async function ExpectHandledCleanly(ArgSlackApp, ArgLabel, ArgDispatch) {
    const ErrorsBefore = ArgSlackApp.Logger.ErrorMessages.length;
    await expect(ArgDispatch()).resolves.toBeDefined();
    await new Promise((ArgResolve) => setImmediate(ArgResolve));
    const HandlerErrors = ArgSlackApp.Logger.ErrorMessages.slice(ErrorsBefore)
      .filter((ArgEntry) => /Error in .* handler/.test(String(ArgEntry)));
    expect({ Shape: ArgLabel, HandlerErrors }).toEqual({ Shape: ArgLabel, HandlerErrors: [] });
    expect({ Shape: ArgLabel, Unhandled }).toEqual({ Shape: ArgLabel, Unhandled: [] });
  }

  test.each(StringTextShapes)('message text: %s', async (ArgLabel, ArgText) => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, `message/${ArgLabel}`, () => SlackApp.SimulateMessageAsync({ text: ArgText }));
  });

  test.each(StringTextShapes)('app_mention text after the mention: %s', async (ArgLabel, ArgText) => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, `app_mention/${ArgLabel}`, () =>
      SlackApp.SimulateAppMentionAsync({ text: `${SlackApp.AppMentionString} ${ArgText}` }));
  });

  test('app_mention whose text does not contain the mention string', async () => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, 'app_mention/no-mention', () =>
      SlackApp.SimulateAppMentionAsync({ text: 'help' }));
  });

  // missing or non-string fields. Reachability per src/slack-app.js: `user` is absent on
  // bot-authored messages (:1631 passes it raw); `channel`/`ts` are always supplied by Slack and a
  // non-string `message.text` is dropped at :1600, so those rows document the handlers' own
  // tolerance and are reachable only through the mock.
  test.each([
    ['user undefined (bot-authored)', { text: 'ping', user: undefined }],
    ['user null', { text: 'ping', user: null }],
    ['channel undefined (mock-reachable only)', { text: 'ping', channel: undefined }],
    ['ts undefined (mock-reachable only)', { text: 'ping', ts: undefined }],
    ['text undefined (mock-reachable only)', { text: undefined }],
    ['text null (mock-reachable only)', { text: null }],
  ])('message missing field: %s', async (ArgLabel, ArgEvent) => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, `message/${ArgLabel}`, () => SlackApp.SimulateMessageAsync(ArgEvent));
  });

  // `text` undefined/null on app_mention is deliberately NOT here: the first run of this corpus
  // caught it (src/chat-command-router.js:111 calls .match on it and every app_mention handler
  // assumes a string, while src/slack-app.js:1543 passes ArgEvent.text raw). Slack's app_mention
  // contract always carries text, so the shape is out of contract today; the assumption is filed
  // as GH-172 with the one-line dispatch guard that would let the two rows return.
  test.each([
    ['user undefined', { user: undefined }],
    ['channel undefined', { channel: undefined }],
    ['ts undefined', { ts: undefined }],
  ])('app_mention missing field (mock-reachable only): %s', async (ArgLabel, ArgEvent) => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, `app_mention/${ArgLabel}`, () => SlackApp.SimulateAppMentionAsync(ArgEvent));
  });

  // subtypes: `file_share` reaches the handlers in production; `bot_message`, `message_changed`
  // and `message_deleted` are dropped before dispatch (src/slack-app.js:1592-1648), so those three
  // rows are mock-reachable only.
  test.each([
    ['thread_ts equal to ts', { text: 'ping', ts: '1700000000.000001', thread_ts: '1700000000.000001' }],
    ['thread_ts with no parent', { text: 'ping', thread_ts: '1600000000.000000' }],
    ['subtype file_share, files empty', { text: 'ping', subtype: 'file_share', files: [] }],
    ['subtype bot_message (mock-reachable only)', { text: 'ping', subtype: 'bot_message' }],
    ['subtype message_changed (mock-reachable only)', { text: 'ping', subtype: 'message_changed' }],
    ['subtype message_deleted (mock-reachable only)', { text: 'ping', subtype: 'message_deleted' }],
    ['files: [{}]', { text: 'ping', files: [{}] }],
    ['file mimetype contradicts filetype', { text: 'ping', files: [{ id: 'F1', name: 'a.png', filetype: 'png', mimetype: 'text/plain', url_private: 'https://example.com/a' }] }],
    ['channel_type im', { text: 'ping', channel_type: 'im' }],
    ['channel_type mpim', { text: 'ping', channel_type: 'mpim' }],
    ['channel_type group', { text: 'ping', channel_type: 'group' }],
    ['channel_type unknown', { text: 'ping', channel_type: 'not-a-type' }],
  ])('message shape: %s', async (ArgLabel, ArgEvent) => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, `message/${ArgLabel}`, () => SlackApp.SimulateMessageAsync(ArgEvent));
  });

  test.each([
    ['unknown reaction name', { reaction: 'definitely_not_an_emoji' }],
    ['item.ts with no such message', { item: { channel: 'C_TEST', ts: '1600000000.000000' } }],
    ['user null', { user: null, reaction: 'white_check_mark' }],
    ['wrench triage on a missing message', { reaction: 'wrench', item: { channel: 'C_TEST', ts: '1600000000.000001' } }],
  ])('reaction_added shape: %s', async (ArgLabel, ArgEvent) => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, `reaction_added/${ArgLabel}`, () => SlackApp.SimulateReactionAddedAsync(ArgEvent));
  });

  // a `null` value is normalized to '' by SimulateActionAsync (mock-slack-app.js) exactly as
  // production does (src/slack-app.js:1668-1675), so '' is the one empty-value row.
  test.each([
    ['value empty', { value: '' }],
    ['value 40k', { value: Long40k }],
    ['value NUL + lone surrogate', { value: '\u0000 \uD83D' }],
  ])('block_actions shape on the web-search button: %s', async (ArgLabel, ArgAction) => {
    const SlackApp = BuildApp();
    await ExpectHandledCleanly(SlackApp, `block_actions/${ArgLabel}`, () =>
      SlackApp.SimulateActionAsync(ChatModule.ChatGoogleSearchActionId, ArgAction));
  });
});
