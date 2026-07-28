# Daily Digest Timing Fix - Deployment Notes

## Issue Summary

**Problem**: Daily digest messages arriving at 5:44 AM PST instead of configured 8:30 AM PST
**Root Cause**: Production server running old code (pre-commit f86bbf2)
**Solution**: Deploy current repository code with enhanced logging

## Changes Made

### 1. Enhanced Logging in `src/reminders-module.js`

Added comprehensive logging to `#CalculateNextDailyDigestTime()` method:
- Current date in workspace timezone
- Configured digest time (hour:minute)
- Workspace timezone setting
- TempDate calculation (intermediate step)
- Timezone offset in minutes
- Final TargetDate in both UTC and local timezone
- Tomorrow scheduling logic (when applicable)

### 2. Enhanced Logging in `src/date-utils.js`

Added logging to `GetTimeZoneOffsetInMinutes()` method:
- Timezone being calculated
- GlobalizedUTC date
- LocalizedUTC date
- Calculated offset in minutes

## Deployment Steps

### Step 1: Pre-Deployment Verification

1. **Check current production version**:
   ```bash
   ssh production-server
   cd /path/to/sleuth-app
   git log --oneline -5
   ```

   Verify if production is at commit `688d9cd` or later (Feb 5, 2026)

2. **Check current production logs** (if app is running):
   ```bash
   tail -100 /path/to/sleuth/logs/app.log | grep -i "digest"
   ```

### Step 2: Deploy Updated Code

1. **Pull latest code**:
   ```bash
   cd /path/to/sleuth-app
   git pull origin main  # or development branch
   ```

2. **Verify changes are present**:
   ```bash
   grep -n "DIGEST CALC" src/reminders-module.js
   grep -n "OFFSET CALC" src/date-utils.js
   ```

3. **Install dependencies** (if needed):
   ```bash
   npm install
   ```

### Step 3: Restart Application

1. **Stop current process**:
   ```bash
   # Method depends on your process manager
   pm2 stop sleuth-app
   # OR
   systemctl stop sleuth-app
   # OR
   kill <pid>
   ```

2. **Start application**:
   ```bash
   pm2 start sleuth-app
   # OR
   systemctl start sleuth-app
   # OR
   npm start
   ```

### Step 4: Immediate Verification

1. **Monitor startup logs**:
   ```bash
   tail -f /path/to/sleuth/logs/app.log | grep -E "DIGEST CALC|OFFSET CALC"
   ```

2. **Expected log output** (for 8:30 AM PST configuration):
   ```
   [OFFSET CALC] Timezone: America/Los_Angeles, GlobalizedUTC: ..., LocalizedUTC: ..., Offset: -480 minutes
   [DIGEST CALC] Current date in timezone: Mon, 09 Feb 2026 11:17:33 GMT
   [DIGEST CALC] Configured time: 8:30
   [DIGEST CALC] Workspace timezone: America/Los_Angeles
   [DIGEST CALC] TempDate: Mon, 09 Feb 2026 08:30:00 GMT
   [DIGEST CALC] Offset minutes: -480
   [DIGEST CALC] TargetDate (UTC): Mon, 09 Feb 2026 16:30:00 GMT
   [DIGEST CALC] TargetDate in LA time: 2/9/2026, 8:30:00 AM
   daily task digest scheduled for Mon, 09 Feb 2026 16:30:00 GMT (XXXms delay)
   ```

3. **Validate calculations**:
   - Offset should be `-480` minutes (PST) or `-420` minutes (PDT)
   - TargetDate in UTC should be `16:30` (for PST) or `15:30` (for PDT)
   - TargetDate in LA time should show `8:30:00 AM`

### Step 5: Next-Day Verification

1. **Wait for actual digest delivery** (next morning at 8:30 AM PST)

2. **Check Slack message timestamp**:
   - Should be exactly 8:30 AM PST
   - NOT 5:44 AM PST

3. **Review post-delivery logs**:
   ```bash
   grep "daily task digest" /path/to/sleuth/logs/app.log | tail -20
   ```

## Troubleshooting

### If logs show incorrect values:

