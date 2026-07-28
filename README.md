# AEGIS

**A Slack bot that turns what your team already says into scheduled reminders — and answers
questions in the same thread.**

Someone types *"I'll ship the migration tomorrow"* in a channel. AEGIS notices the commitment,
extracts the task and the date, and schedules a reminder. When the work is done, a ✅ closes it —
or AEGIS closes it itself when the linked GitHub issue is merged.

AEGIS has been in daily production use for about 2.5 years by a working team, across multiple
Slack workspaces. It is multi-tenant, self-hosted, and stores its data on disk you control.

> **Heads up:** this project was called **Sleuth** internally until July 2026, and you will see that
> name throughout the code, the settings, and the release history. That is deliberate, not leftover
> mess — see [A note on the name](#a-note-on-the-name--formerly-sleuth).

---

## Table of contents

- [What it does](#what-it-does)
- [A note on the name — formerly Sleuth](#a-note-on-the-name--formerly-sleuth)
- [Maturity — an honest read](#maturity--an-honest-read)
- [Requirements](#requirements)
- [Install](#install)
- [Create a Slack app](#create-a-slack-app)
- [Configure a workspace](#configure-a-workspace)
- [Run it](#run-it)
- [Running as a service](#running-as-a-service)
- [Configuration reference](#configuration-reference)
- [Development](#development)
- [Security](#security)
- [Documentation map](#documentation-map)
- [License](#license)

---

## What it does

**Reminders from natural language.** AEGIS reads "actionable language" in messages — *I will do X
tomorrow*, *let's follow up Friday* — and turns it into a scheduled reminder with the right date and
time. The reminder lifecycle (schedule → complete → cancel → snooze) runs through a single state
machine, so a reminder cannot end up in an inconsistent state.

**An assistant in the channel.** Ask questions, do calculations, summarise a thread. 54 commands.
You choose the model provider — OpenAI, Anthropic, or Gemini — and can switch it per channel.

**Sourced web search.** `@Sleuth AI web-search <query>`, plus natural aliases like *look up …* and
*google …*. Answers cite their sources.

**GitHub two-way sync.** Reminders linked to a GitHub issue or PR auto-complete when it closes, and
replies in the Slack thread relay back to the GitHub issue as comments.

**Semantic recall.** Vector search over past Slack threads, so "what did we decide about the
migration?" finds the actual conversation.

**Multi-tenant.** One deployment serves many Slack workspaces, isolated from each other.

**Remote management.** A secured HTTP [Web API](docs/web-api.md) creates and updates workspaces
without redeploying.

Also included, and honestly earlier in maturity: **Notion search (beta)** — search-only and
token-gated; and a **plugin architecture** — a working loader that ships one reference plugin.
There is no plugin catalogue.

## A note on the name — formerly Sleuth

**This project was built and run internally as "Sleuth" from 2023 until July 2026.** It was renamed
**AEGIS** when it was published. The rename was applied to the documentation only, so you will find
the old name in a lot of places. Nothing is broken, and none of it is an oversight:

| Where you'll see `Sleuth` | Why it stayed |
|---|---|
| **Environment variables** — `SLEUTH_API_TOKEN`, `SLEUTH_DATA_DIR`, and ~32 others | Renaming these would break every existing deployment's `.env` for no functional gain. They are configuration keys, not branding. |
| **Code identifiers** — `SleuthAuditWriteID`, `IsSleuthAuthoredMessage`, and similar | Renaming symbols across the codebase is a large, purely cosmetic diff. It would make `git blame` useless and every open patch conflict, while changing nothing a user can observe. |
| **Paths and service names** — `sleuth-app`, `sleuth-app.service`, `/root/sleuth-app` | These are install locations and systemd unit names on running servers. Changing them is a migration, not a rename. |
| **`@Sleuth` in Slack examples** | This is how the bot is mentioned in the workspaces it already runs in. You name your own Slack app whatever you like — the code responds to mentions of *your* app, not to the literal string. |
| **`CHANGELOG.md`** — ~888 entries | Entries written before July 2026 say "Sleuth" because that is what it was called at the time. Rewriting them would make 2023 entries claim a name coined in 2026. |
| **The repository name** — `aegis-sleuth-slack-bot` | Deliberately carries both, so anyone who knew it as Sleuth can still find it. |

**The short version: `AEGIS` is the product name; `SLEUTH_`/`sleuth-` is the internal namespace.**
Treat them as the same thing. If you are searching the code for something and AEGIS turns up
nothing, search for Sleuth.

A full rename of the internals is possible later, but it is a breaking change for anyone already
running this, so it is not being done casually. If you are starting fresh and would prefer
`AEGIS_*` variables, that is a reasonable thing to open an issue about.

## Maturity — an honest read

We would rather you find this here than discover it later.

| Area | Status |
|---|---|
| NL → reminder scheduling, reminder lifecycle | **Proven** — the load-bearing core, 2.5 years of daily production use |
| In-Slack AI assistant, web search, GitHub sync, semantic recall | **Proven** — verified in the live path |
| Multi-tenant workspace isolation, Web API | **Proven** |
| Notion integration | **Beta** — search-only, token-gated |
| Plugin system | **Early** — real loader, one reference plugin |
| Append-only event ledger | **Groundwork.** It writes in production but is authoritative for nothing. AEGIS is *not* an event-sourced system today |

**The one structural caveat you should weigh:** persistence is mutable JSON with no `fsync`
anywhere. That is durable against a graceful restart or deploy — the design goal — but **not**
against a hard kill mid-write. AEGIS cannot claim crash-safety, and we do not.

AEGIS is proven for *reliability and longevity*, not for *scale*: it is a single in-house
deployment under light load. Nothing here has been load-tested.

## Requirements

- **Node.js 18.20.4+** (18 LTS is the floor; newer LTS releases work)
- **A Slack workspace** where you can install an app
- **An API key** for at least one of OpenAI, Anthropic, or Google Gemini
- **Linux with `systemd`** for the always-on deployment (macOS works for development)

AEGIS must stay running to listen for Slack events — it is a long-lived process, not a cron job.

## Install

```bash
git clone https://github.com/hiqs-suite/aegis-sleuth-slack-bot.git aegis
cd aegis
npm install
```

Copy the environment template and fill it in:

```bash
cp .env.example .env
```

`.env` holds host-level configuration only. **Per-workspace secrets (Slack tokens, AI keys) are not
stored here** — they are supplied per workspace through the Web API, described below.

Generate the admin encryption key referenced in `.env.example`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Create a Slack app

AEGIS needs a Slack app with Socket Mode enabled. The fastest route is the app manifest.

**Full walkthrough, both methods, with the ready-to-paste manifest:**
[`docs/slack-app-setup.md`](docs/slack-app-setup.md). In short:

1. Go to <https://api.slack.com/apps> → **Create New App** → **From an app manifest**.
2. Pick your workspace and paste the manifest from that guide.
3. **Basic Information** → **App-Level Tokens** → generate a token with `connections:write`.
   This is your `LIVE_APP_TOKEN` (`xapp-…`).
4. **Install App** → install to your workspace → copy the **Bot User OAuth Token**
   (`xoxb-…`). This is your `LIVE_TOKEN`.
5. **Basic Information** → copy the **Signing Secret**. This is your `LIVE_SIGNING_SECRET`.
6. **Event Subscriptions** → enable, and subscribe to the bot events: `app_mention`,
   `message.channels`, `message.groups`, `message.im`, `reaction_added`.
7. Invite the bot to the channels it should watch.

You now have the three Slack credentials AEGIS needs.

## Configure a workspace

Workspaces are created through the [Web API](docs/web-api.md) rather than a config file, so you can
add or update them without a redeploy.

> **Never paste real credentials into a file you might commit.** Keep them in your environment or a
> secrets manager and interpolate, as below.

```bash
curl -X POST "http://localhost:2020/workspace" \
  -H "Authorization: Bearer $SLEUTH_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "WORKSPACE_NAME": "your-workspace",
    "ADMIN_EMAIL": "admin@example.com",
    "LIVE_TOKEN": "'"$SLACK_BOT_TOKEN"'",
    "LIVE_SIGNING_SECRET": "'"$SLACK_SIGNING_SECRET"'",
    "LIVE_APP_TOKEN": "'"$SLACK_APP_TOKEN"'",
    "OPENAI_API_KEY": "'"$OPENAI_API_KEY"'",
    "REMINDER_CHANNEL_NAME": "your-reminder-channel",
    "MAIN_TIMEZONE": "America/Los_Angeles",
    "SNOOZE_DAYS": ["Saturday", "Sunday"],
    "STARTUP_MESSAGE": "yes"
  }'
```

A successful call returns `{"success":true,"data":"Workspace saved."}`. An HTML response almost
always means malformed JSON — usually a quote or comma lost while pasting keys.

AEGIS does not hot-reload workspace configuration. **Restart after any workspace change:**

```bash
sudo systemctl restart sleuth-app.service
```

### Workspace fields

| Field | Required | Meaning |
|---|---|---|
| `WORKSPACE_NAME` | ✅ | Identifier for this workspace |
| `ADMIN_EMAIL` | ✅ | Admin contact |
| `LIVE_TOKEN` | ✅ | Slack bot token (`xoxb-…`) |
| `LIVE_SIGNING_SECRET` | ✅ | Slack signing secret |
| `LIVE_APP_TOKEN` | ✅ | Slack app-level token (`xapp-…`), Socket Mode |
| `OPENAI_API_KEY` | ✅¹ | AI provider key |
| `REMINDER_CHANNEL_NAME` | ✅ | Channel where reminders are posted |
| `MAIN_TIMEZONE` | ✅ | IANA timezone for date resolution |
| `SNOOZE_DAYS` | — | Weekdays to skip recurring reminders |
| `STARTUP_MESSAGE` | — | `yes` posts a compact deploy/shutdown notice. Off by default |
| `STARTUP_MESSAGE_INCLUDE_CHANGELOG` | — | Verbose startup: changelog excerpt + CI follow-up. Requires `STARTUP_MESSAGE`. Off by default |
| `GITHUB_PAT` | — | Enables GitHub sync |
| `GITHUB_ACTIONS_REPO` | — | `owner/repo` for CI status posts |
| `GITHUB_ACTIONS_WORKFLOW` / `_BRANCH` | — | Narrower CI filters; falls back to the latest run |

¹ At least one AI provider key is required; the field name is historical.

## Run it

```bash
npm run dev     # development, with reload
node src/app.js # production process
```

Then, in Slack: `@Sleuth help`.

## Running as a service

AEGIS needs to be always-on. [`sleuth-app.service`](./sleuth-app.service) is a `systemd` unit that
starts it on boot and restarts it on crash.

```bash
sudo cp sleuth-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now sleuth-app.service
sudo systemctl status sleuth-app.service
```

Full walkthrough: [`docs/server-installation-guide.md`](docs/server-installation-guide.md).
macOS development setup: [`macos-install-guide.md`](./macos-install-guide.md).

## Configuration reference

> Environment variables are prefixed **`SLEUTH_`**, not `AEGIS_`. That is intentional — see
> [A note on the name](#a-note-on-the-name--formerly-sleuth).

**AI models.** The default is a small, cheap model; date extraction uses a stronger one, because
turning "the Tuesday after next" into a timestamp is harder than it looks. Per-channel model
overrides are supported.

**Deployment targets.** [`config/servers.json`](config/servers.json) lists deploy hosts. The
addresses shipped there are RFC 5737 documentation addresses and are deliberately non-routable —
**replace them with your own before deploying.**

**Client bucketing.** [`data/static/client-channel-mapping.json`](data/static/client-channel-mapping.json)
groups reminders by client or project from channel and repo naming patterns. The shipped entries are
examples. Order matters — resolution is first-match-wins.

**Monitoring.** New Relic APM is supported and **off unless `NEW_RELIC_LICENSE_KEY` is set.** There
is no fallback key.

## Development

```bash
npm test                 # full suite
npm run test:watch
npm run build            # tsc typecheck
npm run validate:fsm     # reminder state-machine invariants
npm run validate:ai      # AI prompt/schema contracts
```

Tests run against `MockSlackApp`, an in-memory Slack harness — no network, no tokens, no real
workspace. The mock-harness section of [`AGENTS.md`](./AGENTS.md) covers how to drive the reminder
lifecycle in a test, including a non-obvious gotcha about fake timers that will otherwise cost you
an afternoon.

**Secret scanning.** This repo ships its own gate:

```bash
./utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt
```

It exits non-zero on any finding, and exits `2` — never `0` — if it cannot verify its own tooling,
so a broken scanner can't be mistaken for a clean tree.

## Security

AEGIS handles Slack tokens and AI provider keys. A few things worth stating plainly:

- **⚠️ Set `WEB_API_BEARER_TOKEN` before exposing anything.** If it is unset, the Web API falls
  back to the legacy development bearer token `test`. That API creates workspaces and accepts
  Slack and AI provider credentials, so on a reachable host an unset token is a full
  credential-injection path. AEGIS logs a loud warning at startup; do not ignore it.
- **Never commit credentials.** Workspace secrets go through the Web API, not into files.
- **Protect the Web API.** Bind it to localhost or put it behind a reverse proxy with
  authentication. Do not expose port 2020 publicly.
- **Encryption at rest** applies to SMTP credentials via `ADMIN_ENCRYPTION_KEY`.
- **Rotation.** If a credential is ever committed, rotate it. Removing it from a file does not
  un-expose it.

To report a vulnerability, contact the maintainers privately at
**[security@neochro.me](mailto:security@neochro.me)** rather than opening a public issue. Full
policy, supported versions and scope: [`SECURITY.md`](./SECURITY.md).

## Documentation map

| Doc | What it covers |
|---|---|
| [`docs/web-api.md`](docs/web-api.md) | Web API endpoints — workspace management |
| [`docs/server-installation-guide.md`](docs/server-installation-guide.md) | Full Linux server install |
| [`macos-install-guide.md`](./macos-install-guide.md) | macOS development setup |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Generated architecture reference |
| [`AGENTS.md`](./AGENTS.md) | Conventions, test harness, contributor guidance |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release history |
| [`HONEST.md`](./HONEST.md) | Ground-truth maturity assessment — the source for the table above |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How to contribute — **read the inbound licensing section** |
| [`SECURITY.md`](./SECURITY.md) | Reporting a vulnerability, and operator responsibilities |

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Because AEGIS is dual-licensed, contributions carry one
extra term beyond the usual: you keep your copyright and license your work under the AGPL, and
additionally grant Neochrome the right to include it under the commercial license. Nothing is
assigned away — but please read that section before writing code.

## License

AEGIS is dual-licensed.

**AGPL-3.0-only** is the default and covers nearly every use — see [`LICENSE`](./LICENSE).
Run it for your team, modify it, self-host it, fork it, all at no cost. The one obligation to
know about is **§13**: if you modify AEGIS and let others interact with your modified version
over a network, you must offer those users the complete corresponding source of your version.
Running it unmodified triggers nothing extra.

A **commercial license** is available if you need to offer a modified AEGIS as a hosted service,
or embed it in a proprietary product, without publishing your changes — see
[`LICENSE-COMMERCIAL.md`](./LICENSE-COMMERCIAL.md). Terms are negotiated, not click-through.

Neither license grants trademark rights: "AEGIS" and "Neochrome" are not licensed (see
[`NOTICE`](./NOTICE)). Use the code, but pick your own name and don't imply endorsement.

Third-party dependency licenses are audited in [`THIRD-PARTY.md`](./THIRD-PARTY.md).

Copyright © 2023–2026 Neochrome.
