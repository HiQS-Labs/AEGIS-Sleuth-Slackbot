# GH-277 smoke receipt (2026-10-23)

Run on the real `src/app.js` startup loop in a disposable full clone (`AEGIS-Sleuth-Slackbot-gh277-startup-hang-2026-10-23-gate`, branch head `b3649c0`), offline: a `node -r` preload replaces `@slack/bolt` with a stub (workspace token `xoxb-stall` gets a `start()` that never settles) and stubs `WorkspaceAI.prototype.TestConnectivityAsync`. Two fake workspaces, Alpha then Bravo, in a temp `SLEUTH_DATA_DIR`; `SLACK_START_TIMEOUT_MS=3000`; each run killed after 20 s. The fixture's fake reminder channel produces unrelated list-initialization errors.

Command (per run): `env -i HOME=$HOME PATH=$PATH SLEUTH_DATA_DIR=<tmp> SLACK_START_TIMEOUT_MS=3000 WEB_API_PORT=29277 WEB_API_BEARER_TOKEN=smoke-token NODE_ENV=test node -r smoke-preload.js src/app.js`

## Main path: Alpha stalls, Bravo healthy (fix) — PASS

```
[INFO]  sleuth-app loading workspace: Alpha
[smoke-stub] start() for the stalled workspace: never settles
[ERROR]  sleuth-app Slack Socket Mode did not start for workspace Alpha: Slack Socket Mode start for workspace Alpha did not complete within 3000 ms
[smoke-stub] stop() called (xoxb-stall)
[ERROR]  sleuth-app failed to start workspace Alpha, skipping: Slack Socket Mode start for workspace Alpha did not complete within 3000 ms
[smoke-stub] PluginLoader.StopAsync called
[smoke-stub] StatsModule.StopAsync called
[INFO]  sleuth-app loading workspace: Bravo
[INFO]  sleuth-app workspace modules started: Bravo
[INFO]  sleuth-app web api server started on port: 29277
[smoke-stub] PluginLoader.StopAsync called
[smoke-stub] StatsModule.StopAsync called
```

Alpha times out at the bound, Bolt is stopped, Alpha's PluginLoader and Stats are stopped, then Bravo starts and the web API comes up. (Later stop lines are the kill-time shutdown.)

## Red control: same run on the base `c53412b` (`src/app.js`, `src/slack-app.js`) — FAILS as expected

```
[INFO]  sleuth-app loading workspace: Alpha
```

After 20 s the base never leaves Alpha: Bravo never loads and the web API never starts.

## Adjacent path: both workspaces healthy (fix) — PASS

```
[INFO]  sleuth-app loading workspace: Alpha
[INFO]  sleuth-app workspace modules started: Alpha
[INFO]  sleuth-app loading workspace: Bravo
[INFO]  sleuth-app workspace modules started: Bravo
[INFO]  sleuth-app web api server started on port: 29277
```

## Suites (task clone, `b3649c0`)

- `npm test` — PASS (146 suites, 2,908 tests; 1 suite / 4 tests intentionally skipped; 116/116 Node tests).
- `npx jest tests/slack-app-start-timeout.test.js` — PASS (16). Against the base `src/slack-app.js` the four behaviour tests fail (deferred init, start timeout, late stop, retired-instance fence).
- `npm run build`, `validate:commands`, `validate:fsm`, `validate:ai`, `validate:reminder-pipeline`, `validate:changelog-tone`, `validate:workspace-isolation` — PASS.
- `./utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt` — PASS (no findings).

## Preload used

```js
'use strict';
// GH-277 smoke preload: replaces @slack/bolt with an offline stub and stubs the AI connectivity probe, so the real
// src/app.js startup loop runs with no network. Workspace whose LIVE_TOKEN is "xoxb-stall" gets a start() that never
// settles; every other workspace starts normally.
const Module = require('module');
const path = require('path');

const OriginalLoad = Module._load;

/** An async no-op that can be called or property-accessed to any depth (Slack client methods). */
function AnyClient() {
  const Call = async () => ({ ok: true, channels: [], members: [], messages: [], user: {}, team: {}, ts: '1.0', response_metadata: {} });
  return new Proxy(Call, {
    get: (ArgTarget, ArgProp) => (ArgProp === 'then' ? undefined : AnyClient()),
    apply: () => Call(),
  });
}

class FakeBoltApp {
  constructor(ArgOptions) {
    this.Token = ArgOptions.token;
    this.client = new Proxy({}, {
      get: (ArgTarget, ArgProp) => (ArgProp === 'auth'
        ? { test: async () => ({ ok: true, user_id: 'UBOT', team_id: `T_${this.Token}`, bot_id: 'BBOT' }) }
        : AnyClient()),
    });
  }
  async init() {}
  event() {}
  message() {}
  action() {}
  use() {}
  start() {
    if(this.Token === 'xoxb-stall') {
      console.log('[smoke-stub] start() for the stalled workspace: never settles');
      return new Promise(() => {});
    }
    return Promise.resolve();
  }
  async stop() { console.log(`[smoke-stub] stop() called (${this.Token})`); }
}

Module._load = function (ArgRequest, ArgParent, ArgIsMain) {
  if(ArgRequest === '@slack/bolt') return { App: FakeBoltApp };
  return OriginalLoad.apply(this, [ArgRequest, ArgParent, ArgIsMain]);
};

const Root = process.cwd();
const WorkspaceAI = require(path.join(Root, 'src/workspace-ai.js'));
WorkspaceAI.prototype.TestConnectivityAsync = async () => ({ ok: true });

// observe the owner stop hooks the GH-277 catch now calls.
for(const [ArgFile, ArgName] of [['src/stats-module.js', 'StatsModule'], ['src/plugin-loader.js', 'PluginLoader']]) {
  const Owner = require(path.join(Root, ArgFile));
  const Klass = Owner.default || Owner[ArgName] || Owner;
  const OriginalStop = Klass.prototype.StopAsync;
  Klass.prototype.StopAsync = async function (...ArgArgs) {
    console.log(`[smoke-stub] ${ArgName}.StopAsync called`);
    return OriginalStop.apply(this, ArgArgs);
  };
}
```
