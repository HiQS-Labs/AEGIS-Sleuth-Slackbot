'use strict';

const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');
const { MockSlackApp } = require('./mocks/mock-slack-app');

const ThreadMemory = require('../src/thread-memory');
const {
  EnsureThreadMemorySchema,
  SaveThreadMemoryAsync,
  SearchThreadMemoriesAsync,
  TestThreadMemoryPipelineAsync,
  FindRelatedMemories,
  ThreadAlreadyRemembered,
  ListThreadMemoriesForExport,
  ExtractGitHubRefs,
  CaptureThreadAsync,
  _setDbForTesting,
} = ThreadMemory;
const HandleRememberAboveCommandAsync = require('../src/chat-commands/remember-above-command');
const HandleRecallCommandAsync = require('../src/chat-commands/recall-command');

const EMBED_DIM = 768;

/** A 768-dim one-hot vector for a topic slot, as the Uint8Array the store expects. */
function VecForTopic(ArgIndex) {
  const Floats = new Float32Array(EMBED_DIM);
  Floats[ArgIndex % EMBED_DIM] = 1;
  return new Uint8Array(Floats.buffer);
}

/** Deterministic embedder: maps a keyword in the text to a one-hot topic slot. */
function FakeEmbed(ArgTopicMap) {
  return async (ArgText) => {
    const Lower = (ArgText || '').toLowerCase();
    for(const [Keyword, Index] of Object.entries(ArgTopicMap))
      if(Lower.includes(Keyword)) return VecForTopic(Index);
    return VecForTopic(700);
  };
}

/** Fresh in-memory store with schema + sqlite-vec loaded. */
function MakeTestDb() {
  const Db = new Database(':memory:');
  sqliteVec.load(Db);
  EnsureThreadMemorySchema(Db);
  return Db;
}

/** Build a memory record with sensible defaults. */
function MakeRecord(ArgOverrides = {}) {
  return {
    MemoryId: ArgOverrides.MemoryId || `mem-${Math.random().toString(36).slice(2)}`,
    WorkspaceId: ArgOverrides.WorkspaceId || 'T_A',
    WorkspaceName: ArgOverrides.WorkspaceName !== undefined ? ArgOverrides.WorkspaceName : 'testworkspace',
    ChannelId: ArgOverrides.ChannelId || 'C9',
    ChannelName: ArgOverrides.ChannelName !== undefined ? ArgOverrides.ChannelName : 'payments-team',
    ThreadTs: ArgOverrides.ThreadTs || '100.0',
    CapturedAt: ArgOverrides.CapturedAt || '2026-06-03T12:00:00.000Z',
    CapturedBy: ArgOverrides.CapturedBy || 'U1',
    Participants: ArgOverrides.Participants || ['U1', 'U2'],
    GitHubRefs: ArgOverrides.GitHubRefs || [],
    MessageCount: ArgOverrides.MessageCount ?? 2,
    RawText: ArgOverrides.RawText || 'checkout flow discussion',
    SummaryText: ArgOverrides.SummaryText || 'checkout flow discussion',
  };
}

