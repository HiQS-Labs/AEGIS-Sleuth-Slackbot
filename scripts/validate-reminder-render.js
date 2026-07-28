'use strict';

/**
 * CI guard for the GH-391 reminder-render convention: reminder lists are shown to users ONLY through
 * the canonical per-reminder poster (PostRemindersListAsync / PostBucketedReminderSectionsAsync in
 * src/reminders-display-utils.js), so every task is its own reaction-actionable message and no raw
 * internal `id:` value ever reaches a user. Mirrors scripts/validate-workspace-isolation.js — scan
 * src/**\/*.js, match narrow patterns, honor an inline `// RENDER-OK:` allowlist pragma, report
 * file:line, exit non-zero on any violation.
 *
 * Shape 1 — raw reminder-id construction. Flags a template literal that builds an `id:` prefix
 * directly onto a value (`id:${...}`), the shape behind the reported "id:fc3d9b07 — …" blob. Model-
 * input renders (the cited candidate set, dedup context) are legitimate and carry
 * `// RENDER-OK: <reason>` — but such a string must never flow into a user-facing post.
 *
 * Shape 2 — a prompt instruction telling the model to cite reminder ids in its answer. Flags the
 * exact GH-391 bad instruction ("Always cite reminder IDs (e.g. id:abc-123)") so it can't be
 * reintroduced; refer to tasks by description instead. Reviewed exceptions carry `// RENDER-OK:`.
 *
 * The guard is intentionally narrow (two concrete shapes) to keep false positives at zero. It does
 * not attempt full dataflow ("is this specific string posted to Slack?"); the documented convention
 * (AGENTS.md) plus these two shapes cover the regression class without a parallel render path.
 */

const fs = require('fs');
const path = require('path');

const SrcRoot = path.join(__dirname, '..', 'src');
const RepoRoot = path.join(__dirname, '..');
const RenderPragma = 'RENDER-OK';

// Shape 1a: a template literal building a standalone `id:` token directly onto an interpolated value,
// e.g. `id:${x}`. The negative lookbehind keeps unrelated compound tokens (`task-id:`, `msg-id:`)
// out — those are not reminder-id renders.
const RawIdConstructionPattern = /(?<![-\w])id:\s*\$\{/;
// Shape 1b (consult review): the string-concatenation vector — a quoted `id:` literal glued onto a
// value, e.g. `'id:' + x` or `"id: " + id`. Same intent, different syntax from 1a.
const RawIdConcatPattern = /(['"])[^'"\n]*\bid:\s*\1\s*\+/;
// Shape 2: an instruction to cite reminder ids in the model's answer (the GH-391 bad prompt).
const CiteIdsInstructionPattern = /\bcite\b[^\n]{0,40}\breminder\s*ids?\b/i;
// ...but NOT a negated instruction ("never/do not cite reminder ids"), which is the CORRECT guidance
// (consult review: the guard was false-positiving on the very instruction it wants developers to write).
const CiteIdsNegationPattern = /\b(?:never|not|don'?t|avoid|without|no)\b[^\n]{0,20}\bcite\b/i;

/**
 * Recursively collect .js file paths under a directory.
 * @param {string} ArgDir Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function CollectJsFiles(ArgDir) {
  const Results = [];
  for(const Entry of fs.readdirSync(ArgDir, { withFileTypes: true })) {
    const FullPath = path.join(ArgDir, Entry.name);
    if(Entry.isDirectory()) Results.push(...CollectJsFiles(FullPath));
    else if(Entry.isFile() && Entry.name.endsWith('.js')) Results.push(FullPath);
  }
  return Results;
}

/**
 * Scan a file's lines for reminder-render violations (both shapes).
 * @param {string} ArgRelPath File path used for reporting.
 * @param {string[]} ArgLines File content split on newlines.
 * @returns {string[]} Violation strings shaped "path:line: message".
 */
function FindReminderRenderViolations(ArgRelPath, ArgLines) {
  const Violations = [];
  ArgLines.forEach((Line, Index) => {
    if(Line.includes(RenderPragma)) return;

    if(RawIdConstructionPattern.test(Line) || RawIdConcatPattern.test(Line)) {
      Violations.push(
        `${ArgRelPath}:${Index + 1}: raw reminder-id built into a string ("${Line.trim()}"). ` +
        'render reminder lists through PostRemindersListAsync/PostBucketedReminderSectionsAsync so ' +
        'the id travels in message metadata, not user copy — or add "// ' + RenderPragma +
        ': <reason>" if this string is model-input only.'
      );
    }

    if(CiteIdsInstructionPattern.test(Line) && !CiteIdsNegationPattern.test(Line)) {
      Violations.push(
        `${ArgRelPath}:${Index + 1}: prompt instructs the model to cite reminder ids ("${Line.trim()}"). ` +
        'internal ids must never surface to users — instruct the model to refer to tasks by ' +
        'description, or add "// ' + RenderPragma + ': <reason>" if reviewed.'
      );
    }
  });
  return Violations;
}

/**
 * Run the full reminder-render guard over src/**\/*.js.
 * @returns {string[]} All violation strings found; empty when clean.
 */
function RunReminderRenderValidation() {
  const Violations = [];
  for(const FilePath of CollectJsFiles(SrcRoot)) {
    const RelPath = path.relative(RepoRoot, FilePath);
    const Lines = fs.readFileSync(FilePath, 'utf8').split('\n');
    Violations.push(...FindReminderRenderViolations(RelPath, Lines));
  }
  return Violations;
}

if(require.main === module) {
  const Violations = RunReminderRenderValidation();
  if(Violations.length > 0) {
    console.error('reminder-render violations found:\n');
    Violations.forEach(Violation => console.error(`  ${Violation}`));
    console.error(
      `\n${Violations.length} violation(s). see AGENTS.md ` +
      '"Render reminder lists only through the canonical per-reminder poster (GH-391)."'
    );
    process.exit(1);
  }
  console.log('reminder-render guard: clean.');
}

module.exports = {
  RunReminderRenderValidation,
  FindReminderRenderViolations,
};
