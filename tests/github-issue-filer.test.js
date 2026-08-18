'use strict';

const { FileGithubIssueAsync } = require('../src/github-issue-filer');

describe('FileGithubIssueAsync', () => {
  let SavedFetch;
  let SavedEnvRepo;

  beforeEach(() => {
    SavedFetch = global.fetch;
    SavedEnvRepo = process.env.SLEUTH_ISSUE_REPO;
    delete process.env.SLEUTH_ISSUE_REPO;
  });

  afterEach(() => {
    global.fetch = SavedFetch;
    if(SavedEnvRepo !== undefined)
      process.env.SLEUTH_ISSUE_REPO = SavedEnvRepo;
    else
      delete process.env.SLEUTH_ISSUE_REPO;
    jest.restoreAllMocks();
  });

  test('returns reason no-repo and does NOT call fetch when SLEUTH_ISSUE_REPO is unset', async () => {
    global.fetch = jest.fn();

    const Result = await FileGithubIssueAsync(
      { GITHUB_PAT: 'ghp_test_token' },
      'Test Title',
      'Test Body'
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(Result).toEqual({
      ok: false,
      repo: '',
      apiUrl: '',
      reason: 'no-repo',
    });
  });

  test('returns reason no-pat and does NOT call fetch when GITHUB_PAT is missing', async () => {
    global.fetch = jest.fn();
    process.env.SLEUTH_ISSUE_REPO = 'org/repo';

    const Result = await FileGithubIssueAsync(
      { GITHUB_PAT: '' },
      'Test Title',
      'Test Body'
    );

    expect(global.fetch).not.toHaveBeenCalled();
    expect(Result).toEqual({
      ok: false,
      repo: 'org/repo',
      apiUrl: 'https://api.github.com/repos/org/repo/issues',
      reason: 'no-pat',
    });
  });

  test('uses ArgOptions.Repo when provided explicitly', async () => {
    global.fetch = jest.fn(async (url, options) => ({
      status: 201,
      json: async () => ({ number: 101, html_url: 'https://github.com/custom/repo/issues/101' }),
    }));

    const Result = await FileGithubIssueAsync(
      { GITHUB_PAT: 'ghp_test_token' },
      'Test Title',
      'Test Body',
      { Repo: 'custom/repo' }
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/custom/repo/issues');
    expect(Result).toEqual({
      ok: true,
      repo: 'custom/repo',
      apiUrl: 'https://api.github.com/repos/custom/repo/issues',
      number: 101,
      htmlUrl: 'https://github.com/custom/repo/issues/101',
    });
  });

  test('returns reason forbidden on 403 HTTP status', async () => {
    global.fetch = jest.fn(async () => ({
      status: 403,
      json: async () => ({ message: 'Forbidden' }),
    }));

    const Result = await FileGithubIssueAsync(
      { GITHUB_PAT: 'ghp_test_token' },
      'Test Title',
      'Test Body',
      { Repo: 'custom/repo' }
    );

    expect(Result).toEqual({
      ok: false,
      repo: 'custom/repo',
      apiUrl: 'https://api.github.com/repos/custom/repo/issues',
      reason: 'forbidden',
      status: 403,
    });
  });

  test('returns reason github-error on non-201 non-403 HTTP status', async () => {
    global.fetch = jest.fn(async () => ({
      status: 404,
      json: async () => ({ message: 'Not Found' }),
    }));

    const Result = await FileGithubIssueAsync(
      { GITHUB_PAT: 'ghp_test_token' },
      'Test Title',
      'Test Body',
      { Repo: 'custom/repo' }
    );

    expect(Result).toEqual({
      ok: false,
      repo: 'custom/repo',
      apiUrl: 'https://api.github.com/repos/custom/repo/issues',
      reason: 'github-error',
      status: 404,
    });
  });

  test('returns reason request-failed on fetch throw', async () => {
    const NetworkError = new Error('network down');
    global.fetch = jest.fn(async () => {
      throw NetworkError;
    });

    const Result = await FileGithubIssueAsync(
      { GITHUB_PAT: 'ghp_test_token' },
      'Test Title',
      'Test Body',
      { Repo: 'custom/repo' }
    );

    expect(Result).toEqual({
      ok: false,
      repo: 'custom/repo',
      apiUrl: 'https://api.github.com/repos/custom/repo/issues',
      reason: 'request-failed',
      error: NetworkError,
    });
  });
});
