---
title: "Phase brief p3 — GH-221 docs, scopes, changelog"
status: Queued — plan Codex-approved, preflighted; not fired
created: 2026-10-09
updated: 2026-10-09
owner: noel
branch: marathon/gh-221-selftest-mode
doc_type: phase-brief
related: "GH-221; parent plan PROJECT/2-WORKING/GH-221-SELFTEST-MODE.md; depends on p2"
roadmap_exempt: true
goal: >
  Document the selftest command, add the missing Slack scopes, and write the changelog entry.
---

# p3 — docs and changelog

## Status

| What was just completed | What's next |
|---|---|
| Brief written; parent plan approved by Codex plan QA round 3 (2026-10-10). | Runs after p2 is approved. |

Describe what p1/p2 actually built; read their merged files first and do not document anything that is not
there.

## Build

1. `docs/SSH.md` under `## Common Operations` (line ~66): add `### Post-deploy self-QA` in the existing style
   (a `###` heading plus one `bash` block with an `ssh sleuth-development '...'` one-liner), four lines: set
   `SLEUTH_SELFTEST_CHANNEL` in the dev unit and restart, `@Sleuth selftest all` in that channel, then the
   journal grep `journalctl -u sleuth-app -n 200 | grep '\[selftest\]'`. Mention that the Compass scenario
   needs a Compass-mapped channel and the four look-back scenarios an unmapped one, so full coverage is two runs.
2. `docs/slack-app-setup.md`: add `files:read` and `files:write` to the manifest (lines ~36-52) and the scope
   list (~106-120). If the dev app lacks them it needs a reinstall — say so in one sentence.
3. `docs/deployhq.md`: one line under the Slack smoke step (line ~102) pointing to the self-QA entry.
4. `CHANGELOG.md`: a new top entry in the file's HOW TO WRITE format (lines 22-34): `## <ver> - <date>`, a
   first-person plain-language TL;DR, then a `**Technical:**` paragraph starting with the GH id and listing
   files, the env var and tests. Take the next patch version after the current top entry. Do not bump
   `package.json` (the version lags the changelog until release). Run `node scripts/validate-changelog-tone.js`.

## Check

`node scripts/validate-changelog-tone.js` exits 0; `npm test` exits 0.

## Do NOT

- Do not touch source or tests, the plan doc, or `package.json`.
- Do not state that the live scenarios passed; they are verified on dev after deploy by the operator.
- Do not put the dev QA channel id or any secret in any doc (it lives in the gitignored `temp/SOP.md`).
