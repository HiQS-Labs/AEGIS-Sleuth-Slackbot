# AEGIS Data Flow Diagrams

## Why This Complexity Exists

**The Core Problem**: We have two sources of truth that must stay synchronized:
1. **Slack Reminders** (our internal storage) - optimized for chat output
2. **Slack Lists** (Slack's UI) - optimized for visual task management

**Data Integrity Requirement**: Users can modify tasks from either end. Without bidirectional sync and validation, data diverges silently, leading to missed reminders or stale task lists.

**Format Mismatch**: Slack's mrkdwn format (`<@U123> follow up on <url|this>`) displays poorly in Lists. Lists need clean text. But we must preserve the original for accurate Slack chat output. This requires transformation in both directions.

---

## Flow 1: Create Issue from Slack Chat

```
User posts reminder request in Slack
                    |
                    v
   +----------------------------------+
   |  Parse Message                   |  Extract: user, channel, timestamp, task text
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Create Reminder                 |  Generate UUID, set schedule, store mrkdwn
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Save to JSON                    |  /data/runtime/reminders/{workspace}_reminders.json
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Transform for Lists API         |  Extract clean summary from mrkdwn
   |                                  |  Convert to Block Kit rich_text format
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Create List Item                |  POST to slackLists.items.create
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Cache Mapping                   |  Store: ReminderID -> ListItemID
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Verify Roundtrip                |  Read item back, compare key fields
   +----------------------------------+
                    |
                    v
               [Complete]
```

**Why each step matters:**
- **Transform for Lists**: Raw mrkdwn like `<@U08BHQEAX>` displays as ugly markup in Lists UI
- **Cache Mapping**: Without this, we can't correlate List changes back to reminders
- **Verify Roundtrip**: Catches API failures or data corruption before user sees broken data

---

## Flow 2: Complete Issue from Slack Chat

```
User marks reminder complete (emoji/command)
                    |
                    v
   +----------------------------------+
   |  Find Reminder                   |  Lookup by message reference
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Check List Item                 |  GET current state from Slack Lists
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Conflict Check                  |  Has List version changed since last sync?
   +----------------------------------+
                    |
          +---------+---------+
          |                   |
          v                   v
     No Conflict          Conflict
          |                   |
          v                   v
   +--------------+    +--------------+
   |  Update      |    |  Merge or    |  (Future: conflict resolution UI)
   |  Reminder    |    |  Flag Issue  |
   +--------------+    +--------------+
          |                   |
          +---------+---------+
                    |
                    v
   +----------------------------------+
   |  Save to JSON                    |
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Update List Item                |  PATCH status to "completed"
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Verify Sync                     |  Confirm both sides match
   +----------------------------------+
                    |
                    v
               [Complete]
```

**Why conflict check matters:**
- User A completes task in Slack while User B edits description in Lists
- Without checking, we'd overwrite User B's changes
- Currently: We detect but don't auto-resolve (future feature)

---

## Flow 3: Detect Changes from Slack Lists (Polling)

```
   +----------------------------------+
   |  Poll Timer Fires                |  Every 5 minutes
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Fetch All Items                 |  GET slackLists.items.list
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Transform Items                 |  Convert fields[] array to flat objects
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Validate Each                   |  Parse Block Kit -> plain text
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Compare to Cache                |  Detect: added, modified, deleted
   +----------------------------------+
                    |
          +---------+---------+---------+
          |         |                   |
          v         v                   v
       Added     Modified            Deleted
          |         |                   |
          v         v                   v
      (Flow 4)   Update              Remove
                 Reminder            Reminder
                    |                   |
          +---------+---------+---------+
                    |
                    v
   +----------------------------------+
   |  Save to JSON                    |
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Update Cache                    |  New lastSync timestamp
   +----------------------------------+
                    |
                    v
             [Cycle Complete]
```

**Why transform + validate:**
- Slack API returns: `{ fields: [{ column_id: "Col123", rich_text: [...] }] }`
- We need: `{ summary: "Task text", status: "pending" }`
- Block Kit structures must be parsed to extract actual text values

---

## Flow 4: New Issue Created in Slack Lists

```
(Triggered by Flow 3 detecting new item)
                    |
                    v
   +----------------------------------+
   |  Validate Item                   |  Ensure required fields present
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Check Not Ours                  |  Skip if we created it (already in cache)
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Transform for Reminder Storage  |  Convert List format -> Reminder format
   |                                  |  Parse dates, extract user IDs, build mrkdwn
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Create Reminder                 |  Generate UUID, set defaults
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Save to JSON                    |
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Cache Mapping                   |  Store: ReminderID -> ListItemID
   +----------------------------------+
                    |
                    v
   +----------------------------------+
   |  Notify Channel                  |  Post to default channel: "New task added"
   +----------------------------------+
                    |
                    v
               [Complete]
```

**Why notification matters:**
- Tasks created in Lists UI won't trigger Slack events
- Team needs awareness that a new task exists
- Provides link back to original List item

---

## Complexity Justification

| Requirement | Why It Adds Steps |
|-------------|-------------------|
| **Bidirectional Sync** | Changes can originate from either Slack chat or Lists UI |
| **Format Translation** | mrkdwn <-> Block Kit <-> plain text (3 formats) |
| **Data Integrity** | Must verify writes succeeded; detect silent failures |
| **Conflict Detection** | Concurrent edits from both ends must not corrupt data |
| **ID Correlation** | Slack uses different IDs (message ts, List item ID, our UUID) |
| **Polling Required** | No webhooks for Lists API; must poll for changes |

---

## Current Simplifications

Things we're **not** doing (yet) that would add more complexity:

1. **Real-time sync** - Using 5-minute polling instead of webhooks (Slack doesn't offer List webhooks)
2. **Conflict resolution UI** - Currently just detecting conflicts, not auto-resolving
3. **Partial updates** - Always sync full item, not field-by-field diffs
4. **Offline queue** - No queuing if Slack API is down; retry on next cycle

---

## Potential Simplifications

If we wanted to reduce complexity, here are the trade-offs:

| Simplification | What We Lose |
|----------------|--------------|
| **Remove roundtrip verification** | Silent data corruption goes undetected |
| **One-way sync only (Slack -> Lists)** | Can't create/edit tasks in Lists UI |
| **Skip format transformation** | Lists show ugly `<@U123>` markup |
| **Remove conflict detection** | Last write wins; user edits get overwritten |
| **Longer polling interval** | Changes take longer to appear (10-15 min) |

**Recommendation**: The current complexity is the minimum viable for true bidirectional sync with data integrity. Each transformation layer exists because Slack's data formats differ between Chat and Lists APIs.

---

## Open Question: Simultaneous Edits

**Scenario**: User A edits in Slack, User B edits in Lists, both within same polling window.

**Current behavior**: Last write wins (potential data loss)

**Options for future**:
1. **Timestamp-based merge** - Keep most recent field values from either source
2. **Conflict queue** - Flag for human review, don't auto-merge
3. **Field-level locking** - Prevent edits during sync (poor UX)
4. **Accept last-write-wins** - Document as known limitation

**Recommendation**: Option 2 (conflict queue) is safest. Show user: "This task was modified in both places. Which version do you want to keep?"
