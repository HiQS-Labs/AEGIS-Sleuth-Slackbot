'use strict';

const fs = require('fs');
const path = require('path');

// ponytail: env override so tests can point at their own fixture instead of overwriting the real
// file. The previous hack wrote the fixture over data/static/client-channel-mapping.json and
// restored it after — which raced every other jest worker reading the same path.
const ConfigPath = process.env.SLEUTH_CLIENT_MAPPING_PATH
  || path.join(__dirname, '..', 'data', 'static', 'client-channel-mapping.json');
const OverlayDirPath = path.join(__dirname, '..', 'data', 'runtime', 'client-mapping-overlay');

/**
 * Merged client cache keyed by workspace name. The empty-string key holds the base-only list.
 * A Map (never a single global) is deliberate: overlays are per-workspace, so caching them under
 * one variable would bind one tenant's clients process-wide — the multi-tenant isolation failure
 * mode AGENTS.md 0.1 forbids. See #396.
 * @type {Map<string, Array<any>>}
 */
const ClientCacheByWorkspace = new Map();

/**
 * Read the engineer-owned base client list from static config.
 * @returns {Array<any>}
 */
function LoadBaseClientsSync() {
  try {
    const Raw = fs.readFileSync(ConfigPath, 'utf8');
    const Parsed = JSON.parse(Raw);
    return Array.isArray(Parsed.clients) ? Parsed.clients : [];
  } catch(error) {
    // client mappings are an optional search-expansion layer; fail open to an empty
    // mapping set when the file is missing or invalid instead of breaking reminders.
    return [];
  }
}

/**
 * Read the operator-managed runtime overlay for a workspace (populated from Slack — see #396).
 * Optional and fail-open: a missing or malformed overlay degrades to no overlay, never an error.
 * @param {string} ArgWorkspaceName
 * @returns {Array<any>}
 */
function LoadOverlayClientsSync(ArgWorkspaceName) {
  if(!ArgWorkspaceName) return [];
  try {
    const OverlayPath = path.join(OverlayDirPath, `${ArgWorkspaceName}.json`);
    const Raw = fs.readFileSync(OverlayPath, 'utf8');
    const Parsed = JSON.parse(Raw);
    return Array.isArray(Parsed.clients) ? Parsed.clients : [];
  } catch(error) {
    return [];
  }
}

/**
 * Case-insensitively de-duplicate a list of strings, preserving first-seen original casing and
 * dropping blanks/non-strings. (Match-time comparisons already lowercase, so casing is cosmetic —
 * but ChannelIDs must keep their original case, which this does.)
 * @param {Array<any>} ArgValues
 * @returns {Array<string>}
 */
function DedupePreservingCase(ArgValues) {
  const Seen = new Set();
  const Out = [];
  for(const Value of Array.isArray(ArgValues) ? ArgValues : []) {
    if(typeof Value !== 'string') continue;
    const Trimmed = Value.trim();
    if(!Trimmed) continue;
    const Key = Trimmed.toLowerCase();
    if(Seen.has(Key)) continue;
    Seen.add(Key);
    Out.push(Trimmed);
  }
  return Out;
}

/**
 * Merge base ⊕ overlay client lists by ClientID. Extend-only: the overlay may add net-new clients
 * and extend an existing client's alias/pattern arrays, but never removes or overrides a base
 * client's identity — so a Slack typo can broaden coverage but can't un-wire a curated client (#396).
 * @param {Array<any>} ArgBase
 * @param {Array<any>} ArgOverlay
 * @returns {Array<any>}
 */
function MergeClientLists(ArgBase, ArgOverlay) {
  const ByID = new Map();
  const Order = [];

  for(const Client of Array.isArray(ArgBase) ? ArgBase : []) {
    if(!Client || typeof Client.ClientID !== 'string' || !Client.ClientID) continue;
    ByID.set(Client.ClientID, { ...Client });
    Order.push(Client.ClientID);
  }

  for(const Client of Array.isArray(ArgOverlay) ? ArgOverlay : []) {
    if(!Client || typeof Client.ClientID !== 'string' || !Client.ClientID) continue;
    const Existing = ByID.get(Client.ClientID);
    if(!Existing) {
      ByID.set(Client.ClientID, { ...Client });
      Order.push(Client.ClientID);
      continue;
    }
    // extend-only: union the array fields, keep the base's ClientName/Defaults untouched.
    Existing.Aliases = DedupePreservingCase([...(Existing.Aliases || []), ...(Client.Aliases || [])]);
    Existing.ChannelIDs = DedupePreservingCase([...(Existing.ChannelIDs || []), ...(Client.ChannelIDs || [])]);
    Existing.ChannelNamePatterns = DedupePreservingCase([...(Existing.ChannelNamePatterns || []), ...(Client.ChannelNamePatterns || [])]);
    Existing.GitHubRepoPatterns = DedupePreservingCase([...(Existing.GitHubRepoPatterns || []), ...(Client.GitHubRepoPatterns || [])]);
  }

  return Order.map((/** @type {string} */ ArgID) => ByID.get(ArgID));
}