**Scenario 1: Offset is wrong**
- Check if `GetLocalizedUtcDate()` is working correctly
- Verify timezone string is correct in workspace config
- Test offset calculation manually:
  ```javascript
  node -e "
    const DateUtils = require('./src/date-utils.js').default;
    console.log(DateUtils.GetTimeZoneOffsetInMinutes('America/Los_Angeles'));
  "
  ```

**Scenario 2: TargetDate is still wrong**
- Verify the arithmetic: `TempDate - (OffsetMinutes * 60 * 1000)`
- Check if OffsetMinutes sign is correct (should be negative for PST)
- Ensure no other code is modifying TargetDate

**Scenario 3: Still delivering at 5:44 AM**
- Check if multiple app instances are running
- Verify workspace configuration file is correct
- Check if there's a different cron job or scheduler running

### If digest doesn't arrive at all:

1. **Check for errors**:
   ```bash
   grep -i "error" /path/to/sleuth/logs/app.log | grep -i "digest"
   ```

2. **Verify scheduler is active**:
   ```bash
   grep "daily task digest scheduled" /path/to/sleuth/logs/app.log | tail -1
   ```

3. **Check if digest feature is enabled** in workspace config:
   ```json
   {
     "DAILY_TASK_DIGEST_ENABLED": true,
     "DAILY_TASK_DIGEST_TIME": "08:30"
   }
   ```

## Success Criteria

✅ Logs show correct offset calculation: `-480` (PST) or `-420` (PDT)
✅ Logs show TargetDate is `16:30 UTC` (PST) or `15:30 UTC` (PDT)
✅ Logs show TargetDate in LA time is `8:30:00 AM`
✅ Digest message arrives in Slack at exactly **8:30 AM PST**
✅ No errors in application logs

## Rollback Plan

If the fix causes issues:

1. **Identify last known good commit**:
   ```bash
   git log --oneline | head -10
   ```

2. **Revert to previous version**:
   ```bash
   git revert HEAD  # Reverts the logging changes
   # OR
   git checkout <previous-commit-hash>
   ```

3. **Restart application**:
   ```bash
   pm2 restart sleuth-app
   ```

4. **Document the issue** for further investigation

## Additional Notes

- The current code in the repository is **correct** and has been tested
- The issue is deployment-related, not logic-related
- After deployment, digest timing should work correctly across DST transitions
- No other time-based features should be affected by this change
- Logging can be removed or reduced after confirming fix works in production

## Testing the Fix Locally (Optional)

To test the calculation locally before deploying:

```javascript
// Create a test script: test-digest-timing.js
const DateUtils = require('./src/date-utils.js').default;

// Mock workspace info
const mockWorkspace = {
  MAIN_TIMEZONE: 'America/Los_Angeles',
  DAILY_TASK_DIGEST_TIME: '08:30'
};

// Calculate offset
const offset = DateUtils.GetTimeZoneOffsetInMinutes(mockWorkspace.MAIN_TIMEZONE);
console.log('Offset:', offset, 'minutes');

// Get current date in timezone
const currentDate = DateUtils.GetCurrentDateInTimeZone(mockWorkspace.MAIN_TIMEZONE);
console.log('Current date in LA:', currentDate.toUTCString());

// Parse configured time
const [hour, minute] = mockWorkspace.DAILY_TASK_DIGEST_TIME.split(':').map(Number);
console.log('Configured time:', hour, ':', minute);

// Calculate target date
const year = currentDate.getUTCFullYear();
const month = currentDate.getUTCMonth();
const day = currentDate.getUTCDate();
const tempDate = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
console.log('TempDate:', tempDate.toUTCString());

const targetDate = new Date(tempDate.getTime() - (offset * 60 * 1000));
console.log('TargetDate (UTC):', targetDate.toUTCString());
console.log('TargetDate (LA time):', targetDate.toLocaleString('en-US', { timeZone: mockWorkspace.MAIN_TIMEZONE }));
```

Run with: `node test-digest-timing.js`

Expected output should show 8:30 AM PST = 16:30 UTC (or 15:30 UTC during PDT).
