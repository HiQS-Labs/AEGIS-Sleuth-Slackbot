'use strict';

const SlackFormatUtils = require('../src/slack-format-utils');

// ---------------------------------------------------------------------------
// BuildReminderSnippet
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.BuildReminderSnippet', () => {
  test('strips <url|display> link syntax, keeping display text', () => {
    const Input = '<@U032> - follow up on <https://slack.com/msg|this>';
    expect(SlackFormatUtils.BuildReminderSnippet(Input)).toBe('<@U032> - follow up on this');
  });

  test('strips bare angle-bracket URLs', () => {
    const Input = 'See <https://github.com/org/repo/issues/5> for details';
    expect(SlackFormatUtils.BuildReminderSnippet(Input)).toBe('See https://github.com/org/repo/issues/5 for details');
  });

  test('strips leading blockquote markers so mentions are not prefixed with >', () => {
    // This is the exact bug that was fixed: newline + > was collapsing to ><@user>
    const Input = '<@U111> - follow up on this:\n><@U222> please review the PR';
    const Result = SlackFormatUtils.BuildReminderSnippet(Input);
    expect(Result).not.toMatch(/><@/);
    expect(Result).toContain('<@U222>');
  });

  test('collapses multiple newlines and spaces into a single space', () => {
    const Input = 'line one\n\nline two\n   line three';
    expect(SlackFormatUtils.BuildReminderSnippet(Input)).toBe('line one line two line three');
  });

  test('truncates text longer than default 120 characters with ellipsis', () => {
    const LongText = 'a'.repeat(130);
    const Result = SlackFormatUtils.BuildReminderSnippet(LongText);
    expect(Result).toHaveLength(120);
    expect(Result.endsWith('...')).toBe(true);
  });

  test('respects custom ArgMaxLength', () => {
    const Input = 'Hello, this is a moderately long string for testing purposes';
    const Result = SlackFormatUtils.BuildReminderSnippet(Input, 20);
    expect(Result).toHaveLength(20);
    expect(Result.endsWith('...')).toBe(true);
  });

  test('returns empty string for empty input', () => {
    expect(SlackFormatUtils.BuildReminderSnippet('')).toBe('');
  });

  test('returns empty string for null/undefined input', () => {
    expect(SlackFormatUtils.BuildReminderSnippet(null)).toBe('');
    expect(SlackFormatUtils.BuildReminderSnippet(undefined)).toBe('');
  });

  test('short text passes through unchanged', () => {
    expect(SlackFormatUtils.BuildReminderSnippet('Simple task')).toBe('Simple task');
  });
});

// ---------------------------------------------------------------------------
// MrkdwnToRichText
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.MrkdwnToRichText', () => {
  test('converts user mention to rich_text user element', () => {
    const Result = SlackFormatUtils.MrkdwnToRichText('<@U12345678>');
    const Elements = Result.elements[0].elements;
    expect(Elements).toContainEqual({ type: 'user', user_id: 'U12345678' });
  });

  test('converts <url|text> to link element with url and text', () => {
    const Result = SlackFormatUtils.MrkdwnToRichText('<https://example.com|Click here>');
    const Elements = Result.elements[0].elements;
    expect(Elements).toContainEqual({ type: 'link', url: 'https://example.com', text: 'Click here' });
  });

  test('converts bare <url> to link element with url only', () => {
    const Result = SlackFormatUtils.MrkdwnToRichText('<https://example.com>');
    const Elements = Result.elements[0].elements;
    expect(Elements).toContainEqual({ type: 'link', url: 'https://example.com' });
  });

  test('preserves plain text segments between tokens', () => {
    const Result = SlackFormatUtils.MrkdwnToRichText('Hello <@U123> world');
    const Elements = Result.elements[0].elements;
    expect(Elements[0]).toEqual({ type: 'text', text: 'Hello ' });
    expect(Elements[2]).toEqual({ type: 'text', text: ' world' });
  });

  test('returns empty text element for empty string', () => {
    const Result = SlackFormatUtils.MrkdwnToRichText('');
    expect(Result.elements[0].elements[0]).toEqual({ type: 'text', text: '' });
  });

  test('converts channel reference to channel element', () => {
    const Result = SlackFormatUtils.MrkdwnToRichText('<#C12345|general>');
    const Elements = Result.elements[0].elements;
    expect(Elements).toContainEqual({ type: 'channel', channel_id: 'C12345' });
  });
});

