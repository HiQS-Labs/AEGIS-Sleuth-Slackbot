'use strict';

/**
 * End-to-end harness for the unified Slack attachment pipeline (GH-62/63/64).
 *
 * `slack:harness:file-upload` drives a real Slack workspace and needs live credentials. This
 * harness covers the same journey without them, so the pipeline stays verifiable on any machine
 * and in CI: it stubs ONLY the two network boundaries (Slack file download, Gemini generateContent)
 * and runs the real classifier, the real SlackApp download/decode logic, the real ChatModule
 * dispatch, the real GeminiProvider, and the real list materialization call.
 *
 * Run: node scripts/attachment-pipeline-e2e.js
 * Exits non-zero on the first failed stage so CI can gate on it.
 */

const path = require('path');
const SlackApp = require(path.join(__dirname, '..', 'src', 'slack-app'));
const WorkspaceAI = require(path.join(__dirname, '..', 'src', 'workspace-ai'));
const {
  ResolveAttachmentIntent,
} = require(path.join(__dirname, '..', 'src', 'context-file-classifier'));

const OriginalFetch = global.fetch;
const Results = [];

/** A real, minimal, valid 1x1 PNG — not a string pretending to be an image. */
const RealPngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const ExpectedOcrPayload = {
  title: 'Safety Inspection Findings',
  items: [
    { item_number: 1, text: 'Missing guardrail on north side', amount: '$200', notes: 'high priority' },
    { item_number: 2, text: 'PPE violation logged', amount: null, notes: null },
    { item_number: 3, text: 'Blocked fire exit', amount: '$450', notes: null },
  ],
};

function Check(ArgLabel, ArgCondition, ArgDetail) {
  Results.push({ Label: ArgLabel, Passed: !!ArgCondition, Detail: ArgDetail || '' });
  const Mark = ArgCondition ? 'PASS' : 'FAIL';
  console.log(`  [${Mark}] ${ArgLabel}${ArgDetail ? ` — ${ArgDetail}` : ''}`);
}

function MakeResponse(ArgOptions) {
  return {
    ok: ArgOptions.ok !== false,
    status: ArgOptions.status || 200,
    headers: { get: (ArgName) => (ArgName.toLowerCase() === 'content-type' ? ArgOptions.contentType : null) },
    text: async () => ArgOptions.text || '',
    arrayBuffer: async () => ArgOptions.buffer,
    json: async () => ArgOptions.json,
  };
}

/**
 * Stage 1 — the real SlackApp.DownloadFileAsync, both encodings, through the redirect path.
 * This is the code that used to exist as two drifting copies (GH-62).
 */
async function RunDownloadStageAsync() {
  console.log('\nStage 1 — SlackApp.DownloadFileAsync (real redirect/auth/decode logic)');

  // DownloadFileAsync reads private fields, so exercise it through a real SlackApp instance
  // rather than a bare prototype — the point is to run the shipped code, not a lookalike.
  let Instance;
  try {
    Instance = new SlackApp(
      { WORKSPACE_NAME: 'E2E', LIVE_TOKEN: 'xoxb-e2e', SLACK_SIGNING_SECRET: 's', SLACK_APP_TOKEN: 'a' },
      { info: () => {}, warn: () => {}, error: () => {} }
    );
  } catch(constructError) {
    Check('SlackApp instantiable for download test', false, constructError.message);
    return;
  }

  let RedirectFollowed = false;
  global.fetch = async (ArgUrl, ArgOptions) => {
    const Url = String(ArgUrl);
    if(!RedirectFollowed && Url.includes('files.slack.com')) {
      RedirectFollowed = true;
      return {
        ok: false,
        status: 302,
        headers: { get: (ArgName) => (ArgName.toLowerCase() === 'location' ? 'https://files-origin.slack.com/fines.png' : null) },
      };
    }
    // Auth must NOT be forwarded cross-origin.
    const ForwardedAuth = !!(ArgOptions && ArgOptions.headers && ArgOptions.headers.Authorization);
    return MakeResponse({ contentType: 'image/png', buffer: RealPngBytes, text: 'text-body', json: {} , ok: true, status: 200, forwardedAuth: ForwardedAuth });
  };

  try {
    const Base64Result = await Instance.DownloadFileAsync('https://files.slack.com/fines.png', 'base64', 'E2E');
    Check('base64 encoding returns the real PNG bytes',
      Base64Result.Base64 === RealPngBytes.toString('base64'),
      `${Base64Result.Base64.length} chars`);
    Check('base64 encoding reports the mimetype', Base64Result.Mimetype === 'image/png', Base64Result.Mimetype);
    Check('redirect was followed by the single shared implementation', RedirectFollowed);

    RedirectFollowed = false;
    const TextResult = await Instance.DownloadFileAsync('https://files.slack.com/notes.md', 'text', 'E2E');
    Check('text encoding returns a string body', TextResult.Text === 'text-body', TextResult.Text);
    Check('text encoding leaves Base64 empty', TextResult.Base64 === '');
  } catch(error) {
    Check('DownloadFileAsync completed', false, error.message);
  } finally {
    global.fetch = OriginalFetch;
  }
}

