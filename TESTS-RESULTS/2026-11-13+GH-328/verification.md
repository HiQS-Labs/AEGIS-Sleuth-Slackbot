# GH-328 verification — client name outside the reminder link

Base `f1edf49` (origin/development). Fix commit `b12b3b4`. Synthetic data only.

## Red / green
- New cases in existing `tests/reminders-display-utils.test.js` (`-t GH-328`) on the unchanged code: 2 failed. The caller case received `B.) <https://x.slack.com/archives/C1/p123|Client A - Ship the hotfix> · …`, the reported shape.
- After the fix: the same cases pass; focused suites `reminders-display-utils`, `client-mapping`, `show-rebalance-reminders*`: 125 passed.

## Smoke (manual check, real client resolution)
Command: `SLEUTH_CLIENT_OVERLAY_DIR=<tmp>/overlay node smoke.js` with overlay `smoke-ws.json` = one client `Client A` mapped by channel `C_CLIENT_A`. Script: [smoke.js](smoke.js); output: [smoke-output.txt](smoke-output.txt).

| Path | Observed | Verdict |
|---|---|---|
| Main: mapped client, plain title | `C.) Client A - <permalink\|Automate new meeting summaries …> · …` | pass |
| Adjacent: stored title already led by the client name | `C.) <permalink\|Client A - Automate meeting summaries> · …` (as written, not doubled) | pass |
| Adjacent: unmapped channel | `C.) <permalink\|Automate meeting summaries> · …` (no label) | pass |
| Adjacent: multi-task delivery | line labelled outside the link; extra bullet `• Client A - Review invoice 483` unchanged | pass |
