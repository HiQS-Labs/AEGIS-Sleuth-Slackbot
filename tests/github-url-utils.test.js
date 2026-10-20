'use strict';

const {
  ExtractGitHubUrls,
  ExtractIssueReferences,
  IssueKey,
} = require('../src/github-url-utils');

describe('ExtractGitHubUrls', () => {
  test('extracts a bare issue URL', () => {
    expect(ExtractGitHubUrls('Review https://github.com/org/repo/issues/42 by Friday')).toEqual([
      'https://github.com/org/repo/issues/42',
    ]);
  });

  test('extracts an anchor-text pull request URL', () => {
    expect(ExtractGitHubUrls(
      'Check <https://github.com/org/repo/pull/15|this PR> before noon'
    )).toEqual([
      'https://github.com/org/repo/pull/15',
    ]);
  });

  test('strips trailing fragments and path segments', () => {
    expect(ExtractGitHubUrls(
      'See https://github.com/org/repo/issues/42#issuecomment-123 and <https://github.com/org/repo/pull/99/files>'
    )).toEqual([
      'https://github.com/org/repo/issues/42',
      'https://github.com/org/repo/pull/99',
    ]);
  });

  test('deduplicates repeated URLs across mixed Slack formats', () => {
    expect(ExtractGitHubUrls(
      'Look at https://github.com/org/repo/issues/5 and <https://github.com/org/repo/issues/5|same issue>'
    )).toEqual([
      'https://github.com/org/repo/issues/5',
    ]);
  });

  test('ignores non-GitHub URLs', () => {
    expect(ExtractGitHubUrls(
      'Check <https://woocommerce.com/products/churn-saver/|this plugin>'
    )).toEqual([]);
  });
});

describe('ExtractIssueReferences', () => {
  test('resolves shorthand against the default repo', () => {
    expect(ExtractIssueReferences('Fixes #12', 'HiQS-Labs/rebalanceOS')).toEqual([
      'hiqs-labs/rebalanceos#12',
    ]);
  });

  test('recognizes qualified owner/repo#n and URLs', () => {
    const Refs = ExtractIssueReferences(
      'See BinoidCBD/LTVera-Pandas#99 and https://github.com/HiQS-Labs/XYZ-forge/issues/7',
      'HiQS-Labs/rebalanceOS'
    );
    expect(Refs).toEqual(expect.arrayContaining([
      'binoidcbd/ltvera-pandas#99',
      'hiqs-labs/xyz-forge#7',
    ]));
  });

  test('deduplicates mixed forms of the same issue', () => {
    expect(ExtractIssueReferences(
      'Fixes #12 and https://github.com/HiQS-Labs/rebalanceOS/issues/12 and HiQS-Labs/rebalanceOS#12',
      'HiQS-Labs/rebalanceOS'
    )).toEqual(['hiqs-labs/rebalanceos#12']);
  });

  test('returns empty for blank input', () => {
    expect(ExtractIssueReferences('', 'a/b')).toEqual([]);
    expect(ExtractIssueReferences(null, 'a/b')).toEqual([]);
  });
});

describe('IssueKey', () => {
  test('lowercases owner and repo', () => {
    expect(IssueKey('HiQS-Labs/RebalanceOS', 42)).toBe('hiqs-labs/rebalanceos#42');
  });
});

