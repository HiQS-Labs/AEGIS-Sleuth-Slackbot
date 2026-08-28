'use strict';

const fs = require('fs');
const path = require('path');
const ContextResolution = require('../src/reminder-context-resolution');

/**
 * GH-143: the defect this file exists for.
 *
 * A production thread — "let's take the car" / "please bring the cooler" / "can you do all of the
 * above tomorrow?" — enriched correctly (3 messages prepended), routed correctly (synthesis on),
 * and resolved ownership correctly. The reminder still read "Do all of the above". Every existing
 * test passed, because every existing test asserts PLUMBING: which path fired, which flag was set,
 * who was assigned. Nothing asserted that the produced task text says what to do.
 *
 * These are the two halves of that gap: a detector the pipeline logs on, and a guard that the
 * prompt rules which do the actual fixing are still present.
 */

describe('GH-143 unresolved reference detection', () => {
  // The exact titles a reader learns nothing from. Each is a real or realistic model output.
  const UNRESOLVED = [
    'Do all of the above',
    'do the above',
    'Do it',
    'Handle this',
    'Take care of that',
    'Work on it',
    'Follow up on it',
    'Review the above and confirm',
  ];

  // Titles that name their object. These must NOT be flagged, or the warning becomes noise and
  // stops being read — which is how a detector dies.
  const RESOLVED = [
    'Take the car',
    'Bring the cooler',
    'Go to the Lake',
    'Change Ground Advantage $5 shipping to $6',
    'Review Development branch and push to Production',
    'Rename the plugin to "Sleuth AI v2"',
    'Deploy the hotfix',
    'Move hero CTA above the fold',   // "above" as a position, not a reference
  ];

  test.each(UNRESOLVED)('flags an unresolved reference: %s', (ArgTitle) => {
    expect(ContextResolution.NeedsEarlierContext(ArgTitle)).toBe(true);
  });

  test.each(RESOLVED)('leaves a self-describing title alone: %s', (ArgTitle) => {
    expect(ContextResolution.NeedsEarlierContext(ArgTitle)).toBe(false);
  });
});

describe('GH-143 extraction prompts carry the resolve-the-reference rules', () => {
  const AssetDir = path.join(__dirname, '..', 'data', 'static', 'ai');
  const ReadAsset = (/** @type {string} */ ArgName) =>
    fs.readFileSync(path.join(AssetDir, ArgName), 'utf8');

  // A prompt rule is the actual fix here, and a prompt rule is exactly the kind of thing that gets
  // dropped in an unrelated edit with no test to notice. These guard the rule's presence — they
  // cannot prove the model obeys it, and this file does not pretend otherwise.
  test('the analyzer prompt forbids leaving a bare reference as the task', () => {
    const Instructions = ReadAsset('reminders-instructions.md');
    expect(Instructions).toContain('RESOLVE THE REFERENCE RULE');
    expect(Instructions).toContain('all of the above');
    expect(Instructions).toContain('MULTIPLE REFERENTS RULE');
  });

  test('the forced-reminder prompt carries the same rule — the clock emoji uses it', () => {
    // The :alarm_clock: path falls back to this prompt when the analyzer returns no candidates,
    // so a rule added only to the analyzer would fix one door and leave the other open.
    const Instructions = ReadAsset('manual-reminder-task-instructions.md');
    expect(Instructions).toContain('RESOLVE THE REFERENCE');
    expect(Instructions).toContain('Do all of the above');
  });
});
