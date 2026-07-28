# Slack Lists Next Steps

## Highest Priority

### 1. Live paid-workspace verification

Run the integration against a real paid Slack workspace and verify:
- app has `lists:read` and `lists:write`
- list is created successfully
- reminder channel receives access via `slackLists.access.set`
- new reminders add rows
- posted reminders update `status`
- completed/deleted reminders remove rows

### 2. Decide migration policy for older Lists

Lists created before `1.4.107` may not have the current `status` and `completed` columns.

Pick one policy:
- leave old Lists in place and accept partial row updates
- provide an explicit operator migration procedure
- add a controlled in-app recreation path

## Medium Priority

### 3. Rate-limit and retry hardening

Add a shared retry helper for Lists calls that:
- respects Slack `Retry-After`
- retries transient `internal_error` / `fatal_error` cases conservatively
- does not hide permanent argument/scope errors

### 4. Better operator diagnostics

Improve startup logs so operators can distinguish:
- paid-plan unavailability
- missing `lists:*` scopes
- cached list deleted externally
- schema mismatch with older Lists

## Product Decision Pending

### 5. Keep Lists output-only or support bidirectional edits

Current design: output-only.

If bidirectional behavior is wanted later, that should be treated as a separate feature with explicit decisions around:
- conflict resolution against JSON source of truth
- allowed field mutations
- reminder creation from List rows
- deletion semantics
- extra tests for list-originated state changes
