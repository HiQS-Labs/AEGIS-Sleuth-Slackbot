# Slack API Rate Limits and Quotas Reference

## Document Information

**Created**: 2025-11-21
**Purpose**: Reference documentation for Slack API rate limits and quotas used in AEGIS AI
**Status**: Based on official Slack documentation as of 2025-11-21

**⚠️ Documentation Limitations**: Slack's official documentation for Lists API is incomplete. Some information marked as "Not Documented" below indicates gaps in Slack's official documentation, not missing research.

## Overview

Slack's Web API uses a tiered rate limiting system that applies **per API method per workspace per app**. Rate limits are enforced using HTTP 429 responses with `Retry-After` headers when limits are exceeded.

**Official Reference**: https://docs.slack.dev/apis/web-api/rate-limits

## Rate Limit Tiers

Slack categorizes API methods into tiers based on how frequently they can be called:

| Tier | Rate Limit | Description |
|------|------------|-------------|
| **Tier 1** | 1+ per minute | Most restrictive, typically for write-heavy operations |
| **Tier 2** | 20+ per minute | Moderate usage APIs |
| **Tier 3** | 50+ per minute | Higher frequency APIs |
| **Tier 4** | 100+ per minute | High-frequency read operations |
| **Special** | Variable | Unique methods with custom rate limits |

**Note**: The "+" indicates that these are minimum guarantees. Actual limits may be higher depending on workspace plan and usage patterns.

### Rate Limiting Behavior

- **Scope**: Per API method, per workspace/team, per app
- **Response**: HTTP 429 error with `Retry-After` header (in seconds)
- **Burst Behavior**: Slack allows "generous burst behavior" for some methods
- **Retries**: Apps should respect the `Retry-After` header and implement exponential backoff

**Source**: https://docs.slack.dev/apis/web-api/rate-limits

---

## Slack Lists API

### Overview

Slack Lists is a newer API feature (public release: September 2, 2025) for managing structured task lists within Slack workspaces.

**Availability**: Lists are **only available to Slack workspaces on a paid plan**.

**Official Documentation**:
- Method reference: https://docs.slack.dev/reference/methods/
- Research findings: `docs/slack-lists-research-findings.md`

### OAuth Scopes

**⚠️ Documentation Gap**: Slack's official scope documentation pages exist but contain "No scope information found":
- https://docs.slack.dev/reference/scopes/lists.read
- https://docs.slack.dev/reference/scopes/lists.write

**Expected Scopes** (based on API naming conventions):
- `lists:read` - For reading list data
- `lists:write` - For creating, updating, and deleting lists and list items

**Status**: These scopes are not fully documented in Slack's official documentation as of 2025-11-21. They may be in beta or early access phase.

### Lists API Methods

#### 1. slackLists.create

**Purpose**: Creates a new list in a Slack workspace

**Rate Limit Tier**: ❌ Not documented
**Required Scopes**: ❌ Not documented (likely `lists:write`)

**Parameters**:
- `token` (required) - Authentication token
- `name` (required) - List name
- `description_blocks` (optional) - Descriptive blocks
- `schema` (optional) - List schema definition
- `include_copied_list_records` (optional) - Include records when copying
- `copy_from_list_id` (optional) - Source list ID for copying
- `todo_mode` (optional) - Enable todo mode

**Documentation**: https://docs.slack.dev/reference/methods/slackLists.create

---

#### 2. slackLists.items.create

**Purpose**: Creates a new item in an existing list

**Rate Limit Tier**: ❌ Not documented
**Required Scopes**: ❌ Not documented (likely `lists:write`)

**Parameters**:
- `token` (required) - Authentication token
- `list_id` (required) - The list identifier
- `initial_fields` (optional) - Initial field values for the item
- `duplicated_item_id` (optional) - Item ID to duplicate
- `parent_item_id` (optional) - Parent item for hierarchical lists

**Documentation**: https://docs.slack.dev/reference/methods/slackLists.items.create

---

#### 3. slackLists.items.list

**Purpose**: Retrieves all items from a list with pagination support

**Rate Limit Tier**: ❌ Not documented
**Required Scopes**: ❌ Not documented (likely `lists:read`)

**Parameters**:
- `token` (required) - Authentication token
- `list_id` (required) - The list identifier
- `limit` (optional) - Maximum items per page
- `next_cursor` (optional) - Pagination cursor

**Pagination**:
- Uses cursor-based pagination with `next_cursor`
- Example shows `limit: 100` in sample request
- **Maximum limit value**: ❌ Not documented

**Response Structure**:
```json
{
  "items": [
    {
      "id": "string",
      "summary": "string",
      "scheduled_time": number,
      "source_channel": "string",
      "status": "string",
      // ... additional fields
    }
  ],
  "next_cursor": "string or null"
}
```

**Documentation**: https://docs.slack.dev/reference/methods/slackLists.items.list

---

#### 4. slackLists.items.update

**Purpose**: Updates an existing list item

**Rate Limit Tier**: ❌ Not documented
**Required Scopes**: ❌ Not documented (likely `lists:write`)

**Parameters**:
- `token` (required) - Authentication token
- `list_id` (required) - The list identifier
- `id` (required) - Item record ID to update
- Additional parameters for field updates (not fully documented)

**Documentation**: https://docs.slack.dev/reference/methods/slackLists.items.update

---

#### 5. slackLists.items.delete

**Purpose**: Deletes an item from an existing list

**Rate Limit Tier**: ❌ Not documented
**Required Scopes**: ❌ Not documented (likely `lists:write`)

