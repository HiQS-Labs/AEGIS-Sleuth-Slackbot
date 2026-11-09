
'use strict';

const { queryRagAsync, _resetForTesting } = require('../src/rag');

describe('code RAG completed answers', () => {
  const OriginalFetch = global.fetch;
  const OriginalKey = process.env.GOOGLE_API_KEY;
  let InfoSpy;

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = 'unit-test-key';
    InfoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});
    _resetForTesting({
      db: {
        prepare: (ArgSql) => ({
          all: () => ArgSql.includes('chunks_vec')
            ? [{ rowid: 1, distance: 0.1 }]
            : [{ id: 1, source: 'code', path: 'src/slack-app.js', priority: 0, content: 'Slack event handlers run in registered order.' }],
        }),
      },
      prompts: { orchestrator_system: 'Answer from the supplied source.' },
    });
  });

  afterEach(() => {
    global.fetch = OriginalFetch;
    if(OriginalKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = OriginalKey;
    InfoSpy.mockRestore();
    _resetForTesting();
  });

  function RespondWith(ArgFinishReason, ArgText) {
    global.fetch = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: { values: Array(768).fill(0) } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        modelVersion: 'synthetic-model',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
        candidates: [{ finishReason: ArgFinishReason, content: { parts: [{ text: ArgText }] } }],
      }) });
  }

  test('completed provider answer survives the native query path with bounded output', async () => {
    RespondWith('STOP', 'Handlers run in registered order [src/slack-app.js].');
    const result = await queryRagAsync('How are events routed?', { includeAnswer: true });
    expect(result.answer).toBe('Handlers run in registered order [src/slack-app.js].');
    const request = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(request.generationConfig.maxOutputTokens).toBe(8192);
    expect(InfoSpy).toHaveBeenCalledWith('[rag] synthesis usage:', JSON.stringify({
      modelVersion: 'synthetic-model', finishReason: 'STOP',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
    }));
    expect(JSON.stringify(InfoSpy.mock.calls)).not.toContain('unit-test-key');
    expect(JSON.stringify(InfoSpy.mock.calls)).not.toContain('How are events routed?');
  });

  test('nonempty truncated draft is refused instead of becoming a completed answer', async () => {
    RespondWith('MAX_TOKENS', 'Drafting: I will explain both routes...');
    await expect(queryRagAsync('How are events routed?', { includeAnswer: true })).rejects.toThrow('incomplete');
    expect(InfoSpy).toHaveBeenCalledWith('[rag] synthesis usage:', JSON.stringify({
      modelVersion: 'synthetic-model', finishReason: 'MAX_TOKENS',
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3 },
    }));
    expect(JSON.stringify(InfoSpy.mock.calls)).not.toContain('unit-test-key');
    expect(JSON.stringify(InfoSpy.mock.calls)).not.toContain('How are events routed?');
  });

  test('empty completed response remains a failure', async () => {
    RespondWith('STOP', '');
    await expect(queryRagAsync('How are events routed?', { includeAnswer: true })).rejects.toThrow('empty response');
  });
});

