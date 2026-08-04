'use strict';

const fs = require('fs');
const {
  LoadClientMappingsSync,
  ReloadClientMappings,
  ResolveClientsFromQuery,
  DoesReminderMatchClient,
  ResolveClientIdentity,
  ResolveClientNameForReminder,
  ApplyClientPrefix,
  GetClientDefaults,
  NormalizeClientRowsToOverlay,
  WriteClientOverlaySync,
  LoadClientsListConfigSync,
} = require('../src/client-mapping');

const ClientAClient = {
  ClientName: 'Client A',
  Aliases: ['client-a'],
  ChannelIDs: ['C_CLIENT_A_PRIVATE'],
  ChannelNamePatterns: ['client-a'],
  GitHubRepoPatterns: ['client-a'],
};

describe('ResolveClientsFromQuery', () => {
  test('matches client by name as a whole word, case-insensitive', () => {
    const Resolved = ResolveClientsFromQuery('Show me Client A related tasks', [ClientAClient]);
    expect(Resolved).toHaveLength(1);
    expect(Resolved[0].ClientName).toBe('Client A');
  });

  test('does not match when client name is a substring of another word', () => {
    const Resolved = ResolveClientsFromQuery('paraClientAical research', [ClientAClient]);
    expect(Resolved).toHaveLength(0);
  });

  test('returns empty for empty query or empty client list', () => {
    expect(ResolveClientsFromQuery('', [ClientAClient])).toHaveLength(0);
    expect(ResolveClientsFromQuery('client-a', [])).toHaveLength(0);
  });
});

describe('LoadClientMappingsSync', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns cached mappings from disk when the config is valid', () => {
    const ReadFileSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({
      clients: [ClientAClient],
    }));

    const Result = LoadClientMappingsSync();

    expect(Result).toEqual([ClientAClient]);
    expect(ReadFileSpy).toHaveBeenCalled();
  });

  test('returns an empty array when the config file is missing', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => {
          const Error = new global.Error('ENOENT');
          // @ts-ignore
          Error.code = 'ENOENT';
          throw Error;
        }),
      }));

      const { LoadClientMappingsSync: LoadClientMappingsSyncIsolated } = require('../src/client-mapping');
      expect(LoadClientMappingsSyncIsolated()).toEqual([]);
    });
  });

  test('returns an empty array when the config file contains invalid JSON', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => '{invalid json'),
      }));

      const { LoadClientMappingsSync: LoadClientMappingsSyncIsolated } = require('../src/client-mapping');
      expect(LoadClientMappingsSyncIsolated()).toEqual([]);
    });
  });
});

describe('DoesReminderMatchClient', () => {
  test('matches when reminder channel ID is listed', () => {
    const Reminder = { OriginalChannelID: 'C_CLIENT_A_PRIVATE', OriginalChannelName: 'something-else' };
    expect(DoesReminderMatchClient(Reminder, ClientAClient)).toBe(true);
  });

  test('matches when reminder channel name contains a client pattern', () => {
    const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'client-a-eng' };
    expect(DoesReminderMatchClient(Reminder, ClientAClient)).toBe(true);
  });

  test('matches when a GitHub URL contains a repo pattern', () => {
    const Reminder = {
      OriginalChannelID: 'C_X',
      OriginalChannelName: 'misc',
      GitHubUrls: ['https://github.com/Acme/client-a-app/issues/1'],
    };
    expect(DoesReminderMatchClient(Reminder, ClientAClient)).toBe(true);
  });

  test('does not match when nothing about the reminder relates to the client', () => {
    const Reminder = {
      OriginalChannelID: 'C_X',
      OriginalChannelName: 'general',
      GitHubUrls: ['https://github.com/Acme/other-app/issues/1'],
    };
    expect(DoesReminderMatchClient(Reminder, ClientAClient)).toBe(false);
  });
});

