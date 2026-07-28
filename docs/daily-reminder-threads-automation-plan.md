# Daily Reminder Threads Automation

## Summary

This plan is organized into 5 phases with a total estimated time of **13-18 work hours**. The estimate accounts for AI-assisted implementation, code review, testing, and bug fixes.

**Phase Breakdown:**
- **Phase 1: Configuration System** - 2-3 hours
  - Update workspace configuration types and validation
  - Add user display name helper method
  
- **Phase 2: Daily Scheduler Module** - 3-4 hours
  - Implement scheduler with time calculation
  - Integrate with module lifecycle (start/stop)
  
- **Phase 3: Daily Thread Execution** - 4-5 hours
  - Main execution logic for creating threads
  - User reminder retrieval and thread posting
  
- **Phase 4: Testing & Bug Fixes** - 3-4 hours
  - Unit testing, integration testing, edge case handling
  
- **Phase 5: Documentation** - 1-2 hours
  - Update existing docs and create user guide

**Total: 13-18 work hours**

*Note: This estimate assumes AI-assisted implementation with human review, testing, and iteration.*

## Overview

Automate the creation of daily reminder threads in the reminder channel. Each morning at a configured time, the system will create a thread for each configured user, posting their pending reminders in the thread replies. This automates the manual process that has been done for most of the year.

## Requirements Summary

- **Time**: Default time (8:00 AM) with per-workspace override via environment variable
- **Reminder Filter**: All pending reminders for each user (regardless of due date)
- **No Reminders**: Create thread with "No reminders" message
- **User Selection**: Configured list of users per workspace
- **Enable/Disable**: Configurable per workspace

## Implementation Plan

### Phase 1: Configuration System (2-3 hours)

#### 1.1 Update WorkspaceInfo Type Definition
**File**: `src/workspaces.js`

Add new optional fields to `WorkspaceInfo` typedef:
- `DAILY_REMINDER_THREADS_ENABLED` (string: 'true'/'false', default: 'false')
- `DAILY_REMINDER_THREADS_TIME` (string: 'HH:MM' format in workspace timezone, default: '08:00')
- `DAILY_REMINDER_THREADS_USERS` (string: comma-separated user IDs or mentions, e.g., '<@U123>,<@U456>')

Update `ValidateWorkspaceInfo()` to validate:
- `DAILY_REMINDER_THREADS_ENABLED` must be 'true' or 'false' if present
- `DAILY_REMINDER_THREADS_TIME` must match 'HH:MM' format if present
- `DAILY_REMINDER_THREADS_USERS` must be a non-empty string if feature is enabled

#### 1.2 Add Helper Methods to SlackApp
**File**: `src/slack-app.js`

Add public method to get user display name:
```javascript
/**
 * Get user display name from Slack user ID.
 * @param {string} ArgUserID User ID to get display name for.
 * @returns {Promise<string|null>} Display name or null if not found.
 */
async GetUserDisplayNameAsync(ArgUserID) {
  try {
    const UserInfo = await this.#SlackBoltApp.client.users.info({ user: ArgUserID });
    if(!UserInfo.ok) {
      this.#SlackLogger.error('users.info failed:', UserInfo.error);
      return null;
    }
    return UserInfo.user.real_name || UserInfo.user.name || null;
  } catch(error) {
    this.#SlackLogger.error('Error getting user display name:', error);
    return null;
  }
}
```

### Phase 2: Daily Scheduler Module (3-4 hours)

#### 2.1 Create Daily Scheduler in RemindersModule
**File**: `src/reminders-module.js`

Add private fields:
- `#DailyThreadTimerID` - setTimeout ID for daily thread scheduler
- `#DailyThreadLastRun` - Date of last daily thread run (for tracking)

Add method to calculate next run time:
```javascript
/**
 * Calculate the next time to run daily reminder threads based on configured time.
 * @returns {Date} Next scheduled run time in UTC.
 */
#CalculateNextDailyThreadTimeAsync() {
  const TimeZone = this.#SlackApp.WorkspaceInfo.MAIN_TIMEZONE;
  const CurrentDate = DateUtils.GetCurrentDateInTimeZone(TimeZone);
  
  // Parse configured time (default: '08:00')
  const ConfiguredTime = this.#SlackApp.WorkspaceInfo.DAILY_REMINDER_THREADS_TIME || '08:00';
  const [Hour, Minute] = ConfiguredTime.split(':').map(Number);
  
  // Create target date/time in workspace timezone
  const TargetDate = new Date(CurrentDate);
  TargetDate.setUTCHours(Hour, Minute, 0, 0);
  
  // If time has already passed today, schedule for tomorrow
  if(TargetDate.getTime() <= CurrentDate.getTime()) {
    TargetDate.setUTCDate(TargetDate.getUTCDate() + 1);
  }
  
  return TargetDate;
}
```

