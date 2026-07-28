'use strict';

/**
 * Single source of truth for turning raw CHANGELOG.md content into version blocks. Every consumer
 * that surfaces changelog content externally (the `changelog` Slack command, the startup message
 * excerpt, the GH-408 tone validator) must go through this — the top-of-file authoring note (the
 * `<!-- HOW TO WRITE AN ENTRY -->` block) lives above the first `## ` heading specifically so it
 * never gets surfaced, and that guarantee only holds if there is one extraction implementation
 * instead of each caller re-deriving it.
 */

const CHANGELOG_VERSION_LIMIT = 10;

/**
 * Strip every `<!-- ... -->` block from the content before line-scanning for headings. Without
 * this, a `## `-shaped line placed anywhere inside an HTML comment (e.g. a future edit to the
 * authoring note's own format example) would be mistaken for a real version heading — relying on
 * today's indentation to dodge that is not a structural guarantee. `[\s\S]*?` spans newlines
 * non-greedily so multiple separate comments don't collapse into one match.
 *
 * @param {string} ArgContent Raw text, possibly containing HTML comments.
 * @returns {string} The text with all HTML comment blocks removed.
 */
function StripHtmlComments(ArgContent) {
  return ArgContent.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Extract the most recent N version blocks from CHANGELOG.md content. A version block starts
 * at a line beginning with `## ` and runs until the next `## ` heading or end of file. Content
 * inside `<!-- ... -->` comments (e.g. the top-of-file authoring note) is stripped first, so a
 * `## `-shaped line inside a comment can never be mistaken for a real heading.
 *
 * @param {string} ArgContent Raw CHANGELOG.md text.
 * @param {number} ArgLimit Maximum number of version blocks to return.
 * @returns {{ Text: string, Count: number }} Joined block text and the actual block count.
 */
function ExtractRecentVersionBlocks(ArgContent, ArgLimit) {
  const Lines = StripHtmlComments(String(ArgContent || '')).split('\n');
  /** @type {string[][]} */
  const Blocks = [];
  /** @type {string[] | null} */
  let CurrentBlock = null;
  for(const Line of Lines) {
    if(/^##\s+/.test(Line)) {
      if(CurrentBlock) Blocks.push(CurrentBlock);
      CurrentBlock = [Line];
    } else if(CurrentBlock) {
      CurrentBlock.push(Line);
    }
  }
  if(CurrentBlock) Blocks.push(CurrentBlock);
  const Selected = Blocks.slice(0, ArgLimit);
  const Text = Selected.map((ArgBlock) => ArgBlock.join('\n').trimEnd()).join('\n\n');
  return { Text, Count: Selected.length };
}

module.exports = {
  ExtractRecentVersionBlocks,
  CHANGELOG_VERSION_LIMIT,
};