/** Stage 2 — the real classifier decides ownership for every attachment shape. */
function RunResolverStage() {
  console.log('\nStage 2 — ResolveAttachmentIntent (single classification seam)');
  const Png = [{ name: 'fines.png', mimetype: 'image/png', size: 100 }];
  const Md = [{ name: 'notes.md', mimetype: 'text/markdown', size: 100 }];

  Check("image + list intent -> 'image-list'", ResolveAttachmentIntent(Png, 'create a list').Kind === 'image-list');
  Check("image + todo-list wording (GH-73) -> 'image-list'", ResolveAttachmentIntent(Png, 'make a todo list for by OCRing the attached image').Kind === 'image-list');
  Check("image + scan wording (GH-73) -> 'image-text'", ResolveAttachmentIntent(Png, 'read the text in this screenshot').Kind === 'image-text');
  Check("image + no intent -> 'unsupported'", ResolveAttachmentIntent(Png, 'hello').Kind === 'unsupported');
  Check("text file wins over image", ResolveAttachmentIntent([...Md, ...Png], 'create a list').Kind === 'text');
  Check("no files -> 'none'", ResolveAttachmentIntent([], 'create a list').Kind === 'none');
}

/** Stage 3 — the real GeminiProvider through WorkspaceAI, with a non-Gemini workspace default. */
async function RunVisionStageAsync() {
  console.log('\nStage 3 — WorkspaceAI vision pinning + real GeminiProvider call');

  const Stats = {
    RecordAIRequest: () => {}, RecordAIResponse: () => {}, RecordAIError: () => {},
    IncrementCounter: () => {},
  };

  const ClaudeDefaultAgent = new WorkspaceAI(
    { WORKSPACE_NAME: 'E2E', GEMINI_API_KEY: 'g-key', ANTHROPIC_API_KEY: 'a-key' },
    Stats,
    'claude-sonnet-5'
  );
  Check('Claude-default workspace resolves a Gemini vision model',
    /^gemini-/.test(ClaudeDefaultAgent.ResolveVisionModelName()),
    ClaudeDefaultAgent.ResolveVisionModelName());

  const NoGeminiAgent = new WorkspaceAI(
    { WORKSPACE_NAME: 'E2E', OPENAI_API_KEY: 'o-key' }, Stats, 'gpt-4o-mini'
  );
  let ThrownCode = null;
  let ThrownMessage = '';
  try { NoGeminiAgent.ResolveVisionModelName(); } catch(error) { ThrownCode = error.code; ThrownMessage = error.message; }
  Check('missing Gemini credentials raise vision_provider_not_configured',
    ThrownCode === 'vision_provider_not_configured', ThrownCode || 'no error thrown');
  Check('the message names the real cause, not a retry',
    /gemini/i.test(ThrownMessage) && !/try again later/i.test(ThrownMessage));

  let SentModel = null;
  let SentInlineData = null;
  global.fetch = async (ArgUrl, ArgOptions) => {
    SentModel = String(ArgUrl);
    try {
      const Body = JSON.parse(ArgOptions.body);
      const Parts = Body?.contents?.[0]?.parts || [];
      SentInlineData = Parts.find((ArgPart) => ArgPart.inlineData || ArgPart.inline_data) || null;
    } catch { /* body shape asserted below */ }
    return MakeResponse({
      contentType: 'application/json',
      json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(ExpectedOcrPayload) }] } }] },
    });
  };

  try {
    const OcrResult = await ClaudeDefaultAgent.ProcessMultimodalMessageWithJsonResponseAsync(
      'Extract all list items from this image.',
      'You extract itemized lists.',
      { name: 'ocr_list_extraction', schema: { type: 'object' } },
      { Base64: RealPngBytes.toString('base64'), Mimetype: 'image/png' }
    );
    Check('OCR returned the structured payload', OcrResult && OcrResult.items && OcrResult.items.length === 3,
      `${OcrResult?.items?.length ?? 0} items`);
    Check('the request went to a Gemini endpoint despite the Claude default',
      /gemini/i.test(SentModel || ''), (SentModel || '').slice(0, 60));
    Check('the image was sent as inline data', !!SentInlineData);
  } catch(error) {
    Check('vision call completed', false, error.message);
  } finally {
    global.fetch = OriginalFetch;
  }
}

