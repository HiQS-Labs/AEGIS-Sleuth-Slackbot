#!/usr/bin/env bash
# GH-168 smoke against the DEV bot, driven as a user (see scripts/slack-harness-drive.js).
#
# Every case runs unconditionally, in every router mode. There WAS a gate here: with the GH-397
# router `active`, Flash Lite re-read `switch-models:'openai claude opus'` — one quoted value the
# literal route captures whole — as default='openai' + complex='claude opus' and switched BOTH
# (dev, 2026-09-05). GH-174 fixed exactly that: an incumbent route match now wins over the model's
# reading, so the refusal case is meaningful in active mode and gating it would hide the very
# regression this script exists to catch. tests/smoke-dev-gh168.test.js pins that it stays ungated.
set -euo pipefail
cd "$(dirname "$0")/.."

# Pin the bot by ID. Name discovery reads the channel history, which THIS SCRIPT mutates as it
# runs, so a name lookup can drift onto another app mid-smoke (observed 2026-09-05).
#
# This repo is PUBLIC: workspace identifiers are supplied by the operator, never committed. The
# real values for this workspace are in the gitignored temp/SOP.md §3.6c.
: "${SLEUTH_DEV_CHANNEL_ID:?set SLEUTH_DEV_CHANNEL_ID (see temp/SOP.md SOP section 3.6c)}"
: "${SLEUTH_DEV_BOT_USER_ID:?set SLEUTH_DEV_BOT_USER_ID (see temp/SOP.md SOP section 3.6c)}"
D="node scripts/slack-harness-drive.js --channel-id ${SLEUTH_DEV_CHANNEL_ID} --bot-user-id ${SLEUTH_DEV_BOT_USER_ID} --execute"

$D --text "models" --expect '*Aliases*'
$D --text "run-diagnostics" --expect 'Alias pins: OK'
$D --text "rmm ifl change model to Open AI" --expect "resolved from 'Open AI'"

# Deterministic refusal: a cross-vendor phrase must switch NOTHING, whatever the router mode.
$D --text "switch-models:'openai claude opus'" --expect "'openai claude opus' not found"

echo "smoke-dev-gh168: all passed"
