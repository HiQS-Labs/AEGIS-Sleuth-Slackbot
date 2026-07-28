
'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const LearnedConventionSuppressionStore = require('../src/learned-convention-suppression-store');

/**
 * Build a store backed by a real temp file, plus a captured log so tests can assert on
 * warn/error output without a full SlackApp.
 * @param {string} ArgFilePath
 */
function MakeStore(ArgFilePath) {
  const Logged = { errors: [], warns: [] };
  const SlackApp = {
    Logger: {
      error: (...ArgArgs) => Logged.errors.push(ArgArgs),
      warn: (...ArgArgs) => Logged.warns.push(ArgArgs),
    },
  };
  return { Store: new LearnedConventionSuppressionStore(SlackApp, ArgFilePath), Logged };
}

describe('LearnedConventionSuppressionStore', () => {
  let TmpDir;
  let FilePath;

  beforeEach(async () => {
    TmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'learned-convention-suppression-'));
    FilePath = path.join(TmpDir, 'ws_learned_convention_suppression.json');
  });

  afterEach(async () => {
    await fs.rm(TmpDir, { recursive: true, force: true });
  });

  test('LoadAsync on a missing file starts empty without logging an error', async () => {
    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();
    expect(Store.IsSuppressed('client-a', 'assignee')).toBe(false);
    expect(Store.IsRateLimited('client-a')).toBe(false);
    expect(Logged.errors).toHaveLength(0);
  });

  describe('suppression', () => {
    test('a declined proposal is suppressed within the L-week window', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordDecline('client-a', 'assignee', Now);

      expect(Store.IsSuppressed('client-a', 'assignee', Now + 1000)).toBe(true);
    });

    test('suppression does not leak across kinds or clients', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordDecline('client-a', 'assignee', Now);

      expect(Store.IsSuppressed('client-a', 'cadence', Now + 1000)).toBe(false);
      expect(Store.IsSuppressed('other-client', 'assignee', Now + 1000)).toBe(false);
    });

    test('a declined proposal is no longer suppressed once the window expires', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordDecline('client-a', 'assignee', Now);

      const JustBeforeExpiry = Now + LearnedConventionSuppressionStore.SUPPRESSION_WINDOW_MS - 1;
      const JustAfterExpiry = Now + LearnedConventionSuppressionStore.SUPPRESSION_WINDOW_MS + 1;
      expect(Store.IsSuppressed('client-a', 'assignee', JustBeforeExpiry)).toBe(true);
      expect(Store.IsSuppressed('client-a', 'assignee', JustAfterExpiry)).toBe(false);
    });

    test('RecordDecline de-dupes by (clientId, kind), keeping the latest decline time', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordDecline('client-a', 'assignee', Now - 1000);
      await Store.RecordDecline('client-a', 'assignee', Now);

      // Only the latest decline should be on disk; two rows would mean stale doubling.
      const OnDisk = JSON.parse(await fs.readFile(FilePath, 'utf8'));
      expect(OnDisk.declines).toHaveLength(1);
      expect(OnDisk.declines[0].declinedMs).toBe(Now);
    });

    test('suppression state is durable across a reload', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordDecline('client-a', 'cadence', Now);

      const { Store: Reloaded } = MakeStore(FilePath);
      await Reloaded.LoadAsync();
      expect(Reloaded.IsSuppressed('client-a', 'cadence', Now + 1000)).toBe(true);
    });
  });

  describe('rate limit', () => {
    test('a second proposal for the same client within the week is rate-limited', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordProposalSurfaced('client-a', Now);

      expect(Store.IsRateLimited('client-a', Now + 60_000)).toBe(true);
    });

    test('rate limit does not apply to a different client', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordProposalSurfaced('client-a', Now);

      expect(Store.IsRateLimited('other-client', Now + 60_000)).toBe(false);
    });

    test('rate limit resets after a week', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordProposalSurfaced('client-a', Now);

      const JustBeforeExpiry = Now + LearnedConventionSuppressionStore.RATE_LIMIT_WINDOW_MS - 1;
      const JustAfterExpiry = Now + LearnedConventionSuppressionStore.RATE_LIMIT_WINDOW_MS + 1;
      expect(Store.IsRateLimited('client-a', JustBeforeExpiry)).toBe(true);
      expect(Store.IsRateLimited('client-a', JustAfterExpiry)).toBe(false);
    });

    test('RecordProposalSurfaced de-dupes by clientId, keeping the latest surfaced time', async () => {
      const Now = Date.now();
      const { Store } = MakeStore(FilePath);
      await Store.LoadAsync();
      await Store.RecordProposalSurfaced('client-a', Now - 1000);
      await Store.RecordProposalSurfaced('client-a', Now);

      const OnDisk = JSON.parse(await fs.readFile(FilePath, 'utf8'));
      expect(OnDisk.surfaced).toHaveLength(1);
      expect(OnDisk.surfaced[0].surfacedMs).toBe(Now);
    });
  });

  test('invalid records are ignored and warned, never persisted', async () => {
    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();
    await Store.RecordDecline('', 'assignee', Date.now()); // empty clientId
    await Store.RecordProposalSurfaced('', Date.now()); // empty clientId

    expect(Store.IsSuppressed('', 'assignee')).toBe(false);
    expect(Store.IsRateLimited('')).toBe(false);
    expect(Logged.warns).toHaveLength(2);
  });

  test('FlushAsync resolves after the most recent queued write has reached disk', async () => {
    const Now = Date.now();
    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();
    Store.RecordDecline('client-a', 'assignee', Now); // not awaited — fire-and-forget
    await Store.FlushAsync();

    const OnDisk = JSON.parse(await fs.readFile(FilePath, 'utf8'));
    expect(OnDisk.declines).toHaveLength(1);
  });

  test('LoadAsync tolerates a corrupt file by starting empty and logging an error', async () => {
    await fs.writeFile(FilePath, '{ not valid json', 'utf8');
    const { Store, Logged } = MakeStore(FilePath);
    await Store.LoadAsync();
    expect(Store.IsSuppressed('client-a', 'assignee')).toBe(false);
    expect(Logged.errors).toHaveLength(1);
  });

  test('expired declines and surfaced rows are pruned on load and persisted back to disk', async () => {
    const Now = Date.now();
    const StaleDeclineMs = Now - LearnedConventionSuppressionStore.SUPPRESSION_WINDOW_MS - 1000;
    const StaleSurfacedMs = Now - LearnedConventionSuppressionStore.RATE_LIMIT_WINDOW_MS - 1000;
    await fs.writeFile(FilePath, JSON.stringify({
      declines: [{ clientId: 'client-a', kind: 'assignee', declinedMs: StaleDeclineMs }],
      surfaced: [{ clientId: 'client-a', surfacedMs: StaleSurfacedMs }],
    }), 'utf8');

    const { Store } = MakeStore(FilePath);
    await Store.LoadAsync();

    expect(Store.IsSuppressed('client-a', 'assignee', Now)).toBe(false);
    expect(Store.IsRateLimited('client-a', Now)).toBe(false);

    const OnDisk = JSON.parse(await fs.readFile(FilePath, 'utf8'));
    expect(OnDisk.declines).toHaveLength(0);
    expect(OnDisk.surfaced).toHaveLength(0);
  });
});
