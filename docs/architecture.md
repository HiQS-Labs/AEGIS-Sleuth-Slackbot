# AEGIS App Architecture

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [AI Decision-Making Process](#ai-decision-making-process)
5. [Message Flow & Processing](#message-flow--processing)
6. [Data Architecture](#data-architecture)
7. [Multi-tenant Architecture](#multi-tenant-architecture)
8. [Deployment Architecture](#deployment-architecture)

## Overview

AEGIS is a multi-tenant Slack application that combines AI-powered task reminder scheduling with ChatGPT-like conversational capabilities. The application uses OpenAI's GPT models to:
- Detect actionable language in messages and automatically schedule reminders
- Provide intelligent chat responses to direct mentions
- Search Notion workspaces for relevant information
- Forward admin-only `ask-woo` questions to an external WP DB Toolkit RAG service when a workspace enables that integration

### Key Technologies
- **Runtime**: Node.js v18.20.4+ (JavaScript)
- **Slack Integration**: Bolt for JavaScript SDK
- **AI Provider**: OpenAI API (GPT-4o-mini default, GPT-4o for complex date extraction)
- **Web Framework**: Express for REST API
- **External Integration**: Notion API for workspace search
- **Optional External Integration**: WP DB Toolkit RAG service for admin-only Slack queries
- **Monitoring**: New Relic for application performance monitoring

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Slack Workspaces                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │Workspace1│  │Workspace2│  │Workspace3│  │Workspace N│   │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘  └─────┬────┘   │
└────────┼─────────────┼─────────────┼─────────────┼─────────┘
         │             │             │             │
         └─────────────┴──────┬──────┴─────────────┘
                              │ Socket Mode
                              ▼
        ┌──────────────────────────────────────────────┐
        │              AEGIS Application              │
        │                                              │
        │  ┌────────────────────────────────────────┐  │
        │  │            app.js (Main)               │  │
        │  │  - Module initialization               │  │
        │  │  - Workspace loading                   │  │
        │  │  - Process lifecycle management        │  │
        │  └────────────┬───────────────────────────┘  │
        │               │                              │
        │  ┌────────────▼───────────────────────────┐  │
        │  │         Module Orchestration           │  │
        │  │                                        │  │
        │  │  ┌──────────┐  ┌──────────────────┐   │  │
        │  │  │SlackApp  │  │RemindersModule   │   │  │
        │  │  └──────────┘  └──────────────────┘   │  │
        │  │  ┌──────────┐  ┌──────────────────┐   │  │
        │  │  │ChatModule│  │NotionModule      │   │  │
        │  │  └──────────┘  └──────────────────┘   │  │
        │  │  ┌──────────┐  ┌──────────────────┐   │  │
        │  │  │StatsModule│ │WorkspaceAI       │   │  │
        │  │  └──────────┘  └──────────────────┘   │  │
        │  │  ┌──────────┐  ┌──────────────────┐   │  │
        │  │  │ListsModule│ │SettingsModule    │   │  │
        │  │  └──────────┘  └──────────────────┘   │  │
        │  └────────────────────────────────────────┘  │
        │                                              │
        │  ┌────────────────────────────────────────┐  │
        │  │            Web API (Port 2020)         │  │
        │  │  - Workspace management                │  │
        │  │  - Statistics retrieval                │  │
        │  └────────────────────────────────────────┘  │
        └──────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                ▼                           ▼
        ┌──────────────┐           ┌──────────────┐
        │  OpenAI API  │           │  Notion API  │
        └──────────────┘           └──────────────┘
```

## Core Components

### 1. Main Application (app.js)
**Location**: `src/app.js`

The entry point and orchestrator for the entire application:
- Initializes New Relic monitoring
- Loads all workspace configurations
- Creates and manages module instances for each workspace
- Handles graceful shutdown with notification posting
- Manages the Web API server

**Key Responsibilities**:
- Module lifecycle management (start/stop in dependency order)
- Git branch detection for deployment notifications
- Process signal handling (SIGINT for graceful shutdown)

### 2. SlackApp Module (slack-app.js)
**Location**: `src/slack-app.js`

Core Slack integration layer using Bolt framework:
- Manages Socket Mode connections per workspace
- Routes Slack events to appropriate handlers
- Provides unified interface for Slack API operations
- Handles message posting, reactions, and metadata

**Event Routing**:
```javascript
- message events → RemindersModule → ChatModule (fallthrough)
- app_mention events → RemindersModule → NotionModule → ChatModule
- reaction_added events → RemindersModule (for 🚨 and 🗑️ emojis)
```

### 3. RemindersModule (reminders-module.js)
**Location**: `src/reminders-module.js`

Handles all reminder-related functionality:
- Analyzes messages for actionable language using AI
- Schedules and persists reminders
- Manages reminder timer (60-second check interval)
- Handles manual reminder creation via 🚨 emoji
- Supports reminder cancellation via 🗑️ emoji
- Implements duplicate detection with ♊ indicator

**Reminder Processing Pipeline**:
1. Message received → AI analysis for actionable language
2. Date extraction from scheduling triggers
3. Duplicate checking against existing reminders
4. Reminder creation and persistence
5. User feedback with emoji reactions
6. Timer-based reminder delivery

### 4. ChatModule (chat-module.js)
**Location**: `src/chat-module.js`

Provides ChatGPT-like conversational interface:
- Handles direct mentions not captured by other modules
- Maintains conversation context within threads
- Implements hands-free mode for continued conversation
- Processes timezone queries and calculations

**Chat Features**:
- Thread-aware context management
- Hands-free mode (30-minute timeout)
- Model information disclosure
- Timezone-aware responses
- Optional admin-only `ask-woo` command for a configured external RAG service

### 5. WorkspaceAI (workspace-ai.js)
**Location**: `src/workspace-ai.js`

Centralized AI integration layer:
- Manages OpenAI API connections per workspace
- Provides typed interfaces for AI operations
- Handles model selection (gpt-4o-mini default, gpt-4o for complex tasks)
- Implements structured JSON responses with schema validation

**AI Operations**:
- `ProcessMessageWithJsonResponseAsync`: Structured responses for reminders
- `ProcessMessageWithTextResponseAsync`: Free-form chat responses
- Model cost tracking through WorkspaceStats integration

### 6. StatsModule (stats-module.js)
**Location**: `src/stats-module.js`

Usage tracking and analytics:
- Tracks reminder counts (created, posted, deleted)
- Monitors AI token usage and costs
- Provides per-workspace statistics
- Persists stats to JSON files

### 7. NotionModule (notion-module.js)
**Location**: `src/notion-module.js`

Notion workspace search integration:
- Handles "@Sleuth AI notion search" commands
- Searches across Notion databases and pages
- Returns formatted results with direct links

### 8. Web API (web-api.js)
**Location**: `src/web-api.js`

REST API for remote management (Port 2020):
- Workspace CRUD operations
- Statistics retrieval
- Bearer token authentication
- No hot-reload support (requires service restart)

**Endpoints**:
- `POST /workspace` - Create/update workspace
- `GET /workspaces` - List all workspaces
- `GET /workspace/:name` - Get workspace details
- `DELETE /workspace/:name` - Delete workspace
- `GET /workspace/:name/stats` - Get usage statistics

## AI Decision-Making Process

### How AI Determines What Is a Todo/Reminder

The AI decision-making process follows a sophisticated pipeline to distinguish between actionable tasks (reminders) and regular conversation:

#### 1. Initial Message Analysis
When a message is received, it's analyzed using GPT-4o-mini with specific instructions (`data/static/ai/reminders-instructions.md`):

**Decision Criteria**:
- **Schedule**: Message contains "actionable language" with associated "scheduling triggers"
- **Ignore**: Message lacks actionable language OR contains "exclusion language"

#### 2. Actionable Language Detection

**What Constitutes Actionable Language**:
- Future commitments: "I will...", "I plan to...", "I need to..."
- Expectations: "I expect to...", "I hope to..."
- Requests: "Please...", "Can you...", "You must..."
- Suggestions: "I suggest you...", "You should..."

**Examples**:
```
✅ "I will fix the bug on Monday before proceeding"
✅ "Please download the logs and let me know by tomorrow"
✅ "I plan on reviewing the changes later today"
❌ "I fixed the bug yesterday" (past tense)
❌ "The meeting is at 3 PM" (informational only)
```

#### 3. Scheduling Trigger Requirements

For a message to become a reminder, it MUST contain scheduling triggers:

**Valid Scheduling Triggers**:
- **Relative times**: today, tonight, tomorrow, next week, EOD, in a few hours
- **Weekday names**: Monday, Tuesday, Wednesday, etc.
- **Dates**: 10-01 (October 1st), Monday 11-11
- **Times**: 12:30 AM, 9 AM PST, 18:05 EAT

**Important**: Scheduling triggers must be directly associated with actionable language. Unrelated time references are ignored.

#### 4. Exclusion Language

Certain patterns automatically prevent reminder creation:

**Excluded Patterns**:
- Work summaries: "ending my day", "weekly summary"
- Day planning: "starting my day", "plans for today"
- Past activities: "completed", "finished", "done"
- Meeting/call scheduling: "meeting", "meetings", "zoom call", "teams call", "call at" (informational only)

#### 5. AI Response Structure

The AI returns a structured JSON response:

```json
{
  "recommendation": "schedule|ignore",
  "rationale": "Detailed explanation of the decision",
  "reminders": [
    {
      "actionable_language": "I will work on it",
      "scheduling_trigger": "tomorrow",
      "reminder_message": "Work on it"
    }
  ]
}
```

#### 6. Date Extraction Process

When reminders are scheduled, a second AI call (using GPT-4o for accuracy) extracts specific dates:

1. **Context Provision**: Current date/time in workspace timezone
2. **Natural Language Processing**: Parse phrases like "tomorrow morning", "next Monday"
3. **Time Zone Handling**: Apply workspace timezone settings
4. **Smart Defaults**: 
   - Morning = 9:00 AM
   - Afternoon = 2:00 PM
   - Evening = 6:00 PM
   - Night = 9:00 PM

#### 7. Manual Override Options

Users can force reminder creation regardless of AI detection:
- **🚨 emoji reaction**: Forces reminder for "tomorrow morning"
- **Direct commands**: "@Sleuth AI enable reminders"

### Chat vs Reminder Routing

The system uses a waterfall approach for message handling:

```
1. RemindersModule checks first
   ├─ Contains actionable language + trigger? → Create reminder
   └─ No actionable language? → Pass to next module

2. NotionModule checks (for app mentions)
   ├─ Contains "notion search"? → Handle search
   └─ Not a Notion command? → Pass to next module

3. ChatModule handles remaining
   └─ All unhandled mentions → Generate chat response
```

This ensures that reminder-related queries (like "show my reminders") are handled by the RemindersModule, not misinterpreted as chat requests.

## Message Flow & Processing

### Standard Message Flow

```
User Message in Slack
         │
         ▼
   Socket Mode Event
         │
         ▼
    SlackApp Router
         │
    ┌────┴────┐
    │ message │ (regular messages)
    │  event  │
    └────┬────┘
         │
         ▼
  RemindersModule.#OnMessageAsync
         │
         ├─ Channel enabled? ──No──→ Return false
         │
         ├─ Yes
         ▼
  AI Analysis (GPT-4o-mini)
         │
         ├─ Actionable? ──No──→ Return false → ChatModule
         │
         ├─ Yes
         ▼
  Date Extraction (GPT-4o)
         │
         ▼
  Duplicate Check
         │
         ├─ Duplicate? ──Yes──→ Add ♊ reaction
         │
         ├─ No
         ▼
  Create Reminder
         │
         ▼
  Add ✅ reaction
         │
         ▼
  Schedule for posting
```

### App Mention Flow

```
@Sleuth AI mention
         │
         ▼
   app_mention event
         │
         ▼
  RemindersModule.#OnAppMentionAsync
         │
         ├─ "show reminders"? ──Yes──→ Display reminders
         ├─ "enable reminders"? ──Yes──→ Enable for channel
         ├─ "disable reminders"? ──Yes──→ Disable for channel
         │
         ├─ No
         ▼
  NotionModule check
         │
         ├─ "notion search"? ──Yes──→ Search Notion
         │
         ├─ No
         ▼
  ChatModule.#OnAppMentionAsync
         │
         ▼
  Generate AI response
```

### Emoji Reaction Flow

```
Emoji Reaction Added
         │
         ▼
  reaction_added event
         │
         ▼
  RemindersModule.#OnReactionAddedAsync
         │
         ├─ 🚨 (siren)? ──Yes──→ Force reminder creation
         │                        (tomorrow morning)
         │
         ├─ 🗑️ (wastebasket)? ──Yes──→ Delete reminder(s)
         │                              Delete feedback message
         │
         └─ Other emoji → Ignore
```

## Data Architecture

### File System Structure

```
sleuth-app/
├── data/
│   ├── runtime/           # Per-workspace runtime data
│   │   ├── reminders/
│   │   │   ├── {workspace}_reminders.json
│   │   │   ├── {workspace}_reminder_counter.json
│   │   │   └── {workspace}_enabled_channels.json
│   │   ├── stats/
│   │   │   └── {workspace}_stats.json
│   │   └── workspaces/
│   │       ├── {workspace}.json
│   │       └── lists/
│   │           └── {workspace}_lists_cache.json
│   └── static/           # AI instructions and schemas
│       └── ai/
│           ├── chat-instructions.md
│           ├── reminders-instructions.md
│           ├── reminders-schema.json
│           ├── date-extraction-instructions.md
│           ├── date-extraction-schema.json
│           ├── reminders-dedup-instructions.md
│           └── reminders-dedup-schema.json
```

### Data Schemas

#### Reminder Storage
```javascript
{
  "ReminderID": "uuid-v4",
  "CreatedOn": "2024-01-01T10:00:00Z",
  "ShouldPostOn": "2024-01-02T09:00:00Z",
  "TargetChannelID": "C1234567890",
  "OriginalChannelID": "C1234567890",
  "OriginalChannelName": "general",
  "OriginalMessageID": "1234567890.123456",
  "OriginalSenderID": "U1234567890",     // who created the reminder
  "AssigneeID": "U9876543210",           // who should do the task (null = self-assigned, defaults to OriginalSenderID on load)
  "ReminderMessageText": "Work on the bug fix",
  "IgnoreSnooze": false,
  "GitHubUrls": null,                    // extracted GitHub issue/PR URLs, or null
  "State": "scheduled"                   // FSM state: scheduled|due|snoozed|posting|posted|rescheduled|failed|completed|canceled|dead-letter
}
// Note: AssigneeID, OriginalChannelName, State, and GitHubUrls are backwards-compatible optional fields
// backfilled at load time for legacy records missing them.
```

#### Workspace Configuration
```javascript
{
  "WORKSPACE_NAME": "example-workspace",
  "LIVE_TOKEN": "xoxb-...",
  "LIVE_SIGNING_SECRET": "...",
  "LIVE_APP_TOKEN": "xapp-...",
  "OPENAI_API_KEY": "sk-...",
  "REMINDER_CHANNEL_NAME": "reminders",
  "MAIN_TIMEZONE": "America/Los_Angeles",
  "NOTION_TOKEN": "secret_..." // optional
}
```

## Multi-tenant Architecture

### Workspace Isolation

Each workspace operates independently with:
- **Separate Slack connections**: Individual Socket Mode connections
- **Isolated data storage**: Workspace-prefixed JSON files
- **Independent AI instances**: Per-workspace OpenAI clients
- **Separate configuration**: Individual environment variables

### Resource Management

```javascript
// Module instances per workspace
for(const WorkspaceName of workspaceNames) {
  const WorkspaceInfo = loadWorkspace(WorkspaceName);
  
  // Create isolated instances
  SlackApps.push(new SlackApp(WorkspaceInfo));
  StatsModules.push(new StatsModule(SlackApp));
  ChatModules.push(new ChatModule(SlackApp));
  RemindersModules.push(new RemindersModule(SlackApp));
  NotionModules.push(new NotionModule(SlackApp));
}
```

### Scaling Considerations

- **Vertical scaling**: Single Node.js process handles all workspaces
- **Memory usage**: Linear growth with workspace count
- **API rate limits**: Shared across all workspaces (OpenAI, Slack)
- **Timer coordination**: Single 60-second interval checks all workspace reminders

## Deployment Architecture

### Service Configuration

**systemd Service** (`sleuth-app.service`):
```ini
[Unit]
Description=AEGIS AI Slack App
After=network.target

[Service]
Type=simple
User=sleuth
WorkingDirectory=/opt/sleuth-app
ExecStart=/usr/bin/node src/app.js
Restart=always
RestartSec=10
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
```

### Deployment Process

1. **GitHub Actions**: Automated deployment on push to main
2. **Self-hosted Runner**: Executes deployment scripts
3. **Service Management**: 
   - Stop service
   - Pull latest code
   - Install dependencies
   - Restart service
4. **Notification**: Posts update message to all workspace reminder channels

### Monitoring & Logging

- **Application Monitoring**: New Relic APM integration
- **Process Logs**: systemd journal (`journalctl --unit=sleuth-app`)
- **Console Logging**: Slack ConsoleLogger for structured output
- **Error Tracking**: Logged but non-fatal to maintain uptime

### High Availability Considerations

**Current Limitations**:
- Single instance deployment (no clustering)
- No automatic failover
- Service restart required for configuration changes
- 10-second restart delay on failure

**Reliability Features**:
- Automatic restart on crash (systemd)
- Graceful shutdown with notification
- State persistence to JSON files
- Error isolation per workspace

## Security Considerations

### Authentication & Authorization

- **Slack**: OAuth tokens and signing secrets per workspace
- **Web API**: Bearer token authentication
- **OpenAI**: API key per workspace
- **Notion**: Optional integration token

### Data Protection

- **Secrets Management**: Environment variables (not in code)
- **File Permissions**: Restricted to service user
- **API Security**: HTTPS for all external communications
- **Message Privacy**: No persistent message storage (only reminder text)

### Compliance Notes

- **Data Residency**: All runtime data stored locally
- **Data Retention**: Reminders deleted after posting
- **Audit Trail**: Statistics tracking for usage monitoring
- **User Privacy**: No user message content logged

## Performance Characteristics

### Timing & Intervals

- **Reminder Check**: Every 60 seconds
- **Hands-free Timeout**: 30 minutes
- **Reminder Counter Reset**: Daily at 8:00 AM PST (hardcoded)
- **Socket Mode**: Real-time event delivery

### Resource Usage

- **Memory**: ~100-200MB base + ~10-20MB per workspace
- **CPU**: Minimal except during AI API calls
- **Network**: Burst during reminder checks and AI calls
- **Disk I/O**: JSON file reads/writes on state changes

### Optimization Strategies

- **Caching**: AI instructions loaded once per session
- **Batching**: Reminders grouped by scheduling trigger
- **Deduplication**: Hash-based duplicate detection
- **Lazy Loading**: Modules initialized only when needed

## Future Architecture Considerations

### Potential Improvements

1. **Horizontal Scaling**: Multi-process/container deployment
2. **Database Integration**: Replace JSON files with proper database
3. **Queue System**: Decouple reminder processing from main loop
4. **Hot Reload**: Dynamic workspace configuration updates
5. **Rate Limiting**: Per-workspace API throttling
6. **Webhook Support**: Alternative to Socket Mode for scale
7. **Timezone Flexibility**: Per-reminder timezone support
8. **Advanced Scheduling**: Recurring reminders, snooze functionality

### Technical Debt

- **Hardcoded Values**: Timezone reset time, intervals
- **Error Recovery**: Limited retry mechanisms
- **Type Safety**: JavaScript with JSDoc (consider TypeScript migration)
- **Testing**: Jest suite (160 tests as of 1.4.49); integration tests use a mock WorkspaceAI harness
- **Configuration**: Environment variables vs. configuration files