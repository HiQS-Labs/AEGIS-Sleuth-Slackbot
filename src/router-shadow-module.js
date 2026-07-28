'use strict';

/**
 * GH-397 — Router mode: Gemini Flash Lite shadow corpus + operator off/shadow/active toggle.
 *
 * Per-workspace runtime state (one instance per ChatModule, so `#Mode` is per-workspace and never
 * a `global.*` singleton — respects the #387 isolation guard). Three states:
 *   - `off`    — nothing runs.
 *   - `shadow` — Flash Lite resolves alongside the current router and a corpus record is logged;
 *                ZERO authority. The current resolver is unaffected.
 *   - `active` — Flash Lite takes over resolution above a confidence threshold and executes the
 *                resolved command (FULL takeover — any canonical command, incl. Risk-tagged ones,
 *                per the operator decision 2026-07-16); below threshold it declines so the caller
 *                falls back to the current resolver. A corpus record is logged either way.
 *
 * Everything here is best-effort and must never throw into the hot path: a Flash Lite outage or a
 * corpus-write failure degrades to "logged the error and did nothing" — production behavior in
 * `off`/`shadow` is untouched, and `active` falls back to the normal resolver.
 *
 * PERSISTENCE (GH-397): the mode is otherwise in-memory and resets to the built-in default (`off`)
 * on every restart. `ROUTER_SHADOW_DEFAULT_MODE` (off|shadow|active) overrides that startup default
 * so an operator can make e.g. production `shadow` STICKY across redeploys without re-issuing the
 * admin Slack command each time. The admin `router-mode` command still overrides the env at runtime;
 * on the next restart the env default is re-applied. An invalid env value is warned + ignored (→ off).
 */

/** @type {ReadonlyArray<'off'|'shadow'|'active'>} */
const VALID_ROUTER_MODES = ['off', 'shadow', 'active'];

/** Env var whose value seeds `#Mode` at construction (startup), making the mode sticky across restarts. */
const DEFAULT_MODE_ENV = 'ROUTER_SHADOW_DEFAULT_MODE';

/** Built-in fallback when `ROUTER_SHADOW_DEFAULT_MODE` is unset or invalid. */
const BUILTIN_DEFAULT_MODE = 'off';

/**
 * Default preferred first-responder model (overridable per-deploy via ROUTER_SHADOW_MODEL).
 * Pinned to the STABLE `gemini-3.1-flash-lite` rather than the floating `gemini-flash-lite-latest`
 * alias so the router's behavior is reproducible and a silent upstream alias roll can't change
 * routing/cost under us — bump this constant deliberately to adopt a newer flash-lite.
 */
const DEFAULT_SHADOW_MODEL = 'gemini-3.1-flash-lite';

/** Default minimum confidence for active-mode execution (overridable via ROUTER_ACTIVE_CONFIDENCE_MIN). */
const DEFAULT_ACTIVE_CONFIDENCE_MIN = 0.7;

// Versions stamped onto each corpus record so an offline replay can bucket by prompt/schema.
const PROMPT_VERSION = 'rmm-v1';
const SCHEMA_VERSION = 'rmm-schema-v1';

/**
 * @typedef {Object} RouterShadowCandidate
 * @property {string} model
 * @property {string|null} intentId
 * @property {string|null} canonicalCommand
 * @property {number|null} confidence
 * @property {boolean} needsClarification
 * @property {number} latencyMs
 * @property {string|null} error
 */

/**
 * @typedef {Object} RouterShadowStoreLike
 * @property {(ArgWorkspace: string, ArgRecord: object) => Promise<{ ok: boolean, error?: Error }>} append
 */

/**
 * @typedef {Object} RouterShadowModuleOptions
 * @property {string} WorkspaceName
 * @property {{ info: Function, warn: Function, error: Function }} [Logger]
 * @property {RouterShadowStoreLike} Store
 * @property {(ArgText: string, ArgOptions: object) => Promise<any>} ResolveIntentAsync
 *   Bound RMM resolver — `(text, opts) => ResolveRmmIntentAsync(WorkspaceAI, text, opts)`.
 */

class RouterShadowModule {
  /** @type {string} */
  #WorkspaceName;
  /** @type {{ info: Function, warn: Function, error: Function }} */
  #Logger;
  /** @type {RouterShadowStoreLike} */
  #Store;
  /** @type {(ArgText: string, ArgOptions: object) => Promise<any>} */
  #ResolveIntentAsync;
  /** @type {'off'|'shadow'|'active'} */
  #Mode = BUILTIN_DEFAULT_MODE;

