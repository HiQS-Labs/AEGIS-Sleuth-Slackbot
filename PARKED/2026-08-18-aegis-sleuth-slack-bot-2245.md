---
schema: finish-line/parked/v2
created_local: 2026-08-18T22:45
repo: aegis-sleuth-slack-bot
---

# Parked — 2026-08-18 22:45 — aegis-sleuth-slack-bot

## Runs

### R-001 — 2026-08-18T22:45
- frozen_items: 4
- parked_items: 6

#### P-001 — Lists API off on 4 of 5 prod workspaces
- claimed_severity: ship-safety (OCR half-works there)
- exclusion_rule: X1
- evidence: production startup log — `Lists feature not available for workspace: OCUX / Turn7 / abk-alumni-network / uclauxiii (free plan or missing permissions)`
- summary: Only `neochrome` has Slack Lists available in production. On the other four, image OCR extracts items and then cannot materialize a list; the user gets the "Slack Lists is not configured for this workspace yet" message plus a plain-text item summary. `abk-alumni-network` is the sharp case because it DOES have a Gemini key, so vision succeeds and only list creation fails. Not caused by any branch work and not silent — the failure message is explicit — so it fails the ship-safety bar and is a plan/config decision rather than a defect.
- remediation: Grant the Lists scope per workspace, or decide those workspaces are text-summary-only and say so in the failure copy.
- issue: none
- revisit_when: a non-neochrome workspace reports OCR "not working".

#### P-002 — GH-67 bot-authored reminders echo loop
- claimed_severity: ship-safety (pre-existing on trunk)
- exclusion_rule: X1
- evidence: none re-verified this run; prior note cites zero `bot_id` checks in `src/reminders-module.js`
- summary: Bot-authored Slack messages can trigger scheduling and resolve the assignee to `@Slackbot`, a live echo-loop risk with recurring Slack reminders. Explicitly excluded from the Confluence manifest (#80) so a safety fix is not gated behind an architecture measurement. Outside the OCR frozen list, and no file:line was re-established this run, so it does not meet the bar here.
- remediation: Add a `bot_id` / bot-subtype guard on the scheduling entry path; ships alone as an ordinary fix.
- issue: #67
- revisit_when: picked up as its own branch, or a `@Slackbot`-assigned reminder is observed in production.

#### P-003 — New Relic license key exposed in terminal output
- claimed_severity: security (secret leak)
- exclusion_rule: X4
- evidence: `systemctl show sleuth-app -p Environment` on the development server printed `NEW_RELIC_LICENSE_KEY` in cleartext
- summary: Running `systemctl show -p Environment` dumps every `Environment=` value, including secrets set by other drop-ins. The key is now in this session's transcript. The repository itself is clean (`utils/sanitize-scan.sh` passes), so this is an operational credential-rotation task, not a code defect in this close.
- remediation: Rotate the New Relic license key. Prefer `EnvironmentFile=` with 0600 permissions over `Environment=` for secrets so `systemctl show` cannot echo them; verify config with `systemctl show -p EnvironmentFiles` instead.
- issue: none
- revisit_when: immediately — treat as a standing rotation task.

#### P-004 — Diagnostics baseline provider line self-contradicts
- claimed_severity: minor correctness
- exclusion_rule: X5
- evidence: `src/diagnostics-report.js` baseline output — `Configured AI providers: none configured (active: OpenAI / gpt-4o-mini)`
- summary: The provider line reported "none configured" while simultaneously naming an active provider and model. Observed through a hand-built fake SlackApp with no API keys, so it may be an artifact of that harness rather than a real defect. Not reproduced against a real workspace, so evidence is insufficient to call it a defect in this close.
- remediation: Render the baseline against a real workspace and confirm; if genuine, make the "configured" list and the "active" model read from one resolver so they cannot disagree.
- issue: none
- revisit_when: GH-88 Phase 2 (triage migration) touches the same renderer.

#### P-005 — coverage/ directory is not gitignored
- claimed_severity: hygiene
- exclusion_rule: X2
- evidence: `.gitignore:168-170` covers `coverage*.json` / `.xml` / `.info` but not the `coverage/` directory
- summary: A `jest --coverage` run leaves an untracked `coverage/` tree in a public repository. Deleted by hand this session rather than widening a release PR's scope. One line to fix.
- remediation: Add `coverage/` to `.gitignore`.
- issue: none
- revisit_when: any branch that runs coverage and is about to commit.

#### P-006 — Dead /root/sleuth-app install directory still on production
- claimed_severity: operational risk
- exclusion_rule: X4
- evidence: production holds both `/root/sleuth-app` (dead, 10 enabled channels, 2026-08-11) and `/root/sleuth-app-v3` (live)
- summary: GH-86 Phase 4. State is now pinned by `SLEUTH_DATA_DIR=/var/lib/aegis-sleuth`, so the divergence can no longer grow, and both pre-move trees were deliberately left in place as rollback. Archiving is a deliberate follow-up, not a defect blocking this close.
- remediation: Diff the dead tree against the live one, merge anything unique, then move it off the box. Do the same for the pre-move copies once the new location has run clean for a while.
- issue: #86
- revisit_when: the new `/var/lib/aegis-sleuth` location has run clean through several deploys.
