# Google Calendar Integration - 3 Phase Plan

**Version:** 1.2
**Created:** 2026-03-03
**Updated:** 2026-03-03
**Status:** Experiment
**Owner:** Robin Lee

---

## Overview

**This is an experiment** to evaluate whether Google Calendar integration adds meaningful value to the Sleuth reminder workflow. The goal is to validate the concept with a single user before investing in multi-user infrastructure. If the experiment proves valuable, future iterations can add prioritization keywords (e.g., "P1") to weight and order tasks.

Integrate Sleuth reminders with Google Calendar to provide users with visual time-blocking and prioritization capabilities. This feature will automatically create calendar events for reminders that contain GitHub issue/PR URLs, allowing users to manage their day by dragging events to prioritize tasks.

## Success Criteria

- Reminders with GitHub URLs automatically appear in user's Google Calendar
- Each reminder becomes a 1-hour calendar event
- Events are created for reminders due "today"
- Users can drag/drop events to prioritize their schedule
- Reminder status changes (completed/cancelled) sync back to calendar

---

## Phase 1: Technical Spike - Single User Proof of Concept

**Goal:** Validate Google Calendar API integration with minimal scope.

**Duration:** 1-2 weeks

### Scope

- **Single workspace, single user** (hardcoded user ID for testing)
- **GitHub URL detection**: Detect `github.com` URLs in `ReminderMessageText`
  - Issue format: `https://github.com/owner/repo/issues/123`
  - PR format: `https://github.com/owner/repo/pull/456`
- **"Today" filter**: Only sync reminders where `ShouldPostOn` is today (workspace timezone)
- **Top 5 oldest reminders**: Daily limit of 5 calendar events (sorted by `CreatedOn` ascending)
  - Encourages users to complete/cancel old tasks before new ones appear
  - Acts as a natural WIP (work-in-progress) limit
  - Oldest task scheduled first (earliest time slot)
- **1-hour events**: All events default to 1-hour duration
- **One-way sync**: Sleuth → Google Calendar only (no bidirectional sync)

### Technical Requirements

#### 1. Google Calendar API Setup

**Simplified 2-Project Setup:**
- **Project 1:** `sleuth-development` (for local dev + development server)
- **Project 2:** `sleuth-production` (for production server only)

---

**Project 1: Development (Local + Dev Server)**

Google Cloud Console Steps:

