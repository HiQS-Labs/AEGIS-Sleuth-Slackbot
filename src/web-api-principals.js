// Bot principals for the Web API (GH-301 Phase 1).
//
// A principal is a revocable, workspace-scoped credential for an external bot. The operator keeps one
// file, <data dir>/web-api-principals.json, holding only the SHA-256 of each token plus its grants. The file
// is re-read on every request, so revoking, expiring or removing an entry takes effect on the next call,
// with no restart. Everything fails closed: a missing, unreadable or malformed file, or a malformed entry,
// admits nobody. See docs/web-api.md → "Bot principals (GH-301)".
const crypto = require('crypto');
const fs = require('fs').promises;
const net = require('net');
const path = require('path');
const workspaces = require('./workspaces');

const PrincipalIdPattern = /^[a-z0-9-]{1,32}$/;
// id has no underscore, so the first `_` after `slp_<id>` ends it; the secret is 32 random bytes in base64url.
const TokenPattern = /^slp_([a-z0-9-]{1,32})_([A-Za-z0-9_-]{43})$/;
const Sha256HexPattern = /^[0-9a-f]{64}$/;
const WorkspaceNamePattern = /^[A-Za-z0-9_-]{1,64}$/;
const KnownScopes = ['reminders:read', 'reminders:write'];

// the only two routes a principal may reach, matched exactly on the raw path (Express routing itself is
// case-insensitive and tolerates a trailing slash; this is not). HEAD is not GET here.
const PrincipalRoutes = [
  { Method: 'GET', Pattern: /^\/workspace\/([A-Za-z0-9_-]{1,64})\/reminders$/, Route: 'reminders', Scope: 'reminders:read' },
  { Method: 'POST', Pattern: /^\/workspace\/([A-Za-z0-9_-]{1,64})\/reminders\/bulk$/, Route: 'bulk', Scope: 'reminders:write' },
];

/** @returns {string} Absolute path of the principals file. */
function PrincipalsFilePath() {
  return path.join(workspaces.GetRuntimeDirPath(), 'web-api-principals.json');
}

/** @param {string} ArgToken @returns {string} Lowercase hex SHA-256 of the token. */
function HashToken(ArgToken) {
  return crypto.createHash('sha256').update(ArgToken, 'utf8').digest('hex');
}

/**
 * Make a new token for a principal id (used by scripts/web-api-principal.js).
 * @param {string} ArgId Principal id.
 * @returns {string}
 */
function MakeToken(ArgId) {
  if(!PrincipalIdPattern.test(ArgId)) throw new Error('principal id must match [a-z0-9-]{1,32}');
  return `slp_${ArgId}_${crypto.randomBytes(32).toString('base64url')}`;
}

/**
 * Validate one file entry. Returns a reason string when the entry is unusable, else null.
 * @param {any} ArgEntry
 * @returns {string|null}
 */
function EntryProblem(ArgEntry) {
  if(!ArgEntry || typeof ArgEntry !== 'object' || Array.isArray(ArgEntry)) return 'not an object';
  if(typeof ArgEntry.id !== 'string' || !PrincipalIdPattern.test(ArgEntry.id)) return 'bad id';
  if(typeof ArgEntry.sha256 !== 'string' || !Sha256HexPattern.test(ArgEntry.sha256)) return 'bad sha256';
  if(!Array.isArray(ArgEntry.workspaces) || ArgEntry.workspaces.length === 0
    || !ArgEntry.workspaces.every((/** @type {any} */ ArgName) => typeof ArgName === 'string' && WorkspaceNamePattern.test(ArgName))) return 'bad workspaces';
  if(!Array.isArray(ArgEntry.scopes) || ArgEntry.scopes.length === 0
    || !ArgEntry.scopes.every((/** @type {any} */ ArgScope) => KnownScopes.includes(ArgScope))) return 'bad scopes';
  if(ArgEntry.expiresAt !== undefined && (typeof ArgEntry.expiresAt !== 'string' || isNaN(Date.parse(ArgEntry.expiresAt)))) return 'bad expiresAt';
  if(ArgEntry.revoked !== undefined && typeof ArgEntry.revoked !== 'boolean') return 'bad revoked';
  return null;
}

