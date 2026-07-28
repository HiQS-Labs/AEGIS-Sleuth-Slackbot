# Security Policy

## Reporting a vulnerability

**Email [security@neochro.me](mailto:security@neochro.me).** Please do not open a public issue, pull
request, or discussion for a security problem — a public report is disclosure, and it exposes every
running deployment before there is a fix available.

Helpful things to include, as far as you have them:

- What the issue is and roughly how severe you think it is
- Steps to reproduce, or a proof of concept
- The version or commit you tested
- Whether you believe it is being exploited

If you would like a PGP key for the exchange, ask in a first email with no details in it.

### What to expect

This is a small team, so here is an honest set of expectations rather than an aspirational SLA:

| | |
|---|---|
| Acknowledgement | within **5 business days** |
| Initial assessment | within **10 business days** |
| Fix timeline | communicated after assessment; depends on severity and complexity |

We will keep you updated, tell you plainly if we decide not to act and why, and credit you in the
release notes when a fix ships — unless you would rather stay anonymous, which is fine. We ask that
you give us a reasonable window to ship a fix before publishing.

## Supported versions

AEGIS is distributed as source, and each operator runs their own deployment. **Only the latest
released version is supported.** There are no backported security fixes for older versions; the
remedy for a vulnerability is to update.

## Scope

In scope: the code in this repository — the Slack integration, the web API, credential and token
handling, workspace isolation, the reminder store, and the plugin surface.

Out of scope:

- Vulnerabilities in third-party dependencies. Report those upstream; if one affects AEGIS
  materially, we still want to hear about it.
- Vulnerabilities in Slack, OpenAI, Notion, GitHub, or any other external service.
- Issues that require an attacker to already hold valid administrator credentials for a deployment.
- Findings from an automated scanner with no demonstrated impact.

## Operator responsibilities

AEGIS is self-hosted, so parts of its security posture are yours rather than ours:

- **Credentials live in the environment, never in the repository.** `.env` is gitignored; only
  `.env.example` — placeholders — is committed. Treat any credential that reaches a commit as
  compromised: rotate it at the provider first, because removing it from the repository does not
  unexpose it.
- **Set `WEB_API_BEARER_TOKEN` to a long random value.** If it is unset, the web API falls back to
  the literal legacy token `test` ([`src/app.js`](./src/app.js), `GetWebApiBearerToken`). That API
  creates workspaces and accepts Slack and AI-provider credentials, so on any reachable host the
  fallback is a full credential-injection path. It is retained only because removing it would break
  existing deployments; the startup warning is deliberately loud. **Treat setting this as part of
  installation, not hardening.**
- **Do not expose the web API to the public internet** unless you have deliberately secured it. It
  creates workspaces and accepts credentials.
- **Keep the Slack app's OAuth scopes minimal**, and rotate tokens when someone leaves the team.

## Known posture

Ground-truth maturity is documented in [`HONEST.md`](./HONEST.md), and it is worth reading before
deploying somewhere sensitive: the core has run in daily production for years, while the Notion
integration, the plugin system, and the event ledger are comparatively early. Early does not mean
insecure, but it does mean less battle-tested — please weigh that against your own risk tolerance.