Add method to start daily scheduler:
```javascript
/**
 * Start the daily reminder threads scheduler.
 * @returns {Promise<void>}
 */
async #StartDailyThreadSchedulerAsync() {
  // Check if feature is enabled
  const IsEnabled = (this.#SlackApp.WorkspaceInfo.DAILY_REMINDER_THREADS_ENABLED || 'false').toLowerCase() === 'true';
  if(!IsEnabled) {
    this.#SlackApp.Logger.info('daily reminder threads are disabled for this workspace.');
    return;
  }
  
  // Calculate next run time
  const NextRunTime = await this.#CalculateNextDailyThreadTimeAsync();
  const DelayMs = NextRunTime.getTime() - Date.now();
  
  this.#SlackApp.Logger.info(`daily reminder threads scheduled for ${NextRunTime.toUTCString()} (${DelayMs}ms delay)`);
  
  // Schedule the first run
  this.#DailyThreadTimerID = setTimeout(async () => {
    await this.#RunDailyReminderThreadsAsync();
    // Schedule next run (24 hours later)
    await this.#StartDailyThreadSchedulerAsync();
  }, DelayMs);
}
```

Add method to stop scheduler:
```javascript
/**
 * Stop the daily reminder threads scheduler.
 */
#StopDailyThreadSchedulerAsync() {
  if(this.#DailyThreadTimerID) {
    clearTimeout(this.#DailyThreadTimerID);
    this.#DailyThreadTimerID = null;
  }
}
```

Update `StartAsync()` to call `#StartDailyThreadSchedulerAsync()` after reminder system initialization.

Update `StopAsync()` to call `#StopDailyThreadSchedulerAsync()`.

### Phase 3: Daily Thread Execution (4-5 hours)

#### 3.1 Main Execution Method
**File**: `src/reminders-module.js`

Add method to run daily reminder threads:
```javascript
/**
 * Execute daily reminder threads for all configured users.
 * @returns {Promise<void>}
 */
async #RunDailyReminderThreadsAsync() {
  this.#SlackApp.Logger.info('starting daily reminder threads execution');
  
  try {
    // Get configured users
    const ConfiguredUsers = this.#ParseConfiguredUsers();
    if(ConfiguredUsers.length === 0) {
      this.#SlackApp.Logger.warn('no users configured for daily reminder threads');
      return;
    }
    
    // Get reminder channel ID
    const ReminderChannelID = await this.#GetReminderChannelIdAsync();
    if(!ReminderChannelID) {
      this.#SlackApp.Logger.error('could not find reminder channel for daily threads');
      return;
    }
    
    // Get current date for thread title
    const CurrentDate = DateUtils.GetCurrentDateInTimeZone(this.#SlackApp.WorkspaceInfo.MAIN_TIMEZONE);
    const DateString = this.#FormatDateForThreadTitle(CurrentDate);
    
    // Process each user
    for(const UserID of ConfiguredUsers) {
      await this.#CreateDailyThreadForUserAsync(ReminderChannelID, UserID, DateString);
    }
    
    this.#DailyThreadLastRun = new Date();
    this.#SlackApp.Logger.info('daily reminder threads execution completed');
  } catch(error) {
    this.#SlackApp.Logger.error('error during daily reminder threads execution:', error);
  }
}
```

#### 3.2 Helper Methods
**File**: `src/reminders-module.js`

Add method to parse configured users:
```javascript
/**
 * Parse configured user list from workspace configuration.
 * @returns {string[]} Array of user IDs.
 */
#ParseConfiguredUsers() {
  const UsersString = this.#SlackApp.WorkspaceInfo.DAILY_REMINDER_THREADS_USERS || '';
  if(!UsersString.trim()) return [];
  
  // Parse comma-separated list and extract user IDs from mentions
  return UsersString.split(',')
    .map(u => u.trim())
    .filter(Boolean)
    .map(userMention => {
      const Match = userMention.match(/^<@([^>]+)>$/);
      return Match ? Match[1] : userMention; // Return user ID or original if not a mention
    })
    .filter(Boolean);
}
```

Add method to format date for thread title:
```javascript
/**
 * Format date for daily thread title (e.g., "12-4" for December 4th).
 * @param {Date} ArgDate Date to format.
 * @returns {string} Formatted date string.
 */
#FormatDateForThreadTitle(ArgDate) {
  const Month = ArgDate.getUTCMonth() + 1; // 1-12
  const Day = ArgDate.getUTCDate();
  return `${Month}-${Day}`;
}
```

