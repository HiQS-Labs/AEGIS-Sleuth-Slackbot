'use strict';

const { MarkdownToMrkdwn } = require('../src/markdown-to-mrkdwn');

/** The 2026-09-02 13:05 digest body as it was relayed — the post that motivated GH-163. */
const DIGEST_2026_09_02 = [
  '# Progress digest — 2026-09-02',
  '',
  '*Generated 2026-09-02 13:05 PDT. Covers midnight to now.*',
  '',
  '* **hiqs-suite/xyz-forge** & **hiqs-labs/xyz-forge**: Merged a cross-device bridge over Cloudflare Tunnel (GH-384), test-suite recalibration (GH-377).',
  '* **hiqs-suite/rebalanceos** & **hiqs-labs/rebalanceos**: Merged Phase 0 of the measured CI-lane campaign (#145).',
  '',
  '**HEALTH**',
  '* Five problems: deep work, sleuth export, slack users, commit coverage, and launchd:health-check.',
  '',
  '---',
  '91 commits · 10 merged · 6 active repos · 5 health warnings',
].join('\n');

describe('MarkdownToMrkdwn — GH-163 digest rendering', () => {
  test('the real 2026-09-02 digest: no literal Markdown survives', () => {
    const Out = MarkdownToMrkdwn(DIGEST_2026_09_02, { dropFirstHeading: true });

    expect(Out).not.toMatch(/\*\*/);                    // no double-star bold
    expect(Out).not.toMatch(/^#/m);                     // no heading markers
    expect(Out).not.toMatch(/^---$/m);                  // no horizontal rule
    expect(Out).not.toMatch(/^\* /m);                   // no star bullets
    expect(Out).not.toContain('Progress digest — 2026-09-02'); // title dropped (header carries it)

    expect(Out).toContain('• *hiqs-suite/xyz-forge* & *hiqs-labs/xyz-forge*: Merged');
    expect(Out).toContain('*HEALTH*');
    expect(Out).toContain('_Generated 2026-09-02 13:05 PDT. Covers midnight to now._');
    expect(Out).toContain('91 commits · 10 merged · 6 active repos · 5 health warnings');
  });

  test('headings become bold; first heading kept unless dropFirstHeading', () => {
    const Out = MarkdownToMrkdwn('# Title\n## Section\ntext');
    expect(Out).toBe('*Title*\n*Section*\ntext');
    const Dropped = MarkdownToMrkdwn('# Title\n## Section\ntext', { dropFirstHeading: true });
    expect(Dropped).toBe('*Section*\ntext');
  });

  test('bullets: *, -, + become •, indentation preserved', () => {
    const Out = MarkdownToMrkdwn('* a\n- b\n+ c\n  * nested');
    expect(Out).toBe('• a\n• b\n• c\n  • nested');
  });

  test('links become Slack <url|text>', () => {
    expect(MarkdownToMrkdwn('see [the PR](https://github.com/x/y/pull/1) now'))
      .toBe('see <https://github.com/x/y/pull/1|the PR> now');
  });

  test('italics and strike convert; inline code untouched', () => {
    expect(MarkdownToMrkdwn('a *b* c `**not bold**` ~~gone~~'))
      .toBe('a _b_ c `**not bold**` ~gone~');
  });

  test('fenced code blocks pass through verbatim', () => {
    const Src = '```\n# not a heading\n**not bold**\n* not a bullet\n```';
    expect(MarkdownToMrkdwn(Src)).toBe(Src);
  });

  test('relay header comments and horizontal rules are dropped, blank runs collapsed', () => {
    const Src = '<!-- snapshot-sleuth-relay: forwarded-at=x device="d" repo="r" -->\n# T\n\n\n---\n\nbody';
    expect(MarkdownToMrkdwn(Src)).toBe('*T*\n\nbody');
  });

  test('empty and non-string input yield empty string', () => {
    expect(MarkdownToMrkdwn('')).toBe('');
    expect(MarkdownToMrkdwn(undefined)).toBe('');
  });

  test('bold inside a bullet does not become a stray italic', () => {
    expect(MarkdownToMrkdwn('* **x** y')).toBe('• *x* y');
  });
});