- [ ] Create Google Cloud Project at [console.cloud.google.com](https://console.cloud.google.com/)
  - Project name: `sleuth-development`
- [ ] Enable Google Calendar API (APIs & Services → Library → Search "Google Calendar API")
- [ ] Configure OAuth 2.0 consent screen:
  - User Type: Internal (for Google Workspace) or External
  - App name: "Sleuth AI (Development)"
  - User support email: Your email
  - Scopes: `https://www.googleapis.com/auth/calendar.events`
- [ ] Create OAuth 2.0 credentials (Credentials → Create Credentials → OAuth 2.0 Client ID):
  - Application type: Web application
  - Name: "Sleuth Calendar Sync - Development"
  - Authorized redirect URIs:
    - `http://localhost:2020/google-calendar/oauth/callback` (local dev)
    - `http://203.0.113.12:2020/google-calendar/oauth/callback` (dev server)
- [ ] Copy Client ID and Client Secret → **Use for both local and dev server**

---

**Project 2: Production**

Google Cloud Console Steps:

- [ ] Create Google Cloud Project at [console.cloud.google.com](https://console.cloud.google.com/)
  - Project name: `sleuth-production`
- [ ] Enable Google Calendar API (APIs & Services → Library → Search "Google Calendar API")
- [ ] Configure OAuth 2.0 consent screen:
  - User Type: Internal (for Google Workspace) or External
  - App name: "Sleuth AI"
  - User support email: Your email
  - Scopes: `https://www.googleapis.com/auth/calendar.events`
- [ ] Create OAuth 2.0 credentials (Credentials → Create Credentials → OAuth 2.0 Client ID):
  - Application type: Web application
  - Name: "Sleuth Calendar Sync - Production"
  - Authorized redirect URIs:
    - `http://203.0.113.13:2020/google-calendar/oauth/callback` (production server)
- [ ] Copy Client ID and Client Secret → **Use for production server only**

---

### Credentials Setup Checklist

**Environment-Specific Configuration:**

| Environment | GCP Project | Workspace File Location | Credentials Source |
|-------------|-------------|------------------------|-------------------|
| **Local (Your Mac)** | `sleuth-development` | `data/runtime/workspaces/<WORKSPACE>_workspace.json` | Development Client ID/Secret |
| **Development Server** | `sleuth-development` | `/root/sleuth-app/data/runtime/workspaces/<WORKSPACE>_workspace.json` | Development Client ID/Secret |
| **Production Server** | `sleuth-production` | `/root/sleuth-app/data/runtime/workspaces/<WORKSPACE>_workspace.json` | Production Client ID/Secret |

---

**Local Development Setup:**

- [ ] Create `data/runtime/workspaces/` directory on your Mac
- [ ] Copy `config/workspace-template.json` to `data/runtime/workspaces/neochrome_workspace.json`
- [ ] Add development credentials to workspace file:

```json
{
  "WORKSPACE_NAME": "neochrome",
  "ADMIN_EMAIL": "your-email@example.com",
  "LIVE_TOKEN": "xoxb-your-slack-token",
  "LIVE_SIGNING_SECRET": "your-signing-secret",
  "LIVE_APP_TOKEN": "xapp-your-app-token",
  "OPENAI_API_KEY": "sk-your-openai-key",
  "REMINDER_CHANNEL_NAME": "general",
  "MAIN_TIMEZONE": "America/Los_Angeles",

  "GOOGLE_CALENDAR_CLIENT_ID": "dev-client-id-from-sleuth-development-project",
  "GOOGLE_CALENDAR_CLIENT_SECRET": "dev-client-secret-from-sleuth-development-project",
  "GOOGLE_CALENDAR_TEST_USER_ID": "U032TCHJ8"
}
```

- [ ] Test locally: `npm run dev`

---

**Development Server Setup:**

- [ ] SSH to development server: `ssh sleuth-development`
- [ ] Navigate to app directory: `cd /root/sleuth-app`
- [ ] Edit workspace file: `nano data/runtime/workspaces/neochrome_workspace.json`
- [ ] Add **same development credentials** as local (see above)
- [ ] Restart service: `systemctl restart sleuth-app`
- [ ] Verify logs: `journalctl -u sleuth-app --follow`

---

**Production Server Setup (When Ready):**

- [ ] SSH to production server: `ssh sleuth-production`
- [ ] Navigate to app directory: `cd /root/sleuth-app`
- [ ] Edit workspace file: `nano data/runtime/workspaces/neochrome_workspace.json`
- [ ] Add **production credentials**:

```json
{
  "GOOGLE_CALENDAR_CLIENT_ID": "prod-client-id-from-sleuth-production-project",
  "GOOGLE_CALENDAR_CLIENT_SECRET": "prod-client-secret-from-sleuth-production-project",
  "GOOGLE_CALENDAR_TEST_USER_ID": "U032TCHJ8"
}
```

- [ ] Restart service: `systemctl restart sleuth-app`
- [ ] Verify logs: `journalctl -u sleuth-app --follow`

---

**Security Notes:**
- ✅ `data/runtime/` is in `.gitignore` (credentials never committed to git)
- ✅ Each environment has its own workspace file (not shared)
- ✅ Client Secret is workspace-level (shared by all users in that workspace)
- ✅ User OAuth tokens are stored separately per user in `data/runtime/google-calendar/`
- ✅ Set file permissions on servers: `chmod 600 data/runtime/workspaces/*.json`

#### 2. New Module: `src/google-calendar-module.js`

**Responsibilities:**
- OAuth 2.0 authentication flow
- Token storage and refresh
- Event creation/update/deletion
- GitHub URL extraction from reminder text

**Key Methods:**
```javascript
class GoogleCalendarModule {
  // OAuth flow
  async GetAuthorizationUrlAsync(ArgUserID)
  async HandleOAuthCallbackAsync(ArgCode, ArgUserID)
  
  // Event management
  async CreateEventForReminderAsync(ArgReminder)
  async UpdateEventForReminderAsync(ArgReminder)
  async DeleteEventForReminderAsync(ArgReminderID)
  
  // Helpers
  #ExtractGitHubUrl(ArgReminderText)
  #IsReminderDueToday(ArgReminder)
  #BuildEventFromReminder(ArgReminder)
}
```

#### 3. Data Storage

**File:** `data/runtime/google-calendar/<WORKSPACE>_tokens.json`

```json
{
  "users": {
    "U032TCHJ8": {
      "access_token": "ya29.a0...",
      "refresh_token": "1//0g...",
      "expiry_date": 1709596800000,
      "calendar_id": "primary"
    }
  }
}
```

**File:** `data/runtime/google-calendar/<WORKSPACE>_event_mapping.json`

```json
{
  "reminder_to_event": {
    "add19415-0939-47a7-9861-fe9c05b9d647": "event_id_from_google"
  }
}
```

#### 4. Workspace Configuration

Add to `WorkspaceInfo` typedef in `src/workspaces.js`:

```javascript
/**
 * @property {string} [GOOGLE_CALENDAR_CLIENT_ID]     Google OAuth Client ID
 * @property {string} [GOOGLE_CALENDAR_CLIENT_SECRET] Google OAuth Client Secret
 * @property {string} [GOOGLE_CALENDAR_TEST_USER_ID]  Slack User ID for Phase 1 testing
 */
```

#### 5. Integration Points

**Event-Based Integration (Avoids Circular Dependencies):**

RemindersModule will emit lifecycle events that GoogleCalendarModule subscribes to. This maintains one-way dependency flow per AGENTS.md Section 0.2.

**In `src/reminders-module.js`:**

Add event emitter after reminder creation in `#CreateAndScheduleRemindersAsync`:
```javascript
// After NewReminderInfo is created and added to queue
this.#SlackApp.EmitWorkspaceEvent('reminder:created', {
  reminder: NewReminderInfo,
  workspace: this.#SlackApp.WorkspaceInfo.WORKSPACE_NAME
});
```

Add event emitter in `#TransitionReminderState`:
```javascript
#TransitionReminderState(ArgReminder, ArgNextState, ArgReason) {
  const PreviousState = ArgReminder.State;
  ArgReminder.State = ArgNextState;

  this.#SlackApp.Logger.info(
    `[FSM] Reminder ${ArgReminder.ReminderID}: ${PreviousState} → ${ArgNextState} (${ArgReason})`
  );

  // Emit state transition event for other modules
  this.#SlackApp.EmitWorkspaceEvent('reminder:state-changed', {
    reminder: ArgReminder,
    previousState: PreviousState,
    newState: ArgNextState,
    reason: ArgReason
  });
}
```

**In `src/google-calendar-module.js`:**

Subscribe to events during startup:
```javascript
async StartAsync() {
  // Calendar sync is once-daily (on startup/reconciliation).
  // No real-time event creation on reminder:created — users manage
  // their own calendar for mid-day changes. This keeps the experiment simple.

  this.#SlackApp.OnWorkspaceEvent('reminder:state-changed', async (ArgEventData) => {
    await this.#HandleReminderStateChangedAsync(
      ArgEventData.reminder,
      ArgEventData.previousState,
      ArgEventData.newState
    );
  });

  // Run once-daily sync (top 5 oldest reminders due today)
  await this.#ReconcileCalendarOnStartupAsync();
}

async #HandleReminderStateChangedAsync(ArgReminder, ArgPreviousState, ArgNewState) {
  // Only handle deletions reactively — if a user completes or cancels
  // a synced reminder, remove the event so their calendar stays clean.
  if(ArgNewState === 'completed' || ArgNewState === 'canceled') {
    await this.DeleteEventForReminderAsync(ArgReminder.ReminderID);
  }
  // Rescheduling and new creations are handled by the next startup reconciliation.
  // Users can manually fill calendar gaps mid-day if they finish tasks early.
}
```

**Dependency Direction:**
- `RemindersModule` → emits events (no knowledge of GoogleCalendarModule)
- `GoogleCalendarModule` → subscribes to events (depends on RemindersModule data, not code)
- `SlackApp` → provides event bus (already owns workspace-level coordination)

**Event Bus Implementation in `src/slack-app.js`:**

```javascript
class SlackApp {
  /**
   * Event listeners for workspace-level events.
   * @type {Map<string, Function[]>}
   */
  #EventListeners = new Map();

  /**
   * Register a listener for workspace events.
   * @param {string} ArgEventName Event name (e.g., 'reminder:created')
   * @param {Function} ArgCallback Async callback function
   */
  OnWorkspaceEvent(ArgEventName, ArgCallback) {
    if(!this.#EventListeners.has(ArgEventName)) {
      this.#EventListeners.set(ArgEventName, []);
    }
    this.#EventListeners.get(ArgEventName).push(ArgCallback);
  }

  /**
   * Emit a workspace event to all registered listeners.
   * @param {string} ArgEventName Event name
   * @param {any} ArgEventData Event data payload
   */
  async EmitWorkspaceEvent(ArgEventName, ArgEventData) {
    const Listeners = this.#EventListeners.get(ArgEventName) || [];

    // Call all listeners in parallel (they should handle their own errors)
    await Promise.allSettled(
      Listeners.map(async (Listener) => {
        try {
          await Listener(ArgEventData);
        } catch(error) {
          this.Logger.error(`Error in event listener for ${ArgEventName}:`, error);
        }
      })
    );
  }

  /**
   * Remove all listeners for graceful shutdown (AGENTS.md Section 7).
   * Called during module StopAsync() teardown.
   */
  ClearAllWorkspaceEventListeners() {
    this.#EventListeners.clear();
  }
}
```

**Why This Pattern:**
- No circular dependencies (modules don't import each other)
- Loose coupling (modules don't know about each other)
- Easy to add more subscribers later (ListsModule, NotionModule, etc.)
- Follows existing Sleuth architecture (SlackApp owns coordination)

#### 6. Event Management Implementation (v1.2 Updates)

**DeleteEventForReminderAsync - Complete Data Lifecycle:**

```javascript
async DeleteEventForReminderAsync(ArgReminderID) {
  const EventID = this.#EventMapping.reminder_to_event[ArgReminderID];

  if(!EventID) {
    this.#Logger.warn(`No event mapping found for reminder ${ArgReminderID}`);
    return;
  }

  try {
    // Delete from Google Calendar
    await this.#DeleteCalendarEventAsync(EventID);

    // ✅ v1.2: DELETE THE MAPPING ENTRY (prevents data leak)
    delete this.#EventMapping.reminder_to_event[ArgReminderID];
    await this.#SaveEventMappingAsync();

    this.#Logger.info(`Deleted event ${EventID} and mapping for reminder ${ArgReminderID}`);
  } catch(error) {
    // If event doesn't exist in calendar (404), still clean up mapping
    if(error.code === 404 || error.status === 404) {
      this.#Logger.warn(`Event ${EventID} not found in calendar, cleaning up mapping`);
      delete this.#EventMapping.reminder_to_event[ArgReminderID];
      await this.#SaveEventMappingAsync();
    } else {
      this.#Logger.error(`Failed to delete event for reminder ${ArgReminderID}:`, error);
      throw error;
    }
  }
}
```

**Event Mapping File Persistence (Promise Chaining):**

```javascript
#EventMappingSavePromise = Promise.resolve();

async #SaveEventMappingAsync() {
  // Chain saves to prevent race conditions (same pattern as reminders-module.js)
  this.#EventMappingSavePromise = this.#EventMappingSavePromise.then(async () => {
    try {
      await fs.writeFile(
        this.#EventMappingFilePath,
        JSON.stringify(this.#EventMapping, null, 2),
        'utf8'
      );
      this.#Logger.info('Event mapping saved successfully');
    } catch(error) {
      this.#Logger.error('Failed to save event mapping:', error);
      throw error;
    }
  });

  return this.#EventMappingSavePromise;
}
```

#### 7. GitHub URL Detection

**Regex Pattern:**
```javascript
const GITHUB_URL_REGEX = /https?:\/\/github\.com\/[\w\-]+\/[\w\-]+\/(issues|pull)\/\d+/gi;
```

**Extraction Logic:**
```javascript
#ExtractGitHubUrl(ArgReminderText) {
  const Matches = ArgReminderText.match(GITHUB_URL_REGEX);
  return Matches ? Matches[0] : null;
}
```

#### 7. Calendar Event Structure

**Event Format:**
```javascript
{
  // Use ReminderMessageText directly - no GitHub API call needed
  // Extract issue/PR number from URL for display
  summary: this.#BuildEventSummary(ReminderMessageText, GitHubUrl),

  description: `${ReminderMessageText}\n\nGitHub: ${GitHubUrl}\nSlack: ${SlackMessageLink}`,

  start: {
    dateTime: "2026-03-03T10:00:00-08:00",  // ShouldPostOn time
    timeZone: WorkspaceInfo.MAIN_TIMEZONE
  },
  end: {
    dateTime: "2026-03-03T11:00:00-08:00",  // +1 hour
    timeZone: WorkspaceInfo.MAIN_TIMEZONE
  },
  extendedProperties: {
    private: {
      sleuth_reminder_id: "add19415-0939-47a7-9861-fe9c05b9d647",
      sleuth_workspace: "neochrome",
      github_url: "https://github.com/owner/repo/issues/123"
    }
  },
  colorId: "9"  // Blueberry (per Google Calendar API docs)
}
```

**Summary Builder:**
```javascript
#BuildEventSummary(ArgReminderText, ArgGitHubUrl) {
  // Extract issue/PR number from URL
  const Match = ArgGitHubUrl.match(/\/(issues|pull)\/(\d+)/);
  const IssueNumber = Match ? `#${Match[2]}` : '';

  // Use first line of reminder text as summary
  const FirstLine = ArgReminderText.split('\n')[0].trim();

  // Remove Slack formatting (mentions, links)
  const CleanText = FirstLine
    .replace(/<@[A-Z0-9]+>/g, '')  // Remove mentions
    .replace(/<https?:\/\/[^|>]+\|([^>]+)>/g, '$1')  // Extract link text
    .replace(/<https?:\/\/[^>]+>/g, '')  // Remove plain links
    .trim();

  // Truncate to 100 chars (Google Calendar limit is 1024, but keep it readable)
  const Summary = CleanText.length > 100
    ? CleanText.substring(0, 97) + '...'
    : CleanText;

  return IssueNumber ? `${Summary} (${IssueNumber})` : Summary;
}
```

### Phase 1 Setup Instructions

**✅ Supports Non-Sequential Workflow:** Admin and POC user can work independently!

---

#### **Step 1: Admin Setup (One-Time)**

**Admin** gets Google OAuth credentials and configures workspace:

1. **Get Google OAuth Credentials** (follow steps in "Google Calendar API Setup" section above)

2. **Update Workspace Config:**

   Edit `data/runtime/workspaces/<workspace>_workspace.json`:
   ```json
   {
     "GOOGLE_CALENDAR_CLIENT_ID": "123456789-abc123.apps.googleusercontent.com",
     "GOOGLE_CALENDAR_CLIENT_SECRET": "GOCSPX-aBcDeFgHiJkLmNoPqRsTuVwXyZ",
     "GOOGLE_CALENDAR_TEST_USER_ID": "U032TCHJ8"
   }
   ```

3. **Restart Sleuth:**
   ```bash
   systemctl restart sleuth-app.service
   ```

4. **Share Auth Script with POC User** (send them the command below)

---

#### **Step 2: POC User Authorization (Self-Service - Can Run Anytime After Step 1)**

**POC User** runs this independently (no admin needed):

1. **SSH into Sleuth server** (or run locally if dev environment)

2. **Run Authorization Script:**
   ```bash
   cd /path/to/sleuth-app
   node scripts/google-calendar-auth.js neochrome U032TCHJ8
   ```

3. **Follow Interactive Prompts:**
   ```
   🔗 Authorize Sleuth to access your Google Calendar:
   https://accounts.google.com/o/oauth2/v2/auth?client_id=...

   1. Click the link above (or copy/paste into browser)
   2. Sign in with your Google account
   3. Authorize Sleuth
   4. Copy the 'code' parameter from redirect URL

   Paste the authorization code here: _
   ```

4. **Paste Code:**
   ```
   Paste the authorization code here: 4/0AY0e-g7XYZ123...

   ✅ Authorization successful!
   📁 Tokens saved to: data/runtime/google-calendar/neochrome_tokens.json
   🎉 Your Google Calendar is now connected!
   ```

5. **No Restart Needed** - Tokens loaded on-demand

---

#### **Step 3: Verification**

1. **Check Token File:**
   ```bash
   cat data/runtime/google-calendar/<workspace>_tokens.json
   ```

2. **Create Test Reminder in Slack:**
   ```
   Fix the login bug https://github.com/owner/repo/issues/123 by 2 PM today
   ```

3. **Check Google Calendar** - Event should appear!

---

**Token Storage:**
- Workspace OAuth credentials: `data/runtime/workspaces/<workspace>_workspace.json` (admin-managed)
- User tokens: `data/runtime/google-calendar/<workspace>_tokens.json` (user self-service)
- Event mappings: `data/runtime/google-calendar/<workspace>_event_mapping.json` (auto-generated)

### Deliverables

- [ ] Working OAuth flow (manual authorization via browser)
- [ ] Helper script: `scripts/google-calendar-auth.js` for Phase 1 testing
- [ ] Single test user can authorize Sleuth to access their calendar
- [ ] Reminders with GitHub URLs create 1-hour calendar events
- [ ] Events appear in user's Google Calendar with correct time
- [ ] Completed/cancelled reminders delete corresponding events
- [ ] Documentation: OAuth setup guide for operators (in this file)
- [ ] Logs showing event creation/deletion lifecycle

### Testing Checklist

- [ ] Create reminder with GitHub issue URL due today → Event appears in calendar
- [ ] Create reminder with GitHub PR URL due today → Event appears in calendar
- [ ] Create reminder without GitHub URL → No event created
- [ ] Create reminder due tomorrow → No event created (not "today")
- [ ] Complete reminder via `:white_check_mark:` → Event deleted from calendar
- [ ] Cancel reminder via `:wastebasket:` → Event deleted from calendar
- [ ] Token refresh works when access token expires
- [ ] OAuth re-authorization works if tokens are revoked

### Known Limitations (Phase 1)

- Only works for single hardcoded test user
- No user-facing OAuth flow (manual setup required)
- No time-of-day intelligence (all events start at reminder's `ShouldPostOn` time)
- No conflict detection if multiple reminders have same time
- No bidirectional sync (calendar changes don't affect Sleuth)
- No event updates if reminder text changes

---

## Phase 2: Multi-User Expansion

**Goal:** Scale to support all users in a workspace.

**Duration:** 2-3 weeks

### Scope

- **Per-user OAuth**: Each user authorizes their own Google Calendar
- **Slack command**: `/sleuth-calendar connect` to initiate OAuth
- **User preferences**: Per-user settings for calendar sync
- **Automatic sync**: All users with connected calendars get automatic sync
- **Status visibility**: Users can see if their calendar is connected

### Technical Requirements

#### 1. Slack Command Handler

**New Command:** `/sleuth-calendar`

**Subcommands:**
- `connect` - Start OAuth flow
- `disconnect` - Revoke calendar access
- `status` - Show connection status
- `test` - Create test event to verify connection

**Implementation in `src/slack-app.js`:**
```javascript
HandleSlashCommand('/sleuth-calendar', async (ArgEventInfo) => {
  const Subcommand = ArgEventInfo.text.split(' ')[0];

  switch(Subcommand) {
    case 'connect':
      return await GoogleCalendarModule.HandleConnectCommandAsync(ArgEventInfo);
    case 'disconnect':
      return await GoogleCalendarModule.HandleDisconnectCommandAsync(ArgEventInfo);
    case 'status':
      return await GoogleCalendarModule.HandleStatusCommandAsync(ArgEventInfo);
    case 'test':
      return await GoogleCalendarModule.HandleTestCommandAsync(ArgEventInfo);
    default:
      return await PostHelpMessageAsync(ArgEventInfo);
  }
});
```

#### 2. OAuth Flow Enhancement

**User-Initiated Flow:**
1. User runs `/sleuth-calendar connect` in Slack
2. Sleuth posts ephemeral message with authorization link
3. User clicks link → redirected to Google OAuth consent screen
4. User authorizes → Google redirects to Sleuth callback URL
5. Sleuth stores tokens and posts confirmation in Slack

**Callback Endpoint:** `GET /google-calendar/oauth/callback` (OAuth redirects are GET, not POST)

Add to `src/web-api.js`:
```javascript
// In-memory nonce store for CSRF protection (Phase 1 - single user)
// Phase 2 should use Redis or database for multi-user/multi-instance deployments
const OAuthNonces = new Map(); // nonce -> { workspace, user_id, expires }

// Helper to generate CSRF-safe state parameter
function GenerateOAuthState(ArgWorkspace, ArgUserID) {
  const Nonce = crypto.randomBytes(32).toString('hex');
  const StateData = {
    workspace: ArgWorkspace,
    user_id: ArgUserID,
    nonce: Nonce
  };

  // Store nonce server-side with 10-minute expiry
  OAuthNonces.set(Nonce, {
    workspace: ArgWorkspace,
    user_id: ArgUserID,
    expires: Date.now() + (10 * 60 * 1000)
  });

  // Return base64-encoded state (includes nonce for verification)
  return Buffer.from(JSON.stringify(StateData)).toString('base64');
}

// OAuth callback handler (GET request from Google)
WebApp.get('/google-calendar/oauth/callback', async (ArgRequest, ArgResponse) => {
  try {
    const { code, state, error } = ArgRequest.query;

    // Handle user denial
    if(error) {
      return ArgResponse.status(400).send(
        '<html><body>❌ Authorization cancelled. You can close this window.</body></html>'
      );
    }

    // Decode and verify state parameter
    const StateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { workspace, user_id, nonce } = StateData;

    // CSRF protection: verify nonce exists and hasn't expired
    const StoredNonce = OAuthNonces.get(nonce);
    if(!StoredNonce) {
      return ArgResponse.status(403).send(
        '<html><body>❌ Invalid or expired authorization request.</body></html>'
      );
    }

    if(StoredNonce.expires < Date.now()) {
      OAuthNonces.delete(nonce);
      return ArgResponse.status(403).send(
        '<html><body>❌ Authorization request expired. Please try again.</body></html>'
      );
    }

    // Verify state matches stored nonce
    if(StoredNonce.workspace !== workspace || StoredNonce.user_id !== user_id) {
      return ArgResponse.status(403).send(
        '<html><body>❌ State mismatch. Possible CSRF attack.</body></html>'
      );
    }

    // Clean up used nonce
    OAuthNonces.delete(nonce);

    // Exchange code for tokens
    await GoogleCalendarModule.HandleOAuthCallbackAsync(workspace, user_id, code);

    ArgResponse.send(
      '<html><body>✅ Calendar connected! You can close this window.</body></html>'
    );
  } catch(error) {
    console.error('OAuth callback error:', error);
    ArgResponse.status(500).send(
      '<html><body>❌ Error connecting calendar. Please try again.</body></html>'
    );
  }
});

// Periodic cleanup of expired nonces (run every 5 minutes)
// Store timer reference for graceful shutdown (AGENTS.md Section 7)
const OAuthNonceCleanupTimer = setInterval(() => {
  const Now = Date.now();
  for(const [nonce, data] of OAuthNonces.entries()) {
    if(data.expires < Now) {
      OAuthNonces.delete(nonce);
    }
  }
}, 5 * 60 * 1000);

// Clean up timer on shutdown (called from WebAPI.StopAsync())
// clearInterval(OAuthNonceCleanupTimer);
```

**Shutdown Cleanup:**

The `OAuthNonceCleanupTimer` must be cleared during `WebAPI.StopAsync()`:

```javascript
async StopAsync() {
  clearInterval(this.#OAuthNonceCleanupTimer);
  this.#OAuthNonceCleanupTimer = null;
}
```

#### 3. Per-User Token Storage

**Enhanced Token File Structure:**
```json
{
  "users": {
    "U032TCHJ8": {
      "access_token": "ya29.a0...",
      "refresh_token": "1//0g...",
      "expiry_date": 1709596800000,
      "calendar_id": "primary",
      "connected_at": "2026-03-03T10:00:00.000Z",
      "last_sync": "2026-03-03T14:30:00.000Z",
      "sync_enabled": true
    },
    "U08BHQEAX": {
      "access_token": "ya29.b1...",
      "refresh_token": "1//1h...",
      "expiry_date": 1709600400000,
      "calendar_id": "primary",
      "connected_at": "2026-03-03T11:00:00.000Z",
      "last_sync": "2026-03-03T14:35:00.000Z",
      "sync_enabled": true
    }
  }
}
```

**Concurrency Protection:**

Follow existing pattern from `reminders-module.js` for file-based persistence:

```javascript
// In google-calendar-module.js
#TokenFileLock = Promise.resolve(); // Serialize file operations

async #SaveTokensAsync() {
  // Chain file operations to prevent concurrent writes
  this.#TokenFileLock = this.#TokenFileLock.then(async () => {
    const FilePath = path.join(
      __dirname,
      '../data/runtime/google-calendar',
      `${this.#WorkspaceInfo.WORKSPACE_NAME}_tokens.json`
    );

    await fs.mkdir(path.dirname(FilePath), { recursive: true });
    await fs.writeFile(FilePath, JSON.stringify(this.#Tokens, null, 2));
  });

  await this.#TokenFileLock;
}

async #LoadTokensAsync() {
  // Load is also serialized to prevent read-during-write
  this.#TokenFileLock = this.#TokenFileLock.then(async () => {
    const FilePath = path.join(
      __dirname,
      '../data/runtime/google-calendar',
      `${this.#WorkspaceInfo.WORKSPACE_NAME}_tokens.json`
    );

    try {
      const FileContent = await fs.readFile(FilePath, 'utf-8');
      this.#Tokens = JSON.parse(FileContent);
    } catch(error) {
      if(error.code === 'ENOENT') {
        this.#Tokens = { users: {} };
      } else {
        throw error;
      }
    }
  });

  await this.#TokenFileLock;
}
```

**Note:** This pattern works for single-instance deployments. Multi-instance deployments would require external locking (Redis, database, or file locks).

#### 4. Reminder Assignment Detection

**Assignee Extraction:**
- Use existing `AssigneeID` field from `ReminderInfo`
- Only create calendar event for the assigned user
- If no assignee, create event for `OriginalSenderID`

**Logic:**
```javascript
#GetTargetUserForCalendarSync(ArgReminder) {
  return ArgReminder.AssigneeID || ArgReminder.OriginalSenderID;
}
```

#### 5. Two-Way Reconciliation on Startup (v1.2 Update)

**On Module Start:**
- **Direction 1 (Sleuth → Calendar):** Create events for reminders that don't have calendar events
- **Direction 2 (Calendar → Sleuth):** Delete orphaned events that don't have active reminders

**Method:**
```javascript
async #ReconcileCalendarOnStartupAsync() {
  // ✅ DIRECTION 1: Sleuth → Calendar (existing logic)
  // Create events for reminders that don't have calendar events
  const TodayReminders = this.#GetRemindersWithGitHubUrlsDueToday();

  // ✅ v1.2: TOP 5 OLDEST REMINDERS ONLY
  // Sort by CreatedOn ascending (oldest first), limit to 5
  const Top5Reminders = TodayReminders
    .sort((a, b) => new Date(a.CreatedOn) - new Date(b.CreatedOn))
    .slice(0, 5);

  this.#Logger.info(
    `[calendar-sync] Found ${TodayReminders.length} reminders due today, ` +
    `syncing top 5 oldest (WIP limit)`
  );

  for(const Reminder of Top5Reminders) {
    const TargetUserID = this.#GetTargetUserForCalendarSync(Reminder);

    if(await this.#IsUserConnectedAsync(TargetUserID)) {
      // Only create if mapping doesn't exist
      if(!this.#EventMapping.reminder_to_event[Reminder.ReminderID]) {
        await this.CreateEventForReminderAsync(Reminder, TargetUserID);
      }
    }
  }

  // ✅ v1.2: DIRECTION 2: Calendar → Sleuth (NEW LOGIC)
  // Delete orphaned events AND events for reminders that fell out of the top 5
  const Top5ReminderIDs = new Set(Top5Reminders.map(r => r.ReminderID));
  await this.#CleanupOrphanedEventsAsync(Top5ReminderIDs);
}

