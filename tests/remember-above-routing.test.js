'use strict';

// Regression guard for the Q2 routing bug: the `remember above` command is a standalone, no-argument
// command and must only fire when the message IS that command (after the bot mention). The previous
// unanchored matcher fired on any message containing the phrase, so asking ABOUT the command silently
// captured the thread (a real write). See REMEMBER_ABOVE_PATTERN in reminders-app-mention-handler.js.

const { REMEMBER_ABOVE_PATTERN } = require('../src/reminders-app-mention-handler');

const MENTION = '<@U07SLEUTH>';

describe('remember-above route matching', () => {
  describe('fires on the standalone command', () => {
    const Matches = [
      `${MENTION} remember above`,
      `${MENTION} remember above.`,
      `${MENTION} remember above!`,
      `${MENTION} please remember above`,
      `${MENTION}   remember   above  `,
      '<@U07SLEUTH|sleuth> remember above',
      'remember above', // no mention (e.g. message-event / test invocation)
    ];
    test.each(Matches)('matches %p', (Text) => {
      // exec from a fresh lastIndex each time — the pattern has no /g flag so this is just clarity.
      expect(REMEMBER_ABOVE_PATTERN.test(Text)).toBe(true);
    });
  });

  describe('does NOT fire when the phrase only appears inside a larger message', () => {
    const NonMatches = [
      // the exact reported failure — asking about the command via ask-self
      `${MENTION} ask-self what is and how does the remember above command work?`,
      // a question that ends with the phrase (the case end-anchoring alone would miss)
      `${MENTION} what is remember above?`,
      `${MENTION} ask-self explain remember above`,
      `${MENTION} how do I use remember above to save a thread`,
      `${MENTION} remember above the budget we should ship`, // trailing args = not the bare command
      `${MENTION} recall remember above`,
      'ok cool everyone, lets remember above important context here',
    ];
    test.each(NonMatches)('ignores %p', (Text) => {
      expect(REMEMBER_ABOVE_PATTERN.test(Text)).toBe(false);
    });
  });
});