/**
 * Load client mappings, optionally merged with a workspace's runtime overlay. Cached per workspace
 * after first call. Called with no workspace it returns the base-only list (unchanged legacy
 * behavior); pass a workspace name to fold in that workspace's operator-managed overlay (#396).
 * @param {string} [ArgWorkspaceName]
 * @returns {Array<any>}
 */
function LoadClientMappingsSync(ArgWorkspaceName = '') {
  const CacheKey = typeof ArgWorkspaceName === 'string' ? ArgWorkspaceName : '';
  const Cached = ClientCacheByWorkspace.get(CacheKey);
  if(Cached) return Cached;

  const Base = LoadBaseClientsSync();
  const Merged = CacheKey ? MergeClientLists(Base, LoadOverlayClientsSync(CacheKey)) : Base;

  ClientCacheByWorkspace.set(CacheKey, Merged);
  return Merged;
}

/**
 * Bust the in-module client cache so the next lookup re-reads base ⊕ overlay from disk. Call after
 * an overlay is rewritten (see WriteClientOverlaySync). With no argument, clears every workspace.
 * @param {string} [ArgWorkspaceName]
 * @returns {void}
 */
function ReloadClientMappings(ArgWorkspaceName) {
  if(ArgWorkspaceName === undefined) {
    ClientCacheByWorkspace.clear();
    return;
  }
  ClientCacheByWorkspace.delete(typeof ArgWorkspaceName === 'string' ? ArgWorkspaceName : '');
}

/**
 * Find clients whose name or alias appears as a whole word in the query.
 * @param {string} ArgQuery
 * @param {Array<any>} ArgClients
 * @returns {Array<any>}
 */
function ResolveClientsFromQuery(ArgQuery, ArgClients) {
  const NormalizedQuery = (ArgQuery || '').toLowerCase();
  if(!NormalizedQuery || !Array.isArray(ArgClients)) return [];

  return ArgClients.filter((/** @type {any} */ ArgClient) => {
    const Names = [ArgClient.ClientName, ...(ArgClient.Aliases || [])]
      .filter((/** @type {any} */ ArgName) => typeof ArgName === 'string' && ArgName.length > 0)
      .map((/** @type {string} */ ArgName) => ArgName.toLowerCase());

    return Names.some((/** @type {string} */ ArgName) => {
      const WordBoundaryPattern = new RegExp(`\\b${EscapeRegex(ArgName)}\\b`, 'i');
      return WordBoundaryPattern.test(NormalizedQuery);
    });
  });
}

/**
 * @param {any} ArgReminder
 * @param {any} ArgClient
 * @returns {boolean}
 */
function DoesReminderMatchClient(ArgReminder, ArgClient) {
  const ChannelIDs = Array.isArray(ArgClient.ChannelIDs) ? ArgClient.ChannelIDs : [];
  if(ArgReminder.OriginalChannelID && ChannelIDs.includes(ArgReminder.OriginalChannelID)) return true;

  const ChannelName = (ArgReminder.OriginalChannelName || '').toLowerCase();
  const NamePatterns = (Array.isArray(ArgClient.ChannelNamePatterns) ? ArgClient.ChannelNamePatterns : [])
    .filter((/** @type {any} */ ArgPattern) => typeof ArgPattern === 'string' && ArgPattern.length > 0)
    .map((/** @type {string} */ ArgPattern) => ArgPattern.toLowerCase());
  if(ChannelName && NamePatterns.some((/** @type {string} */ ArgPattern) => ChannelName.includes(ArgPattern))) return true;

  const GitHubUrls = Array.isArray(ArgReminder.GitHubUrls) ? ArgReminder.GitHubUrls : [];
  if(GitHubUrls.length > 0) {
    const RepoPatterns = (Array.isArray(ArgClient.GitHubRepoPatterns) ? ArgClient.GitHubRepoPatterns : [])
      .filter((/** @type {any} */ ArgPattern) => typeof ArgPattern === 'string' && ArgPattern.length > 0)
      .map((/** @type {string} */ ArgPattern) => ArgPattern.toLowerCase());

    const HasMatchingUrl = GitHubUrls.some((/** @type {string} */ ArgUrl) => {
      const Lower = (ArgUrl || '').toLowerCase();
      return RepoPatterns.some((/** @type {string} */ ArgPattern) => Lower.includes(ArgPattern));
    });
    if(HasMatchingUrl) return true;
  }

  return false;
}