async #CleanupOrphanedEventsAsync(ArgEligibleReminderIDs) {
  const TodayStart = DateUtils.GetStartOfDayInTimeZone(this.#WorkspaceInfo.MAIN_TIMEZONE);
  const TodayEnd = DateUtils.GetEndOfDayInTimeZone(this.#WorkspaceInfo.MAIN_TIMEZONE);

  // Fetch all Sleuth-managed events for today from all connected users
  for(const [UserID, UserTokens] of Object.entries(this.#UserTokens.users)) {
    if(!UserTokens.access_token) continue;

    try {
      const CalendarEvents = await this.#FetchSleuthEventsForDateRangeAsync(
        UserID,
        TodayStart,
        TodayEnd
      );

      for(const Event of CalendarEvents) {
        const ReminderID = Event.extendedProperties?.private?.sleuth_reminder_id;

        if(!ReminderID) continue;

        // Delete if reminder no longer exists OR is no longer in the top 5
        const ReminderExists = this.#RemindersModule.HasReminder(ReminderID);
        const IsEligible = ArgEligibleReminderIDs.has(ReminderID);

        if(!ReminderExists || !IsEligible) {
          const Reason = !ReminderExists ? 'reminder no longer exists' : 'fell out of top 5';
          this.#Logger.warn(
            `Cleaning up calendar event ${Event.id} ` +
            `(reminder ${ReminderID}: ${Reason}) - deleting`
          );
          await this.#DeleteCalendarEventAsync(UserID, Event.id);
          delete this.#EventMapping.reminder_to_event[ReminderID];
        }
      }
    } catch(error) {
      this.#Logger.error(`Failed to cleanup orphaned events for user ${UserID}:`, error);
      // Continue with other users
    }
  }

  await this.#SaveEventMappingAsync();
}

