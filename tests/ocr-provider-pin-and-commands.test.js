'use strict';

/**
 * GH-63 — Vision OCR must not follow the workspace's default chat model.
 * GH-64 — the OCR capabilities must be visible to the catalog-driven discovery surfaces.
 *
 * Both defects were invisible to the GH-58 suite because it hardcoded 'gemini-2.5-flash' in every
 * call and never consulted the command catalog.
 */

const WorkspaceAI = require('../src/workspace-ai');
const CommandCatalog = require('../data/static/ai/command-catalog.json');

const BaseWorkspaceInfo = {
  WORKSPACE_NAME: 'ProviderPinWorkspace',
  LIVE_TOKEN: 'xoxb-test',
};

function MakeStats() {
  return {
    RecordAIRequest: () => {},
    RecordAIResponse: () => {},
    RecordAIError: () => {},
    IncrementCounter: () => {},
  };
}

describe('GH-63: vision model is pinned independently of the default chat model', () => {
  test('a Claude-default workspace still resolves OCR to Gemini', () => {
    const Agent = new WorkspaceAI(
      { ...BaseWorkspaceInfo, GEMINI_API_KEY: 'g-key', ANTHROPIC_API_KEY: 'a-key' },
      MakeStats(),
      'claude-sonnet-5'
    );
    expect(Agent.ResolveVisionModelName()).toMatch(/^gemini-/);
  });

  test('a GPT-default workspace still resolves OCR to Gemini', () => {
    const Agent = new WorkspaceAI(
      { ...BaseWorkspaceInfo, GEMINI_API_KEY: 'g-key', OPENAI_API_KEY: 'o-key' },
      MakeStats(),
      'gpt-4o-mini'
    );
    expect(Agent.ResolveVisionModelName()).toMatch(/^gemini-/);
  });

  test('an explicitly pinned Gemini default is honored rather than overridden', () => {
    const Agent = new WorkspaceAI(
      { ...BaseWorkspaceInfo, GEMINI_API_KEY: 'g-key' },
      MakeStats(),
      'gemini-3.0-experimental'
    );
    // A model this preference list has never heard of must still win — the operator chose it.
    expect(Agent.ResolveVisionModelName()).toBe('gemini-3.0-experimental');
  });

  test('no Gemini credentials produces a typed, honest error instead of a transient one', () => {
    const Agent = new WorkspaceAI(
      { ...BaseWorkspaceInfo, OPENAI_API_KEY: 'o-key' },
      MakeStats(),
      'gpt-4o-mini'
    );
    let Caught = null;
    try {
      Agent.ResolveVisionModelName();
    } catch(error) {
      Caught = error;
    }
    expect(Caught).not.toBeNull();
    expect(Caught.code).toBe('vision_provider_not_configured');
    // The user-facing message must name the real cause, not invite a doomed retry.
    expect(Caught.message).toMatch(/Gemini/i);
    expect(Caught.message).not.toMatch(/try again later/i);
  });

  test('the preference list is ordered and Gemini-only', () => {
    expect(WorkspaceAI.VisionModelPreference.length).toBeGreaterThan(0);
    for(const ModelName of WorkspaceAI.VisionModelPreference) {
      expect(ModelName).toMatch(/^gemini-/);
    }
  });
});

describe('GH-64: OCR capabilities are discoverable through the command catalog', () => {
  test('the catalog is no longer blind to OCR — the measurement that justified this work', () => {
    const Matching = CommandCatalog.filter(
      (ArgEntry) => JSON.stringify(ArgEntry).match(/ocr|image|screenshot|photo/i)
    );
    expect(Matching.length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    ['scan-image-for-text', 'scan image for text'],
    ['convert-text-into-slack-list', 'convert text into slack list'],
  ])('%s is registered with the route %s', (ArgId, ArgRoute) => {
    const Entry = CommandCatalog.find((ArgEntry) => ArgEntry.Id === ArgId);
    expect(Entry).toBeDefined();
    expect(Entry.RegisteredRoutes).toContain(ArgRoute);
    // Aliases drive deterministic matching; IntentPhrases are what let rmm resolve variations.
    expect(Entry.Aliases.length).toBeGreaterThan(0);
    expect(Entry.IntentPhrases.length).toBeGreaterThan(0);
    // Visible to help and the commands list, or users still cannot find it.
    expect(Entry.IncludeInHelp).toBe(true);
    expect(Entry.IncludeInCommandsList).toBe(true);
  });

  test('rmm can execute both — they are low-risk and public', () => {
    for(const Id of ['scan-image-for-text', 'convert-text-into-slack-list']) {
      const Entry = CommandCatalog.find((ArgEntry) => ArgEntry.Id === Id);
      expect(Entry.CanExecuteWithIfl).toBe(true);
      expect(Entry.Permission).toBe('public');
    }
  });

  test('catalog ids and orders stay unique after the additions', () => {
    const Ids = CommandCatalog.map((ArgEntry) => ArgEntry.Id);
    expect(new Set(Ids).size).toBe(Ids.length);

    const HelpOrders = CommandCatalog
      .filter((ArgEntry) => ArgEntry.IncludeInHelp && typeof ArgEntry.HelpOrder === 'number')
      .map((ArgEntry) => ArgEntry.HelpOrder);
    expect(new Set(HelpOrders).size).toBe(HelpOrders.length);
  });
});
