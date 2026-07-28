'use strict';

const fs = require('fs');
const path = require('path');
const { CommandRouter } = require('../src/chat-command-router');
const { ResolveAliasArgSpec, RegisterCatalogRegexAliases } = require('../src/catalog-regex-aliases');
const { NormalizeDirectCommandTextAsync } = require('../src/command-intent-resolver');

const CatalogPath = path.join(__dirname, '..', 'data', 'static', 'ai', 'command-catalog.json');
const Catalog = JSON.parse(fs.readFileSync(CatalogPath, 'utf8'));

const EventInfo = { channel: 'C_GENERAL', ts: '1700000000.000001', user: 'U_ASKER', text: '' };

// ── Arg-spec resolution ───────────────────────────────────────────────────────

describe('ResolveAliasArgSpec', () => {
  test('resolves capture references', () => {
    expect(ResolveAliasArgSpec('$1', EventInfo, ['<@U123>'])).toBe('<@U123>');
    expect(ResolveAliasArgSpec('$2', EventInfo, [undefined, 'second'])).toBe('second');
  });

  test('resolves {user} to the asking user mention and {channel} to the channel ID', () => {
    expect(ResolveAliasArgSpec('{user}', EventInfo, [])).toBe('<@U_ASKER>');
    expect(ResolveAliasArgSpec('{channel}', EventInfo, [])).toBe('C_GENERAL');
  });

  test('?? alternatives: first non-empty wins', () => {
    expect(ResolveAliasArgSpec('$1??$2??$3', EventInfo, [undefined, '<@U2>', '<@U3>'])).toBe('<@U2>');
    expect(ResolveAliasArgSpec('$1??{user}', EventInfo, [undefined])).toBe('<@U_ASKER>');
    expect(ResolveAliasArgSpec('$1??{user}', EventInfo, ['<@U9>'])).toBe('<@U9>');
  });

  test('passes unknown tokens through as literals; returns undefined when all empty', () => {
    expect(ResolveAliasArgSpec('literal-value', EventInfo, [])).toBe('literal-value');
    expect(ResolveAliasArgSpec('$1??$2', EventInfo, [undefined, undefined])).toBeUndefined();
  });
});

// ── Registration + dispatch ───────────────────────────────────────────────────

describe('RegisterCatalogRegexAliases', () => {
  function MakeRouterWithBase(RouteName) {
    const Router = new CommandRouter();
    const BaseHandle = jest.fn().mockResolvedValue(undefined);
    Router.Register({ Pattern: new RegExp(`^${RouteName}$`, 'i'), Route: RouteName, Handle: BaseHandle });
    return { Router, BaseHandle };
  }

  test('registers an alias that delegates to the named route with resolved Args', async () => {
    const { Router, BaseHandle } = MakeRouterWithBase('show-me');
    const Count = RegisterCatalogRegexAliases(Router, [{
      Id: 'show-me',
      RegisteredRoutes: ['show-me'],
      RegexAliases: [{ Pattern: "^what\\s+are\\s+my\\s+tasks\\b", Route: 'show-me', Args: ['{user}'] }],
    }], { warn: jest.fn() });

    expect(Count).toBe(1);
    expect(await Router.RouteAsync('what are my tasks?', EventInfo)).toBe(true);
    expect(BaseHandle).toHaveBeenCalledWith(EventInfo, '<@U_ASKER>');
  });

  test('passes captures through positionally when Args is omitted', async () => {
    const { Router, BaseHandle } = MakeRouterWithBase('show-me');
    RegisterCatalogRegexAliases(Router, [{
      Id: 'show-me',
      RegisteredRoutes: ['show-me'],
      RegexAliases: [{ Pattern: "^tasks\\s+for\\s+(<@[UW][^>]+>)$", Route: 'show-me' }],
    }], { warn: jest.fn() });

    await Router.RouteAsync('tasks for <@U777>', EventInfo);
    expect(BaseHandle).toHaveBeenCalledWith(EventInfo, '<@U777>');
  });

  test('aliases never shadow primary routes (registered at the end)', async () => {
    const { Router, BaseHandle } = MakeRouterWithBase('show-me');
    RegisterCatalogRegexAliases(Router, [{
      Id: 'show-me',
      RegisteredRoutes: ['show-me'],
      // deliberately overlaps the primary pattern.
      RegexAliases: [{ Pattern: "^show-me$", Route: 'show-me', Args: ['{user}'] }],
    }], { warn: jest.fn() });

    await Router.RouteAsync('show-me', EventInfo);
    // primary route matched first → no Args injection.
    expect(BaseHandle).toHaveBeenCalledWith(EventInfo);
  });

  test('skips aliases with unknown routes or invalid patterns, with a warning', () => {
    const { Router } = MakeRouterWithBase('show-me');
    const Logger = { warn: jest.fn() };
    const Count = RegisterCatalogRegexAliases(Router, [{
      Id: 'broken',
      RegisteredRoutes: ['no-such-route'],
      RegexAliases: [
        { Pattern: '^x$', Route: 'no-such-route' },
        { Pattern: '([', Route: 'show-me' },
      ],
    }], Logger);

    expect(Count).toBe(0);
    expect(Logger.warn).toHaveBeenCalledTimes(2);
  });
});

