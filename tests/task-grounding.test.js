'use strict';

const {
  IsTitleGrounded, UngroundedTerms, ExtractGroundedTerms, NormalizeForGrounding,
} = require('../src/task-grounding');

// GH-43 Phase 3 — the grounding constraint that makes rewriting a display title safe.
// Red before this phase: the module did not exist, and the only defense against an invented entity
// was a sentence in a prompt.

describe('NormalizeForGrounding', () => {
  test('reduces to bare lowercase alphanumerics so formatting is not a difference', () => {
    expect(NormalizeForGrounding('Billing-Sync')).toBe('billingsync');
    expect(NormalizeForGrounding('billing sync')).toBe('billingsync');
    expect(NormalizeForGrounding('  BILLING_SYNC!  ')).toBe('billingsync');
    expect(NormalizeForGrounding('')).toBe('');
  });
});

describe('ExtractGroundedTerms', () => {
  test('ordinary prose claims nothing and needs no grounding', () => {
    expect(ExtractGroundedTerms('deploy the changes')).toEqual([]);
    expect(ExtractGroundedTerms('Roll out the export bucket config fix')).toEqual([]);
    expect(ExtractGroundedTerms('')).toEqual([]);
  });

  test('the leading imperative verb is exempt — rewriting it is the point of synthesis', () => {
    // "Ship" is capitalized only because it starts the title.
    expect(ExtractGroundedTerms('Ship the fix')).toEqual([]);
  });

  test('identifiers, numbers, proper nouns, and quoted strings all require grounding', () => {
    expect(ExtractGroundedTerms('Ship the billing-sync retry patch')).toEqual(['billing-sync']);
    expect(ExtractGroundedTerms('Bump the timeout by 4')).toEqual(['4']);
    expect(ExtractGroundedTerms('Review Development branch and push to Production'))
      .toEqual(['Development', 'Production']);
    expect(ExtractGroundedTerms('Finish "On-going Project: Yard Photo Backfill"'))
      .toEqual(['On-going Project: Yard Photo Backfill']);
    expect(ExtractGroundedTerms('Update deploy.sh')).toEqual(['deploy.sh']);
    expect(ExtractGroundedTerms('Migrate to PayloadV2')).toEqual(['PayloadV2']);
  });

  test('words inside a quoted span are not also tested individually', () => {
    // the whole quotation is the claim; splitting it would demand each word appear separately.
    expect(ExtractGroundedTerms('Handle "Review Quarterly Reports"'))
      .toEqual(['Review Quarterly Reports']);
  });

  test('routine capitals are not proper nouns', () => {
    expect(ExtractGroundedTerms('Deploy it Monday')).toEqual([]);
    expect(ExtractGroundedTerms('Ask if I should merge')).toEqual([]);
  });
});

describe('UngroundedTerms', () => {
  const Source = "quick note on the report job: it has been timing out since the index change. "
    + 'i will push that fix tomorrow morning';

  test('THE GUARANTEE: an invented system name is caught', () => {
    expect(UngroundedTerms('Bump the Snowflake query timeout', Source)).toEqual(['Snowflake']);
    expect(IsTitleGrounded('Bump the Snowflake query timeout', Source)).toBe(false);
  });

  test('an invented number is caught', () => {
    expect(UngroundedTerms('Bump the query timeout by 4x', Source)).toEqual(['4x']);
  });

  test('a re-worded title that only uses the source vocabulary passes', () => {
    // none of these words is quoted verbatim from the source in this order, and that is fine —
    // the constraint is on entities, not on phrasing.
    expect(IsTitleGrounded('Push the report job timeout fix', Source)).toBe(true);
  });

  test('hyphenation and spacing differences are not inventions', () => {
    expect(IsTitleGrounded('Fix the report-job timeout', Source)).toBe(true);
    expect(IsTitleGrounded('Fix the reportjob timeout', Source)).toBe(true);
  });

  test('an empty source grounds nothing, so anything with a claim is rejected', () => {
    expect(UngroundedTerms('Ship the billing-sync patch', '')).toEqual(['billing-sync']);
    // ...but a title that claims nothing is still fine.
    expect(IsTitleGrounded('ship the patch', '')).toBe(true);
  });

  test('matching is case-insensitive — the source writing it lowercase still grounds it', () => {
    expect(IsTitleGrounded('Restart Nginx', 'we should restart nginx tonight')).toBe(true);
  });

  test('reports EVERY ungrounded term, not just the first', () => {
    expect(UngroundedTerms('Ship Snowflake and Redshift by 9', Source))
      .toEqual(['9', 'Snowflake', 'Redshift']);
  });
});
