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

describe('GH-63 r2 (agy review): every declared fallback model is actually reachable', () => {
  const Stats = {
    RecordAIRequest: () => {}, RecordAIResponse: () => {}, RecordAIError: () => {},
    IncrementCounter: () => {},
  };

  function MakeAgent(ArgDefaultModel) {
    return new WorkspaceAI(
      { WORKSPACE_NAME: 'FallbackWorkspace', GEMINI_API_KEY: 'g-key' },
      Stats,
      ArgDefaultModel
    );
  }

  test('the candidate list exposes every preference entry, not just the head', () => {
    const Candidates = MakeAgent('gpt-4o-mini').ResolveVisionModelNames();
    for(const ModelName of WorkspaceAI.VisionModelPreference) {
      expect(Candidates).toContain(ModelName);
    }
  });

  test('a pinned Gemini default leads the list but no longer hides the fallbacks', () => {
    const Candidates = MakeAgent('gemini-3.0-experimental').ResolveVisionModelNames();
    expect(Candidates[0]).toBe('gemini-3.0-experimental');
    expect(Candidates.length).toBeGreaterThan(1);
    // No duplicates, even if the pinned model is also in the preference list.
    expect(new Set(Candidates).size).toBe(Candidates.length);
  });

  // The candidate-walking loop itself is exercised in
  // tests/vision-model-fallback.test.js, which mocks the provider registry at module load —
  // the only honest way to intercept a function this module destructures at require time.

  test.each([
    ['404 status', Object.assign(new Error('nope'), { status: 404 }), true],
    ['model not found message', new Error('model gemini-x not found'), true],
    ['unsupported model message', new Error('Unsupported model: gemini-x'), true],
    ['quota error', new Error('quota exceeded for this project'), false],
    ['malformed image', new Error('image payload was rejected as malformed'), false],
    ['null', null, false],
  ])('IsModelUnavailableError(%s) -> %s', (_Label, ArgError, ArgExpected) => {
    expect(WorkspaceAI.IsModelUnavailableError(ArgError)).toBe(ArgExpected);
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

describe('GH-74 (PR-78 review): catalog phrasings and the attachment resolver cannot drift', () => {
  const { ResolveAttachmentIntent } = require('../src/context-file-classifier');

  const ImageFiles = [{ name: 'fines.png', mimetype: 'image/png', size: 50000 }];

  // Phrasings that deliberately do NOT deterministically resolve to an OCR arm. They are RMM
  // discovery examples — the AI intent resolver carries them; the narrow attachment regex does
  // not, by design. This list is the explicit boundary #74 asked for: adding a catalog phrasing
  // now either resolves, or the test fails loudly naming the phrase until it is allowlisted here
  // (a conscious act), or it is RMM-only and nothing changes.
  const RmmOnlyPhrasings = new Set([
    // scan-image-for-text
    'what does this image say',
    'extract the text from this photo',
    'pull the words out of this image',
    // make-list-from-image
    'turn this image into a slack list',
    'extract the items in this photo into a list',
  ]);

  // Entries whose advertised phrasings must reach an OCR arm when an image is attached.
  const ImageSourceEntryIds = ['scan-image-for-text', 'make-list-from-image'];
  // Text-source entry: with an image attached its phrasings deliberately do NOT auto-route —
  // the deterministic answer is 'unsupported' (stated in its DisambiguationNotes).
  const TextSourceEntryIds = ['convert-text-into-slack-list'];

  function CatalogPhrasingsFor(ArgId) {
    const Entry = CommandCatalog.find((ArgEntry) => ArgEntry.Id === ArgId) || {};
    return [...(Entry.Aliases || []), ...(Entry.IntentPhrases || [])];
  }

  test('every entry this boundary covers exists in the catalog', () => {
    for(const Id of [...ImageSourceEntryIds, ...TextSourceEntryIds]) {
      expect(CommandCatalog.find((ArgEntry) => ArgEntry.Id === Id)).toBeDefined();
    }
  });

  test.each(
    ImageSourceEntryIds.flatMap((ArgId) => CatalogPhrasingsFor(ArgId).map((ArgPhrase) => [ArgId, ArgPhrase]))
  )('%s — "%s" resolves to an OCR arm or is allowlisted as RMM-only', (_ArgId, ArgPhrase) => {
    const Kind = ResolveAttachmentIntent(ImageFiles, ArgPhrase).Kind;
    if(RmmOnlyPhrasings.has(ArgPhrase)) {
      // Pins the allowlist itself: the phrase is expected NOT to resolve today. If a grammar
      // change makes it resolve, this fails and forces a conscious removal from the list.
      expect(Kind).toBe('unsupported');
    } else {
      expect(['image-list', 'image-text']).toContain(Kind);
    }
  });

  // Phrasings on the text-source entry that are GENERIC list-creation wordings: with an image
  // attached they resolve to image-list, and that is the intended answer — the image is the only
  // thing attached, so building a list from it is the right guess. Pinned so the mixed behavior
  // of this entry (3 resolve, 7 do not) is a documented contract, not an accident.
  const GenericListPhrasings = new Set([
    'make a slack list from this',
    'make a slack list out of what i just pasted',
    'build a list from this text',
  ]);

  test.each(
    TextSourceEntryIds.flatMap((ArgId) => CatalogPhrasingsFor(ArgId).map((ArgPhrase) => [ArgId, ArgPhrase]))
  )('text-source %s — "%s" is pinned: text-specific stays unsupported, generic resolves to image-list', (_ArgId, ArgPhrase) => {
    const Kind = ResolveAttachmentIntent(ImageFiles, ArgPhrase).Kind;
    if(GenericListPhrasings.has(ArgPhrase)) {
      expect(Kind).toBe('image-list');
    } else {
      expect(Kind).toBe('unsupported');
    }
  });

  test('the RMM-only allowlist has not rotted — every entry still exists verbatim in the catalog', () => {
    const AllPhrasings = new Set(
      [...ImageSourceEntryIds, ...TextSourceEntryIds].flatMap((ArgId) => CatalogPhrasingsFor(ArgId))
    );
    for(const Phrase of [...RmmOnlyPhrasings, ...GenericListPhrasings]) {
      // Failure output names the orphaned allowlist phrase so it gets deleted, not ignored.
      expect(AllPhrasings).toContain(Phrase);
    }
  });
});
