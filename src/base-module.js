'use strict';

const { CommandRouter } = require('./chat-command-router');

/**
 * BaseModule — the first-class per-workspace feature-module primitive.
 *
 * One Node process runs every workspace at once, so the single invariant every feature module must
 * uphold is **tenant isolation**: a module instance belongs to exactly ONE workspace and may only
 * ever touch that workspace's `SlackApp`. #384 happened because a route resolved its `SlackApp` from
 * a process-global registry that always returned the first-loaded workspace — every tenant answered
 * from someone else's data with the wrong bot. This base class removes the temptation: it makes the
 * owning `SlackApp` mandatory at construction and exposes everything a module needs (logger,
 * workspace info, command router) *through that one instance*, so there is never a reason to reach
 * for a global.
 *
 * Contract for subclasses (mirrors the proven `ChatModule`/`RemindersModule`/... convention):
 *   1. Constructor takes the per-workspace `SlackApp` as its first arg and calls `super(ArgSlackApp)`.
 *      Do disk I/O in `StartAsync`, not the constructor — construction stays synchronous.
 *   2. Read logger / workspace via `this.Logger`, `this.WorkspaceInfo`, `this.WorkspaceName` — never
 *      a `global.*` or module-level singleton keyed on anything shared across workspaces.
 *   3. Register Slack event handlers with `this.RegisterAppMention/Message/Action/ReactionAdded(...)`
 *      (they `.bind(this)` for you) so every handler closes over `this` → `this.SlackApp`.
 *   4. If the module has chat commands, override `RegisterCommandRoutes(ArgRouter)` and register each
 *      route with a `Handle` closure that reaches `this.SlackApp`. Call `this.RegisterCommandRoutes()`
 *      at the END of your constructor, after your own dependencies are wired (JS runs subclass field
 *      initializers only after `super()` returns, so the base cannot safely auto-call it for you).
 *   5. Override `StartAsync()` (deferred load + late handler wiring) and `StopAsync()` (persist +
 *      clear timers; keep it idempotent and safe to call during best-effort shutdown).
 *
 * `#private` fields are not visible to subclasses, so the owning `SlackApp` and router are exposed as
 * getters — that is deliberate: it is the supported way for a subclass to reach its workspace, and it
 * keeps the "one SlackApp per module" contract enforceable.
 *
 * See AGENTS.md §0.1 / §0.1.1 and docs/module-primitive.md for the full contract and a worked example.
 */
class BaseModule {
  /** @type {import('./slack-app')} */
  #SlackApp;

  /** @type {CommandRouter} */
  #CommandRouter;

  /**
   * @param {import('./slack-app')} ArgSlackApp The per-workspace SlackApp this module binds to.
   *   Required — a module with no workspace is a tenant-isolation bug waiting to happen.
   */
  constructor(ArgSlackApp) {
    if(!ArgSlackApp) {
      throw new Error(
        'BaseModule: ArgSlackApp is required. Every module binds to exactly one workspace SlackApp; ' +
        'resolving it later from a global is the #384 multi-tenant isolation bug.'
      );
    }
    // WORKSPACE_NAME keys every per-workspace disk path. A module built with a nameless workspace would
    // read/write shared `data/runtime/workspaces/undefined_*` files — a silent cross-tenant leak, the
    // same isolation failure #384 was. It is a required, regex-validated field on load
    // (src/workspaces.js), so assert it here too rather than trusting the caller.
    const WorkspaceName = ArgSlackApp.WorkspaceInfo?.WORKSPACE_NAME;
    if(typeof WorkspaceName !== 'string' || WorkspaceName === '') {
      throw new Error(
        'BaseModule: ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME must be a non-empty string — a module ' +
        'without a workspace name would collide on shared per-tenant paths (data/runtime/.../undefined_*).'
      );
    }
    this.#SlackApp = ArgSlackApp;
    this.#CommandRouter = new CommandRouter();
  }

  /**
   * The per-workspace SlackApp this module was constructed with. All Slack access — posting,
   * privacy checks, workspace info, logger — goes through this instance.
   * @returns {import('./slack-app')}
   */
  get SlackApp() {
    return this.#SlackApp;
  }