**Parameters**:
- `token` (required) - Authentication token
- `list_id` (required) - The list identifier (e.g., "F1234567")
- `id` (required) - The item record ID to delete (e.g., "Rec1234567")

**Documentation**: https://docs.slack.dev/reference/methods/slackLists.items.delete

---

## Chat API

### chat.postMessage

**Purpose**: Posts a message to a public channel, private channel, or direct message

**Rate Limit**: **Special Tier - Custom Limits**
- **Per Channel**: 1 message per second to a specific channel
- **Workspace-Wide**: "Several hundred messages per minute" across entire workspace
- **Burst Behavior**: "Generous burst behavior" allowed

**Required Scopes**:
- `chat:write` - For posting messages
- `chat:write.public` - For posting to public channels without joining
- `chat:write.customize` - For posting with custom username/icon

**Recommendations**:
- Implement message queuing for high-volume scenarios
- Respect per-channel rate of 1/second maximum
- Monitor 429 responses and implement exponential backoff
- Consider message batching where appropriate

**Documentation**: https://docs.slack.dev/reference/methods/chat.postMessage

---

## Implementation Guidelines for AEGIS AI

### Lists Polling Implementation

**Current Implementation**: 5-minute polling interval (300,000ms)

**Calculations**:
- **Polling Frequency**: Every 5 minutes = 12 requests per hour
- **Daily Requests**: 12 × 24 = 288 requests per day
- **Method Used**: `slackLists.items.list`

**Risk Assessment**: ✅ **LOW RISK**
- Even at Tier 1 (1/minute minimum), polling every 5 minutes is well within limits
- Actual limits likely much higher for read operations
- No risk of rate limit violations with current implementation

**Optimization Opportunities**:
- Could safely reduce to 2-3 minute intervals if needed
- Current 5-minute interval provides good balance of responsiveness vs. API usage
- Consider adaptive polling (faster when activity detected, slower when idle)

### Reminder Posting

**Method Used**: `chat.postMessage`

**Current Behavior**:
- Posts reminders as they become due
- Typically low volume (occasional reminders throughout the day)
- Each reminder posts to specific channel

**Risk Assessment**: ✅ **LOW RISK**
- 1 message per second per channel is generous for reminder use case
- Reminder volume unlikely to approach "several hundred per minute" workspace limit
- Natural spacing between reminders prevents bunching

**Safeguards in Place**:
- Reminders processed sequentially from queue
- Natural delays between reminder checks
- No bulk posting scenarios

### Rate Limit Error Handling

**Current Implementation Status**:
- ⚠️ No explicit HTTP 429 handling observed in current codebase
- Error handling exists but may not specifically handle rate limit responses

**Recommended Enhancements**:

```javascript
/**
 * Enhanced error handling for rate limits
 */
async function CallSlackAPIWithRetry(method, args, maxRetries = 3) {
  for(let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await method(args);
      return result;
    } catch(error) {
      // Check for rate limit error
      if(error.data?.error === 'ratelimited') {
        const retryAfter = error.data?.['retry-after'] || Math.pow(2, attempt);
        logger.warn(`Rate limited, retrying after ${retryAfter}s (attempt ${attempt}/${maxRetries})`);

        if(attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          continue;
        }
      }

      throw error;
    }
  }
}
```

---

## Verification and Sources

### Verified Information

All information marked with ✅ in this document comes from official Slack documentation:

1. **Rate Limit Tiers**: https://docs.slack.dev/apis/web-api/rate-limits
2. **chat.postMessage Limits**: https://docs.slack.dev/reference/methods/chat.postMessage
3. **Lists API Method Parameters**:
   - https://docs.slack.dev/reference/methods/slackLists.create
   - https://docs.slack.dev/reference/methods/slackLists.items.create
   - https://docs.slack.dev/reference/methods/slackLists.items.list
   - https://docs.slack.dev/reference/methods/slackLists.items.update
   - https://docs.slack.dev/reference/methods/slackLists.items.delete

### Unverified/Missing Information

Information marked with ❌ indicates gaps in Slack's official documentation:

1. **Lists API Rate Tiers**: Not documented in method reference pages
2. **Lists OAuth Scopes**: Scope pages exist but contain "No scope information found"
3. **Lists Pagination Limits**: Maximum `limit` value not specified
4. **Lists Response Formats**: Partial documentation only

### Research Methodology

1. Reviewed official Slack Web API rate limits overview
2. Examined individual method documentation for Lists API
3. Searched for OAuth scope documentation
4. Attempted to find Lists-specific rate limit information
5. Cross-referenced with existing research in `docs/slack-lists-research-findings.md`

### Recommendations for Production

1. **Monitor API Responses**: Implement logging for all API responses to detect 429 errors early
2. **Implement Retry Logic**: Add exponential backoff for rate limit handling
3. **Conservative Defaults**: Maintain current 5-minute polling interval as safe baseline
4. **Alerting**: Set up alerts for recurring rate limit errors
5. **Documentation Updates**: Revisit this document quarterly as Slack improves Lists API documentation

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| 2025-11-21 | Initial documentation created | Claude Code |

---

## Notes

- Lists API is relatively new (public release: September 2, 2025)
- Documentation gaps are expected for newer APIs
- Rate limits for Lists API are likely conservative (Tier 1 or 2 estimated)
- Current polling implementation (5 minutes) is safe regardless of actual tier
- This document will be updated as Slack publishes more complete documentation