async #FetchSleuthEventsForDateRangeAsync(ArgUserID, ArgStartDate, ArgEndDate) {
  // Fetch events with sleuth_reminder_id extended property
  const Response = await this.#MakeCalendarAPICallAsync(ArgUserID, {
    method: 'GET',
    url: `https://www.googleapis.com/calendar/v3/calendars/primary/events`,
    params: {
      timeMin: ArgStartDate.toISOString(),
      timeMax: ArgEndDate.toISOString(),
      privateExtendedProperty: 'sleuth_reminder_id',  // Filter for Sleuth events only
      singleEvents: true
    }
  });

  return Response.items || [];
}
```

---

#### 5.1. Top 5 Oldest Reminders (WIP Limit)

**Rationale:**
- Prevents calendar overload (users won't see 50+ events cluttering their day)
- Forces prioritization: old tasks bubble to the top, creating urgency
- Encourages cleanup: users must complete/cancel old reminders to surface new ones
- Acts as a natural "work-in-progress" (WIP) limit
- Reduces Google Calendar API usage (cost/quota savings)

**Scheduling Model: Once-Daily on Startup**

Calendar sync runs **once per day** during app startup (or restart). There is no real-time event creation when reminders are created mid-day. This keeps the experiment simple and avoids over-engineering.

- On startup: sync top 5 oldest reminders to calendar, clean up stale events
- During the day: only reactive deletions (completed/canceled reminders remove their events)
- If a user finishes tasks early, they manage their own calendar for the rest of the day

**Behavior:**

| Scenario | Behavior |
|----------|----------|
| **User has 3 reminders due today** | All 3 sync to calendar on startup |
| **User has 10 reminders due today** | Only the 5 oldest (by `CreatedOn`) sync on startup |
| **User completes a synced reminder** | Event deleted from calendar immediately |
| **User completes all 5 synced reminders** | Calendar is clear; 6th surfaces on next startup |
| **New reminder created mid-day** | Not synced until next startup |
| **App restart** | Re-syncs top 5, cleans up events for reminders no longer in top 5 |

**User Experience:**

Startup log output:
```
[calendar-sync] Found 12 reminders due today, syncing top 5 oldest (WIP limit)
```

**Phase 2 Consideration:**
- **Phase 1:** 5 total (single test user)
- **Phase 2:** 5 per user (multi-user support)
- **Phase 3:** Configurable per workspace (e.g., `GOOGLE_CALENDAR_DAILY_LIMIT: 10`)

**Edge Case: What if user completes a reminder mid-day?**

When a reminder in the top 5 is completed:
1. Event is deleted from calendar (reactive, via `reminder:state-changed` event)
2. Mapping entry is removed
3. The 6th oldest reminder does **not** auto-promote until the next startup — this is intentional to keep the experiment simple
4. User can manually manage their freed-up calendar time

---

**Additional Method Needed in RemindersModule:**
```javascript
// Add to src/reminders-module.js
/**
 * Check if a reminder exists in the queue.
 * @param {string} ArgReminderID Reminder ID to check
 * @returns {boolean}
 */
