'use strict';

const fs = require('fs').promises;
const Workspaces = require('../src/workspaces');

const ValidWorkspaceInfo = {
  WORKSPACE_NAME: 'TestWorkspace',
  ADMIN_EMAIL: 'admin@example.com',
  LIVE_TOKEN: 'xoxb-test',
  LIVE_SIGNING_SECRET: 'secret',
  LIVE_APP_TOKEN: 'xapp-test',
  OPENAI_API_KEY: 'sk-test',
  REMINDER_CHANNEL_NAME: 'test-reminders',
  MAIN_TIMEZONE: 'America/Los_Angeles',
};

describe('Workspaces.ValidateWorkspaceInfo', () => {
  afterEach(async () => {
    await fs.rm(Workspaces.MakeWorkspaceFilePath('AnthropicOnlyNormalizedSave'), { force: true });
  });

  test('accepts persisted model names when they are non-empty strings', () => {
    expect(() => Workspaces.ValidateWorkspaceInfo({
      ...ValidWorkspaceInfo,
      DEFAULT_MODEL_NAME: 'gpt-5-mini',
      COMPLEX_MODEL_NAME: 'gpt-5',
    })).not.toThrow();
  });

  test.each([
    ['DEFAULT_MODEL_NAME', '', 'DEFAULT_MODEL_NAME cannot be empty'],
    ['DEFAULT_MODEL_NAME', 42, 'DEFAULT_MODEL_NAME must be a string'],
    ['COMPLEX_MODEL_NAME', '   ', 'COMPLEX_MODEL_NAME cannot be empty'],
    ['COMPLEX_MODEL_NAME', null, 'COMPLEX_MODEL_NAME must be a string'],
  ])('rejects invalid optional model field %s=%p', (ArgFieldName, ArgValue, ArgMessage) => {
    expect(() => Workspaces.ValidateWorkspaceInfo({
      ...ValidWorkspaceInfo,
      [ArgFieldName]: ArgValue,
    })).toThrow(ArgMessage);
  });

  test('accepts a workspace that only provides ANTHROPIC_API_KEY', () => {
    const AnthropicOnlyWorkspace = { ...ValidWorkspaceInfo, ANTHROPIC_API_KEY: 'sk-anthropic-test' };
    delete AnthropicOnlyWorkspace.OPENAI_API_KEY;

    expect(() => Workspaces.ValidateWorkspaceInfo(AnthropicOnlyWorkspace)).not.toThrow();
  });

  test('accepts a workspace that only provides GEMINI_API_KEY', () => {
    const GeminiOnlyWorkspace = { ...ValidWorkspaceInfo, GEMINI_API_KEY: 'goog-gemini-test' };
    delete GeminiOnlyWorkspace.OPENAI_API_KEY;

    expect(() => Workspaces.ValidateWorkspaceInfo(GeminiOnlyWorkspace)).not.toThrow();
  });

  test('rejects a workspace when none of the supported AI keys are configured', () => {
    const NoAiKeyWorkspace = { ...ValidWorkspaceInfo };
    delete NoAiKeyWorkspace.OPENAI_API_KEY;

    expect(() => Workspaces.ValidateWorkspaceInfo(NoAiKeyWorkspace)).toThrow(
      'At least one AI API key is required: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY'
    );
  });

  test('SaveWorkspaceInfoAsync removes blank optional AI-key fields before validation and persistence', async () => {
    const WorkspaceToSave = {
      ...ValidWorkspaceInfo,
      WORKSPACE_NAME: 'AnthropicOnlyNormalizedSave',
      OPENAI_API_KEY: '   ',
      ANTHROPIC_API_KEY: '  sk-anthropic-test  ',
      GEMINI_API_KEY: '',
    };

    await Workspaces.SaveWorkspaceInfoAsync(WorkspaceToSave);

    const FilePath = Workspaces.MakeWorkspaceFilePath('AnthropicOnlyNormalizedSave');
    const SavedJson = JSON.parse(await fs.readFile(FilePath, 'utf8'));
    expect(SavedJson.OPENAI_API_KEY).toBeUndefined();
    expect(SavedJson.GEMINI_API_KEY).toBeUndefined();
    expect(SavedJson.ANTHROPIC_API_KEY).toBe('sk-anthropic-test');

    const LoadedWorkspace = await Workspaces.LoadWorkspaceInfoAsync(FilePath);
    expect(LoadedWorkspace.OPENAI_API_KEY).toBeUndefined();
    expect(LoadedWorkspace.ANTHROPIC_API_KEY).toBe('sk-anthropic-test');
  });

  test('accepts optional GitHub Actions startup fields when they are non-empty strings', () => {
    expect(() => Workspaces.ValidateWorkspaceInfo({
      ...ValidWorkspaceInfo,
      GITHUB_PAT: 'github_pat_example',
      GITHUB_ACTIONS_REPO: 'NeochromeTeam/sleuth-app',
      GITHUB_ACTIONS_WORKFLOW: 'ci.yml',
      GITHUB_ACTIONS_BRANCH: 'development',
    })).not.toThrow();
  });

  test.each([
    ['GITHUB_ACTIONS_REPO', '', 'GITHUB_ACTIONS_REPO cannot be empty'],
    ['GITHUB_ACTIONS_REPO', 42, 'GITHUB_ACTIONS_REPO must be a string'],
    ['GITHUB_ACTIONS_WORKFLOW', '   ', 'GITHUB_ACTIONS_WORKFLOW cannot be empty'],
    ['GITHUB_ACTIONS_BRANCH', null, 'GITHUB_ACTIONS_BRANCH must be a string'],
  ])('rejects invalid optional GitHub Actions field %s=%p', (ArgFieldName, ArgValue, ArgMessage) => {
    expect(() => Workspaces.ValidateWorkspaceInfo({
      ...ValidWorkspaceInfo,
      [ArgFieldName]: ArgValue,
    })).toThrow(ArgMessage);
  });
});