  /**
   * @param {RouterShadowModuleOptions} ArgOptions
   */
  constructor(ArgOptions) {
    this.#WorkspaceName = ArgOptions.WorkspaceName;
    this.#Logger = ArgOptions.Logger || { info() {}, warn() {}, error() {} };
    this.#Store = ArgOptions.Store;
    this.#ResolveIntentAsync = ArgOptions.ResolveIntentAsync;
    // Seed the startup mode from the persistent env default (GH-397). Logger is set above, so an
    // invalid value can be warned here rather than silently coerced.
    this.#Mode = this.#ResolveStartupMode();
  }

  /**
   * Resolve the startup mode from `ROUTER_SHADOW_DEFAULT_MODE`. Unset → built-in default (`off`).
   * A present-but-invalid value is warned and falls back to the built-in default (fail-safe: never
   * arm on a typo). Non-`off` startup is logged at info so an operator can see the sticky default
   * took effect in the boot logs.
   * @returns {'off'|'shadow'|'active'}
   */
  #ResolveStartupMode() {
    const Raw = (process.env[DEFAULT_MODE_ENV] || '').trim().toLowerCase();
    if(!Raw) return BUILTIN_DEFAULT_MODE;
    if(!VALID_ROUTER_MODES.includes(/** @type {any} */ (Raw))) {
      this.#Logger.warn(
        `router-shadow: ignoring invalid ${DEFAULT_MODE_ENV}="${process.env[DEFAULT_MODE_ENV]}" `
        + `(valid: ${VALID_ROUTER_MODES.join('|')}); defaulting to ${BUILTIN_DEFAULT_MODE}`
      );
      return BUILTIN_DEFAULT_MODE;
    }
    if(Raw !== BUILTIN_DEFAULT_MODE) {
      this.#Logger.info(`router-shadow[${this.#WorkspaceName}]: startup mode "${Raw}" from ${DEFAULT_MODE_ENV}`);
    }
    return /** @type {'off'|'shadow'|'active'} */ (Raw);
  }

  /**
   * @param {*} ArgMode
   * @returns {boolean}
   */
  static IsValidMode(ArgMode) {
    return VALID_ROUTER_MODES.includes(/** @type {any} */ (String(ArgMode == null ? '' : ArgMode).trim().toLowerCase()));
  }

  /** @returns {Array<'off'|'shadow'|'active'>} */
  static get ValidModes() {
    return [...VALID_ROUTER_MODES];
  }

  /** @returns {'off'|'shadow'|'active'} */
  GetMode() {
    return this.#Mode;
  }

  /**
   * @param {string} ArgMode
   * @returns {'off'|'shadow'|'active'}
   */
  SetMode(ArgMode) {
    const Mode = String(ArgMode == null ? '' : ArgMode).trim().toLowerCase();
    if(!VALID_ROUTER_MODES.includes(/** @type {any} */ (Mode))) {
      throw new Error(`invalid router mode: ${ArgMode}`);
    }
    this.#Mode = /** @type {'off'|'shadow'|'active'} */ (Mode);
    return this.#Mode;
  }

  /**
   * Whether THIS workspace is permitted to arm shadow/active. An optional comma-separated
   * `ROUTER_SHADOW_WORKSPACES` env allowlist restricts collection (privacy guard for the
   * rawText capture); when unset, any workspace may arm (the admin-only command still gates
   * WHO can toggle). Mirrors the SNAPSHOT_RELAY_WORKSPACES pattern.
   * @returns {boolean}
   */
  IsWorkspaceAllowed() {
    const Raw = (process.env.ROUTER_SHADOW_WORKSPACES || '').trim();
    if(!Raw) return true;
    const Allow = Raw.split(',').map((ArgName) => ArgName.trim()).filter(Boolean);
    return Allow.includes(this.#WorkspaceName);
  }

  /** @returns {boolean} True when the mode is non-off AND this workspace may arm. */
  IsArmed() {
    return this.#Mode !== 'off' && this.IsWorkspaceAllowed();
  }

  /** @returns {string} */
  #ModelName() {
    const Model = (process.env.ROUTER_SHADOW_MODEL || '').trim();
    return Model || DEFAULT_SHADOW_MODEL;
  }

  /** @returns {string} The effective first-responder model id in effect (ROUTER_SHADOW_MODEL env override, else the default). */
  EffectiveModelName() {
    return this.#ModelName();
  }

  /** @returns {number} */
  #ConfidenceMin() {
    const Value = Number(process.env.ROUTER_ACTIVE_CONFIDENCE_MIN);
    return Number.isFinite(Value) && Value >= 0 && Value <= 1 ? Value : DEFAULT_ACTIVE_CONFIDENCE_MIN;
  }

  /** @returns {number} The active-mode confidence floor currently in effect. */
  ActiveConfidenceMin() {
    return this.#ConfidenceMin();
  }

  /**
   * Resolve the shadow candidate with the Flash Lite model. NEVER throws — on error it returns a
   * candidate with `error` set and everything else null, so callers treat it as "declined".
   * @param {string} ArgRawText
   * @param {string} [ArgChannelId]
   * @returns {Promise<RouterShadowCandidate>}
   */
  async ResolveCandidateAsync(ArgRawText, ArgChannelId) {
    const Model = this.#ModelName();
    const StartedAt = Date.now();
    try {
      const Resolution = await this.#ResolveIntentAsync(ArgRawText, {
        ChannelID: ArgChannelId,
        ModelNameOverride: Model,
      });
      return {
        model: Model,
        intentId: Resolution && Resolution.IntentId ? Resolution.IntentId : null,
        canonicalCommand: Resolution && Resolution.CanonicalCommand ? Resolution.CanonicalCommand : null,
        confidence: Resolution && typeof Resolution.Confidence === 'number' ? Resolution.Confidence : null,
        needsClarification: !!(Resolution && Resolution.NeedsClarification),
        latencyMs: Date.now() - StartedAt,
        error: null,
      };
    } catch(error) {
      return {
        model: Model,
        intentId: null,
        canonicalCommand: null,
        confidence: null,
        needsClarification: false,
        latencyMs: Date.now() - StartedAt,
        error: (error && /** @type {Error} */ (error).message) ? /** @type {Error} */ (error).message : String(error),
      };
    }
  }

  /**
   * Whether, in active mode, a resolved candidate should be executed (full takeover): it must have
   * resolved cleanly to a runnable canonical command with confidence at/above the floor.
   * @param {RouterShadowCandidate|null|undefined} ArgCandidate
   * @returns {boolean}
   */
  ShouldExecute(ArgCandidate) {
    return !!(
      ArgCandidate
      && !ArgCandidate.error
      && !ArgCandidate.needsClarification
      && ArgCandidate.canonicalCommand
      && typeof ArgCandidate.confidence === 'number'
      && ArgCandidate.confidence >= this.#ConfidenceMin()
    );
  }

  /**
   * Assemble + append one corpus record. Best-effort; never throws.
   * @param {{
   *   mode: 'shadow'|'active',
   *   channelId?: string,
   *   rawText: string,
   *   routerOutcome: 'matched'|'unmatched',
   *   matchedRoute?: string|null,
   *   candidate?: RouterShadowCandidate|null,
   *   executed?: boolean|null
   * }} ArgFields
   * @returns {Promise<{ ok: boolean, error?: Error }>}
   */
  async AppendRecordAsync(ArgFields) {
    try {
      const Record = {
        mode: ArgFields.mode,
        channelId: ArgFields.channelId || null,
        rawText: ArgFields.rawText || '',
        routerOutcome: ArgFields.routerOutcome,
        matchedRoute: ArgFields.matchedRoute || null,
        candidate: ArgFields.candidate || null,
        executed: typeof ArgFields.executed === 'boolean' ? ArgFields.executed : null,
        promptVersion: PROMPT_VERSION,
        schemaVersion: SCHEMA_VERSION,
      };
      const Result = await this.#Store.append(this.#WorkspaceName, Record);
      if(!Result.ok) {
        this.#Logger.warn(`router-shadow append failed: ${Result.error && Result.error.message ? Result.error.message : Result.error}`);
      }
      return Result;
    } catch(error) {
      this.#Logger.warn(`router-shadow append threw: ${error && /** @type {Error} */ (error).message ? /** @type {Error} */ (error).message : error}`);
      return { ok: false, error: /** @type {Error} */ (error) };
    }
  }

  /**
   * SHADOW mode: resolve with Flash Lite and log a corpus record. ZERO authority. Intended to be
   * called fire-and-forget by the hot path.
   * @param {{ rawText: string, channelId?: string, routerOutcome: 'matched'|'unmatched', matchedRoute?: string|null }} ArgFields
   * @returns {Promise<{ ok: boolean, error?: Error }>}
   */
  async LogShadowAsync(ArgFields) {
    const Candidate = await this.ResolveCandidateAsync(ArgFields.rawText, ArgFields.channelId);
    return this.AppendRecordAsync({
      mode: 'shadow',
      channelId: ArgFields.channelId,
      rawText: ArgFields.rawText,
      routerOutcome: ArgFields.routerOutcome,
      matchedRoute: ArgFields.matchedRoute,
      candidate: Candidate,
      executed: null,
    });
  }
}

module.exports = {
  RouterShadowModule,
  VALID_ROUTER_MODES,
  DEFAULT_SHADOW_MODEL,
  DEFAULT_ACTIVE_CONFIDENCE_MIN,
  DEFAULT_MODE_ENV,
  BUILTIN_DEFAULT_MODE,
};