// ---------------------------------------------------------------------------
// RichTextToPlainText
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.RichTextToPlainText', () => {
  test('returns string as-is', () => {
    expect(SlackFormatUtils.RichTextToPlainText('hello')).toBe('hello');
  });

  test('extracts text from user element', () => {
    expect(SlackFormatUtils.RichTextToPlainText({ type: 'user', user_id: 'U123' })).toBe('@U123');
  });

  test('extracts text from link element with display text', () => {
    expect(SlackFormatUtils.RichTextToPlainText({ type: 'link', url: 'https://x.com', text: 'X' })).toBe('X');
  });

  test('extracts url from link element with no display text', () => {
    expect(SlackFormatUtils.RichTextToPlainText({ type: 'link', url: 'https://x.com' })).toBe('https://x.com');
  });

  test('recursively extracts from rich_text_section', () => {
    const Input = {
      type: 'rich_text_section',
      elements: [{ type: 'text', text: 'Hi ' }, { type: 'user', user_id: 'U999' }]
    };
    expect(SlackFormatUtils.RichTextToPlainText(Input)).toBe('Hi @U999');
  });

  test('returns empty string for null', () => {
    expect(SlackFormatUtils.RichTextToPlainText(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// RichTextToMrkdwn
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.RichTextToMrkdwn', () => {
  test('preserves user mentions as Slack mrkdwn', () => {
    const Input = [{
      type: 'rich_text',
      elements: [{
        type: 'rich_text_section',
        elements: [
          { type: 'user', user_id: 'U123' },
          { type: 'text', text: ' review ' },
          { type: 'link', url: 'https://example.com', text: 'this' }
        ]
      }]
    }];

    expect(SlackFormatUtils.RichTextToMrkdwn(Input)).toBe('<@U123> review <https://example.com|this>');
  });
});

// ---------------------------------------------------------------------------
// ExtractUserMentions
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.ExtractUserMentions', () => {
  test('extracts a single user ID', () => {
    expect(SlackFormatUtils.ExtractUserMentions('<@U111> please review')).toEqual(['U111']);
  });

  test('extracts multiple user IDs in order', () => {
    expect(SlackFormatUtils.ExtractUserMentions('<@U111> and <@U222>')).toEqual(['U111', 'U222']);
  });

  test('deduplicates repeated mentions', () => {
    expect(SlackFormatUtils.ExtractUserMentions('<@U111> <@U111>')).toEqual(['U111']);
  });

  test('returns empty array when no mentions present', () => {
    expect(SlackFormatUtils.ExtractUserMentions('no mentions here')).toEqual([]);
  });

  test('returns empty array for null/empty input', () => {
    expect(SlackFormatUtils.ExtractUserMentions(null)).toEqual([]);
    expect(SlackFormatUtils.ExtractUserMentions('')).toEqual([]);
  });

  test('repeated calls do not leak regex lastIndex state across each other (GH-429)', () => {
    // ExtractUserMentions and ReplaceUserMentions share one `g`-flagged pattern source; each call
    // must get a fresh RegExp instance rather than reusing a stateful shared one.
    expect(SlackFormatUtils.ExtractUserMentions('<@U111>')).toEqual(['U111']);
    expect(SlackFormatUtils.ExtractUserMentions('<@U222>')).toEqual(['U222']);
    expect(SlackFormatUtils.ExtractUserMentions('<@U111>')).toEqual(['U111']);
  });
});

