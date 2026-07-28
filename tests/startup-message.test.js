'use strict';

const fs = require('fs');
const path = require('path');
const {
  IsTruthyFlag,
  ShouldPostStartupMessage,
  ShouldIncludeStartupChangelog,
  BuildStartupChangelogExcerpt,
} = require('../src/startup-message');

const PLACEHOLDER_MARKERS = ['<!--', '-->', 'HOW TO WRITE AN ENTRY'];

describe('IsTruthyFlag', () => {
  test.each([
    ['true', true],
    ['TRUE', true],
    ['True', true],
    ['yes', true],
    ['YES', true],
    ['  yes  ', true],
    ['no', false],
    ['false', false],
    ['', false],
    ['  ', false],
    ['1', false],
    ['on', false],
    ['truthy', false],
  ])('IsTruthyFlag(%p) === %p', (ArgValue, ArgExpected) => {
    expect(IsTruthyFlag(ArgValue)).toBe(ArgExpected);
  });

  test('handles null / undefined / non-string without throwing', () => {
    expect(IsTruthyFlag(null)).toBe(false);
    expect(IsTruthyFlag(undefined)).toBe(false);
    expect(IsTruthyFlag(0)).toBe(false);
    expect(IsTruthyFlag(true)).toBe(true);
    expect(IsTruthyFlag({})).toBe(false);
  });
});

describe('ShouldPostStartupMessage', () => {
  test('returns true when STARTUP_MESSAGE is "yes"', () => {
    expect(ShouldPostStartupMessage({ STARTUP_MESSAGE: 'yes' })).toBe(true);
  });

  test('returns true when STARTUP_MESSAGE is "true"', () => {
    expect(ShouldPostStartupMessage({ STARTUP_MESSAGE: 'true' })).toBe(true);
  });

  test('returns false when STARTUP_MESSAGE is missing', () => {
    expect(ShouldPostStartupMessage({})).toBe(false);
  });

  test('returns false when STARTUP_MESSAGE is set to a non-truthy string', () => {
    expect(ShouldPostStartupMessage({ STARTUP_MESSAGE: 'no' })).toBe(false);
    expect(ShouldPostStartupMessage({ STARTUP_MESSAGE: '' })).toBe(false);
  });

  test('returns false when given null / undefined workspace', () => {
    expect(ShouldPostStartupMessage(null)).toBe(false);
    expect(ShouldPostStartupMessage(undefined)).toBe(false);
  });
});

describe('ShouldIncludeStartupChangelog — the 2x2 truth table', () => {
  // STARTUP_MESSAGE off + changelog off → no post, no changelog.
  test('off / off → false', () => {
    expect(ShouldIncludeStartupChangelog({})).toBe(false);
    expect(ShouldIncludeStartupChangelog({
      STARTUP_MESSAGE: 'no',
      STARTUP_MESSAGE_INCLUDE_CHANGELOG: 'no',
    })).toBe(false);
  });

  // STARTUP_MESSAGE on + changelog off → compact post only (the new default behavior).
  test('on / off → false (compact-only — the new default for workspaces with STARTUP_MESSAGE)', () => {
    expect(ShouldIncludeStartupChangelog({ STARTUP_MESSAGE: 'yes' })).toBe(false);
    expect(ShouldIncludeStartupChangelog({
      STARTUP_MESSAGE: 'true',
      STARTUP_MESSAGE_INCLUDE_CHANGELOG: 'no',
    })).toBe(false);
  });

  // STARTUP_MESSAGE on + changelog on → full post with changelog (the explicit opt-in).
  test('on / on → true', () => {
    expect(ShouldIncludeStartupChangelog({
      STARTUP_MESSAGE: 'yes',
      STARTUP_MESSAGE_INCLUDE_CHANGELOG: 'yes',
    })).toBe(true);
    expect(ShouldIncludeStartupChangelog({
      STARTUP_MESSAGE: 'true',
      STARTUP_MESSAGE_INCLUDE_CHANGELOG: 'true',
    })).toBe(true);
  });

  // STARTUP_MESSAGE off + changelog on → still no post (subordination invariant).
  // This is the rule the user explicitly described: the changelog flag never overrides the
  // outer startup-message flag. Otherwise a typo on the outer field would silently post the
  // changelog without the deploy header above it.
  test('off / on → false (changelog flag never overrides the outer STARTUP_MESSAGE gate)', () => {
    expect(ShouldIncludeStartupChangelog({
      STARTUP_MESSAGE_INCLUDE_CHANGELOG: 'yes',
    })).toBe(false);
    expect(ShouldIncludeStartupChangelog({
      STARTUP_MESSAGE: 'no',
      STARTUP_MESSAGE_INCLUDE_CHANGELOG: 'yes',
    })).toBe(false);
  });
});