HasReminder(ArgReminderID) {
  return this.#PendingRemindersQueue.some(r => r.ReminderID === ArgReminderID);
}
```

### Deliverables

- [ ] `/sleuth-calendar` slash command with all subcommands
- [ ] User-initiated OAuth flow via Slack
- [ ] Per-user token storage and management
- [ ] Automatic sync for all connected users
- [ ] Status command shows connection state
- [ ] Batch sync on startup for existing reminders
- [ ] Documentation: User guide for connecting calendar
- [ ] Admin documentation: OAuth app setup

### Testing Checklist

- [ ] User A connects calendar → OAuth flow completes successfully
- [ ] User B connects calendar → Both users have independent tokens
- [ ] User A's reminder → Event appears in User A's calendar only
- [ ] User B's reminder → Event appears in User B's calendar only
- [ ] Reminder assigned to User C → Event appears in User C's calendar
- [ ] User disconnects calendar → Future reminders don't create events
- [ ] User disconnects calendar → Existing events are deleted
- [ ] App restart → Existing reminders sync to connected calendars
- [ ] Token refresh works independently for each user
- [ ] Multiple users can authorize simultaneously without conflicts

### Known Limitations (Phase 2)

- No time-of-day distribution (all events use reminder's exact time)
- No conflict resolution if multiple reminders have same time
- No smart scheduling within 10 AM - 5 PM window
- No calendar event updates if reminder text changes
- No bidirectional sync (calendar changes don't affect Sleuth)

---

## Phase 3: Polish & Bells and Whistles

**Goal:** Production-ready feature with intelligent scheduling and user experience enhancements.

**Duration:** 2-3 weeks

### Scope

- **Smart time distribution**: Distribute today's tasks across 10 AM - 5 PM
- **Conflict detection**: Avoid overlapping events
- **Event updates**: Sync reminder text changes to calendar
- **Workspace configuration**: Admin controls for calendar feature
- **Analytics**: Track calendar sync usage and errors
- **Error recovery**: Graceful handling of API failures
- **User preferences**: Per-user customization options

### Technical Requirements

#### 1. Smart Time Distribution

**Algorithm:**
- Fetch user's existing calendar events for today
- Find available 1-hour slots between 10 AM - 5 PM
- Distribute Sleuth reminders into available slots
- Prioritize earlier slots for higher-priority tasks

**Configuration:**
```javascript
// Add to WorkspaceInfo
GOOGLE_CALENDAR_WORK_START: "10:00",  // Default 10 AM
GOOGLE_CALENDAR_WORK_END: "17:00",    // Default 5 PM
GOOGLE_CALENDAR_SLOT_DURATION: 60,    // Minutes per task
```

**Implementation:**
```javascript
async #FindAvailableSlotAsync(ArgUserID, ArgDate) {
  const ExistingEvents = await this.#GetUserEventsForDateAsync(ArgUserID, ArgDate);
  const WorkStart = this.#ParseWorkHours(this.#WorkspaceInfo.GOOGLE_CALENDAR_WORK_START);
  const WorkEnd = this.#ParseWorkHours(this.#WorkspaceInfo.GOOGLE_CALENDAR_WORK_END);

  const AvailableSlots = this.#CalculateAvailableSlots(
    ExistingEvents,
    WorkStart,
    WorkEnd,
    this.#SlotDuration
  );

  return AvailableSlots[0]; // Return earliest available slot
}
```

#### 2. Conflict Detection & Resolution

**Strategies:**
- **Check existing events**: Query user's calendar before creating event
- **Auto-adjust**: If slot is taken, find next available slot
- **User notification**: Post Slack message if no slots available
- **Overflow handling**: If day is full, offer to schedule for next day

**Notification Example:**
```
⚠️ Your calendar is full today (10 AM - 5 PM).
The reminder "Fix login bug (#123)" couldn't be scheduled.