describe('thread-memory store', () => {
  test('ExtractGitHubRefs labels pull requests and issues', () => {
    const Refs = ExtractGitHubRefs(
      'see https://github.com/o/r/pull/47 and https://github.com/o/r/issues/52'
    );
    expect(Refs).toEqual([
      { url: 'https://github.com/o/r/pull/47', ref: 'PR #47' },
      { url: 'https://github.com/o/r/issues/52', ref: '#52' },
    ]);
  });

  test('CaptureThreadAsync resolves inline @mentions within message bodies, not just the sender line (GH-428)', async () => {
    const SlackApp = new MockSlackApp({
      ThreadMessagesById: {
        'C9:100.0': [
          { user: 'U1', text: 'can <@U2> take a look at this?', ts: '100.0' },
          { user: 'U2', text: 'sure, will do', ts: '101.0' },
        ],
      },
      ChannelNamesById: { C9: 'payments-team' },
    });
    SlackApp.SetUserDisplayNames({ U1: 'Alice', U2: 'Bob' });

    const Record = await CaptureThreadAsync(SlackApp, { channel: 'C9', ts: '100.0', thread_ts: '100.0', user: 'U1' });

    expect(Record.RawText).toContain('Alice (');
    expect(Record.RawText).toContain('can @Bob take a look at this?');
    expect(Record.RawText).not.toMatch(/<@U2>/);
  });

  test('CaptureThreadAsync resolves a user mentioned in several messages only once (shared cache, GH-429)', async () => {
    const SlackApp = new MockSlackApp({
      ThreadMessagesById: {
        'C9:100.0': [
          { user: 'U1', text: 'can <@U2> take a look?', ts: '100.0' },
          { user: 'U1', text: 'also <@U2> please check this', ts: '101.0' },
          { user: 'U1', text: 'and <@U2> once more', ts: '102.0' },
        ],
      },
      ChannelNamesById: { C9: 'payments-team' },
    });
    SlackApp.SetUserDisplayNames({ U1: 'Alice', U2: 'Bob' });
    const LookupSpy = jest.spyOn(SlackApp, 'GetUserDisplayNameAsync');

    const Record = await CaptureThreadAsync(SlackApp, { channel: 'C9', ts: '100.0', thread_ts: '100.0', user: 'U1' });

    expect(Record.RawText.match(/@Bob/g)).toHaveLength(3);
    // U1 (sender, resolved once for the cache) + U2 (mentioned 3x, resolved once via the shared cache).
    expect(LookupSpy).toHaveBeenCalledTimes(2);
    expect(LookupSpy).toHaveBeenCalledWith('U2');
  });

  test('SaveThreadMemoryAsync persists the row and an embedding', async () => {
    const Db = MakeTestDb();
    const Record = MakeRecord({ RawText: 'checkout flow' });
    const Result = await SaveThreadMemoryAsync(Db, Record, 'key', { EmbedAsync: FakeEmbed({ checkout: 0 }) });

    expect(Result.Embedded).toBe(true);
    const Row = Db.prepare('SELECT * FROM thread_memories WHERE memory_id = ?').get(Record.MemoryId);
    expect(Row.workspace_id).toBe('T_A');
    expect(Row.workspace_name).toBe('testworkspace');
    expect(Row.channel_name).toBe('payments-team');
    const VecCount = Db.prepare('SELECT COUNT(*) AS n FROM thread_memory_embeddings WHERE memory_id = ?').get(Record.MemoryId);
    expect(VecCount.n).toBe(1);
  });

  test('SaveThreadMemoryAsync stores the row but no embedding when no key/embedder', async () => {
    const Db = MakeTestDb();
    const Record = MakeRecord();
    const Result = await SaveThreadMemoryAsync(Db, Record, undefined);

    expect(Result.Embedded).toBe(false);
    expect(Db.prepare('SELECT COUNT(*) AS n FROM thread_memories').get().n).toBe(1);
    expect(Db.prepare('SELECT COUNT(*) AS n FROM thread_memory_embeddings').get().n).toBe(0);
  });

  test('SearchThreadMemoriesAsync returns hits above threshold for the workspace', async () => {
    const Db = MakeTestDb();
    const Embed = FakeEmbed({ checkout: 0, deploy: 1 });
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'm-checkout', RawText: 'checkout flow bug' }), 'k', { EmbedAsync: Embed });
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'm-deploy', RawText: 'deploy pipeline' }), 'k', { EmbedAsync: Embed });

    const Hits = await SearchThreadMemoriesAsync(Db, 'T_A', 'checkout', 'k', { EmbedAsync: Embed });
    expect(Hits).toHaveLength(1);
    expect(Hits[0].MemoryId).toBe('m-checkout');
    expect(Hits[0].Similarity).toBeGreaterThanOrEqual(0.65);
  });

  test('SearchThreadMemoriesAsync returns [] when nothing clears the threshold', async () => {
    const Db = MakeTestDb();
    const Embed = FakeEmbed({ checkout: 0, deploy: 1 });
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'm-checkout', RawText: 'checkout flow' }), 'k', { EmbedAsync: Embed });

    // query embeds to an orthogonal topic — cosine similarity 0, below the 0.65 threshold.
    const Hits = await SearchThreadMemoriesAsync(Db, 'T_A', 'deploy', 'k', { EmbedAsync: Embed });
    expect(Hits).toEqual([]);
  });

  test('channel-name keyword match surfaces in-channel threads below the threshold, and excludes tangential content mentions', async () => {
    const Db = MakeTestDb();
    // Orthogonal embedder: documents land in slot 0, the query in slot 7, so the semantic leg never
    // clears the threshold and only the channel-name keyword leg can include a hit. Mirrors prod for
    // "client-b": both #client-a-client-b threads scored ~0.64–0.66 (just under the cut) while a #…-devops
    // thread name-dropped an "ClientB-Analytics" repo in its message text.
    const Embed = async (ArgText, ArgTask) => (ArgTask === 'RETRIEVAL_QUERY' ? VecForTopic(7) : VecForTopic(0));
    // In the Client B channel, but the message text never says "client-b" (the Elan Lipin analog):
    await SaveThreadMemoryAsync(Db, MakeRecord({
      MemoryId: 'in-chan', ChannelName: 'client-a-client-b', ThreadTs: '1.0',
      RawText: 'Clustering by spend levels and recommendations',
    }), 'k', { EmbedAsync: Embed });
    // A different channel whose text name-drops the entity (the ClientB-Analytics devops analog):
    await SaveThreadMemoryAsync(Db, MakeRecord({
      MemoryId: 'name-drop', ChannelName: 'clients-1-client-a-devops', ThreadTs: '2.0',
      RawText: 'pushed the WP to BigQuery sync to the ClientB-Analytics repo',
    }), 'k', { EmbedAsync: Embed });

    // case-insensitive: the in-channel thread surfaces via the channel name; the tangential
    // content mention in a non-matching channel does not.
    const Hits = await SearchThreadMemoriesAsync(Db, 'T_A', 'client-b', 'k', { EmbedAsync: Embed });
    expect(Hits.map(ArgHit => ArgHit.MemoryId)).toEqual(['in-chan']);
  });

  test('a Slack-style "#channel" query strips the leading # and still matches the stored channel name', async () => {
    const Db = MakeTestDb();
    // Query slot 9, documents slot 0: orthogonal, so only the channel-name keyword leg can include a hit.
    const Embed = async (ArgText, ArgTask) => (ArgTask === 'RETRIEVAL_QUERY' ? VecForTopic(9) : VecForTopic(0));
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'in-chan', ChannelName: 'client-a-client-b' }), 'k', { EmbedAsync: Embed });

    // The stored channel name omits the '#'; the query includes it. Without stripping, instr() misses.
    const Hits = await SearchThreadMemoriesAsync(Db, 'T_A', '#client-a-client-b', 'k', { EmbedAsync: Embed });
    expect(Hits.map(ArgHit => ArgHit.MemoryId)).toEqual(['in-chan']);
  });

  test('channel keyword match stays scoped to the workspace', async () => {
    const Db = MakeTestDb();
    // Query embeds to slot 9, documents to slot 0 — orthogonal, so the semantic leg never clears
    // the threshold and only the channel-name keyword leg can include a hit.
    const Embed = async (ArgText, ArgTask) => (ArgTask === 'RETRIEVAL_QUERY' ? VecForTopic(9) : VecForTopic(0));
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'a-lt', WorkspaceId: 'T_A', ChannelName: 'client-a-client-b' }), 'k', { EmbedAsync: Embed });
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'b-lt', WorkspaceId: 'T_B', ChannelName: 'client-a-client-b' }), 'k', { EmbedAsync: Embed });

    const Hits = await SearchThreadMemoriesAsync(Db, 'T_A', 'client-b', 'k', { EmbedAsync: Embed });
    expect(Hits.map(ArgHit => ArgHit.MemoryId)).toEqual(['a-lt']);
  });

  test('workspace isolation: a recall in workspace A never returns workspace B memories', async () => {
    const Db = MakeTestDb();
    const Embed = FakeEmbed({ checkout: 0 });
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'a-1', WorkspaceId: 'T_A', RawText: 'checkout flow' }), 'k', { EmbedAsync: Embed });
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'b-1', WorkspaceId: 'T_B', RawText: 'checkout flow' }), 'k', { EmbedAsync: Embed });

    const HitsA = await SearchThreadMemoriesAsync(Db, 'T_A', 'checkout', 'k', { EmbedAsync: Embed });
    expect(HitsA.map(ArgHit => ArgHit.MemoryId)).toEqual(['a-1']);

    const HitsB = await SearchThreadMemoriesAsync(Db, 'T_B', 'checkout', 'k', { EmbedAsync: Embed });
    expect(HitsB.map(ArgHit => ArgHit.MemoryId)).toEqual(['b-1']);
  });

  test('FindRelatedMemories matches on a shared GitHub URL, scoped to the workspace', async () => {
    const Db = MakeTestDb();
    const Url = 'https://github.com/o/r/pull/47';
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'a-1', WorkspaceId: 'T_A', GitHubRefs: [{ url: Url, ref: 'PR #47' }] }), undefined);
    await SaveThreadMemoryAsync(Db, MakeRecord({ MemoryId: 'b-1', WorkspaceId: 'T_B', GitHubRefs: [{ url: Url, ref: 'PR #47' }] }), undefined);

    expect(FindRelatedMemories(Db, 'T_A', [Url]).map(ArgHit => ArgHit.MemoryId)).toEqual(['a-1']);
    expect(FindRelatedMemories(Db, 'T_A', ['https://github.com/o/r/pull/999'])).toEqual([]);
  });

  test('ThreadAlreadyRemembered flips from false to true after save', async () => {
    const Db = MakeTestDb();
    expect(ThreadAlreadyRemembered(Db, 'T_A', '100.0')).toBe(false);
    await SaveThreadMemoryAsync(Db, MakeRecord({ ThreadTs: '100.0' }), undefined);
    expect(ThreadAlreadyRemembered(Db, 'T_A', '100.0')).toBe(true);
    // a different workspace with the same thread_ts is still unremembered.
    expect(ThreadAlreadyRemembered(Db, 'T_B', '100.0')).toBe(false);
  });

  test('TestThreadMemoryPipelineAsync round-trips a synthetic memory through Gemini embed + recall', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({
        embedding: {
          values: Array.from({ length: EMBED_DIM }, (_v, ArgI) => (ArgI === 0 ? 1 : 0)),
        },
      }),
    }));

    const Result = await TestThreadMemoryPipelineAsync('T_DIAG', 'test-key');

    expect(Result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(Result.similarity).toBeGreaterThanOrEqual(0);
    jest.restoreAllMocks();
  });
});