// ---------------------------------------------------------------------------
// ReplaceUserMentions
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.ReplaceUserMentions', () => {
  test('replaces a single mention using the resolver', () => {
    const Result = SlackFormatUtils.ReplaceUserMentions('hi <@U111>', (ArgUserId) => `@${ArgUserId}-resolved`);
    expect(Result).toBe('hi @U111-resolved');
  });

  test('replaces multiple distinct mentions, each via its own resolver call', () => {
    const Seen = [];
    const Result = SlackFormatUtils.ReplaceUserMentions('<@U111> and <@U222>', (ArgUserId) => {
      Seen.push(ArgUserId);
      return `@${ArgUserId}`;
    });
    expect(Result).toBe('@U111 and @U222');
    expect(Seen).toEqual(['U111', 'U222']);
  });

  test('handles the piped-label mention form', () => {
    expect(SlackFormatUtils.ReplaceUserMentions('<@U111|matt.saw>', () => '@Matt')).toBe('@Matt');
  });

  test('passes through text with no mentions unchanged and never calls the resolver', () => {
    const Resolve = jest.fn();
    expect(SlackFormatUtils.ReplaceUserMentions('no mentions here', Resolve)).toBe('no mentions here');
    expect(Resolve).not.toHaveBeenCalled();
  });

  test('passes through falsy/non-string input unchanged', () => {
    expect(SlackFormatUtils.ReplaceUserMentions('', () => 'x')).toBe('');
    expect(SlackFormatUtils.ReplaceUserMentions(null, () => 'x')).toBeNull();
    expect(SlackFormatUtils.ReplaceUserMentions(undefined, () => 'x')).toBeUndefined();
  });

  test('does not leak lastIndex state across repeated calls (shares pattern source with ExtractUserMentions)', () => {
    expect(SlackFormatUtils.ReplaceUserMentions('<@U111>', () => 'X')).toBe('X');
    expect(SlackFormatUtils.ReplaceUserMentions('<@U222>', () => 'Y')).toBe('Y');
    expect(SlackFormatUtils.ReplaceUserMentions('<@U111> <@U222>', (ArgUserId) => ArgUserId)).toBe('U111 U222');
  });
});

// ---------------------------------------------------------------------------
// NormalizeUserMentionsToMrkdwn
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.NormalizeUserMentionsToMrkdwn', () => {
  test('converts plain @U mentions to Slack mrkdwn tokens', () => {
    expect(SlackFormatUtils.NormalizeUserMentionsToMrkdwn('Determine work for @U000EXAMPLE1'))
      .toBe('Determine work for <@U000EXAMPLE1>');
  });

  test('leaves existing mrkdwn mentions unchanged', () => {
    expect(SlackFormatUtils.NormalizeUserMentionsToMrkdwn('Assign <@U000EXAMPLE1> to review'))
      .toBe('Assign <@U000EXAMPLE1> to review');
  });

  test('leaves labeled mrkdwn mentions unchanged', () => {
    expect(SlackFormatUtils.NormalizeUserMentionsToMrkdwn('Ping <@U000EXAMPLE1|Alex Rivera>'))
      .toBe('Ping <@U000EXAMPLE1|Alex Rivera>');
  });

  test('normalizes multiple plain mentions in one string', () => {
    expect(SlackFormatUtils.NormalizeUserMentionsToMrkdwn('@U111 and @U222 collaborate'))
      .toBe('<@U111> and <@U222> collaborate');
  });

  test('returns empty and null input unchanged', () => {
    expect(SlackFormatUtils.NormalizeUserMentionsToMrkdwn('')).toBe('');
    expect(SlackFormatUtils.NormalizeUserMentionsToMrkdwn(null)).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// ExtractCleanSummary
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.ExtractCleanSummary', () => {
  test('strips user mention brackets, keeping @ID', () => {
    const Result = SlackFormatUtils.ExtractCleanSummary('<@U123> - finish the report');
    expect(Result).toContain('@U123');
    expect(Result).not.toContain('<@U123>');
  });

  test('replaces <url|display> with display text', () => {
    expect(SlackFormatUtils.ExtractCleanSummary('check <https://example.com|this link>')).toContain('this link');
  });

  test('strips blockquote lines', () => {
    const Input = 'Header\n>Quoted content that should be removed\nFooter';
    const Result = SlackFormatUtils.ExtractCleanSummary(Input);
    expect(Result).not.toContain('Quoted content');
    expect(Result).toContain('Header');
  });

  test('truncates to maxLength with ellipsis', () => {
    const Long = 'word '.repeat(50);
    const Result = SlackFormatUtils.ExtractCleanSummary(Long, { maxLength: 50 });
    expect(Result.length).toBeLessThanOrEqual(50);
    expect(Result.endsWith('...')).toBe(true);
  });

  test('returns "Untitled reminder" for null/empty input', () => {
    expect(SlackFormatUtils.ExtractCleanSummary(null)).toBe('Untitled reminder');
    expect(SlackFormatUtils.ExtractCleanSummary('')).toBe('Untitled reminder');
  });
});