Options:
• Schedule for tomorrow
• Extend work hours to 6 PM
• Skip calendar sync for this reminder
```

#### 3. Bidirectional Sync (DEFERRED TO PHASE 4)

**Reason for Deferral:**
Bidirectional sync requires:
- Publicly-accessible HTTPS endpoint (infrastructure change)
- Webhook signature verification
- Google Cloud Pub/Sub setup
- Channel watch management (renewals every 7 days)
- Conflict resolution logic
- Snooze guard interaction (see AGENTS.md Section 2)

**Snooze Guard Consideration:**
If a user moves a calendar event to Saturday (a snooze day), bidirectional sync would reschedule the reminder to Saturday. This violates the snooze guard contract. Decision needed:
- Option A: Ignore calendar changes on snooze days
- Option B: Allow calendar to override snooze (set `IgnoreSnooze = true`)
- Option C: Notify user of conflict, don't sync

**Recommendation:** Create separate plan document `P4-GOOGLE-CALENDAR-BIDIRECTIONAL.md` if this feature is needed.

#### 4. Workspace Configuration

**Add to `config/workspace-template.json`:**
```json
{
  "GOOGLE_CALENDAR_ENABLED": "true",
  "GOOGLE_CALENDAR_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
  "GOOGLE_CALENDAR_CLIENT_SECRET": "GOCSPX-...",
  "GOOGLE_CALENDAR_WORK_START": "10:00",
  "GOOGLE_CALENDAR_WORK_END": "17:00",
  "GOOGLE_CALENDAR_SLOT_DURATION": 60,
  "GOOGLE_CALENDAR_AUTO_DISTRIBUTE": "true",
  "GOOGLE_CALENDAR_CONFLICT_STRATEGY": "auto-adjust"
}
```

**Validation in `src/workspaces.js`:**
```javascript
// Validate Google Calendar settings if enabled
if(ArgTargetWorkspace.GOOGLE_CALENDAR_ENABLED === 'true') {
  if(!ArgTargetWorkspace.GOOGLE_CALENDAR_CLIENT_ID)
    throw new Error('GOOGLE_CALENDAR_CLIENT_ID required when calendar is enabled');

  if(!ArgTargetWorkspace.GOOGLE_CALENDAR_CLIENT_SECRET)
    throw new Error('GOOGLE_CALENDAR_CLIENT_SECRET required when calendar is enabled');
}
```

#### 5. User Preferences

**Per-User Settings:**
```json
{
  "users": {
    "U032TCHJ8": {
      "access_token": "...",
      "preferences": {
        "work_start": "09:00",           // Override workspace default
        "work_end": "18:00",             // Override workspace default
        "auto_distribute": true,         // Enable smart scheduling
        "conflict_strategy": "notify",   // "auto-adjust" | "notify" | "skip"
        "event_color": "9",              // Google Calendar color ID
        "include_non_github": false      // Sync all reminders, not just GitHub
      }
    }
  }
}
```

**Preference Commands:**
```
/sleuth-calendar set work-hours 9:00-18:00
/sleuth-calendar set auto-distribute on
/sleuth-calendar set conflict-strategy notify
```

#### 6. Analytics & Monitoring

**Track Metrics:**
- Events created per user per day
- OAuth connection success/failure rate
- API errors and retry counts
- Token refresh frequency
- Sync latency (reminder created → event created)

**Add to `src/stats-module.js`:**
```javascript
{
  "google_calendar": {
    "events_created_today": 15,
    "events_deleted_today": 3,
    "oauth_connections": 8,
    "api_errors_today": 2,
    "last_sync": "2026-03-03T14:45:00.000Z"
  }
}
```

#### 7. Error Recovery

**Graceful Degradation:**
- API rate limit hit → Queue events for retry
- Token expired → Attempt refresh, notify user if refresh fails
- Network error → Retry with exponential backoff
- Calendar not found → Notify user, disable sync for that user

**Retry Logic:**
```javascript
async #CreateEventWithRetryAsync(ArgReminder, ArgUserID, ArgMaxRetries = 3) {
  for(let i = 0; i < ArgMaxRetries; i++) {
    try {
      return await this.#CreateEventAsync(ArgReminder, ArgUserID);
    } catch(error) {
      if(this.#IsRateLimitError(error)) {
        await this.#WaitForRateLimitResetAsync(error);
        continue;
      }

      if(this.#IsTokenError(error)) {
        await this.#RefreshTokenAsync(ArgUserID);
        continue;
      }

      throw error; // Non-recoverable error
    }
  }
}
```

### Deliverables

- [ ] Smart time distribution across work hours
- [ ] Conflict detection and resolution
- [ ] User preference commands
- [ ] Workspace-level configuration
- [ ] Analytics dashboard (via stats)
- [ ] Error recovery and retry logic
- [ ] Comprehensive logging
- [ ] User documentation (setup, usage, troubleshooting)
- [ ] Admin documentation (configuration, monitoring)
- [ ] CHANGELOG.md entry with feature announcement

### Testing Checklist

- [ ] 5 reminders due today → Distributed across 10 AM - 5 PM
- [ ] User has existing meeting 2-3 PM → Sleuth events avoid that slot
- [ ] User's calendar is full → Notification posted, no event created
- [ ] Reminder text updated → Calendar event description updated
- [ ] API rate limit hit → Events queued and created after cooldown
- [ ] Token expires → Automatic refresh, sync continues
- [ ] User revokes access → Graceful error, user notified
- [ ] Multiple workspaces → Independent OAuth apps, no cross-contamination
- [ ] Workspace disables feature → No new events, existing events preserved
- [ ] User sets custom work hours → Events respect user preference

---

## Implementation Checklist

### Phase 1
- [ ] Google Cloud Project setup
- [ ] OAuth credentials created
- [ ] `google-calendar-module.js` created
- [ ] Token storage implemented
- [ ] Event mapping storage implemented
- [ ] GitHub URL detection implemented
- [ ] Integration with RemindersModule
- [ ] Manual OAuth flow tested
- [ ] Single user end-to-end test passed

### Phase 2
- [ ] `/sleuth-calendar` command implemented
- [ ] User-initiated OAuth flow
- [ ] Web API callback endpoint
- [ ] Per-user token management
- [ ] Batch sync on startup
- [ ] Multi-user testing completed
- [ ] User documentation written

### Phase 3
- [ ] Smart time distribution algorithm
- [ ] Conflict detection implemented
- [ ] User preferences system
- [ ] Workspace configuration
- [ ] Analytics integration
- [ ] Error recovery and retry logic
- [ ] Comprehensive testing
- [ ] Production deployment

### Post-Build Verification (Per Phase — AGENTS.md Section 8)

Each phase must complete these steps before merging:

- [ ] `npm run build` — type check passes (new module, method signatures, JSDoc types)
- [ ] `npm run dev` — startup smoke test, confirm GoogleCalendarModule initializes and subscribes to events
- [ ] Verify timer cleanup: `OAuthNonceCleanupTimer` cleared on shutdown, event bus listeners cleared via `ClearAllWorkspaceEventListeners()`
- [ ] Manual test: create reminder with GitHub URL due today → event appears in Google Calendar
- [ ] Manual test: complete reminder → event deleted from calendar, mapping entry cleaned up
- [ ] Manual test: app restart → orphaned events cleaned up, missing events reconciled
- [ ] Bump version in `package.json`
- [ ] Update `CHANGELOG.md` with feature description
- [ ] Add `#lessonslearned` entry: event bus pattern enables cross-module coordination without circular dependencies
- [ ] Update `AGENTS.md` Section 2 (Runtime Build Contract) with GoogleCalendarModule startup position
- [ ] Update `AGENTS.md` Section 11 (Key Paths) to include `src/google-calendar-module.js`
- [ ] Update `docs/web-api.md` with `GET /google-calendar/oauth/callback` endpoint documentation

---

## Dependencies

### NPM Packages

**Recommended Approach (Smaller Footprint):**
```json
{
  "google-auth-library": "^9.6.3"
}
```

Use `google-auth-library` for OAuth + direct REST API calls to Google Calendar API. This avoids the ~80MB `googleapis` package which bundles every Google API client.

**Alternative (Full SDK):**
```json
{
  "googleapis": "^134.0.0"
}
```

Use full SDK if we anticipate adding other Google integrations (Drive, Docs, etc.) in the future.

**Phase 1 Recommendation:** Start with `google-auth-library` + REST. Can migrate to full SDK later if needed.

