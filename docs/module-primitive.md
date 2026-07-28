# Module Primitive (`BaseModule`)

`src/base-module.js` is the first-class per-workspace feature-module primitive. It codifies the
convention that `ChatModule`, `RemindersModule`, `ListsModule`, `NotionModule`, and `StatsModule`
already follow by hand, and makes the one non-negotiable invariant — **tenant isolation** —
structural instead of aspirational.

## Why it exists

One Node process runs every workspace at once (`app.js` loops over workspaces, constructing one set
of modules per workspace). A module instance therefore belongs to **exactly one** workspace and may
only ever touch that workspace's `SlackApp`.

Issue #384 broke this: `ask-reminders` resolved
its `SlackApp` from a process-global registry (`global.__sleuthaskreminders__`) that always returned
the **first-loaded** workspace. Every other workspace answered from OCUX's data with OCUX's bot →
`channel_not_found` → silent failure. The fix passed the per-workspace `SlackApp` in explicitly.
`BaseModule` removes the temptation that caused it: the owning `SlackApp` is mandatory at
construction and everything a module needs is reached *through it*, so there is never a reason to
reach for a global.

## The contract

```js
const { BaseModule } = require('./base-module');

class MyModule extends BaseModule {
  #Store;

  constructor(ArgSlackApp) {
    super(ArgSlackApp);                 // 1. per-workspace SlackApp is mandatory
    this.#Store = new Store(this.WorkspaceName);   // read workspace via getters, not globals
    this.RegisterAppMention(this.#OnAppMentionAsync);   // 3. helpers .bind(this) for you
    this.RegisterCommandRoutes();       // 4. call AFTER your deps are wired
  }

  RegisterCommandRoutes() {
    this.CommandRouter.Register({
      Pattern: /^my-command\b[\s,:;.!?]+(.+)/is,
      Route: 'my-command',
      // The anti-#384 discipline: Handle closes over this.SlackApp — never a global.
      Handle: (ArgEventInfo, ArgText) =>
        HandleMyCommandAsync(this.SlackApp, ArgEventInfo, ArgText.trim()),
    });
  }

  async StartAsync() { await this.#Store.LoadAsync(); }   // 5. disk I/O here, not the constructor
  async StopAsync()  { await this.#Store.SaveAsync(); }   //    idempotent, best-effort
}
```

### What the base gives you

| Member | Purpose |
| --- | --- |
| `super(ArgSlackApp)` | Mandatory — throws if no `SlackApp`, or if its `WORKSPACE_NAME` is empty (a nameless workspace would collide on shared per-tenant paths). Binds the module to one workspace. |
| `this.SlackApp` | The per-workspace SlackApp. All Slack access goes through it. |
| `this.Logger` | Workspace logger (via SlackApp — modules never hold a raw logger ref). |
| `this.WorkspaceInfo` / `this.WorkspaceName` | This workspace's record / name (for per-workspace file paths). |
| `this.CommandRouter` | The owned router — register routes on it. |
| `GetRegisteredCommandRoutes()` | Route snapshot for the catalog validator (same method name legacy modules expose). |
| `RegisterAppMention/Message/Action/ReactionAdded(fn)` | Register Slack handlers, `.bind(this)` applied. |
| `RegisterCommandRoutes()` | Override to declare chat commands (reach the router via `this.CommandRouter`). Call it yourself from the constructor. |
| `StartAsync()` / `StopAsync()` | Lifecycle hooks (default no-op). |

### Rules (also in AGENTS.md §0.1 / §0.1.1)

1. **First constructor arg is the `SlackApp`; call `super(ArgSlackApp)`.** No `SlackApp` → no module.
2. **Reach workspace state only through the getters.** Never a `global.*` or a module-level
   singleton keyed on anything shared across workspaces (logger, team id). That is the #384 bug.
3. **Constructors stay synchronous.** Disk I/O goes in `StartAsync`.
4. **Call `this.RegisterCommandRoutes()` at the end of your constructor**, after your dependencies
   exist. JS runs subclass field initializers only after `super()` returns, so the base cannot
   safely auto-call it — doing so would see `undefined` fields.
5. **Every route `Handle` closes over `this.SlackApp`.** Do not register a primary route from
   outside its owning module, and do not fetch the `SlackApp` from anywhere but the closure.

## Why getters, not inheritable fields

`#private` fields are not visible to subclasses, so a subclass literally cannot read a base class's
`#SlackApp`. Exposing the app and router as getters is the supported way for a subclass to reach its
workspace, and it keeps the "one SlackApp per module" contract enforceable.

## Adoption

New modules extend `BaseModule`. Existing modules (`chat`, `reminders`, `lists`, `notion`, `stats`)
still use the equivalent hand-rolled convention and can be migrated incrementally — each migration is
a small, independently reviewable change (swap `#SlackApp` field + `this.#SlackApp` reads for
`super()` + `this.SlackApp`), not a big-bang rewrite. The self-check `tests/base-module.test.js`
regresses the #384 isolation property directly.
