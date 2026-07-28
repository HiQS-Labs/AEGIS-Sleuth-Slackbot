'use strict';

const {
  FindReminderRenderViolations,
  RunReminderRenderValidation,
} = require('../scripts/validate-reminder-render');

describe('validate-reminder-render (GH-391)', () => {
  describe('Shape 1 — raw reminder-id construction', () => {
    test('flags a template literal building an id: prefix onto a value', () => {
      const Lines = [
        'function Render(ArgReminders) {',
        '  return ArgReminders.map(R => `id:${R.ReminderID} ${R.text}`).join(String.fromCharCode(10));',
        '}',
      ];
      const Violations = FindReminderRenderViolations('fixture.js', Lines);
      expect(Violations).toHaveLength(1);
      expect(Violations[0]).toMatch(/fixture\.js:2:/);
    });

    test('honors an inline RENDER-OK pragma (model-input render)', () => {
      const Lines = [
        '  return `id:${Candidate.id} ${Candidate.text}`; // RENDER-OK: model-input only, never posted.',
      ];
      expect(FindReminderRenderViolations('fixture.js', Lines)).toHaveLength(0);
    });

    test('flags the string-concatenation vector (consult review)', () => {
      expect(FindReminderRenderViolations('a.js', ["  const s = 'id:' + reminder.ReminderID;"])).toHaveLength(1);
      expect(FindReminderRenderViolations('b.js', ['  const s = "id: " + id + text;'])).toHaveLength(1);
    });

    test('does not flag a benign "id:" mention with no interpolation', () => {
      const Lines = [
        "  const Help = 'reference tasks by their id: shown in the sidebar';",
        '  const Label = `id ${count}`;', // "id " not "id:"
      ];
      expect(FindReminderRenderViolations('fixture.js', Lines)).toHaveLength(0);
    });
  });

  describe('Shape 2 — prompt instruction to cite reminder ids', () => {
    test('flags the GH-391 bad instruction', () => {
      const Lines = [
        "      'Always cite reminder IDs (e.g. id:abc-123) when referencing specific tasks.',",
      ];
      const Violations = FindReminderRenderViolations('fixture.js', Lines);
      // Both the cite-instruction (Shape 2) and the literal id:abc pattern... note id:abc-123 has no
      // ${ interpolation, so only Shape 2 fires here.
      expect(Violations).toHaveLength(1);
      expect(Violations[0]).toMatch(/cite reminder ids/i);
    });

    test('does not flag an instruction to NOT surface ids', () => {
      const Lines = [
        "      'Never surface internal reminder ids (e.g. id:abc-123) in your answer.',",
      ];
      expect(FindReminderRenderViolations('fixture.js', Lines)).toHaveLength(0);
    });

    test('does not false-positive on a NEGATED cite instruction (consult review)', () => {
      // "Do not cite reminder ids" is the CORRECT guidance — the guard must not flag it.
      expect(FindReminderRenderViolations('a.js', ["  'Do not cite reminder ids in your answer.',"])).toHaveLength(0);
      expect(FindReminderRenderViolations('b.js', ["  'Never cite reminder IDs to the user.',"])).toHaveLength(0);
    });

    test('does not flag "provide the open reminder ID" (dedup context, no cite verb)', () => {
      const Lines = [
        "  const P = 'Flag any candidate that duplicates an already-open reminder (provide the open reminder ID).';",
      ];
      expect(FindReminderRenderViolations('fixture.js', Lines)).toHaveLength(0);
    });
  });

  describe('RunReminderRenderValidation (integration)', () => {
    test('the current src tree is clean', () => {
      // Enforcement: reintroducing a user-facing id blob or the "cite reminder IDs" prompt (or
      // dropping a RENDER-OK pragma from a model-input render) turns this red under `npm test`.
      expect(RunReminderRenderValidation()).toEqual([]);
    });
  });
});
