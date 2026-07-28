'use strict';

/**
 * CI guard for the GH-408 changelog-tone convention: the newest CHANGELOG entry must lead with a
 * friendly plain-language TL;DR and include a `**Technical:**` block. The guard is intentionally
 * narrow and forward-only: it inspects only the newest `## ` block, ignores the authoring note
 * above it, honors a `<!-- TONE-OK: <reason> -->` pragma anywhere in that block, reports clear
 * shape-specific errors, and exits non-zero on violations.
 */

const fs = require('fs');
const path = require('path');

const RepoRoot = path.join(__dirname, '..');
const ChangelogPath = path.join(RepoRoot, 'CHANGELOG.md');
const TonePragmaPattern = /<!--\s*TONE-OK:/;
const VersionHeadingPattern = /^##\s+(.+)$/m;
const TechnicalMarker = '**Technical:**';

/**
 * Extract the newest `## ` changelog block, ignoring any top-of-file authoring note before it.
 * @param {string} ArgContent Raw CHANGELOG.md content.
 * @returns {{ VersionLabel: string, BlockLines: string[] } | null} Newest block info, or null when absent.
 */
function ExtractNewestVersionBlock(ArgContent) {
  const Lines = ArgContent.split('\n');
  const StartIndex = Lines.findIndex(Line => Line.startsWith('## '));
  if(StartIndex < 0) return null;

  let EndIndex = Lines.length;
  for(let Index = StartIndex + 1; Index < Lines.length; Index += 1) {
    if(Lines[Index].startsWith('## ')) {
      EndIndex = Index;
      break;
    }
  }

  const HeadingMatch = Lines[StartIndex].match(VersionHeadingPattern);
  if(!HeadingMatch) return null;

  return {
    VersionLabel: HeadingMatch[1].trim(),
    BlockLines: Lines.slice(StartIndex + 1, EndIndex),
  };
}

/**
 * Find GH-408 tone violations in the newest changelog block only.
 * @param {string} ArgContent Raw CHANGELOG.md content.
 * @returns {string[]} Violation messages.
 */
function FindChangelogToneViolations(ArgContent) {
  const NewestBlock = ExtractNewestVersionBlock(ArgContent);
  if(!NewestBlock) return ['CHANGELOG.md: no `## <version> - <date>` block found.'];
  if(NewestBlock.BlockLines.some(Line => TonePragmaPattern.test(Line))) return [];

  const Violations = [];
  const FirstNonBlankLine = NewestBlock.BlockLines.find(Line => Line.trim() !== '');
  if(FirstNonBlankLine && FirstNonBlankLine.trimStart().startsWith('- ')) {
    Violations.push(
      `CHANGELOG.md: newest block "${NewestBlock.VersionLabel}" fails Shape 1 (no human lead): ` +
      'the first non-blank line starts with "- ". lead with a friendly plain-language TL;DR line ' +
      `before any bullets, or add "<!-- TONE-OK: <reason> -->" to opt out.`
    );
  }

  if(!NewestBlock.BlockLines.some(Line => Line.includes(TechnicalMarker))) {
    Violations.push(
      `CHANGELOG.md: newest block "${NewestBlock.VersionLabel}" fails Shape 2 (no technical block): ` +
      `missing "${TechnicalMarker}". add a technical detail section, or add ` +
      '"<!-- TONE-OK: <reason> -->" to opt out.'
    );
  }

  return Violations;
}

/**
 * Run the full changelog-tone guard against the repo's CHANGELOG.md.
 * @returns {string[]} All violation messages found; empty when clean.
 */
function RunChangelogToneValidation() {
  const ChangelogContent = fs.readFileSync(ChangelogPath, 'utf8');
  return FindChangelogToneViolations(ChangelogContent);
}

if(require.main === module) {
  const Violations = RunChangelogToneValidation();
  const NewestBlock = ExtractNewestVersionBlock(fs.readFileSync(ChangelogPath, 'utf8'));
  const VersionLabel = NewestBlock ? NewestBlock.VersionLabel : '(missing version block)';

  if(Violations.length > 0) {
    console.error('changelog tone violations found:\n');
    Violations.forEach(Violation => console.error(`  ${Violation}`));
    console.error(`\nSUMMARY: ${Violations.length} violation(s) in newest CHANGELOG block "${VersionLabel}".`);
    process.exit(1);
  }

  console.log(`changelog tone guard: clean. SUMMARY: newest CHANGELOG block "${VersionLabel}" is compliant.`);
}

module.exports = {
  ExtractNewestVersionBlock,
  FindChangelogToneViolations,
  RunChangelogToneValidation,
};