// ---------------------------------------------------------------------------
// ExtractKeyTasks
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.ExtractKeyTasks', () => {
  test('extracts content after "Key task(s):" section', () => {
    const Input = 'Header\n\nKey task(s):\n• Do the thing\n• Review PR';
    const Result = SlackFormatUtils.ExtractKeyTasks(Input);
    expect(Result).toContain('Do the thing');
    expect(Result).toContain('Review PR');
  });

  test('falls back to ExtractCleanSummary when no key tasks section', () => {
    const Input = '<@U123> - just do this by Friday';
    const Result = SlackFormatUtils.ExtractKeyTasks(Input);
    expect(Result).toBeTruthy();
    expect(Result).not.toBe('Untitled reminder');
  });

  test('returns "Untitled reminder" for null input', () => {
    expect(SlackFormatUtils.ExtractKeyTasks(null)).toBe('Untitled reminder');
  });
});

// ---------------------------------------------------------------------------
// ReplaceReminderSummary
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.ReplaceReminderSummary', () => {
  test('rewrites only the key-tasks section when present', () => {
    const Input = '<@U1> - please follow up on <https://slack.com/msg|this>:\n>original request\n\nKey task(s):\n• Old task';
    const Result = SlackFormatUtils.ReplaceReminderSummary(Input, '<@U2> New task');

    expect(Result).toContain('<@U1> - please follow up on <https://slack.com/msg|this>:');
    expect(Result).toContain('>original request');
    expect(Result).toContain('\n\nKey task(s):\n• <@U2> New task');
    expect(Result).not.toContain('• Old task');
  });

  test('replaces plain list-authored reminders wholesale when no key-tasks section exists', () => {
    expect(SlackFormatUtils.ReplaceReminderSummary('Old plain summary', 'New plain summary')).toBe('New plain summary');
  });
});