describe('BuildStartupChangelogExcerpt', () => {
  // Reproduces the exact prod incident (v1.4.236 boot message): a raw whole-file word-truncate
  // surfaced the top-of-file "HOW TO WRITE AN ENTRY" authoring note instead of the newest entry.
  test('never surfaces the authoring note above the first version heading', () => {
    const Fixture = [
      '# Changelog',
      '',
      '<!--',
      '✍️ HOW TO WRITE AN ENTRY (please follow — this note lives above the first ## heading, so the',
      'changelog Slack command and the startup message never surface it; they lift the entries below).',
      '',
      "Lead every new version with a friendly, plain-language TL;DR in Sleuth's own voice...",
      '-->',
      '',
      '## 1.4.236 - 2026-07-17',
      "We're back up and running with the latest fixes.",
      '',
      '**Technical:** deployed from main.',
    ].join('\n');

    const Excerpt = BuildStartupChangelogExcerpt(Fixture, 50);

    for(const Marker of PLACEHOLDER_MARKERS) {
      expect(Excerpt).not.toContain(Marker);
    }
    expect(Excerpt).toContain('1.4.236');
  });

  // Cross-model QA (agy relay, 2026-07-17) found the indentation-only guard wasn't structural: a
  // future authoring-note edit with an UNINDENTED "## " line (e.g. a format example at column 0)
  // would still be mistaken for a real heading. HTML comments must be stripped outright, not just
  // trusted to stay indented.
  test('never surfaces an unindented "## "-shaped line inside the authoring comment', () => {
    const Fixture = [
      '# Changelog',
      '',
      '<!--',
      'HOW TO WRITE AN ENTRY. Format:',
      '## <version> - <date>',
      '<TL;DR here>',
      '-->',
      '',
      '## 1.4.238 - 2026-07-17',
      'Real entry text.',
    ].join('\n');

    const Excerpt = BuildStartupChangelogExcerpt(Fixture, 50);

    expect(Excerpt).not.toContain('<version>');
    expect(Excerpt).not.toContain('<TL;DR here>');
    expect(Excerpt).toContain('Real entry text.');
  });

  test('returns empty string when no version heading exists', () => {
    expect(BuildStartupChangelogExcerpt('# Changelog\n\nno version blocks here.', 50)).toBe('');
  });

  test('truncates a long newest block to the word budget', () => {
    const LongBody = new Array(200).fill('word').join(' ');
    const Fixture = `# Changelog\n\n## 1.4.236 - 2026-07-17\n${LongBody}\n`;
    const Excerpt = BuildStartupChangelogExcerpt(Fixture, 10);
    expect(Excerpt.split(/\s+/).length).toBeLessThan(50);
  });

  // Integration guard: runs the real CHANGELOG.md through the excerpt builder, so an edit to the
  // file (or a regression in the extraction logic) that reintroduces the placeholder leak fails
  // CI directly — this is the guard the GH-408-adjacent boot message incident was missing.
  test('the real CHANGELOG.md never leaks the authoring note into the startup excerpt', () => {
    const ChangelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
    const ChangelogContent = fs.readFileSync(ChangelogPath, 'utf8');
    const Excerpt = BuildStartupChangelogExcerpt(ChangelogContent, 50);

    for(const Marker of PLACEHOLDER_MARKERS) {
      expect(Excerpt).not.toContain(Marker);
    }
  });
});
