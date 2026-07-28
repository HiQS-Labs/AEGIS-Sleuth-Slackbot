'use strict';

const SlackFormatUtils = require('../slack-format-utils');
const {
  LoadClientsListConfigSync,
  NormalizeClientRowsToOverlay,
  WriteClientOverlaySync,
} = require('../client-mapping');

const SetupHelpText = [
  'I can\'t refresh the clients list yet — the *Clients* Slack List isn\'t wired up.',
  'Configure it by adding a `ClientsList` block to `data/static/client-channel-mapping.json`:',
  '```',
  '"ClientsList": {',
  '  "ListId": "F0XXXXXXXXX",',
  '  "Columns": {',
  '    "Name": "Col0AAAA",',
  '    "Aliases": "Col0BBBB",',
  '    "ChannelPatterns": "Col0CCCC",',
  '    "RepoPatterns": "Col0DDDD"',
  '  }',
  '}',
  '```',
  '(`ListId` can also come from the `SLEUTH_CLIENTS_LIST_ID` env var. `Columns` maps each logical field to its Slack `column_id`; at minimum `Name` is required.)',
].join('\n');

/**
 * Pull a scalar string out of a raw Slack List field object (keyed by `column_id`, value under one
 * of rich_text/text/select/…). Non-text field kinds collapse to their best string form.
 * @param {any} ArgField
 * @returns {string}
 */
function ScalarizeField(ArgField) {
  if(!ArgField || typeof ArgField !== 'object') return '';
  if(typeof ArgField.text === 'string') return ArgField.text.trim();
  if('rich_text' in ArgField) return String(SlackFormatUtils.ParseListFieldValue(ArgField.rich_text, 'rich_text') || '').trim();
  if('select' in ArgField) {
    const Select = ArgField.select;
    if(Array.isArray(Select)) return Select.filter((/** @type {any} */ V) => typeof V === 'string').join(', ');
    return typeof Select === 'string' ? Select.trim() : '';
  }
  if(Array.isArray(ArgField.user)) return ArgField.user.join(', ');
  if(Array.isArray(ArgField.channel)) return ArgField.channel.join(', ');
  return '';
}

/**
 * Read every row of the configured Clients Slack List (paginated) via the Bolt Web client, mapping
 * each row's fields to our logical columns using the configured `column_id` map.
 * @param {import('../slack-app')} ArgSlackApp
 * @param {{ ListId: string, Columns: Record<string, string> }} ArgConfig
 * @returns {Promise<Array<Record<string, string>>>}
 */
async function ReadClientsListRowsAsync(ArgSlackApp, ArgConfig) {
  const Client = ArgSlackApp.BoltApp?.client;
  if(!Client) throw new Error('Slack Web client is unavailable');

  // reverse the logical→column_id map so we can label each raw field by our logical column name.
  /** @type {Record<string, string>} */
  const ColumnIdToLogical = {};
  for(const [Logical, ColumnId] of Object.entries(ArgConfig.Columns || {})) {
    if(typeof ColumnId === 'string' && ColumnId) ColumnIdToLogical[ColumnId] = Logical;
  }

  const Rows = [];
  let Cursor;
  do {
    const Response = /** @type {any} */ (await Client.apiCall('slackLists.items.list', {
      list_id: ArgConfig.ListId,
      limit: 100,
      cursor: Cursor,
    }));

    for(const Item of Response.items || []) {
      /** @type {Record<string, string>} */
      const Row = { Name: '', Aliases: '', ChannelPatterns: '', RepoPatterns: '' };
      for(const Field of Array.isArray(Item.fields) ? Item.fields : []) {
        const Logical = ColumnIdToLogical[Field.column_id];
        if(!Logical || !(Logical in Row)) continue;
        Row[Logical] = ScalarizeField(Field);
      }
      Rows.push(Row);
    }

    Cursor = Response.response_metadata?.next_cursor;
  } while(Cursor);

  return Rows;
}

/**
 * `refresh clients` — read the operator-managed Clients Slack List and write it back into the Sleuth
 * client lookup as a per-workspace overlay, so #395's client-name inference picks up new
 * clients/aliases without a code deploy (#396).
 * @param {import('../slack-app')} ArgSlackApp
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo
 * @param {{
 *   ReadRowsAsync?: (ArgSlackApp: any, ArgConfig: any) => Promise<Array<any>>,
 *   LoadConfig?: () => ({ ListId: string, Columns: Record<string, string> }|null),
 * }} [ArgOptions]
 * @returns {Promise<void>}
 */
async function HandleRefreshClientsCommandAsync(ArgSlackApp, ArgEventInfo, ArgOptions = {}) {
  const LoadConfig = ArgOptions.LoadConfig || LoadClientsListConfigSync;
  const ReadRowsAsync = ArgOptions.ReadRowsAsync || ReadClientsListRowsAsync;

  const Config = LoadConfig();
  if(!Config) {
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, SetupHelpText);
    return;
  }

  const WorkspaceName = ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME;
  if(!WorkspaceName) {
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, 'Could not resolve the workspace to write the clients overlay.');
    return;
  }

  try {
    const Rows = await ReadRowsAsync(ArgSlackApp, Config);
    const Overlay = NormalizeClientRowsToOverlay(Rows);

    if(Overlay.clients.length === 0) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        'Read the Clients list but found no usable rows (every row needs a *Name*). Nothing was changed.'
      );
      return;
    }

    WriteClientOverlaySync(WorkspaceName, Overlay);

    const AliasCount = Overlay.clients.reduce((/** @type {number} */ ArgSum, /** @type {any} */ ArgClient) => ArgSum + (ArgClient.Aliases?.length || 0), 0);
    const ClientWord = Overlay.clients.length === 1 ? 'client' : 'clients';
    const AliasWord = AliasCount === 1 ? 'alias' : 'aliases';
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `✅ Clients lookup refreshed: ${Overlay.clients.length} ${ClientWord} loaded (${AliasCount} ${AliasWord}). New names apply to reminder synthesis immediately.`
    );
  } catch(error) {
    ArgSlackApp.Logger?.error?.('refresh clients failed:', error);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `Couldn't refresh the clients list: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

module.exports = HandleRefreshClientsCommandAsync;
module.exports.ScalarizeField = ScalarizeField;
module.exports.ReadClientsListRowsAsync = ReadClientsListRowsAsync;
