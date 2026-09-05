#!/usr/bin/env bash
# GH-168 smoke against the DEV bot, driven as a user (see scripts/slack-harness-drive.js).
#
# Read this before adding a case: with the GH-397 router in `active` mode, Flash Lite reinterprets
# EVERY mention before the deterministic command router sees it (src/chat-module.js:1205-1208), so
# an exact quoted command is not guaranteed to reach the code you think you are testing. Observed
# 2026-09-05: `switch-models:'openai claude opus'` — one quoted value, expected to be REFUSED —
# was split by the router into default='openai' + complex='claude opus' and BOTH were switched.
# The refusal case below therefore only runs when the router is off/shadow.
set -euo pipefail
cd "$(dirname "$0")/.."

# Pin the bot by ID. Name discovery reads the channel history, which THIS SCRIPT mutates as it
# runs, so a name lookup can drift onto another app mid-smoke (observed 2026-09-05).
D="node scripts/slack-harness-drive.js --channel-id ${SLEUTH_DEV_CHANNEL_ID:-C0A6969SU30} --bot-user-id ${SLEUTH_DEV_BOT_USER_ID:-U0917484FM4} --execute"

$D --text "models" --expect '*Aliases*'
$D --text "run-diagnostics" --expect 'Alias pins: OK'
$D --text "rmm ifl change model to Open AI" --expect "resolved from 'Open AI'"

# Deterministic refusal (cross-vendor phrase must NOT switch anything). Router-active rewrites this
# one, so gate it rather than assert a failure that is not the resolver's.
if $D --text "models" | grep -q 'System router mode: `active`'; then
  echo "smoke-dev-gh168: SKIPPED the cross-vendor refusal case — router mode is active (see header)."
else
  $D --text "switch-models:'openai claude opus'" --expect "'openai claude opus' not found"
fi

echo "smoke-dev-gh168: all passed"