// ── Real catalog integration: the live RegexAliases entries dispatch correctly ─

describe('command-catalog.json RegexAliases (live file)', () => {

  function MakeLiveRouter() {
    const Router = new CommandRouter();
    const Handles = {
      'show-me': jest.fn().mockResolvedValue(undefined),
      'show-me-projects': jest.fn().mockResolvedValue(undefined),
    };
    // primary routes as chat-module registers them (patterns simplified — aliases delegate to Handle).
    Router.Register({ Pattern: /^show-me\s+(<@[UW][^>]+>)/i, Route: 'show-me', Handle: Handles['show-me'] });
    Router.Register({ Pattern: /^show-me-projects(?:\s+(<@[UW][^>]+>))?/i, Route: 'show-me-projects', Handle: Handles['show-me-projects'] });
    RegisterCatalogRegexAliases(Router, Catalog, { warn: jest.fn() });
    return { Router, Handles };
  }

  test.each([
    ['what are my tasks?', 'show-me', '<@U_ASKER>'],
    ['show me my tasks', 'show-me', '<@U_ASKER>'],
    ['what should I work on today', 'show-me', '<@U_ASKER>'],
    ["what are <@U123>'s tasks", 'show-me', '<@U123>'],
    ['for-today', 'show-me', '<@U_ASKER>'],
    ['for-today <@U9>', 'show-me', '<@U9>'],
    ['show me projects', 'show-me-projects', '<@U_ASKER>'],
    ['show me PROJECTS', 'show-me-projects', '<@U_ASKER>'],
    ['show me my projects', 'show-me-projects', '<@U_ASKER>'],
    ['what are my projects', 'show-me-projects', '<@U_ASKER>'],
    ["show me <@U123>'s projects", 'show-me-projects', '<@U123>'],
    ["group <@U123>'s tasks", 'show-me-projects', '<@U123>'],
  ])('"%s" routes to %s with %s', async (Text, Route, ExpectedMention) => {
    const { Router, Handles } = MakeLiveRouter();
    expect(await Router.RouteAsync(Text, EventInfo)).toBe(true);
    expect(Handles[Route]).toHaveBeenCalledTimes(1);
    expect(Handles[Route].mock.calls[0][1]).toBe(ExpectedMention);
  });

  test.each([
    'show me the door',          // not a tasks/projects phrasing
    'search projects client-a',    // reminders-handler route, not a chat alias
    'what are your tasks',       // wrong pronoun
  ])('"%s" does not match any catalog alias', async (Text) => {
    const { Router } = MakeLiveRouter();
    expect(await Router.RouteAsync(Text, EventInfo)).toBe(false);
  });
});

// ── show-channel-model NL aliases (live catalog) ──────────────────────────────

describe('show-channel-model RegexAliases (live catalog)', () => {
  function MakeModelRouter() {
    const Router = new CommandRouter();
    const Handle = jest.fn().mockResolvedValue(undefined);
    Router.Register({ Pattern: /^show-channel-model$/i, Route: 'show-channel-model', Handle });
    RegisterCatalogRegexAliases(Router, Catalog, { warn: jest.fn() });
    return { Router, Handle };
  }

  test.each([
    'what model are you running?',
    'which model are you running right now',
    'what model are you using?',
    'which model is this channel using',
    'what model is running on this channel?',
    'what ai model are you running',
  ])('"%s" routes to show-channel-model', async (Text) => {
    const { Router, Handle } = MakeModelRouter();
    expect(await Router.RouteAsync(Text, EventInfo)).toBe(true);
    expect(Handle).toHaveBeenCalledTimes(1);
  });

  test.each([
    'show me the models',      // belongs to live-model-catalog-question, not an alias
    'what models are available',
    'what is a model',
  ])('"%s" does not match show-channel-model alias', async (Text) => {
    const { Router, Handle } = MakeModelRouter();
    await Router.RouteAsync(Text, EventInfo);
    expect(Handle).not.toHaveBeenCalled();
  });
});

