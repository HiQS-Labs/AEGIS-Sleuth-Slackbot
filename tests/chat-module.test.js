'use strict';

const ChatModule = require('../src/chat-module');

describe('ChatModule.IsLiveModelCatalogQuestion', () => {
  test('matches natural-language current model availability questions', () => {
    expect(ChatModule.IsLiveModelCatalogQuestion('what are the available ChatGPT models currently?')).toBe(true);
    expect(ChatModule.IsLiveModelCatalogQuestion('which OpenAI models are supported now?')).toBe(true);
  });

  test('does not shadow explicit model management commands', () => {
    expect(ChatModule.IsLiveModelCatalogQuestion('models')).toBe(false);
    expect(ChatModule.IsLiveModelCatalogQuestion('show-channel-model')).toBe(false);
    expect(ChatModule.IsLiveModelCatalogQuestion("set-channel-model:'gpt-4o'")).toBe(false);
    expect(ChatModule.IsLiveModelCatalogQuestion("switch-models:'gpt-4o-mini'")).toBe(false);
    expect(ChatModule.IsLiveModelCatalogQuestion("what's the latest on OpenAI today?")).toBe(false);
  });
});

describe('ChatModule.ExtractNaturalLanguageWebSearchQuery', () => {
  test('extracts queries from explicit natural-language web lookup aliases', () => {
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('search the web for latest OpenAI news')).toBe('latest OpenAI news');
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('could you look up Slack API rate limits?')).toBe('Slack API rate limits');
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('google OpenAI Responses API docs')).toBe('OpenAI Responses API docs');
  });

  test('extracts queries from domain-based check and search aliases', () => {
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('check slack.com for duplicate app names')).toBe('slack.com for duplicate app names');
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('check openai.com for GPT-5 pricing')).toBe('openai.com for GPT-5 pricing');
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('search slack.com for bots similar to ours')).toBe('slack.com for bots similar to ours');
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('could you check github.com/openai for recent releases')).toBe('github.com/openai for recent releases');
  });

  test('does not match check/search without a recognizable domain', () => {
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('check if reminders are enabled')).toBe(null);
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('search my reminders for deploy')).toBe(null);
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('search reminders')).toBe(null);
  });

  test('does not match generic chat text', () => {
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('what is the population of France?')).toBe(null);
    expect(ChatModule.ExtractNaturalLanguageWebSearchQuery('summarize this thread')).toBe(null);
  });
});

describe('ChatModule.ShouldAutoRouteToWebSearchForFreshness', () => {
  test('matches narrow freshness-sensitive external questions', () => {
    expect(ChatModule.ShouldAutoRouteToWebSearchForFreshness("what's the latest on OpenAI today?")).toBe(true);
    expect(ChatModule.ShouldAutoRouteToWebSearchForFreshness('what is the current weather in Seattle today?')).toBe(true);
    expect(ChatModule.ShouldAutoRouteToWebSearchForFreshness('any recent news on Anthropic?')).toBe(true);
  });

  test('does not match general or internal questions', () => {
    expect(ChatModule.ShouldAutoRouteToWebSearchForFreshness('what is the population of France?')).toBe(false);
    expect(ChatModule.ShouldAutoRouteToWebSearchForFreshness('what are the available ChatGPT models currently?')).toBe(false);
    expect(ChatModule.ShouldAutoRouteToWebSearchForFreshness('show reminders')).toBe(false);
  });
});

describe('ChatModule.IsReminderActionIntent', () => {
  test('matches reminder creation and scheduling requests', () => {
    expect(ChatModule.IsReminderActionIntent('make a Sleuth reminder for @jane based on task above')).toBe(true);
    expect(ChatModule.IsReminderActionIntent('create reminder for <@U123> tomorrow')).toBe(true);
    expect(ChatModule.IsReminderActionIntent('schedule a reminder for me')).toBe(true);
  });

  test('does not match reminder list/search commands or generic chat', () => {
    expect(ChatModule.IsReminderActionIntent('show reminders')).toBe(false);
    expect(ChatModule.IsReminderActionIntent('search reminders for deploy')).toBe(false);
    expect(ChatModule.IsReminderActionIntent('what reminders do I have')).toBe(false);
    expect(ChatModule.IsReminderActionIntent('tell me about reminders')).toBe(false);
  });
});

describe('ChatModule.FilterLiveModelCatalogForChat', () => {
  test('keeps chat-like model IDs and drops non-chat utility models', () => {
    const Result = ChatModule.FilterLiveModelCatalogForChat([
      'text-embedding-3-small',
      'gpt-4o',
      'dall-e-3',
      'o3-mini',
      'whisper-1',
      'chatgpt-4o-latest',
    ]);

    expect(Result).toEqual([
      'chatgpt-4o-latest',
      'gpt-4o',
      'o3-mini',
    ]);
  });
});

describe('ChatModule.BuildWebSearchResponseText', () => {
  test('formats answer text and source links for Slack', () => {
    const Result = ChatModule.BuildWebSearchResponseText({
      text: '## Summary\n**OpenAI** announced something current.',
      sources: [
        { title: 'OpenAI News', url: 'https://openai.com/news/' },
      ],
    });

    expect(Result).toContain('*Summary*');
    expect(Result).toContain('*OpenAI* announced something current.');
    expect(Result).toContain('*Sources:*');
    expect(Result).toContain('<https://openai.com/news/|OpenAI News>');
  });

  test('skips invalid source URLs and escapes Slack control characters in valid ones', () => {
    const Result = ChatModule.BuildWebSearchResponseText({
      text: 'Answer text.',
      sources: [
        { title: 'Bad URL', url: 'javascript:alert(1)' },
        { title: 'Escaped URL', url: 'https://example.com/a|b>c' },
      ],
    });

    expect(Result).not.toContain('Bad URL');
    expect(Result).toContain('<https://example.com/a%7Cb%3Ec|Escaped URL>');
  });
});

describe('ChatModule.BuildSafeSlackLinkUrl', () => {
  test('returns null for empty, invalid, or non-http URLs', () => {
    expect(ChatModule.BuildSafeSlackLinkUrl('')).toBeNull();
    expect(ChatModule.BuildSafeSlackLinkUrl('notaurl')).toBeNull();
    expect(ChatModule.BuildSafeSlackLinkUrl('javascript:alert(1)')).toBeNull();
  });

  test('escapes reserved Slack link characters in valid URLs', () => {
    expect(ChatModule.BuildSafeSlackLinkUrl('https://example.com/a|b>c')).toBe('https://example.com/a%7Cb%3Ec');
  });
});
