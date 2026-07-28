'use strict';

const {
  CountSentences,
  ValidateCommandCatalogShape,
  BuildHelpMarkdownFromCatalog,
  BuildCommandsReferenceLinesFromCatalog,
  BuildRegisteredRouteMap,
  LoadCommandCatalogSync,
} = require('../src/command-catalog');

describe('command-catalog helpers', () => {
  test('CountSentences counts terminal sentences and trailing text', () => {
    expect(CountSentences('One sentence.')).toBe(1);
    expect(CountSentences('One sentence. Two sentence?')).toBe(2);
    expect(CountSentences('One sentence without punctuation')).toBe(1);
  });

  test('BuildHelpMarkdownFromCatalog groups entries by section order', () => {
    const HelpText = BuildHelpMarkdownFromCatalog(LoadCommandCatalogSync());

    expect(HelpText).toContain('*Getting Started*');
    expect(HelpText).toContain('*Reminders*');
    expect(HelpText).toContain('*Search & Knowledge*');
    expect(HelpText.indexOf('*Getting Started*')).toBeLessThan(HelpText.indexOf('*Reminders*'));
    expect(HelpText).toContain('`@Sleuth AI changelog`');
    expect(HelpText.indexOf('`@Sleuth AI changelog`')).toBeLessThan(HelpText.indexOf('*Reminders*'));
  });

  test('BuildRegisteredRouteMap maps chat routes back to catalog entries', () => {
    const RouteMap = BuildRegisteredRouteMap(LoadCommandCatalogSync());

    expect(RouteMap.get('help/features')).toContain('help-features');
    expect(RouteMap.get('view stratalist')).toContain('view-stratalist');
    expect(RouteMap.get('rmm ifl')).toContain('rmm-ifl');
    expect(RouteMap.get('switch-models')).toEqual(
      expect.arrayContaining(['model-switch-default', 'model-switch-complex', 'model-switch-both'])
    );
    expect(RouteMap.get('sync-github')).toContain('github-sync-now');
    expect(RouteMap.get('send-to-github')).toContain('send-to-github');
  });

  test('BuildCommandsReferenceLinesFromCatalog renders CommandsListNotes under send-to-github', () => {
    const Lines = BuildCommandsReferenceLinesFromCatalog(LoadCommandCatalogSync());
    const SendToGithubIndex = Lines.findIndex(ArgLine => ArgLine.includes('send to github'));
    expect(SendToGithubIndex).toBeGreaterThan(-1);
    expect(Lines[SendToGithubIndex + 1]).toContain('Reply in thread');
    expect(Lines[SendToGithubIndex + 2]).toContain('Optional inline title');
    expect(Lines[SendToGithubIndex + 3]).toContain('issues:write');
  });

  test('ValidateCommandCatalogShape rejects help-visible entries with more than two sentences', () => {
    expect(() => ValidateCommandCatalogShape([
      {
        Id: 'bad-help-entry',
        Permission: 'public',
        Risk: 'low',
        CanExecuteWithIfl: true,
        Description: 'First sentence. Second sentence. Third sentence.',
        SyntaxExamples: ['@Sleuth AI bad'],
        Aliases: [],
        IntentPhrases: [],
        ArgumentHints: [],
        DisambiguationNotes: [],
        IncludeInHelp: true,
        IncludeInCommandsList: false,
        HelpOrder: 1,
        HelpSection: 'Bad Section',
      },
    ])).toThrow('must use 1-2 sentences');
  });
});
