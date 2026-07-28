'use strict';

// Keep overlay writes hermetic: replace the disk writer with a spy, keep everything else real.
jest.mock('../src/client-mapping', () => {
  const Actual = jest.requireActual('../src/client-mapping');
  return { ...Actual, WriteClientOverlaySync: jest.fn(() => '/tmp/acme.json') };
});

const HandleRefreshClientsCommandAsync = require('../src/chat-commands/refresh-clients-command');
const { ScalarizeField, ReadClientsListRowsAsync } = HandleRefreshClientsCommandAsync;
const { WriteClientOverlaySync } = require('../src/client-mapping');

function MakeSlackApp(ArgApiCall) {
  const Posted = [];
  return {
    Posted,
    WorkspaceInfo: { WORKSPACE_NAME: 'acme' },
    Logger: { error: () => {} },
    PostMessageTextAsync: async (/** @type {string} */ _Ch, /** @type {string} */ _Ts, /** @type {string} */ Text) => { Posted.push(Text); },
    BoltApp: { client: { apiCall: ArgApiCall || (async () => ({ items: [] })) } },
  };
}

beforeEach(() => {
  WriteClientOverlaySync.mockClear();
});

describe('ScalarizeField', () => {
  test('reads a plain text field and trims it', () => {
    expect(ScalarizeField({ column_id: 'C', text: '  Acme  ' })).toBe('Acme');
  });

  test('flattens a rich_text field to plain text', () => {
    const Field = {
      column_id: 'C',
      rich_text: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Rich Client' }] }],
    };
    expect(ScalarizeField(Field)).toBe('Rich Client');
  });

  test('joins select values', () => {
    expect(ScalarizeField({ column_id: 'C', select: ['a', 'b'] })).toBe('a, b');
  });

  test('returns empty string for null / unknown field kinds', () => {
    expect(ScalarizeField(null)).toBe('');
    expect(ScalarizeField({ column_id: 'C' })).toBe('');
  });
});

describe('ReadClientsListRowsAsync', () => {
  test('maps configured columns to logical fields and paginates', async () => {
    const Pages = [
      {
        items: [{ fields: [{ column_id: 'nCol', text: 'Acme' }, { column_id: 'aCol', text: 'a1, a2' }] }],
        response_metadata: { next_cursor: 'c2' },
      },
      {
        items: [{ fields: [{ column_id: 'nCol', text: 'Beta' }] }],
        response_metadata: { next_cursor: '' },
      },
    ];
    let Index = 0;
    const App = MakeSlackApp(async () => Pages[Index++]);

    const Rows = await ReadClientsListRowsAsync(App, { ListId: 'F1', Columns: { Name: 'nCol', Aliases: 'aCol' } });

    expect(Rows).toEqual([
      { Name: 'Acme', Aliases: 'a1, a2', ChannelPatterns: '', RepoPatterns: '' },
      { Name: 'Beta', Aliases: '', ChannelPatterns: '', RepoPatterns: '' },
    ]);
    expect(Index).toBe(2); // both pages fetched
  });

  test('throws when the Slack Web client is unavailable', async () => {
    await expect(ReadClientsListRowsAsync({ BoltApp: {} }, { ListId: 'F1', Columns: {} })).rejects.toThrow(/client/i);
  });
});

describe('HandleRefreshClientsCommandAsync', () => {
  test('reads rows, writes the overlay, and confirms', async () => {
    const App = MakeSlackApp();
    await HandleRefreshClientsCommandAsync(App, { channel: 'C', ts: '1' }, {
      LoadConfig: () => ({ ListId: 'F1', Columns: { Name: 'nCol' } }),
      ReadRowsAsync: async () => [{ Name: 'Client E', Aliases: 'CC' }],
    });

    expect(WriteClientOverlaySync).toHaveBeenCalledWith('acme', expect.objectContaining({ clients: expect.any(Array) }));
    expect(App.Posted[0]).toMatch(/refreshed/i);
    expect(App.Posted[0]).toMatch(/1 client/);
  });

  test('posts setup help when the Clients list is not configured', async () => {
    const App = MakeSlackApp();
    await HandleRefreshClientsCommandAsync(App, { channel: 'C', ts: '1' }, { LoadConfig: () => null });

    expect(WriteClientOverlaySync).not.toHaveBeenCalled();
    expect(App.Posted[0]).toMatch(/ClientsList/);
  });

  test('does not write an overlay when the list yields no usable rows', async () => {
    const App = MakeSlackApp();
    await HandleRefreshClientsCommandAsync(App, { channel: 'C', ts: '1' }, {
      LoadConfig: () => ({ ListId: 'F1', Columns: { Name: 'nCol' } }),
      ReadRowsAsync: async () => [{ Aliases: 'orphan-no-name' }],
    });

    expect(WriteClientOverlaySync).not.toHaveBeenCalled();
    expect(App.Posted[0]).toMatch(/no usable rows/i);
  });

  test('reports an error instead of throwing when the read fails', async () => {
    const App = MakeSlackApp();
    await HandleRefreshClientsCommandAsync(App, { channel: 'C', ts: '1' }, {
      LoadConfig: () => ({ ListId: 'F1', Columns: { Name: 'nCol' } }),
      ReadRowsAsync: async () => { throw new Error('slack boom'); },
    });

    expect(WriteClientOverlaySync).not.toHaveBeenCalled();
    expect(App.Posted[0]).toMatch(/couldn't refresh/i);
    expect(App.Posted[0]).toMatch(/slack boom/);
  });
});