**REST API Example:**
```javascript
async #CreateEventAsync(ArgCalendarId, ArgEventData, ArgAccessToken) {
  const Response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${ArgCalendarId}/events`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ArgAccessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(ArgEventData)
    }
  );

  if(!Response.ok) {
    throw new Error(`Calendar API error: ${Response.status} ${await Response.text()}`);
  }

  return await Response.json();
}
```

### Google Cloud Resources
- Google Cloud Project
- Google Calendar API enabled
- OAuth 2.0 Client ID (Web application)
- OAuth consent screen configured

### Sleuth Modules
- `src/reminders-module.js` - Emit reminder lifecycle events
- `src/slack-app.js` - Slash command handling + event bus
- `src/web-api.js` - OAuth callback endpoint (GET)
- `src/workspaces.js` - Configuration validation
- `src/stats-module.js` - Analytics tracking

### Module Startup Order (per AGENTS.md Section 2)

**Current Order:**
1. Load workspace via `workspaces`
2. Create `SlackApp`
3. Start `StatsModule`
4. Create `ListsModule`, `RemindersModule`, `NotionModule`, `ChatModule`
5. Start `SlackApp`, then `RemindersModule`, then `ListsModule`, then `NotionModule`

**With GoogleCalendarModule:**
1. Load workspace via `workspaces`
2. Create `SlackApp`
3. Start `StatsModule`
4. Create `ListsModule`, `RemindersModule`, `NotionModule`, `ChatModule`, **`GoogleCalendarModule`**
5. Start `SlackApp`
6. Start `RemindersModule` (begins emitting events)
7. **Start `GoogleCalendarModule`** (subscribes to reminder events)
8. Start `ListsModule`, then `NotionModule`

**Rationale:**
- GoogleCalendarModule must start **after** RemindersModule so it can subscribe to events
- GoogleCalendarModule must start **before** any reminders are created/processed
- Placement between RemindersModule and ListsModule maintains dependency order

---

## Security Considerations

1. **Token Storage**:
   - Tokens stored in `data/runtime/google-calendar/` (already in `.gitignore`)
   - File permissions: `chmod 600` for token files
   - Future: Consider encryption at rest using workspace-specific key

2. **OAuth State Parameter**:
   - ✅ **IMPLEMENTED**: Server-side nonce store with HMAC verification
   - Nonces expire after 10 minutes
   - One-time use (deleted after successful callback)
   - Prevents CSRF attacks

3. **Scope Minimization**:
   - Request only `https://www.googleapis.com/auth/calendar.events` scope
   - NOT `calendar` (full access) or `calendar.readonly`

4. **Token Rotation**:
   - Implement automatic token refresh when `expiry_date < Date.now() + 5 minutes`
   - Store refresh tokens securely
   - Handle refresh failures gracefully (notify user to re-authorize)

