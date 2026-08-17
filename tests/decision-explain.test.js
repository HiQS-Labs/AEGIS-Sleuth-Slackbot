'use strict';

const {
  RenderDecisionFacts,
  RenderDecisionFactsSection,
  DescribeAssigneeResolution,
  MaxValueLength,
} = require('../src/decision-explain');

// GH-44 Phase 5 — the decision-agnostic explain renderer. Red before this phase: the module did not
// exist and the routing/ownership facts lived only in a server log line.

describe('RenderDecisionFacts', () => {
  test('renders one bullet per fact with booleans humanized', () => {
    const Lines = RenderDecisionFacts({ synthesisOn: true, segment: 'long', flagged: false });
    expect(Lines).toContain('• segment: long');
    expect(Lines).toContain('• synthesisOn: yes');
    expect(Lines).toContain('• flagged: no');
  });

  test('puts the well-known routing facts first so the story reads top-to-bottom', () => {
    const Lines = RenderDecisionFacts({
      zzzExtra: 1, actionableSpanRatio: 0.07, recommendation: 'schedule', candidateCount: 2, segment: 'normal',
    });
    const Order = Lines.map(ArgLine => ArgLine.split(':')[0].replace('• ', ''));
    expect(Order).toEqual(['recommendation', 'candidateCount', 'segment', 'actionableSpanRatio', 'zzzExtra']);
  });

  test('an absent, empty, or non-object bag renders NOTHING — never a dangling header', () => {
    expect(RenderDecisionFacts(null)).toEqual([]);
    expect(RenderDecisionFacts(undefined)).toEqual([]);
    expect(RenderDecisionFacts({})).toEqual([]);
    expect(RenderDecisionFacts(/** @type {any} */([1, 2]))).toEqual([]);
    expect(RenderDecisionFactsSection('Why', null)).toEqual([]);
    expect(RenderDecisionFactsSection('Why', {})).toEqual([]);
  });

  test('a section with facts gets exactly one bold header', () => {
    const Lines = RenderDecisionFactsSection('Why this task text', { segment: 'long' });
    expect(Lines[0]).toBe('*Why this task text:*');
    expect(Lines).toHaveLength(2);
  });

  test('long values are truncated rather than blowing the Slack message limit', () => {
    const Lines = RenderDecisionFacts({ rationale: 'x'.repeat(5000) });
    expect(Lines[0].length).toBeLessThan(MaxValueLength + 80);
  });

  test('null and undefined values render as _none_ rather than the literal strings', () => {
    const Lines = RenderDecisionFacts({ deadline: null, flag: undefined });
    expect(Lines).toContain('• deadline: _none_');
    expect(Lines).toContain('• flag: _none_');
  });

  test('a nested object renders informatively rather than as [object Object]', () => {
    const Lines = RenderDecisionFacts({ nested: { a: 1 } });
    // quotes come back escaped because the value goes through SanitizeForInlineSlack — that is the
    // correct Slack-safe form, so assert the property that matters (the content survived) rather
    // than a raw JSON byte match.
    expect(Lines[0]).not.toContain('[object Object]');
    expect(Lines[0]).toContain('a');
    expect(Lines[0]).toContain('1');
  });

  test('an unserializable value degrades instead of throwing', () => {
    const Circular = /** @type {any} */ ({});
    Circular.self = Circular;
    expect(() => RenderDecisionFacts({ bad: Circular })).not.toThrow();
    expect(RenderDecisionFacts({ bad: Circular })[0]).toContain('_unrenderable_');
  });
});

describe('DescribeAssigneeResolution', () => {
  test('flags the GH-43 case: mentions won, and the author is not on their own commitment', () => {
    // the reported production message: "@alpha @beta <status report> i am going to deploy tomorrow"
    const Facts = DescribeAssigneeResolution(['U_ALPHA', 'U_BETA'], ['U_ALPHA', 'U_BETA'], 'U_SENDER');

    expect(Facts.resolvedFrom).toBe('message mentions');
    expect(Facts.mentionsFound).toBe(2);
    expect(Facts.senderIsAssignee).toBe(false);
    expect(Facts.senderExcludedByMentions).toBe(true);
  });

  test('no mentions means the sender fallback fired, and nothing is flagged', () => {
    const Facts = DescribeAssigneeResolution([], ['U_SENDER'], 'U_SENDER');

    expect(Facts.resolvedFrom).toBe('sender fallback');
    expect(Facts.senderIsAssignee).toBe(true);
    expect(Facts.senderExcludedByMentions).toBe(false);
  });

  test('a genuine shared assignment that includes the sender is NOT flagged', () => {
    const Facts = DescribeAssigneeResolution(['U_SENDER', 'U_ALPHA'], ['U_SENDER', 'U_ALPHA'], 'U_SENDER');
    expect(Facts.senderExcludedByMentions).toBe(false);
  });

  test('renders assignees as Slack mentions, and empty as _none_', () => {
    expect(DescribeAssigneeResolution(['U_A'], ['U_A'], 'U_S').assignees).toBe('<@U_A>');
    expect(DescribeAssigneeResolution([], [], 'U_S').assignees).toBe('_none_');
  });

  test('tolerates non-array input rather than throwing into the triage view', () => {
    expect(() => DescribeAssigneeResolution(/** @type {any} */(null), /** @type {any} */(undefined), 'U_S'))
      .not.toThrow();
  });
});
