# GH-301 development HTTPS cutover

Observed 2026-11-07, approximately17:30–17:32UTC. Scope is development only.

- Inventoried local active secrets/configs, launch agents, private sync configuration and source
  references. The identified direct-HTTP operator env was atomically migrated to the existing
  managed HTTPS tunnel endpoint; token/workspace unchanged, private backup retained, mode600.
  Bot configs already used HTTPS. Rebalance's selected source is its synced local reminder mirror,
  so it was unaffected. No claim is made about an unexamined machine's configuration.
- Actual bulk CLI operator backup succeeded through the migrated env before closure. Separate
  operator and scoped-bot HTTPS reads each returned18 pending records; each response was
  byte-identical before/after the firewall change. Unauthenticated HTTPS remained denied.
- Removed direct IPv4 port2020 acceptance and installed explicit non-loopback TCP rejects for
  port2020 on IPv4 and IPv6, before established-connection acceptance. Loopback tunnel origin
  stays available. Saved via enabled netfilter-persistent; both saved rule sets passed restore
  syntax checks. Prior live/persistent rules retained in a private root-only rollback directory.
- External direct HTTP responded before the change and was refused afterward. App and tunnel
  remained active/running with zero restarts; no error-priority app journal entries during cutover.
- The cloud security-list allow was not removed because the available OCI CLI session is expired.
  The host firewall supplies the verified closure; removal of that redundant allow is maintenance
  follow-up. No reboot was performed; persistence is evidenced by enabled loader and validated
  saved rules, not a reboot test.

Only read-only checks ran against the deployed app. No server test harness, live-data surgery,
credential distribution, production promotion or MCP work. Managed edge TLS uses existing system
trust and renewal; no self-signed certificates were installed. Raw request/response snapshots,
config backups, firewall receipts and rollback details remain in private operator storage/SOP.
