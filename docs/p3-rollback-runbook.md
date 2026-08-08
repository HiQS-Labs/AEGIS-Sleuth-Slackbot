# P3 Ledger rollback runbook

## Current release gate

Do **not** enable any Ledger authority flag in this checkout. The P8 drill currently fails before
the data-loss assertions because the live readers do not consume `REMINDER_STATE_SOURCE`,
`REMINDERS_READ_SOURCE`, `COMPLETED_READ_SOURCE`, or `REBALANCE_EXPORT_SOURCE`, and the live write
path does not invoke the derived snapshot writer. `SUMMARIZE_WEEK_COMPLETED_SOURCE` is the only
implemented flag below. Treat the other four as reserved names, not operational switches.

This is a roll-back-now condition for any environment that was configured with one of the four
unwired names: remove it and restart. An ignored flag can make an operator believe a rollback or
cutover occurred when neither did.

## Immediate rollback command

Run as the service operator on the Sleuth host. It removes every Ledger flag atomically from the
runtime environment file, retains a timestamped backup, then restarts the service:

```bash
sudo cp /root/sleuth-app/.env.runtime /root/sleuth-app/.env.runtime.p3-rollback-$(date +%Y%m%d%H%M%S)
sudo sed -i -E '/^(SUMMARIZE_WEEK_COMPLETED_SOURCE|REMINDER_STATE_SOURCE|REMINDERS_READ_SOURCE|COMPLETED_READ_SOURCE|REBALANCE_EXPORT_SOURCE)=/d' /root/sleuth-app/.env.runtime
sudo systemctl restart sleuth-app.service
```

Confirm the service is healthy before changing another flag:

```bash
sudo systemctl is-active --quiet sleuth-app.service
sudo journalctl -u sleuth-app.service -n 100 --no-pager
```

`is-active` must return success. Investigate warnings mentioning a JSON parse error, event-log
replay, projection fallback, or missing reminders before re-enabling anything.

## Flag reference

| Flag | Default | Intended behavior | Rollback check | Escalation |
| --- | --- | --- | --- | --- |
| `SUMMARIZE_WEEK_COMPLETED_SOURCE` | unset (JSON completion store) | `projection` reads the weekly completed list from the event projection. | Run a `summarize week` mention; its completed list must match the JSON-backed result. | Roll back now if a completion is missing, extra, or attributed to the wrong user/channel. Investigate first for a logged projection error: this path falls back to JSON. |
| `REMINDER_STATE_SOURCE` | unset (reserved; no live consumer) | Intended to select log-derived boot state. | Must remain unset. A configured value is not a real cutover in this release. | Roll back now if set; P8 has not approved this switch. |
| `REMINDERS_READ_SOURCE` | unset (reserved; no live consumer) | Intended to select projected active reminders. | Must remain unset. | Roll back now if set; P8 has not approved this switch. |
| `COMPLETED_READ_SOURCE` | unset (reserved; no live consumer) | Intended to select projected completion history. | Must remain unset. | Roll back now if set; P8 has not approved this switch. |
| `REBALANCE_EXPORT_SOURCE` | unset (reserved; no live consumer) | Intended to select the projected rebalance export. | Must remain unset and verify the published export continues to update after a normal reminder change. | Roll back now if set or if the export misses/duplicates a reminder. |

## Snapshot freshness and corrupt-file response

A derived snapshot is safe for a rollback only after the running service has written it *after* the
latest reminder event. A stale snapshot would resurrect the exact latest terminal changes it lacks:
the P8 fixture demonstrates a completed reminder and a cancelled reminder returning as open. Do
not use a dated snapshot to roll back an authority move; first restore a known-current JSON backup
or repair the authoritative log with the migration owner.

If either JSON snapshot is truncated/corrupt, keep the source flags unset and restart only after
preserving copies of the bad files and the matching event log. The intended future behavior is
replay-from-log; it is not wired in this release, so an automatic recovery claim would be unsafe.
If an event log is corrupt/truncated, do not enable a projection flag. Preserve the files, roll
back to JSON, and investigate the last valid event before attempting repair.

## Two-workspace rollout guard

Flags are process environment variables, not workspace settings. A single service process cannot
currently run one workspace with a Ledger source flag ON and another OFF. Do not attempt staged
per-workspace rollout until the flag ownership is redesigned; doing so would affect every workspace
in that process.