/**
 * Read and validate the principals file. Invalid entries (and every entry sharing a duplicated id) are
 * dropped with a warning that names only the array index and the rule.
 * @param {string} ArgFilePath
 * @returns {Promise<Map<string, any>>} Valid entries by id; empty when the file is missing or unusable.
 */
async function LoadPrincipalsAsync(ArgFilePath) {
  /** @type {Map<string, any>} */
  const Valid = new Map();
  let Raw;
  try {
    Raw = JSON.parse(await fs.readFile(ArgFilePath, 'utf8'));
  } catch(error) {
    if(error?.code !== 'ENOENT') console.warn('[web-api] principals file unreadable or not JSON; admitting no principals');
    return Valid;
  }
  if(!Array.isArray(Raw)) {
    console.warn('[web-api] principals file is not an array; admitting no principals');
    return Valid;
  }
  /** @type {Map<string, number>} */
  const IdCounts = new Map();
  for(const Entry of Raw) {
    if(typeof Entry?.id === 'string') IdCounts.set(Entry.id, (IdCounts.get(Entry.id) || 0) + 1);
  }
  Raw.forEach((ArgEntry, ArgIndex) => {
    const Problem = EntryProblem(ArgEntry) ?? (IdCounts.get(ArgEntry.id) > 1 ? 'duplicate id' : null);
    if(Problem) {
      console.warn(`[web-api] principals entry [${ArgIndex}] ignored: ${Problem}`);
      return;
    }
    Valid.set(ArgEntry.id, ArgEntry);
  });
  return Valid;
}

/**
 * Authenticate a `slp_` bearer token against the principals file.
 * @param {string} ArgToken Bearer token.
 * @param {{ FilePath?: string, Now?: number }} [ArgOptions]
 * @returns {Promise<{ok: true, principal: {Id: string, Workspaces: string[], Scopes: string[]}} | {ok: false, code: string, id: string|null}>}
 */
async function AuthenticatePrincipalAsync(ArgToken, ArgOptions = {}) {
  const Match = typeof ArgToken === 'string' ? TokenPattern.exec(ArgToken) : null;
  if(!Match) return { ok: false, code: 'invalid', id: null };
  const Id = Match[1];
  try {
    const Principals = await LoadPrincipalsAsync(ArgOptions.FilePath ?? PrincipalsFilePath());
    const Entry = Principals.get(Id);
    if(!Entry) return { ok: false, code: 'unknown', id: Id };
    const Expected = Buffer.from(Entry.sha256, 'hex');
    const Actual = Buffer.from(HashToken(ArgToken), 'hex');
    if(Expected.length !== 32 || Actual.length !== 32 || !crypto.timingSafeEqual(Expected, Actual))
      return { ok: false, code: 'invalid', id: Id };
    if(Entry.revoked === true) return { ok: false, code: 'revoked', id: Id };
    if(Entry.expiresAt !== undefined && Date.parse(Entry.expiresAt) <= (ArgOptions.Now ?? Date.now()))
      return { ok: false, code: 'expired', id: Id };
    return { ok: true, principal: { Id, Workspaces: [...Entry.workspaces], Scopes: [...Entry.scopes] } };
  } catch {
    return { ok: false, code: 'unavailable', id: Id };
  }
}

/**
 * True for a loopback TCP peer: 127.0.0.0/8, ::1, or IPv4-mapped 127.0.0.0/8. Exact checks, no prefixes.
 * @param {string|undefined} ArgAddress `req.socket.remoteAddress`.
 * @returns {boolean}
 */
function IsLoopbackAddress(ArgAddress) {
  if(typeof ArgAddress !== 'string' || net.isIP(ArgAddress) === 0) return false;
  if(ArgAddress === '::1') return true;
  const V4 = ArgAddress.startsWith('::ffff:') ? ArgAddress.slice('::ffff:'.length) : ArgAddress;
  return net.isIPv4(V4) && V4.split('.')[0] === '127';
}

/**
 * Match a request against the principal route allowlist.
 * @param {string} ArgMethod HTTP method.
 * @param {string} ArgPath Raw request path (`req.path`).
 * @returns {{Route: string, Scope: string, Workspace: string}|null}
 */