/** Stage 4 — the whole journey through the real ChatModule event handler. */
async function RunDispatchStageAsync() {
  console.log('\nStage 4 — app_mention -> ChatModule -> Slack List (the path that was dead)');

  // MockSlackApp is jest-native; supply the minimum `jest.fn` surface it constructs with so the
  // Slack transport can be reused outside a jest run. Everything under test stays real.
  if(typeof global.jest === 'undefined') {
    global.jest = {
      fn: (ArgImplementation) => {
        const Calls = [];
        const Mock = (...ArgArgs) => {
          Calls.push(ArgArgs);
          return Mock._implementation ? Mock._implementation(...ArgArgs) : undefined;
        };
        Mock.mock = { calls: Calls };
        Mock._implementation = ArgImplementation;
        Mock.mockResolvedValue = (ArgValue) => { Mock._implementation = async () => ArgValue; return Mock; };
        Mock.mockReturnValue = (ArgValue) => { Mock._implementation = () => ArgValue; return Mock; };
        Mock.mockImplementation = (ArgFn) => { Mock._implementation = ArgFn; return Mock; };
        return Mock;
      },
    };
  }

  const { MockSlackApp } = require(path.join(__dirname, '..', 'tests', 'mocks', 'mock-slack-app'));
  const ChatModule = require(path.join(__dirname, '..', 'src', 'chat-module'));

  const CreateCalls = [];
  // GH-75: ListsModule is injected directly into ChatModule, no longer nested on RemindersModule.
  const ListsModule = {
    CreateListFromExtractedItemsAsync: async (ArgOptions) => {
      CreateCalls.push(ArgOptions);
      return { ok: true, ListId: 'L_E2E', Permalink: 'https://slack.com/lists/L_E2E', ItemCount: ArgOptions.Items.length };
    },
  };

  const App = new MockSlackApp({
    WorkspaceInfo: { WORKSPACE_NAME: 'E2E', LIVE_TOKEN: 'xoxb-e2e', GEMINI_API_KEY: 'g-key', OPENAI_API_KEY: 'o-key' },
  });
  App.DownloadFileBase64Async = async () => ({ Base64: RealPngBytes.toString('base64'), Mimetype: 'image/png' });

  global.fetch = async () => MakeResponse({
    contentType: 'application/json',
    json: { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(ExpectedOcrPayload) }] } }] },
  });

  try {
    new ChatModule(App, {
      RecordAIRequest: () => {}, RecordAIResponse: () => {}, RecordAIError: () => {}, IncrementCounter: () => {},
    }, {}, null, null, ListsModule);

    const Handled = await App.SimulateAppMentionAsync({
      channel: 'C_E2E',
      user: 'U_E2E',
      text: `${App.AppMentionString} create a list`,
      files: [{
        name: 'fines.png', mimetype: 'image/png', size: RealPngBytes.length,
        url_private: 'https://files.slack.com/fines.png',
        url_private_download: 'https://files.slack.com/fines.png?dl=1',
      }],
    });

    const AllText = App.SentMessages.map((ArgMessage) => ArgMessage.text).join('\n');
    Check('the event was handled', Handled === true);
    Check('a Slack List was created', CreateCalls.length === 1, `${CreateCalls.length} call(s)`);
    Check('the list carried every extracted item', CreateCalls[0]?.Items?.length === 3, `${CreateCalls[0]?.Items?.length ?? 0} items`);
    Check('the list title came from the model', CreateCalls[0]?.ListTitle === 'Safety Inspection Findings', CreateCalls[0]?.ListTitle);
    Check('the user got a confirmation', /Created list/.test(AllText));
    Check('the 1.4.292 rejection message is gone',
      !/I can only read text-based files as context/.test(AllText));
  } catch(error) {
    Check('dispatch completed', false, error.message);
  } finally {
    global.fetch = OriginalFetch;
  }
}

(async function MainAsync() {
  console.log('Attachment pipeline end-to-end harness (GH-62/63/64)');
  console.log('Network boundaries stubbed; all pipeline code is real.');

  await RunDownloadStageAsync();
  RunResolverStage();
  await RunVisionStageAsync();
  await RunDispatchStageAsync();

  const Failed = Results.filter((ArgResult) => !ArgResult.Passed);
  console.log(`\n${'='.repeat(64)}`);
  console.log(`E2E RESULT: ${Results.length - Failed.length}/${Results.length} checks passed`);
  if(Failed.length > 0) {
    console.log('\nFailed checks:');
    for(const Failure of Failed) console.log(`  - ${Failure.Label}${Failure.Detail ? ` (${Failure.Detail})` : ''}`);
    process.exit(1);
  }
  console.log('All stages green.');
  process.exit(0);
})().catch((ArgError) => {
  console.error('harness crashed:', ArgError);
  process.exit(1);
});