// ---------------------------------------------------------------------------
// ExtractAssignee
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.ExtractAssignee', () => {
  // Typical reminder format: header line then :\n> quoted original message
  const ReminderWithQuote = '<@BOT> - follow up:\n><@U111> please fix the bug';

  test('returns first human user from quoted section', () => {
    expect(SlackFormatUtils.ExtractAssignee(ReminderWithQuote, null, 'BOT')).toBe('U111');
  });

  test('filters out the bot user ID', () => {
    const BotOnlyMessage = '<@BOT> some text\n><@BOT> bot is mentioned again';
    expect(SlackFormatUtils.ExtractAssignee(BotOnlyMessage, null, 'BOT')).toBeNull();
  });

  test('returns null when no mentions found', () => {
    expect(SlackFormatUtils.ExtractAssignee('no mentions at all', null, 'BOT')).toBeNull();
  });

  test('returns null for null input', () => {
    expect(SlackFormatUtils.ExtractAssignee(null, null, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ExtractDueDate
// ---------------------------------------------------------------------------

describe('SlackFormatUtils.ExtractDueDate', () => {
  test('extracts "by Wednesday" pattern', () => {
    const Result = SlackFormatUtils.ExtractDueDate('finish the report by Wednesday');
    expect(Result).toMatch(/by wednesday/i);
  });

  test('extracts "by tomorrow at 5 PM" pattern', () => {
    const Result = SlackFormatUtils.ExtractDueDate('submit by tomorrow at 5 PM');
    expect(Result).toMatch(/by tomorrow/i);
  });

  test('extracts "by Friday EOD" pattern', () => {
    const Result = SlackFormatUtils.ExtractDueDate('complete by friday eod');
    expect(Result).toMatch(/by friday/i);
  });

  test('returns null when no due date pattern found', () => {
    expect(SlackFormatUtils.ExtractDueDate('no deadline mentioned here')).toBeNull();
  });

  test('returns null for null/empty input', () => {
    expect(SlackFormatUtils.ExtractDueDate(null)).toBeNull();
    expect(SlackFormatUtils.ExtractDueDate('')).toBeNull();
  });
});

describe('SlackFormatUtils.NormalizeModelMarkdownForSlack', () => {
  test('returns empty string for null / undefined / empty input', () => {
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(null)).toBe('');
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(undefined)).toBe('');
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('')).toBe('');
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(42)).toBe('');
  });

  test('converts double-asterisk bold to single-asterisk Slack bold', () => {
    const Input = 'This is **bold text** inline.';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input)).toBe('This is *bold text* inline.');
  });

  test('converts multiple bold runs on the same line', () => {
    const Input = '**First bold** and then **second bold** here.';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input)).toBe('*First bold* and then *second bold* here.');
  });

  test('converts triple-asterisk bold-italic to single-asterisk bold', () => {
    const Input = '***strong emphasis***';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input)).toBe('*strong emphasis*');
  });

  test('converts underscore-underscore bold to single-asterisk bold', () => {
    const Input = 'This is __also bold__ text.';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input)).toBe('This is *also bold* text.');
  });

  test('converts single-hash heading to a pushpin-prefixed bold line', () => {
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('# Top Heading'))
      .toBe(':round_pushpin: *Top Heading*');
  });

  test('converts double-hash heading to a diamond-prefixed bold line', () => {
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('## Second Level'))
      .toBe(':small_blue_diamond: *Second Level*');
  });

  test('converts triple-hash heading to a right-arrow-prefixed bold line', () => {
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('### Third Level'))
      .toBe(':point_right: *Third Level*');
  });

  test('converts four-plus-hash headings to an orange-diamond-prefixed bold line', () => {
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('#### Fourth Level'))
      .toBe(':small_orange_diamond: *Fourth Level*');
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('##### Fifth Level'))
      .toBe(':small_orange_diamond: *Fifth Level*');
  });

  test('supports plain-bold heading mode for startup-style markdown previews', () => {
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('# Top Heading', { HeadingStyle: 'plain-bold' }))
      .toBe('*Top Heading*');
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('## Second Level', { HeadingStyle: 'plain-bold' }))
      .toBe('*Second Level*');
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack('### Third Level', { HeadingStyle: 'plain-bold' }))
      .toBe('*Third Level*');
  });

  test('supports plain-bold setext heading mode for startup-style markdown previews', () => {
    const Input = 'Section Title\n=============\n\nSubsection\n----------';
    const Result = SlackFormatUtils.NormalizeModelMarkdownForSlack(Input, { HeadingStyle: 'plain-bold' });
    expect(Result).toContain('*Section Title*');
    expect(Result).toContain('*Subsection*');
    expect(Result).not.toContain('=============');
    expect(Result).not.toContain('----------');
  });

  test('does NOT convert hashes that are not heading markers', () => {
    // A hash in the middle of a line or immediately followed by a non-space
    // character (like `#sleuth-ai`) should be left alone.
    const Input = 'Tag me with #sleuth-ai in a channel.';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input)).toBe(Input);
  });

  test('converts hyphen bullet list to Slack bullet points', () => {
    const Input = '- first item\n- second item\n- third item';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input))
      .toBe('\u2022 first item\n\u2022 second item\n\u2022 third item');
  });

  test('preserves indentation on nested hyphen bullets', () => {
    const Input = '- parent\n  - child\n  - sibling';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input))
      .toBe('\u2022 parent\n  \u2022 child\n  \u2022 sibling');
  });

  test('does NOT touch fenced code blocks', () => {
    const Input = [
      'Before code:',
      '```javascript',
      'const x = **not bold**;',
      '## not a heading',
      '```',
      'After code.',
    ].join('\n');
    const Result = SlackFormatUtils.NormalizeModelMarkdownForSlack(Input);
    // Inside the fence, the double asterisks and hash should be preserved literally.
    expect(Result).toContain('const x = **not bold**;');
    expect(Result).toContain('## not a heading');
    // Outside the fence, normalization still applies (nothing to change here,
    // but prove the fence exited).
    expect(Result).toContain('After code.');
  });

  test('setext-style h1 (underlined with ===) becomes a pushpin-bold line', () => {
    const Input = 'Section Title\n=============\n\nBody paragraph.';
    const Result = SlackFormatUtils.NormalizeModelMarkdownForSlack(Input);
    expect(Result).toContain(':round_pushpin: *Section Title*');
    expect(Result).toContain('Body paragraph.');
    expect(Result).not.toContain('=============');
  });

  test('setext-style h2 (underlined with ---) becomes a diamond-bold line', () => {
    const Input = 'Subsection\n----------\n\nBody.';
    const Result = SlackFormatUtils.NormalizeModelMarkdownForSlack(Input);
    expect(Result).toContain(':small_blue_diamond: *Subsection*');
    expect(Result).not.toContain('----------');
  });

  test('handles a realistic Gemini-style response end-to-end', () => {
    const Input = [
      '**1. Direct Answer**',
      '',
      'Sleuth is a Slack-native reminder bot.',
      '',
      '**2. Supporting Evidence**',
      '',
      '- **Reaction-driven UX:** users react with `:alarm_clock:` to schedule.',
      '- **GitHub integration:** relays thread replies to PR comments.',
      '',
      '## Caveats',
      '',
      'The strategy brief is a draft.',
    ].join('\n');
    const Result = SlackFormatUtils.NormalizeModelMarkdownForSlack(Input);

    // Bolded section headers normalized to Slack bold.
    expect(Result).toContain('*1. Direct Answer*');
    expect(Result).toContain('*2. Supporting Evidence*');
    // ## heading replaced with diamond-bold.
    expect(Result).toContain(':small_blue_diamond: *Caveats*');
    // Bullets flipped.
    expect(Result).toContain('\u2022 *Reaction-driven UX:*');
    expect(Result).toContain('\u2022 *GitHub integration:*');
    // No residual double asterisks anywhere.
    expect(Result).not.toMatch(/\*{2}/);
    // Literal emoji shortcodes passed through unchanged (Slack renders them).
    expect(Result).toContain(':alarm_clock:');
  });

  test('idempotent: already-Slack-mrkdwn input passes through unchanged', () => {
    const Input = '*already bold*\n\u2022 bullet one\n\u2022 bullet two';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input)).toBe(Input);
  });

  test('preserves inline code spans', () => {
    const Input = 'Use `npm run rag:ingest` to rebuild.';
    expect(SlackFormatUtils.NormalizeModelMarkdownForSlack(Input)).toBe(Input);
  });
});

