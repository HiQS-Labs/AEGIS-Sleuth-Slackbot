'use strict';

const {
  ExtractNewestVersionBlock,
  FindChangelogToneViolations,
  RunChangelogToneValidation,
} = require('../scripts/validate-changelog-tone');

/**
 * Build a small changelog fixture from one or more `## ` blocks.
 * @param {...string} ArgBlocks Version blocks to join after the header note.
 * @returns {string} Combined changelog content.
 */
function MakeChangelogFixture(...ArgBlocks) {
  return [
    '# Changelog',
    '',
    '<!-- authoring note above the first version block -->',
    '- bullets up here are ignored.',
    '',
    ...ArgBlocks,
  ].join('\n');
}

describe('validate-changelog-tone (GH-408)', () => {
  describe('ExtractNewestVersionBlock', () => {
    test('ignores content before the first version heading', () => {
      const Block = ExtractNewestVersionBlock(MakeChangelogFixture(
        '## 1.2.3 - 2026-07-16\n' +
        "I've been updated so the newest block has a plain-language lead.\n\n" +
        '**Technical:** detail.'
      ));

      expect(Block).not.toBeNull();
      expect(Block.VersionLabel).toBe('1.2.3 - 2026-07-16');
    });
  });

  describe('FindChangelogToneViolations', () => {
    test('passes a compliant newest block', () => {
      const Violations = FindChangelogToneViolations(MakeChangelogFixture(
        '## 1.2.3 - 2026-07-16\n' +
        "I've been updated so the changelog now opens with a human summary.\n\n" +
        '**Technical:** validator and tests added.'
      ));
      expect(Violations).toEqual([]);
    });

    test('flags Shape 1 when the newest block starts with a bullet', () => {
      const Violations = FindChangelogToneViolations(MakeChangelogFixture(
        '## 1.2.3 - 2026-07-16\n' +
        '- technical bullet came first.\n\n' +
        '**Technical:** details exist, but the human lead is missing.'
      ));
      expect(Violations).toHaveLength(1);
      expect(Violations[0]).toMatch(/Shape 1/);
      expect(Violations[0]).toMatch(/1\.2\.3 - 2026-07-16/);
    });

    test('flags Shape 2 when the newest block has no technical marker', () => {
      const Violations = FindChangelogToneViolations(MakeChangelogFixture(
        '## 1.2.3 - 2026-07-16\n' +
        "I've been updated so users get the plain-language summary first."
      ));
      expect(Violations).toHaveLength(1);
      expect(Violations[0]).toMatch(/Shape 2/);
      expect(Violations[0]).toMatch(/\*\*Technical:\*\*/);
    });

    test('honors a TONE-OK pragma anywhere in the newest block', () => {
      const Violations = FindChangelogToneViolations(MakeChangelogFixture(
        '## 1.2.3 - 2026-07-16\n' +
        '<!-- TONE-OK: imported historical release notes. -->\n' +
        '- bullet-first is intentionally exempt here.'
      ));
      expect(Violations).toEqual([]);
    });

    test('scopes enforcement to the newest block only', () => {
      const Violations = FindChangelogToneViolations(MakeChangelogFixture(
        '## 1.2.3 - 2026-07-16\n' +
        "I've been updated so the latest entry follows the new shape.\n\n" +
        '**Technical:** latest details.\n',
        '## 1.2.2 - 2026-07-15\n' +
        '- historical bullet-first entry is ignored.\n'
      ));
      expect(Violations).toEqual([]);
    });
  });

  describe('RunChangelogToneValidation (integration)', () => {
    test('the current changelog is clean', () => {
      expect(RunChangelogToneValidation()).toEqual([]);
    });
  });
});