describe('ResolveClientIdentity', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns ClientID for a reminder matching a known client by channel name pattern', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{ ...ClientAClient, ClientID: 'client-a' }],
        })),
      }));

      const { ResolveClientIdentity: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'client-a-eng' };
      const Result = Resolve(Reminder);
      expect(Result.ClientID).toBe('client-a');
      expect(Result.ProjectID).toBeNull();
    });
  });

  test('returns ClientID null for a reminder matching no client', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{ ...ClientAClient, ClientID: 'client-a' }],
        })),
      }));

      const { ResolveClientIdentity: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'general' };
      const Result = Resolve(Reminder);
      expect(Result.ClientID).toBeNull();
      expect(Result.ProjectID).toBeNull();
    });
  });

  test('returns both null when the client list is empty', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({ clients: [] })),
      }));

      const { ResolveClientIdentity: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_CLIENT_A_PRIVATE', OriginalChannelName: 'client-a-eng' };
      const Result = Resolve(Reminder);
      expect(Result.ClientID).toBeNull();
      expect(Result.ProjectID).toBeNull();
    });
  });

  // GH-367 QA-gate: ResolveClientIdentity iterates clients in file order and returns the FIRST
  // match — deterministic but order-dependent. Two overlapping clients ('client-a' pattern is a
  // substring of 'client-a-labs') resolve to whichever is listed first in the config, regardless of
  // which name is the "better"/longer match. This test pins that documented, currently-unresolved
  // ambiguity as a regression guard, not as proof it's the ideal behavior.
  test('ambiguous match: two clients both match a channel name — first-listed client wins', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [
            { ClientName: 'Client A', ClientID: 'client-a', ChannelNamePatterns: ['client-a'] },
            { ClientName: 'Client A Labs', ClientID: 'client-a-labs', ChannelNamePatterns: ['client-a-labs'] },
          ],
        })),
      }));

      const { ResolveClientIdentity: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'client-a-labs-eng' };
      const Result = Resolve(Reminder);
      // Both clients' patterns match this channel name; first-listed ('client-a') wins today.
      expect(Result.ClientID).toBe('client-a');
      expect(Result.ProjectID).toBeNull();
    });
  });

  test('ambiguous match: reversing the config order flips the winner (proves order-dependence, not name specificity)', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [
            { ClientName: 'Client A Labs', ClientID: 'client-a-labs', ChannelNamePatterns: ['client-a-labs'] },
            { ClientName: 'Client A', ClientID: 'client-a', ChannelNamePatterns: ['client-a'] },
          ],
        })),
      }));

      const { ResolveClientIdentity: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'client-a-labs-eng' };
      const Result = Resolve(Reminder);
      expect(Result.ClientID).toBe('client-a-labs');
    });
  });
});

describe('ResolveClientNameForReminder', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns the display ClientName for a reminder matching by channel name pattern', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{ ...ClientAClient, ClientID: 'client-a' }],
        })),
      }));

      const { ResolveClientNameForReminder: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'client-a-eng' };
      expect(Resolve(Reminder)).toBe('Client A');
    });
  });

  test('returns null for a reminder matching no client (never guesses)', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{ ...ClientAClient, ClientID: 'client-a' }],
        })),
      }));

      const { ResolveClientNameForReminder: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'general' };
      expect(Resolve(Reminder)).toBeNull();
    });
  });

  test('returns null when the matched client has no usable ClientName', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{ ClientID: 'x', ChannelNamePatterns: ['client-a'] }],
        })),
      }));

      const { ResolveClientNameForReminder: Resolve } = require('../src/client-mapping');
      const Reminder = { OriginalChannelID: 'C_X', OriginalChannelName: 'client-a-eng' };
      expect(Resolve(Reminder)).toBeNull();
    });
  });
});

