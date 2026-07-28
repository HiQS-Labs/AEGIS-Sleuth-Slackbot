'use strict';

const { ExtractGitHubUrls } = require('../src/github-url-utils');

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

