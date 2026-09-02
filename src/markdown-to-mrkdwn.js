'use strict';

/**
 * Markdown → Slack mrkdwn (GH-163).
 *
 * Slack does not render GitHub-flavoured Markdown. `**bold**`, `# headings`, `* bullets`
 * and `---` all arrive as literal characters in a chat.postMessage `text` field. The
 * progress digest (and the snapshot relay) are authored as Markdown because the same
 * file is read on GitHub, so the conversion belongs here, at post time — never upstream.
 *
 * Deliberately small and line-oriented. It covers the constructs the relayed files
 * actually use; it is NOT a general Markdown parser. Fenced code blocks pass through
 * untouched so a pasted command or stack trace is never rewritten.
 *
 * Pure: string in, string out, no I/O.
 */

/**
 * Convert inline Markdown emphasis + links to mrkdwn on a single line.
 * Order matters: `**` must be collapsed before single `*` is considered, and links
 * before anything that might touch the `[]()` characters.
 * @param {string} ArgLine One line, not inside a fenced block.
 * @returns {string}
 */
function ConvertInline(ArgLine) {
  // Inline code spans are valid mrkdwn and must not be rewritten: convert only the
  // segments between backtick pairs.
  return ArgLine.split(/(`[^`]*`)/).map((ArgSegment, ArgIndex) =>
    (ArgIndex % 2 === 1 ? ArgSegment : ConvertInlineSegment(ArgSegment))).join('');
}

/**
 * Convert one code-free segment of a line.
 * @param {string} ArgSegment
 * @returns {string}
 */
function ConvertInlineSegment(ArgSegment) {
  let Line = ArgSegment;

  // [text](url) → <url|text>. Slack's link form; only http(s) targets.
  Line = Line.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<$2|$1>');

  // **bold** / __bold__ → *bold*, via a placeholder so the italic pass below cannot
  // see the freshly-made single stars and turn bold into italic.
  const BoldMark = '\u0000';
  Line = Line.replace(/\*\*([^*\n]+?)\*\*/g, `${BoldMark}$1${BoldMark}`);
  Line = Line.replace(/__([^_\n]+?)__/g, `${BoldMark}$1${BoldMark}`);

  // *italic* (single star, not a bullet marker) → _italic_
  Line = Line.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, '$1_$2_');

  Line = Line.split(BoldMark).join('*');

  // ~~strike~~ → ~strike~
  Line = Line.replace(/~~([^~\n]+?)~~/g, '~$1~');

  return Line;
}

/**
 * Convert a Markdown document to Slack mrkdwn.
 * @param {string} ArgMarkdown Source text.
 * @param {{ dropFirstHeading?: boolean }} [ArgOptions]
 *   dropFirstHeading — remove the first `# Title` line entirely. The relay already lifts
 *   that title into its own header line, so keeping it would print the title twice.
 * @returns {string}
 */
function MarkdownToMrkdwn(ArgMarkdown, ArgOptions = {}) {
  if(typeof ArgMarkdown !== 'string' || ArgMarkdown.length === 0) return '';

  const DropFirstHeading = ArgOptions.dropFirstHeading === true;
  const Lines = ArgMarkdown.split('\n');
  const Out = [];
  let InFence = false;
  let FirstHeadingDropped = false;

  for(const RawLine of Lines) {
    // Fenced code: pass through verbatim, including the fence lines themselves.
    if(/^\s*```/.test(RawLine)) {
      InFence = !InFence;
      Out.push(RawLine);
      continue;
    }
    if(InFence) {
      Out.push(RawLine);
      continue;
    }

    // HTML comments used as relay headers are not for humans — drop them.
    if(/^\s*<!--.*-->\s*$/.test(RawLine)) continue;

    // Horizontal rule → dropped (Slack has no rule; a blank line reads cleaner).
    if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(RawLine)) {
      if(Out.length && Out[Out.length - 1] !== '') Out.push('');
      continue;
    }

    // Headings: `# Title` → `*Title*`. First one optionally dropped.
    const HeadingMatch = RawLine.match(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/);
    if(HeadingMatch) {
      if(DropFirstHeading && !FirstHeadingDropped) {
        FirstHeadingDropped = true;
        continue;
      }
      FirstHeadingDropped = true;
      Out.push(`*${ConvertInline(HeadingMatch[1])}*`);
      continue;
    }

    // Bullets: `* item` / `- item` / `+ item` → `• item` (indent preserved).
    const BulletMatch = RawLine.match(/^(\s*)[*\-+]\s+(.*)$/);
    if(BulletMatch) {
      Out.push(`${BulletMatch[1]}• ${ConvertInline(BulletMatch[2])}`);
      continue;
    }

    // Numbered lists render fine in Slack as plain text; convert inline only.
    Out.push(ConvertInline(RawLine));
  }

  // Collapse runs of 3+ blank lines left behind by dropped rules/comments.
  return Out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

module.exports = { MarkdownToMrkdwn };