describe('ApplyClientPrefix', () => {
  test('prepends the client name to the task text', () => {
    expect(ApplyClientPrefix('Ship the login fix', 'Client A')).toBe('Client A - Ship the login fix');
  });

  test('returns the text unchanged when there is no client name', () => {
    expect(ApplyClientPrefix('Ship the login fix', null)).toBe('Ship the login fix');
    expect(ApplyClientPrefix('Ship the login fix', '')).toBe('Ship the login fix');
    expect(ApplyClientPrefix('Ship the login fix', undefined)).toBe('Ship the login fix');
  });

  test('is idempotent when the text already leads with the client name', () => {
    expect(ApplyClientPrefix('Client A - Ship it', 'Client A')).toBe('Client A - Ship it');
    // Lower-case, same spelling: the leading-name check is case-insensitive, so this is a no-op.
    expect(ApplyClientPrefix('client a ship it', 'Client A')).toBe('client a ship it');
  });

  test('still prefixes when the client name appears mid-text but not at the start', () => {
    expect(ApplyClientPrefix('Fix the Client A checkout', 'Client A')).toBe('Client A - Fix the Client A checkout');
  });

  test('escapes regex metacharacters in the client name for the idempotency check', () => {
    expect(ApplyClientPrefix("Client D - water plants", "Client D")).toBe("Client D - water plants");
    expect(ApplyClientPrefix('water plants', "Client D")).toBe("Client D - water plants");
  });

  test('coerces non-string task text to an empty base', () => {
    expect(ApplyClientPrefix(undefined, 'Client A')).toBe('Client A - ');
  });
});

describe('LoadClientMappingsSync with a workspace overlay (#396)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('merges overlay on top of base by ClientID (extend-only, base name preserved)', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn((/** @type {string} */ ArgPath) => {
          if(String(ArgPath).includes('client-mapping-overlay')) {
            return JSON.stringify({ clients: [
              { ClientID: 'client-a', Aliases: ['bnd'], ChannelNamePatterns: ['client-a-support'] },
              { ClientID: 'client-e', ClientName: 'Client E', Aliases: ['cc'], ChannelNamePatterns: ['client-e'] },
            ] });
          }
          return JSON.stringify({ clients: [{ ...ClientAClient, ClientID: 'client-a' }] });
        }),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
      }));

      const { LoadClientMappingsSync: Load } = require('../src/client-mapping');
      const Merged = Load('acme');

      const ClientA = Merged.find((/** @type {any} */ C) => C.ClientID === 'client-a');
      expect(ClientA.ClientName).toBe('Client A'); // base identity untouched
      expect(ClientA.Aliases).toEqual(expect.arrayContaining(['client-a', 'bnd']));
      expect(ClientA.ChannelNamePatterns).toEqual(expect.arrayContaining(['client-a', 'client-a-support']));

      const ClientE = Merged.find((/** @type {any} */ C) => C.ClientID === 'client-e');
      expect(ClientE).toBeTruthy();
      expect(ClientE.ClientName).toBe('Client E');
    });
  });

  test('base-only lookup never reads the overlay when no workspace is given', () => {
    jest.isolateModules(() => {
      const ReadSpy = jest.fn((/** @type {string} */ ArgPath) => {
        if(String(ArgPath).includes('overlay')) throw new global.Error('overlay must not be read');
        return JSON.stringify({ clients: [{ ...ClientAClient, ClientID: 'client-a' }] });
      });
      jest.doMock('fs', () => ({ readFileSync: ReadSpy, mkdirSync: jest.fn(), writeFileSync: jest.fn() }));

      const { LoadClientMappingsSync: Load } = require('../src/client-mapping');
      expect(Load()).toEqual([{ ...ClientAClient, ClientID: 'client-a' }]);
    });
  });

  test('a missing overlay fails open to the base list', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn((/** @type {string} */ ArgPath) => {
          if(String(ArgPath).includes('overlay')) throw new global.Error('ENOENT');
          return JSON.stringify({ clients: [{ ...ClientAClient, ClientID: 'client-a' }] });
        }),
        mkdirSync: jest.fn(),
        writeFileSync: jest.fn(),
      }));

      const { LoadClientMappingsSync: Load } = require('../src/client-mapping');
      const Merged = Load('acme');
      expect(Merged).toHaveLength(1);
      expect(Merged[0].ClientID).toBe('client-a');
    });
  });

  test('ReloadClientMappings busts the cache so a re-read picks up overlay edits', () => {
    jest.isolateModules(() => {
      let OverlayAliases = ['first'];
      const ReadSpy = jest.fn((/** @type {string} */ ArgPath) => {
        if(String(ArgPath).includes('overlay')) {
          return JSON.stringify({ clients: [{ ClientID: 'client-a', Aliases: OverlayAliases }] });
        }
        return JSON.stringify({ clients: [{ ...ClientAClient, ClientID: 'client-a' }] });
      });
      jest.doMock('fs', () => ({ readFileSync: ReadSpy, mkdirSync: jest.fn(), writeFileSync: jest.fn() }));

      const { LoadClientMappingsSync: Load, ReloadClientMappings: Reload } = require('../src/client-mapping');
      expect(Load('acme').find((/** @type {any} */ C) => C.ClientID === 'client-a').Aliases).toContain('first');

      OverlayAliases = ['second'];
      expect(Load('acme').find((/** @type {any} */ C) => C.ClientID === 'client-a').Aliases).toContain('first'); // cached

      Reload('acme');
      expect(Load('acme').find((/** @type {any} */ C) => C.ClientID === 'client-a').Aliases).toContain('second'); // re-read
    });
  });
});