// ── rmm-ifl broad "I Feel Lucky" aliases (live catalog) ───────────────────────

describe('rmm-ifl RegexAliases (live catalog)', () => {
  function MakeLuckyRouter() {
    const Router = new CommandRouter();
    const Handle = jest.fn().mockResolvedValue(undefined);
    // primary execute route as chat-module registers it (the alias delegates to this Handle).
    Router.Register({ Pattern: /^rmm\s+ifl\b[\s,:;.!?]+(.+)/is, Route: 'rmm ifl', Handle });
    RegisterCatalogRegexAliases(Router, Catalog, { warn: jest.fn() });
    return { Router, Handle };
  }

  // Broad demo-friendly phrasings all reach the `rmm ifl` execute path, capturing the request only.
  test.each([
    ['ifl show my reminders', 'show my reminders'],
    ['ifl rmm switch model to opus 4.8', 'switch model to opus 4.8'],
    ['i feel lucky changelog', 'changelog'],
    ["i'm feeling lucky web search latest ai news", 'web search latest ai news'],
    ['im feeling lucky models', 'models'],
    ['feeling lucky version', 'version'],
  ])('"%s" routes to rmm ifl with request "%s"', async (Text, ExpectedRequest) => {
    const { Router, Handle } = MakeLuckyRouter();
    expect(await Router.RouteAsync(Text, EventInfo)).toBe(true);
    expect(Handle).toHaveBeenCalledTimes(1);
    expect(Handle.mock.calls[0][1]).toBe(ExpectedRequest);
  });

  test.each([
    'iflation quarterly report',   // word starting with "ifl" — the \b guard prevents a match
    'ifl',                         // bare prefix, no request
    'i feel great about this',     // "feel ... lucky" not present
  ])('"%s" does not trigger the lucky alias', async (Text) => {
    const { Router, Handle } = MakeLuckyRouter();
    await Router.RouteAsync(Text, EventInfo);
    expect(Handle).not.toHaveBeenCalled();
  });
});

// ── deterministic/catalog boundary ───────────────────────────────────────────

describe('deterministic/catalog boundary', () => {
  test('ping is not a catalog Alias (owned exclusively by deterministic-responses.json)', () => {
    const PingEntry = Catalog.find(ArgEntry => ArgEntry.Id === 'ping');
    expect(PingEntry).toBeDefined();
    expect((PingEntry.Aliases || []).includes('ping')).toBe(false);
  });
});

// ── direct model-switch normalization ─────────────────────────────────────────

describe('NormalizeDirectCommandTextAsync — model-switch patterns', () => {
  test.each([
    ["switch-models:'gpt-4o'",                          "switch-models:'gpt-4o'"],
    ["model switch: 'gpt-4o'",                          "switch-models:'gpt-4o'"],
    ["model-switch:default='gpt-4o'",                   "switch-models:'gpt-4o'"],
    ["switch-models:complex='claude-sonnet-4-6'",       "switch-models:complex='claude-sonnet-4-6'"],
    ["switch models: default='gpt-4o',complex='claude-sonnet-4-6'", "switch-models:default='gpt-4o',complex='claude-sonnet-4-6'"],
    ['show channel model',                              'show-channel-model'],
    ['clear channel model',                             'clear-channel-model'],
    ["set channel model: 'gpt-4o'",                    "set-channel-model:'gpt-4o'"],
  ])('"%s" normalizes to "%s"', async (Input, Expected) => {
    const Result = await NormalizeDirectCommandTextAsync(Input);
    expect(Result.NormalizedText).toBe(Expected);
  });

  test('unrecognized input passes through unchanged', async () => {
    const Result = await NormalizeDirectCommandTextAsync('remind me to call bob tomorrow');
    expect(Result.NormalizedText).toBe('remind me to call bob tomorrow');
  });
});