5. **Revocation Handling (v1.2 Update - Persistent Notifications)**:
   - Catch 401 errors from Calendar API
   - Mark user as disconnected
   - ✅ **Use persistent DM** (not ephemeral message) for background failures

   **Implementation:**
   ```javascript
   async #HandleAuthFailureAsync(ArgUserID, ArgError) {
     this.#Logger.error(`Calendar auth failed for user ${ArgUserID}:`, ArgError);

     // Mark user as disconnected
     this.#UserTokens.users[ArgUserID].auth_failed = true;
     this.#UserTokens.users[ArgUserID].auth_failed_at = new Date().toISOString();
     await this.#SaveUserTokensAsync();

     // Check if we should notify (avoid spam)
     if(!await this.#ShouldNotifyUserOfAuthFailureAsync(ArgUserID)) {
       return;
     }

     // ✅ v1.2: SEND PERSISTENT DM (not ephemeral message)
     // This ensures user sees the alert even if failure happens overnight
     try {
       await this.#SlackApp.PostDirectMessageAsync(
         ArgUserID,
         `⚠️ *Google Calendar Connection Lost*\n\n` +
         `Your calendar sync has stopped working. This usually happens when:\n` +
         `• You revoked Sleuth's access in Google settings\n` +
         `• Your authorization expired\n\n` +
         `To reconnect, run: \`/sleuth-calendar connect\``
       );

       // Track notification timestamp
       this.#AuthFailureNotifications.set(ArgUserID, Date.now());
     } catch(dmError) {
       this.#Logger.error(`Failed to send auth failure DM to ${ArgUserID}:`, dmError);
     }

     // Also log to workspace channel for admin visibility
     await this.#SlackApp.PostMessageTextAsync(
       this.#WorkspaceInfo.REMINDER_CHANNEL_NAME,
       null, // no thread
       `⚠️ Calendar sync failed for <@${ArgUserID}>. User has been notified.`
     );
   }

   #AuthFailureNotifications = new Map(); // UserID -> last notification timestamp

   async #ShouldNotifyUserOfAuthFailureAsync(ArgUserID) {
     const LastNotification = this.#AuthFailureNotifications.get(ArgUserID);

     if(!LastNotification) return true;

     // Only notify once per 24 hours to avoid spam
     const HoursSinceLastNotification = (Date.now() - LastNotification) / (1000 * 60 * 60);
     return HoursSinceLastNotification >= 24;
   }
   ```

6. **Audit Logging**:
   - Log all OAuth flows (authorization, callback, token refresh)
   - Log all Calendar API calls (create, update, delete events)
   - Include user ID, workspace, and timestamp
   - Do NOT log access tokens or refresh tokens

---

## Rollout Strategy

1. **Phase 1**: Internal testing with 1-2 users in `neochrome` workspace
2. **Phase 2**: Beta testing with 5-10 users across 2-3 workspaces
3. **Phase 3**: Gradual rollout to all workspaces with opt-in flag
4. **Post-Launch**: Monitor for 2 weeks, gather feedback, iterate

---

## Success Metrics

- **Adoption**: % of users who connect their calendar within 30 days
- **Engagement**: Average events created per user per week
- **Reliability**: API success rate > 99.5%
- **Performance**: Event creation latency < 2 seconds
- **User Satisfaction**: Positive feedback in Slack channels

---

## Rate Limiting & Performance

**Google Calendar API Quotas:**
- **Global**: 1,000,000 queries/day per project
- **Per-User**: 500 requests per 100 seconds per user
- **Burst**: 10 requests/second per user

**Risk Scenario:**
Monday morning, 50 users in workspace, each has 10 reminders due today = 500 events to create. If all created simultaneously, could hit per-user rate limit.

**Mitigation Strategies:**

1. **Batch Processing (Phase 1-2):**
   ```javascript
   async #CreateEventsWithRateLimitAsync(ArgEvents, ArgUserID) {
     const BATCH_SIZE = 5;
     const DELAY_MS = 1000; // 1 second between batches

     for(let i = 0; i < ArgEvents.length; i += BATCH_SIZE) {
       const Batch = ArgEvents.slice(i, i + BATCH_SIZE);
       await Promise.all(Batch.map(e => this.#CreateEventAsync(e, ArgUserID)));

       if(i + BATCH_SIZE < ArgEvents.length) {
         await new Promise(resolve => setTimeout(resolve, DELAY_MS));
       }
     }
   }
   ```

2. **Queue-Based Processing (Phase 3):**
   - Add events to queue instead of creating immediately
   - Background worker processes queue at controlled rate
   - Respects per-user rate limits

3. **Exponential Backoff (Phase 3):**
   - Already planned in error recovery section
   - Retry with increasing delays: 1s, 2s, 4s, 8s, 16s

4. **Monitoring:**
   - Track API calls per user per minute
   - Alert if approaching rate limits
   - Add to stats: `google_calendar.api_calls_today`

## Testing Strategy

**Current State:**
- `package.json` shows: `"test": "echo \"Error: no test specified\" && exit 1"`
- No test infrastructure exists
- P1-WEEKEND-SNOOZE.md already flagged this gap

**Phase 1 Testing (Manual):**
- [ ] Manual testing checklist (documented in plan)
- [ ] Test user performs end-to-end flow
- [ ] Logs reviewed for errors
- [ ] **Deliverable**: Document test results in `docs/testing/google-calendar-phase1-results.md`

**Phase 2 Testing (Semi-Automated):**
- [ ] Create test script: `scripts/test-google-calendar.js`
- [ ] Automated OAuth flow testing (mock Google responses)
- [ ] Multi-user token management tests
- [ ] **Deliverable**: Test script that can be run manually

**Phase 3 Testing (Automated):**
- [ ] Set up test framework (Jest or Mocha)
- [ ] Unit tests for GoogleCalendarModule methods
- [ ] Integration tests with mock Calendar API
- [ ] **Deliverable**: `npm test` runs Google Calendar tests

**Post-Phase 3:**
- [ ] Add to CI/CD pipeline (if one exists)
- [ ] Create separate issue to address repo-wide testing gap

**Note:** This plan acknowledges the testing debt but doesn't block implementation. Each phase includes appropriate testing for its scope.

## Open Questions

1. Should we support Google Workspace (enterprise) calendars differently?
2. Should we allow users to choose which calendar (if they have multiple)?
3. Should we sync reminders without GitHub URLs (Phase 3 preference)?
4. Should we support other calendar providers (Outlook, Apple Calendar)?
5. Should calendar events include Slack deep links back to original message? (Answer: Yes, already in event description)
6. Should we support recurring reminders → recurring calendar events?
7. **NEW:** How should we handle users in multiple workspaces? (Same Google account, different Slack workspaces)
8. **NEW:** Should we support team calendars (shared calendars) in addition to personal calendars?

---

## References

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/guides/overview)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [googleapis Node.js Client](https://github.com/googleapis/google-api-nodejs-client)
- [Google Calendar API Quotas](https://developers.google.com/calendar/api/guides/quota)
- Sleuth Architecture: `AGENTS.md`, `docs/coding-conventions.md`

---

## Summary of Changes

### v1.2 - Top 5 Oldest Reminders (WIP Limit) - 2026-03-03

**Change:** Added daily limit of 5 calendar events (oldest reminders first).

**Rationale:**
- Prevents calendar overload (users won't see 50+ events)
- Forces prioritization: old tasks create urgency
- Encourages cleanup: must complete/cancel old reminders to surface new ones
- Natural work-in-progress (WIP) limit
- Reduces Google Calendar API usage

**Implementation:**
- Sort reminders by `CreatedOn` ascending (oldest first)
- Take top 5 only
- Check `#IsReminderInTop5Oldest()` before creating events
- Startup reconciliation respects limit
- Automatic queue progression: when top-5 reminder completes, 6th becomes eligible

**User Impact:**
- Users with 3 reminders: all 3 sync
- Users with 10 reminders: only 5 oldest sync
- Completing a reminder automatically surfaces the next oldest

**Future Phases:**
- Phase 2: 5 per user (multi-user)
- Phase 3: Configurable limit per workspace

**Code Locations:**
- Section "5.1. Top 5 Oldest Reminders (WIP Limit)"
- `#ReconcileCalendarOnStartupAsync()` - startup sync
- `#HandleReminderCreatedAsync()` - real-time creation

---

### v1.2 - Simplified GCP Setup (2 Projects) - 2026-03-03

**Change:** Simplified Google Cloud Platform setup from 3 projects to 2 projects.

**Rationale:**
- Local development and development server can share the same GCP project and credentials
- Reduces complexity while maintaining production isolation
- Easier credential management during Phase 1 POC

**New Setup:**
1. **Project 1: `sleuth-development`**
   - Used by: Local dev (Mac) + Development server
   - Redirect URIs: `localhost:2020` + `203.0.113.12:2020`
   - Credentials: Shared between local and dev server

2. **Project 2: `sleuth-production`**
   - Used by: Production server only
   - Redirect URI: `203.0.113.13:2020`
   - Credentials: Production-only

**Added:**
- Comprehensive credentials setup checklist (Section 1)
- Environment-specific configuration table
- Step-by-step setup instructions for each environment (local, dev, prod)

---

### Round 1 Review (v1.1 - 2026-03-03)

Addressed 10 red flags and 3 minor concerns:

**Red Flags Fixed:**
1. ✅ OAuth callback changed from POST to GET (Google redirects are GET requests)
2. ✅ Integration point corrected: Event-based pattern instead of non-existent `#ScheduleRemindersAsync`
3. ✅ OAuth state parameter now CSRF-safe with server-side nonce verification
4. ✅ Circular dependency avoided: Event emitter pattern maintains one-way dependency flow
5. ✅ Event summary uses `ReminderMessageText` directly (no GitHub API call needed)
6. ✅ File-based token storage includes concurrency protection (promise chaining pattern)
7. ✅ Module startup order explicitly defined (after RemindersModule, before ListsModule)
8. ✅ Snooze guard interaction documented (bidirectional sync deferred to Phase 4)
9. ✅ NPM dependencies reduced: `google-auth-library` + REST API instead of full `googleapis` SDK
10. ✅ Testing strategy documented (acknowledges gap, provides phase-appropriate approach)

**Minor Concerns:**
- Bidirectional sync moved to separate Phase 4 plan
- `colorId: "9"` corrected to "Blueberry"
- Rate limiting strategy added with batch processing and monitoring

**Non-Sequential Workflow:**
- Added support for POC user self-authorization via helper script
- Admin configures OAuth credentials once
- POC user runs interactive script anytime to connect Google Calendar
- No server restart required for user authorization

---

### Round 2 Review (v1.2 - 2026-03-03)

Addressed 4 data lifecycle and edge case gaps:

#### 1. ✅ Incomplete Data Lifecycle for Event Mappings

**The Gap:** Event mappings in `_event_mapping.json` were never deleted when reminders were completed.

**The Risk:**
- File grows indefinitely with stale entries
- Memory/performance degradation over time
- Debugging becomes difficult with thousands of orphaned mappings

**The Fix:** `DeleteEventForReminderAsync()` now:
- Deletes the calendar event
- Deletes the mapping entry from `_event_mapping.json`
- Handles 404 errors gracefully (still cleans up mapping)

**Code Location:** Section "6. Event Management Implementation (v1.2 Updates)"

---

#### 2. ✅ Startup Reconciliation Is Only One-Way

**The Gap:** Batch sync on startup only created events for existing reminders, but didn't clean up orphaned calendar events (events pointing to deleted reminders).

**The Risk:**
- Calendar accumulates "ghost" events for reminders deleted while app was offline
- User's calendar state drifts from Sleuth's state
- No way to recover without manual calendar cleanup

**The Fix:** Implemented two-way reconciliation:
- **Direction 1 (Sleuth → Calendar):** Create events for reminders that don't have calendar events
- **Direction 2 (Calendar → Sleuth):** Delete orphaned events that don't have active reminders

**New Methods:**
- `#CleanupOrphanedEventsAsync()` - Fetches Sleuth-managed events and deletes orphans
- `#FetchSleuthEventsForDateRangeAsync()` - Queries calendar for events with `sleuth_reminder_id`
- `RemindersModule.HasReminder(ArgReminderID)` - Checks if reminder exists in queue

**Code Location:** Phase 2, Section "5. Two-Way Reconciliation on Startup (v1.2 Update)"

---

#### 3. ✅ Oversimplified Logic for Rescheduled Reminders

**The Gap:** Plan said "rescheduled → update event" but didn't account for date boundary changes (today ↔ tomorrow).

**The Risk:**
- Reminder moved from today to tomorrow: Event remains on today's calendar (incorrect)
- Reminder moved from tomorrow to today: No event created for today (missing)
- User's calendar shows wrong dates for tasks

**The Fix:** Date-aware rescheduling logic:
- **Today → Tomorrow:** DELETE event
- **Tomorrow → Today:** CREATE event
- **Today → Today (time change):** UPDATE event
- **Future → Future:** No action needed

**Requirements:**
- Track `previousShouldPostOn` in event data to detect date changes
- New helper method: `#WasDateToday(ArgDate)`

**Code Location:** Phase 1, Section "5. Event-Based Integration Pattern"

---

#### 4. ✅ Ambiguous User Notification for Background Auth Failures

**The Gap:** Plan mentioned notifying users of token expiry but didn't specify delivery mechanism for background failures.

**The Risk:**
- Background sync fails overnight → User never sees ephemeral message
- Silent sync failures until user next interacts with app
- User thinks sync is working when it's been broken for days

**The Fix:** Persistent DM notifications with 24-hour backoff:
- Use `PostDirectMessageAsync()` instead of ephemeral messages
- Track notification timestamps to avoid spam (once per 24 hours)
- Also log to workspace channel for admin visibility
- Mark user as disconnected in token file

**New Methods:**
- `#HandleAuthFailureAsync(ArgUserID, ArgError)` - Sends persistent DM
- `#ShouldNotifyUserOfAuthFailureAsync(ArgUserID)` - Implements 24-hour backoff

**Code Location:** Security Considerations, Section "5. Revocation Handling (v1.2 Update)"

---

### Summary Table

| Issue | Impact | Complexity | Phase | Status |
|-------|--------|------------|-------|--------|
| Event mapping cleanup | High (data leak) | Low | Phase 1 | ✅ Fixed v1.2 |
| Two-way reconciliation | High (data drift) | Medium | Phase 2 | ✅ Fixed v1.2 |
| Date-aware rescheduling | High (incorrect events) | Medium | Phase 1 | ✅ Fixed v1.2 |
| Persistent auth notifications | Medium (UX) | Low | Phase 2 | ✅ Fixed v1.2 |