function MatchPrincipalRoute(ArgMethod, ArgPath) {
  for(const Entry of PrincipalRoutes) {
    if(ArgMethod !== Entry.Method) continue;
    const Match = Entry.Pattern.exec(ArgPath);
    if(Match) return { Route: Entry.Route, Scope: Entry.Scope, Workspace: Match[1] };
  }
  return null;
}

/**
 * In-memory idempotency for principal writes. A key is reserved synchronously before any await, so two
 * overlapping requests with the same key run the work once; a different body under a held key conflicts
 * at once. Completed entries live 24 h; the cap evicts the oldest completed entries only (an in-flight entry
 * is never evicted). A throw, or a result the caller says not to keep, frees the key for a retry. Restart
 * empties the store.
 */
class IdempotencyStore {
  /** @type {Map<string, {Fingerprint: string, Promise: Promise<any>, DoneAt: number|null}>} */
  #Entries = new Map();
  #TtlMs;
  #Cap;

  /** @param {{ TtlMs?: number, Cap?: number }} [ArgOptions] */
  constructor(ArgOptions = {}) {
    this.#TtlMs = ArgOptions.TtlMs ?? 24 * 60 * 60 * 1000;
    this.#Cap = ArgOptions.Cap ?? 1000;
  }

  /**
   * Reserve a key and run the work, or join the run already holding it.
   * @param {string} ArgKey Unambiguous key, e.g. JSON.stringify([principal, workspace, idempotency key]).
   * @param {string} ArgFingerprint Hash of the request body.
   * @param {() => Promise<any>} ArgWork The work; its resolved value is the response.
   * @param {(ArgResult: any) => boolean} ArgKeep Whether a result may be replayed.
   * @returns {{conflict: true} | {conflict: false, replayed: boolean, promise: Promise<any>}}
   */
  Reserve(ArgKey, ArgFingerprint, ArgWork, ArgKeep) {
    this.#Expire(Date.now());
    // look the key up before any capacity eviction: a retry of a held key must replay or conflict, never run again.
    const Held = this.#Entries.get(ArgKey);
    if(Held) {
      if(Held.Fingerprint !== ArgFingerprint) return { conflict: true };
      return { conflict: false, replayed: true, promise: Held.Promise };
    }
    this.#MakeRoom();
    /** @type {{Fingerprint: string, Promise: Promise<any>, DoneAt: number|null}} */
    const Entry = { Fingerprint: ArgFingerprint, Promise: Promise.resolve(), DoneAt: null };
    // set before the work starts: the synchronous part of this method is the reservation.
    this.#Entries.set(ArgKey, Entry);
    Entry.Promise = Promise.resolve().then(ArgWork).then(ArgResult => {
      if(ArgKeep(ArgResult)) Entry.DoneAt = Date.now();
      else this.#Entries.delete(ArgKey);
      return ArgResult;
    }, ArgError => {
      this.#Entries.delete(ArgKey);
      throw ArgError;
    });
    return { conflict: false, replayed: false, promise: Entry.Promise };
  }

  /** Drop completed entries older than the TTL. @param {number} ArgNow */
  #Expire(ArgNow) {
    for(const [Key, Entry] of this.#Entries) {
      if(Entry.DoneAt !== null && ArgNow - Entry.DoneAt > this.#TtlMs) this.#Entries.delete(Key);
    }
  }

  /** Before admitting a new key at the cap, evict the oldest completed entries (never an in-flight one). */
  #MakeRoom() {
    if(this.#Entries.size < this.#Cap) return;
    for(const [Key, Entry] of this.#Entries) {
      if(this.#Entries.size < this.#Cap) break;
      if(Entry.DoneAt !== null) this.#Entries.delete(Key);
    }
  }

  /** @returns {number} Entries held (for tests). */
  get Size() {
    return this.#Entries.size;
  }
}

module.exports = {
  AuthenticatePrincipalAsync,
  HashToken,
  IdempotencyStore,
  IsLoopbackAddress,
  MakeToken,
  MatchPrincipalRoute,
  PrincipalsFilePath,
  KnownScopes,
};