describe('NormalizeClientRowsToOverlay (#396)', () => {
  test('maps rows to the overlay client shape and folds the name into aliases', () => {
    const { clients } = NormalizeClientRowsToOverlay([
      // The third alias must differ from Name by more than case, or DedupePreservingCase folds
      // it away and this test stops proving that aliases survive the fold.
      { Name: 'Client E', Aliases: 'CC, client-e', ChannelPatterns: 'client-e, cr-cc', RepoPatterns: 'cc-app' },
    ]);
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ ClientID: 'client-e', ClientName: 'Client E' });
    expect(clients[0].Aliases).toEqual(['Client E', 'CC', 'client-e']);
    expect(clients[0].ChannelNamePatterns).toEqual(['client-e', 'cr-cc']);
    expect(clients[0].GitHubRepoPatterns).toEqual(['cc-app']);
    expect(clients[0].ChannelIDs).toEqual([]);
  });

  test('skips rows with no usable name and dedups by derived ClientID', () => {
    const { clients } = NormalizeClientRowsToOverlay([
      { Name: '' },
      { Aliases: 'orphan' },
      { Name: 'Acme' },
      { Name: 'ACME' },
      null,
    ]);
    expect(clients.map((/** @type {any} */ C) => C.ClientID)).toEqual(['acme']);
  });

  test('accepts array-valued cells as well as delimited strings', () => {
    const { clients } = NormalizeClientRowsToOverlay([{ Name: 'Acme', Aliases: ['a1', 'a2'] }]);
    expect(clients[0].Aliases).toEqual(['Acme', 'a1', 'a2']);
  });

  test('returns an empty client list for non-array input', () => {
    expect(NormalizeClientRowsToOverlay(null)).toEqual({ clients: [] });
    expect(NormalizeClientRowsToOverlay(undefined)).toEqual({ clients: [] });
  });
});

describe('WriteClientOverlaySync (#396)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  // Since GH-12 Phase 5 this goes through WriteFileDurableSync (temp -> fsync -> rename -> fsync
  // dir) rather than a bare writeFileSync, so the fs mock has to provide the whole sync sequence.
  // The rename assertion below is stronger than the original write-path one: it proves the atomic
  // swap lands on the real overlay path, which is the property that actually matters.
  test('writes the overlay JSON to the per-workspace overlay path', () => {
    jest.isolateModules(() => {
      const WriteSpy = jest.fn();
      const MkdirSpy = jest.fn();
      const RenameSpy = jest.fn();
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({ clients: [] })),
        mkdirSync: MkdirSpy,
        writeFileSync: WriteSpy,
        openSync: jest.fn(() => 42),
        fsyncSync: jest.fn(),
        closeSync: jest.fn(),
        renameSync: RenameSpy,
        unlinkSync: jest.fn(),
      }));

      const { WriteClientOverlaySync: Write } = require('../src/client-mapping');
      const WrittenPath = Write('acme', { clients: [{ ClientID: 'x', ClientName: 'X' }] });

      expect(MkdirSpy).toHaveBeenCalledWith(expect.stringContaining('client-mapping-overlay'), { recursive: true });
      expect(String(WrittenPath)).toContain('acme.json');
      expect(WriteSpy.mock.calls[0][1]).toContain('"ClientID": "x"');
      // Written to a temp, then atomically renamed onto the real overlay path.
      expect(String(RenameSpy.mock.calls[0][0])).toContain('.tmp');
      expect(String(RenameSpy.mock.calls[0][1])).toContain('acme.json');
    });
  });

  test('throws when no workspace name is provided', () => {
    expect(() => WriteClientOverlaySync('', { clients: [] })).toThrow(/workspace/i);
  });
});