Add method to create thread for a user:
```javascript
/**
 * Create daily reminder thread for a specific user.
 * @param {string} ArgChannelID Channel ID to post in.
 * @param {string} ArgUserID User ID to create thread for.
 * @param {string} ArgDateString Formatted date string for title.
 * @returns {Promise<void>}
 */
async #CreateDailyThreadForUserAsync(ArgChannelID, ArgUserID, ArgDateString) {
  try {
    // Get user display name
    const UserDisplayName = await this.#SlackApp.GetUserDisplayNameAsync(ArgUserID);
    const UserMention = `<@${ArgUserID}>`;
    const UserName = UserDisplayName || 'User';
    
    // Get user's reminders
    const UserReminders = this.#GetUserReminders(ArgUserID);
    
    // Create thread title message
    const ThreadTitle = `@${UserName}: Your todos for today ${ArgDateString}...`;
    
    // Post initial thread message
    const ThreadTS = await this.#SlackApp.PostMessageTextAsync(ArgChannelID, null, ThreadTitle);
    
    if(!ThreadTS) {
      this.#SlackApp.Logger.error(`failed to create daily thread for user ${ArgUserID}`);
      return;
    }
    
    // Post reminders in thread (reuse existing #HandleShowRemindersListAsync logic)
    if(UserReminders.length === 0) {
      await this.#SlackApp.PostMessageTextAsync(ArgChannelID, ThreadTS, `No pending reminders for ${UserMention}.`);
    } else {
      // Create synthetic event info for reuse of existing display logic
      const SyntheticEventInfo = {
        channel: ArgChannelID,
        ts: ThreadTS,
        user: ArgUserID,
        text: UserMention
      };
      
      const EmptyMessage = `No pending reminders for ${UserMention}.`;
      const SummaryMessage = `Pending reminders for ${UserMention} (${UserReminders.length} total):`;
      
      await this.#HandleShowRemindersListAsync(
        this.#SlackApp,
        SyntheticEventInfo,
        UserReminders,
        EmptyMessage,
        SummaryMessage
      );
    }
    
    this.#SlackApp.Logger.info(`created daily thread for user ${ArgUserID} with ${UserReminders.length} reminders`);
  } catch(error) {
    this.#SlackApp.Logger.error(`error creating daily thread for user ${ArgUserID}:`, error);
  }
}
```

Add method to get user reminders:
```javascript
/**
 * Get all pending reminders for a user.
 * @param {string} ArgUserID User ID to get reminders for.
 * @returns {ReminderInfo[]} Array of user's reminders.
 */
#GetUserReminders(ArgUserID) {
  const UserMentionPattern = `<@${ArgUserID}>`;
  const SeenReminderIds = new Set();
  const UserReminders = [];
  
  // Add reminders created by the user
  const CreatedReminders = this.#RemindersBySender.get(ArgUserID) ?? [];
  for(const reminder of CreatedReminders) {
    SeenReminderIds.add(reminder.ReminderID);
    UserReminders.push(reminder);
  }
  
  // Add reminders where the user is mentioned (avoiding duplicates)
  for(const reminder of this.#PendingRemindersQueue) {
    if(reminder.ReminderMessageText.includes(UserMentionPattern) && !SeenReminderIds.has(reminder.ReminderID)) {
      SeenReminderIds.add(reminder.ReminderID);
      UserReminders.push(reminder);
    }
  }
  
  return UserReminders;
}
```

### Phase 4: Testing & Bug Fixes (3-4 hours)

#### 4.1 Unit Testing
- Test date calculation logic for next run time
- Test user parsing from configuration
- Test reminder filtering for users
- Test date formatting for thread titles

#### 4.2 Integration Testing
- Test scheduler starts correctly on app startup
- Test scheduler reschedules correctly after execution
- Test thread creation with reminders
- Test thread creation without reminders
- Test with feature disabled
- Test with invalid user IDs
- Test timezone handling

#### 4.3 Edge Cases
- Handle missing user IDs gracefully
- Handle users with no display name
- Handle reminder channel not found
- Handle API failures (users.info, posting messages)
- Handle scheduler during app shutdown
- Handle timezone edge cases (DST transitions)

### Phase 5: Documentation (1-2 hours)

#### 5.1 Update AGENTS.md
**File**: `AGENTS.md`

Add section documenting:
- New workspace configuration fields
- How the daily scheduler works
- Integration with existing reminder system

#### 5.2 Update Architecture Documentation
**File**: `docs/architecture.md`

Add section on:
- Daily reminder threads feature
- Scheduler implementation details
- Configuration options

#### 5.3 Create User Guide
**File**: `docs/daily-reminder-threads.md` (new file)

Document:
- Feature overview
- Configuration instructions
- How to enable/disable per workspace
- How to configure user list
- How to set custom time
- Example configuration

## File Changes Summary

### Modified Files
1. `src/workspaces.js` - Add new configuration fields to WorkspaceInfo
2. `src/slack-app.js` - Add GetUserDisplayNameAsync method
3. `src/reminders-module.js` - Add daily scheduler and thread creation logic
4. `AGENTS.md` - Document new feature
5. `docs/architecture.md` - Document architecture details

### New Files
1. `docs/daily-reminder-threads.md` - User guide for the feature

## Time Estimate

**Total: 13-18 work hours**

Breakdown:
- Phase 1 (Configuration): 2-3 hours
- Phase 2 (Scheduler): 3-4 hours
- Phase 3 (Execution): 4-5 hours
- Phase 4 (Testing & Bug Fixes): 3-4 hours
- Phase 5 (Documentation): 1-2 hours

**Note**: This estimate includes time for:
- Code implementation
- Testing in development environment
- Bug fixes and edge case handling
- Documentation updates
- Manual testing in Slack workspace

The estimate assumes the developer will use Cursor extensively for code generation and will need time to test and iterate on the implementation.