describe('SlackFormatUtils.TruncateToWords', () => {
  test('returns text unchanged when word count is at or below the budget', () => {
    expect(SlackFormatUtils.TruncateToWords('one two three', 5)).toBe('one two three');
    expect(SlackFormatUtils.TruncateToWords('one two three', 3)).toBe('one two three');
  });

  test('cuts at the word boundary and appends a horizontal ellipsis', () => {
    expect(SlackFormatUtils.TruncateToWords('one two three four five', 3)).toBe('one two three…');
  });

  test('never slices mid-word — protects bold-pair / backtick markdown tokens from being cut', () => {
    // The 1.4.144 entry got cut mid-"caller" with the old character truncation. Word truncation
    // either includes a whole markdown token like `**State**` or excludes it entirely.
    const Input = 'invariants ( **State** , **IgnoreSnooze** , **ReminderID** , **CreatedOn** ) now spread last so a caller cannot override.';
    const Result = SlackFormatUtils.TruncateToWords(Input, 5);
    // Cut lands cleanly between whole tokens — no half-`**State` or stray closing pair.
    expect(Result).toBe('invariants ( **State** , **IgnoreSnooze**…');
  });

  test('preserves original whitespace structure (including newlines) up to the cut point', () => {
    const Input = '# Changelog\n\n## 1.4.146 - 2026-05-28\n- Promoted the reminder FSM contract';
    const Result = SlackFormatUtils.TruncateToWords(Input, 4);
    // First 4 \S+ tokens: "#", "Changelog", "##", "1.4.146" — preserves the surrounding newlines.
    expect(Result).toBe('# Changelog\n\n## 1.4.146…');
  });

  test('does not append the ellipsis when only trailing whitespace follows the last counted word', () => {
    expect(SlackFormatUtils.TruncateToWords('one two three   \n\n', 3)).toBe('one two three   \n\n');
  });

  test('handles empty / falsy / zero-budget inputs without throwing', () => {
    expect(SlackFormatUtils.TruncateToWords('', 10)).toBe('');
    expect(SlackFormatUtils.TruncateToWords(null, 10)).toBe('');
    expect(SlackFormatUtils.TruncateToWords(undefined, 10)).toBe('');
    expect(SlackFormatUtils.TruncateToWords('one two three', 0)).toBe('');
  });

  test('whitespace-only input returns empty (no infinite ellipsis on blank changelogs)', () => {
    expect(SlackFormatUtils.TruncateToWords('   \n\n   ', 10)).toBe('   \n\n   ');
  });
});
