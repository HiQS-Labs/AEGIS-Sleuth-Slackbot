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

  // Codex branch relay r3. The exemption used to apply to ANY first token, so an invented product
  // name rendered simply by being moved to the front. It is now bounded to recognized imperative
  // verbs and fails closed on everything else.
  test('THE WITNESS: a non-verb first word is NOT exempt', () => {
    expect(ExtractGroundedTerms('Acme deployment')).toEqual(['Acme']);
    expect(IsTitleGrounded('Acme deployment', 'deployment is tomorrow')).toBe(false);
    expect(IsTitleGrounded('Snowflake the data', 'fix the data job tomorrow')).toBe(false);
  });

  test('real imperative openings still pass, including ones the source conjugated differently', () => {
    expect(IsTitleGrounded('Deploy the fix', 'i will deploy the fix tomorrow')).toBe(true);
    // "Bump" against a source that wrote "bumping" — the allowlist is what saves this
    expect(IsTitleGrounded('Bump the timeout', 'the real fix is bumping the timeout')).toBe(true);
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

// Found independently by self-audit AND by Codex in the branch relay — two reviewers, same defect.
// The first implementation collapsed both sides to bare alphanumerics and asked whether the source
// CONTAINED the term. Collapsing erases word boundaries, so a fragment of a longer word grounded an
// entity the author never wrote. A check that accepts an invented environment name is worse than no
// check: it grants false confidence to the whole synthesis path.
describe('UngroundedTerms — word-fragment bypasses (regression)', () => {
  test.each([
    ['PROD', 'Deploy to PROD', 'i could not reproduce the issue, will look again tomorrow'],
    ['Ortho', 'Update Ortho', 'restart the orthogonal service tomorrow'],
    ['Stage', 'Ship to Stage', 'the changes are staged already, will ship tomorrow'],
    ['Acme', 'Deploy Acme', 'we will deploy xacmey tomorrow'],
  ])('%s must NOT be grounded by a longer word that merely contains it', (ArgTerm, ArgTitle, ArgSource) => {
    expect(UngroundedTerms(ArgTitle, ArgSource)).toEqual([ArgTerm]);
    expect(IsTitleGrounded(ArgTitle, ArgSource)).toBe(false);
  });

  test('the bypass applied to identifiers and numbers too, not only proper nouns', () => {
    expect(IsTitleGrounded('Ship billing-sync', 'the xbillingsyncy job failed')).toBe(false);
    expect(IsTitleGrounded('Bump it by 42', 'ticket 1425 is the one')).toBe(false);
  });

  test('a TRAILING homoglyph is rejected', () => {
    expect(IsTitleGrounded('Restart Nginх', 'restart nginx tonight')).toBe(false);
  });

  // Codex branch relay r2. The trailing case above passed for the wrong reason — it left an ASCII
  // "Ngin" behind to reject. A LEADING lookalike was a real bypass: the ASCII-only `[A-Z]` capital
  // test did not recognize a Cyrillic capital as a capital, so the word was never extracted as a
  // term, nothing was checked, and the invented name rendered to the user.
  test.each([
    ['Cyrillic А', 'Deploy Аcme'],
    ['Greek Α', 'Deploy Αcme'],
  ])('a LEADING %s lookalike is still extracted as a term and rejected', (ArgName, ArgTitle) => {
    expect(ExtractGroundedTerms(ArgTitle)).toHaveLength(1);
    expect(IsTitleGrounded(ArgTitle, 'we will deploy acme tomorrow')).toBe(false);
  });

  test('genuine non-ASCII names are NOT collateral damage', () => {
    // the fix must not reject a real accented name the author actually wrote
    expect(IsTitleGrounded('Ask José', 'ask josé about it tomorrow')).toBe(true);
    expect(IsTitleGrounded('Deploy Acme', 'we will deploy acme tomorrow')).toBe(true);
  });
});

describe('UngroundedTerms — inflections are not inventions', () => {
  test.each([
    ["Fix Jamie's script", 'ask jamie about the script tomorrow'],
    ['Fix the Reports', 'fix the report job tomorrow'],
  ])('%s stays grounded — a model inflecting the source word invents nothing', (ArgTitle, ArgSource) => {
    expect(IsTitleGrounded(ArgTitle, ArgSource)).toBe(true);
  });

  test('the formatting tolerance that motivated the original design still holds', () => {
    // these are why the check cannot simply demand an exact whole-token match
    expect(IsTitleGrounded('Ship the billing-sync patch', 'the billing sync is broken')).toBe(true);
    expect(IsTitleGrounded('Push the warehousesync fix', 'heads up on the warehouse sync')).toBe(true);
    expect(IsTitleGrounded('Restart Nginx', 'restart nginx tonight')).toBe(true);
  });

  test('plural tolerance works in BOTH directions', () => {
    // title plural / source singular
    expect(IsTitleGrounded('Fix the Reports', 'fix the report job')).toBe(true);
    // title singular / source plural — found by self-audit after the first fix: the run-length bound
    // broke BEFORE the plural comparison, so this direction silently failed. One-directional
    // tolerance is a false-positive generator, and every false positive here sends a good title back
    // to the verbatim dump.
    expect(IsTitleGrounded('Deploy Api', 'the apis are down, will look tomorrow')).toBe(true);
  });

  test('plural tolerance does not become a new bypass', () => {
    expect(IsTitleGrounded('Check the Reporters', 'fix the report job')).toBe(false);
    expect(IsTitleGrounded('Fix the Snowflakes', 'fix the report job')).toBe(false);
    // the short-token guard stops "AWS" being stripped to "aw"
    expect(IsTitleGrounded('Deploy AWS', 'deploy aw tomorrow')).toBe(false);
    // and the one-character slack does not admit a longer unrelated word
    expect(IsTitleGrounded('Deploy Prod', 'deploy prodx tomorrow')).toBe(false);
  });
});