describe('LoadClientsListConfigSync (#396)', () => {
  const OriginalEnv = process.env.SLEUTH_CLIENTS_LIST_ID;
  afterEach(() => {
    if(OriginalEnv === undefined) delete process.env.SLEUTH_CLIENTS_LIST_ID;
    else process.env.SLEUTH_CLIENTS_LIST_ID = OriginalEnv;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns null when neither config block nor env var is set', () => {
    jest.isolateModules(() => {
      delete process.env.SLEUTH_CLIENTS_LIST_ID;
      jest.doMock('fs', () => ({ readFileSync: jest.fn(() => JSON.stringify({ clients: [] })) }));
      const { LoadClientsListConfigSync: Load } = require('../src/client-mapping');
      expect(Load()).toBeNull();
    });
  });

  test('reads ListId and Columns from the config block', () => {
    jest.isolateModules(() => {
      delete process.env.SLEUTH_CLIENTS_LIST_ID;
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [],
          ClientsList: { ListId: 'F1', Columns: { Name: 'Col0', Aliases: 'Col1' } },
        })),
      }));
      const { LoadClientsListConfigSync: Load } = require('../src/client-mapping');
      expect(Load()).toEqual({ ListId: 'F1', Columns: { Name: 'Col0', Aliases: 'Col1' } });
    });
  });

  test('the env var overrides the file ListId', () => {
    jest.isolateModules(() => {
      process.env.SLEUTH_CLIENTS_LIST_ID = 'F_ENV';
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({ clients: [], ClientsList: { ListId: 'F_FILE', Columns: {} } })),
      }));
      const { LoadClientsListConfigSync: Load } = require('../src/client-mapping');
      expect(Load().ListId).toBe('F_ENV');
    });
  });
});

describe('GetClientDefaults', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test('returns the Defaults block for a known client', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{
            ...ClientAClient,
            ClientID: 'client-a',
            Defaults: { DefaultAssigneeID: 'U123', DeadlineConvention: 'Sunday 21:00 America/Los_Angeles deploy' },
          }],
        })),
      }));

      const { GetClientDefaults: GetDefaults } = require('../src/client-mapping');
      const Defaults = GetDefaults('client-a');
      expect(Defaults).toEqual({
        DefaultAssigneeID: 'U123',
        DeadlineConvention: 'Sunday 21:00 America/Los_Angeles deploy',
      });
    });
  });

  test('returns {} for an unknown client ID', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{ ...ClientAClient, ClientID: 'client-a', Defaults: {} }],
        })),
      }));

      const { GetClientDefaults: GetDefaults } = require('../src/client-mapping');
      expect(GetDefaults('unknown-client')).toEqual({});
    });
  });

  test('returns {} when ArgClientId is null', () => {
    expect(GetClientDefaults(null)).toEqual({});
  });

  test('returns {} when ArgClientId is undefined', () => {
    expect(GetClientDefaults(undefined)).toEqual({});
  });

  test('returns {} when the client has no Defaults block', () => {
    jest.isolateModules(() => {
      jest.doMock('fs', () => ({
        readFileSync: jest.fn(() => JSON.stringify({
          clients: [{ ...ClientAClient, ClientID: 'client-a' }],
        })),
      }));

      const { GetClientDefaults: GetDefaults } = require('../src/client-mapping');
      expect(GetDefaults('client-a')).toEqual({});
    });
  });
});