/**
 * @param {string} ArgString
 * @returns {string}
 */
function EscapeRegex(ArgString) {
  return ArgString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve the client and project identity for a reminder or context object.
 * Uses the same channel/repo pattern-match logic as DoesReminderMatchClient.
 * ProjectID is null in v1 — no project dimension is derivable from this phase.
 * @param {any} ArgReminderOrContext
 * @returns {{ ClientID: string|null, ProjectID: string|null }}
 */
function ResolveClientIdentity(ArgReminderOrContext) {
  const Clients = LoadClientMappingsSync();
  for(const Client of Clients) {
    if(DoesReminderMatchClient(ArgReminderOrContext, Client)) {
      return {
        ClientID: typeof Client.ClientID === 'string' && Client.ClientID.length > 0
          ? Client.ClientID
          : null,
        ProjectID: null,
      };
    }
  }
  return { ClientID: null, ProjectID: null };
}

/**
 * Resolve the display ClientName for a reminder using the same deterministic
 * channel/repo match as ResolveClientIdentity. Returns null when no client
 * confidently matches — callers must fail open (never guess a client).
 * @param {any} ArgReminderOrContext
 * @param {string} [ArgWorkspaceName] Workspace whose overlay should be folded in (#396). Omitted → base only.
 * @returns {string|null}
 */
function ResolveClientNameForReminder(ArgReminderOrContext, ArgWorkspaceName = '') {
  const Clients = LoadClientMappingsSync(ArgWorkspaceName);
  const Match = Clients.find(
    (/** @type {any} */ ArgClient) => DoesReminderMatchClient(ArgReminderOrContext, ArgClient)
  );
  if(!Match) return null;
  return typeof Match.ClientName === 'string' && Match.ClientName.length > 0
    ? Match.ClientName
    : null;
}

/**
 * Prepend a client name to a task's text, safely and idempotently.
 * No client name → return the text unchanged (fail open, never guess).
 * Text already led by the client name → return unchanged (avoid "Client A - Client A …").
 * @param {string} ArgTaskText
 * @param {string|null|undefined} ArgClientName
 * @returns {string}
 */
function ApplyClientPrefix(ArgTaskText, ArgClientName) {
  const TaskText = typeof ArgTaskText === 'string' ? ArgTaskText : '';
  if(!ArgClientName) return TaskText;

  const AlreadyPrefixed = new RegExp(`^\\s*${EscapeRegex(ArgClientName)}\\b`, 'i');
  if(AlreadyPrefixed.test(TaskText)) return TaskText;

  return `${ArgClientName} - ${TaskText}`;
}

/**
 * Return the Defaults block for a known client, or {} when absent/unknown.
 * Defensive: a missing or malformed Defaults block always degrades to {}.
 * @param {string|null|undefined} ArgClientId
 * @returns {Record<string, string>}
 */
function GetClientDefaults(ArgClientId) {
  if(!ArgClientId) return {};
  const Clients = LoadClientMappingsSync();
  const Client = Clients.find(
    (/** @type {any} */ ArgClient) => ArgClient.ClientID === ArgClientId
  );
  if(!Client) return {};
  try {
    const Defaults = Client.Defaults;
    if(Defaults && typeof Defaults === 'object' && !Array.isArray(Defaults)) {
      return /** @type {Record<string, string>} */ (Defaults);
    }
  } catch(_) {
    // malformed Defaults — fall through to {}
  }
  return {};
}

/**
 * Derive a stable ClientID slug from a display name (lowercase, non-alphanumerics → single dash).
 * @param {string} ArgName
 * @returns {string}
 */
function SlugifyClientId(ArgName) {
  return String(ArgName || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Coerce a Slack List cell into a string list. Arrays pass through (strings only); a string is split
 * on commas, semicolons, or newlines. Blanks are dropped.
 * @param {any} ArgValue
 * @returns {Array<string>}
 */
function SplitToList(ArgValue) {
  if(Array.isArray(ArgValue)) return ArgValue.filter((/** @type {any} */ V) => typeof V === 'string' && V.trim());
  if(typeof ArgValue !== 'string') return [];
  return ArgValue.split(/[,;\n]/).map((/** @type {string} */ S) => S.trim()).filter(Boolean);
}

/**
 * Normalize loosely-typed client rows (already scalarized from a Slack List) into the
 * client-channel-mapping overlay shape consumed by the loader (#396). Rows with no usable Name are
 * skipped and duplicate derived ClientIDs collapse to the first — mirroring the fail-open posture of
 * the base loader so a malformed Slack row can never break lookups.
 * @param {Array<{ Name?: any, Aliases?: any, ChannelPatterns?: any, RepoPatterns?: any }>} ArgRows
 * @returns {{ clients: Array<any> }}
 */
function NormalizeClientRowsToOverlay(ArgRows) {
  const Clients = [];
  const SeenIDs = new Set();

  for(const Row of Array.isArray(ArgRows) ? ArgRows : []) {
    if(!Row || typeof Row !== 'object') continue;
    const Name = typeof Row.Name === 'string' ? Row.Name.trim() : '';
    if(!Name) continue;

    const ClientID = SlugifyClientId(Name);
    if(!ClientID || SeenIDs.has(ClientID)) continue;
    SeenIDs.add(ClientID);

    Clients.push({
      ClientID,
      ClientName: Name,
      // fold the display name in as an alias so name-in-query lookups match too.
      Aliases: DedupePreservingCase([Name, ...SplitToList(Row.Aliases)]),
      ChannelIDs: [],
      ChannelNamePatterns: DedupePreservingCase(SplitToList(Row.ChannelPatterns)),
      GitHubRepoPatterns: DedupePreservingCase(SplitToList(Row.RepoPatterns)),
    });
  }

  return { clients: Clients };
}

/**
 * Persist a workspace's client overlay and bust the cache so the next lookup picks it up (#396).
 * @param {string} ArgWorkspaceName
 * @param {{ clients: Array<any> }} ArgOverlay
 * @returns {string} The written overlay file path.
 */
function WriteClientOverlaySync(ArgWorkspaceName, ArgOverlay) {
  if(!ArgWorkspaceName || typeof ArgWorkspaceName !== 'string') {
    throw new Error('WriteClientOverlaySync requires a workspace name');
  }
  fs.mkdirSync(OverlayDirPath, { recursive: true });
  const OverlayPath = path.join(OverlayDirPath, `${ArgWorkspaceName}.json`);
  fs.writeFileSync(OverlayPath, `${JSON.stringify(ArgOverlay, null, 2)}\n`, 'utf8');
  ReloadClientMappings(ArgWorkspaceName);
  return OverlayPath;
}

/**
 * Read the optional `ClientsList` config block from static config: the Slack List id and the
 * logical-column → Slack `column_id` map the refresh command needs (Slack has no fetch-by-name).
 * Returns null when unconfigured. An env `SLEUTH_CLIENTS_LIST_ID` overrides the file's ListId.
 * @returns {{ ListId: string, Columns: Record<string, string> }|null}
 */
function LoadClientsListConfigSync() {
  let Block = null;
  try {
    const Raw = fs.readFileSync(ConfigPath, 'utf8');
    const Parsed = JSON.parse(Raw);
    if(Parsed && typeof Parsed.ClientsList === 'object' && Parsed.ClientsList) Block = Parsed.ClientsList;
  } catch(error) {
    Block = null;
  }

  const ListId = (process.env.SLEUTH_CLIENTS_LIST_ID || '').trim() || (Block && typeof Block.ListId === 'string' ? Block.ListId.trim() : '');
  if(!ListId) return null;

  const Columns = Block && Block.Columns && typeof Block.Columns === 'object' ? Block.Columns : {};
  return { ListId, Columns };
}

module.exports = {
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
};