describe('ListThreadMemoriesForExport', () => {
  test('returns [] when the DB file does not exist', () => {
    const Result = ListThreadMemoriesForExport('testworkspace', '/tmp/nonexistent-thread-memories-test.sqlite');
    expect(Result).toEqual([]);
  });

  test('returns only memories for the requested workspace_name, with correct export shape', async () => {
    const os = require('os');
    const fs = require('fs');
    const TmpPath = require('path').join(os.tmpdir(), `tm-export-test-${process.pid}.sqlite`);
    const TmpDb = new (require('better-sqlite3'))(TmpPath);
    require('sqlite-vec').load(TmpDb);
    EnsureThreadMemorySchema(TmpDb);

    await SaveThreadMemoryAsync(TmpDb, MakeRecord({
      MemoryId: 'em-alpha', WorkspaceName: 'alpha', ChannelId: 'CA', ChannelName: 'alpha-ch',
      ThreadTs: '1000.000100', CapturedBy: 'U1', Participants: ['U1'],
      GitHubRefs: [{ url: 'https://github.com/o/r/pull/1', ref: 'PR #1' }],
      SummaryText: 'some preview text',
    }), undefined);
    await SaveThreadMemoryAsync(TmpDb, MakeRecord({
      MemoryId: 'em-beta', WorkspaceName: 'beta', ChannelId: 'CB', ChannelName: 'beta-ch',
      ThreadTs: '2000.000200', CapturedBy: 'U2', Participants: ['U2'],
      GitHubRefs: [], SummaryText: 'other preview text',
    }), undefined);
    TmpDb.close();

    const AlphaMemories = ListThreadMemoriesForExport('alpha', TmpPath);
    expect(AlphaMemories).toHaveLength(1);
    expect(AlphaMemories[0].memoryId).toBe('em-alpha');
    expect(AlphaMemories[0].channelId).toBe('CA');
    expect(AlphaMemories[0].channelName).toBe('alpha-ch');
    expect(AlphaMemories[0].capturedBy).toBe('U1');
    expect(AlphaMemories[0].participantIds).toEqual(['U1']);
    expect(AlphaMemories[0].githubRefs).toEqual(['https://github.com/o/r/pull/1']);
    expect(AlphaMemories[0].preview).toBe('some preview text');
    expect(AlphaMemories[0].threadUrl).toBe('https://alpha.slack.com/archives/CA/p1000000100');

    const BetaMemories = ListThreadMemoriesForExport('beta', TmpPath);
    expect(BetaMemories).toHaveLength(1);
    expect(BetaMemories[0].memoryId).toBe('em-beta');
    expect(BetaMemories[0].threadUrl).toBe('https://beta.slack.com/archives/CB/p2000000200');

    fs.unlinkSync(TmpPath);
  });

  test('preview is capped at 200 chars', async () => {
    const os = require('os');
    const TmpPath = require('path').join(os.tmpdir(), `tm-preview-test-${process.pid}.sqlite`);
    const TmpDb = new (require('better-sqlite3'))(TmpPath);
    require('sqlite-vec').load(TmpDb);
    EnsureThreadMemorySchema(TmpDb);
    const LongText = 'x'.repeat(500);
    await SaveThreadMemoryAsync(TmpDb, MakeRecord({ MemoryId: 'em-long', WorkspaceName: 'ws', SummaryText: LongText }), undefined);
    TmpDb.close();

    const Result = ListThreadMemoriesForExport('ws', TmpPath);
    expect(Result[0].preview).toHaveLength(200);
    require('fs').unlinkSync(TmpPath);
  });

  test('falls back to domain-less threadUrl when workspace_name is empty', async () => {
    const os = require('os');
    const TmpPath = require('path').join(os.tmpdir(), `tm-noname-test-${process.pid}.sqlite`);
    const TmpDb = new (require('better-sqlite3'))(TmpPath);
    require('sqlite-vec').load(TmpDb);
    EnsureThreadMemorySchema(TmpDb);
    // Save with empty WorkspaceName via raw SQL so workspace_name stays ''
    TmpDb.prepare(
      `INSERT INTO thread_memories (memory_id, workspace_id, workspace_name, channel_id, channel_name,
         thread_ts, captured_at, captured_by, participants, github_refs, message_count, raw_text, summary_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('em-noname', 'T_A', '', 'CX', '', '5000.000500', '2026-06-01T00:00:00.000Z', 'U1', '[]', '[]', 1, 'text', 'text');
    TmpDb.close();

    const Result = ListThreadMemoriesForExport('', TmpPath);
    expect(Result[0].threadUrl).toBe('https://slack.com/archives/CX/p5000000500');
    require('fs').unlinkSync(TmpPath);
  });
});

describe('remember-above command', () => {
  const OriginalKey = process.env.GOOGLE_API_KEY;
  /** @type {import('better-sqlite3').Database} */
  let Db;

  beforeEach(() => {
    Db = MakeTestDb();
    _setDbForTesting(Db);
    process.env.GOOGLE_API_KEY = 'test-key';
    // stub the embedding HTTP call so capture exercises the real embed path without network.
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({ embedding: { values: Array.from({ length: EMBED_DIM }, (_v, ArgI) => (ArgI === 0 ? 1 : 0)) } }),
    }));
  });

  afterEach(() => {
    _setDbForTesting(null);
    if(OriginalKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = OriginalKey;
    jest.restoreAllMocks();
  });

  function MakeSlackApp() {
    const App = new MockSlackApp({
      TeamId: 'T_A',
      ThreadMessagesById: {
        'C1:100.0': [
          { user: 'U1', ts: '100.0', text: "let's fix checkout https://github.com/o/r/pull/47" },
          { user: 'U2', ts: '100.1', text: 'on it' },
        ],
        'C1:200.0': [
          { user: 'U1', ts: '200.0', text: 'no links here' },
        ],
      },
    });
    App.SetUserDisplayNames({ U1: 'Alice', U2: 'Bob' });
    return App;
  }

  test('rejects a non-threaded invocation', async () => {
    const App = MakeSlackApp();
    await HandleRememberAboveCommandAsync(App, { channel: 'C1', ts: '300.0', user: 'U1', text: 'remember above' });
    expect(App.SentMessages.at(-1).text).toBe("Use 'remember above' at the end of a Slack thread.");
  });

  test('captures the thread and confirms with message/participant counts and refs', async () => {
    const App = MakeSlackApp();
    await HandleRememberAboveCommandAsync(App, { channel: 'C1', ts: '100.5', thread_ts: '100.0', user: 'U1', text: 'remember above' });
    expect(App.SentMessages.at(-1).text).toBe('Remembered. 2 messages, 2 participants, refs: PR #47. (via `remember above`)');
  });

  test('omits the refs clause when the thread has no GitHub links', async () => {
    const App = MakeSlackApp();
    await HandleRememberAboveCommandAsync(App, { channel: 'C1', ts: '200.5', thread_ts: '200.0', user: 'U1', text: 'remember above' });
    expect(App.SentMessages.at(-1).text).toBe('Remembered. 1 messages, 1 participants. (via `remember above`)');
  });

  test('is idempotent — a second capture of the same thread is rejected', async () => {
    const App = MakeSlackApp();
    const Event = { channel: 'C1', ts: '100.5', thread_ts: '100.0', user: 'U1', text: 'remember above' };
    await HandleRememberAboveCommandAsync(App, Event);
    await HandleRememberAboveCommandAsync(App, Event);
    expect(App.SentMessages.at(-1).text).toBe('Already remembered this thread.');
  });

  test('degrades gracefully without GOOGLE_API_KEY', async () => {
    delete process.env.GOOGLE_API_KEY;
    const App = MakeSlackApp();
    await HandleRememberAboveCommandAsync(App, { channel: 'C1', ts: '100.5', thread_ts: '100.0', user: 'U1', text: 'remember above' });
    expect(App.SentMessages.at(-1).text).toBe('Thread saved (search unavailable — GOOGLE_API_KEY not configured).');
  });
});

describe('recall command', () => {
  const OriginalKey = process.env.GOOGLE_API_KEY;
  /** @type {import('better-sqlite3').Database} */
  let Db;

  beforeEach(() => {
    Db = MakeTestDb();
    _setDbForTesting(Db);
    process.env.GOOGLE_API_KEY = 'test-key';
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({ embedding: { values: Array.from({ length: EMBED_DIM }, (_v, ArgI) => (ArgI === 0 ? 1 : 0)) } }),
    }));
  });

  afterEach(() => {
    _setDbForTesting(null);
    if(OriginalKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = OriginalKey;
    jest.restoreAllMocks();
  });

  test('posts the empty-state message when nothing matches', async () => {
    const App = new MockSlackApp({ TeamId: 'T_A' });
    await HandleRecallCommandAsync(App, { channel: 'C1', ts: '1.0', user: 'U1' }, 'checkout');
    expect(App.SentMessages.at(-1).text).toBe(
      "No remembered threads match 'checkout'. Use 'remember above' at the end of a relevant thread."
    );
  });

  test('renders ranked results with a permalink', async () => {
    const App = new MockSlackApp({ TeamId: 'T_A', ChannelNamesById: { C9: 'payments-team' } });
    await SaveThreadMemoryAsync(
      Db,
      MakeRecord({
        MemoryId: 'm1', WorkspaceId: 'T_A', ChannelId: 'C9', ThreadTs: 'T9',
        GitHubRefs: [{ url: 'https://github.com/o/r/pull/47', ref: 'PR #47' }],
        RawText: 'checkout flow needs validation before release',
      }),
      'k',
      { EmbedAsync: FakeEmbed({ checkout: 0 }) }
    );

    await HandleRecallCommandAsync(App, { channel: 'C1', ts: '1.0', user: 'U1' }, 'checkout');
    const Sent = App.SentMessages.at(-1);
    expect(Sent.text).toContain('Found 1 thread matching "checkout"');
    expect(Sent.text).toContain('#payments-team');
    expect(Sent.text).toContain('PR #47');
    expect(Sent.text).toContain('https://mock.slack.test/C9/T9');
    // results reply in-thread under the invoking mention, not to the main channel.
    expect(Sent.threadTs).toBe('1.0');
  });

  test('requires GOOGLE_API_KEY', async () => {
    delete process.env.GOOGLE_API_KEY;
    const App = new MockSlackApp({ TeamId: 'T_A' });
    await HandleRecallCommandAsync(App, { channel: 'C1', ts: '1.0', user: 'U1' }, 'checkout');
    expect(App.SentMessages.at(-1).text).toBe('Recall requires GOOGLE_API_KEY to be configured.');
  });
});