  /**
   * This workspace's logger (shared process logger, reached via SlackApp so modules never hold a
   * raw logger reference that could drift from the workspace).
   * @returns {{ info: Function, warn: Function, error: Function }}
   */
  get Logger() {
    return this.#SlackApp.Logger;
  }

  /**
   * This workspace's info record.
   * @returns {import('./workspaces').WorkspaceInfo}
   */
  get WorkspaceInfo() {
    return this.#SlackApp.WorkspaceInfo;
  }

  /**
   * This workspace's name (used for per-workspace file paths). Undefined only if WorkspaceInfo is.
   * @returns {string|undefined}
   */
  get WorkspaceName() {
    return this.#SlackApp.WorkspaceInfo?.WORKSPACE_NAME;
  }

  /**
   * The command router this module owns. Register routes via `RegisterCommandRoutes(ArgRouter)`.
   * @returns {CommandRouter}
   */
  get CommandRouter() {
    return this.#CommandRouter;
  }

  /**
   * Snapshot of the routes registered on this module — used by validation tooling to prove every
   * command binds through a per-workspace module instance (never an external global). Named to match
   * the existing `GetRegisteredCommandRoutes()` method that `scripts/validate-command-catalog.js`
   * already calls on ChatModule/Reminders, so a module migrated onto this base keeps working with the
   * catalog validator unchanged.
   * @returns {import('./chat-command-router').CommandRoute[]}
   */
  GetRegisteredCommandRoutes() {
    return this.#CommandRouter.GetRoutes();
  }

  /**
   * Override to register this module's chat command routes on the owned router (`this.CommandRouter`).
   * Each `Handle` closure MUST reach `this.SlackApp` (never a global). Call `this.RegisterCommandRoutes()`
   * from your constructor once dependencies are wired. Parameterless on purpose — reach the router via
   * `this.CommandRouter` (an overriding subclass wouldn't inherit a default parameter anyway). Default:
   * no routes.
   */
  RegisterCommandRoutes() {
    // No routes by default; ChatModule-style subclasses override this.
  }

  /**
   * Deferred startup: disk loads and any handler wiring that must land in a specific order relative
   * to other modules. Override; default no-op. Constructors stay synchronous, so put I/O here.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    // No-op by default.
  }

  /**
   * Graceful shutdown: persist state, clear timers. Must be idempotent and safe to call even when
   * StartAsync partially ran — the orchestrator calls this best-effort during shutdown. Override;
   * default no-op.
   * @returns {Promise<void>}
   */
  async StopAsync() {
    // No-op by default.
  }

  /**
   * Register an app_mention handler bound to this module. Returns `true` from the handler only when
   * it handled the mention; `false` lets downstream handlers run.
   * @param {(ArgEventInfo: *) => (boolean|Promise<boolean>)} ArgHandler
   */
  RegisterAppMention(ArgHandler) {
    this.#SlackApp.HandleAppMention(ArgHandler.bind(this));
  }

  /**
   * Register a message handler bound to this module (return `true` when handled).
   * @param {(ArgEventInfo: *) => (boolean|Promise<boolean>)} ArgHandler
   */
  RegisterMessage(ArgHandler) {
    this.#SlackApp.HandleMessage(ArgHandler.bind(this));
  }

  /**
   * Register a block-action handler bound to this module.
   * @param {string} ArgActionId Slack action_id to match.
   * @param {(ArgEventInfo: *) => (boolean|Promise<boolean>)} ArgHandler
   */
  RegisterAction(ArgActionId, ArgHandler) {
    this.#SlackApp.HandleAction(ArgActionId, ArgHandler.bind(this));
  }

  /**
   * Register a reaction_added handler bound to this module (return `true` when handled).
   * @param {(ArgEventInfo: *) => (boolean|Promise<boolean>)} ArgHandler
   */
  RegisterReactionAdded(ArgHandler) {
    this.#SlackApp.HandleReactionAdded(ArgHandler.bind(this));
  }
}

module.exports = { BaseModule };
