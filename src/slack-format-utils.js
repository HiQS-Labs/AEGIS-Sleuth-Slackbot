/**
 * Utilities for converting between Slack mrkdwn and Block Kit rich_text formats.
 * Provides bidirectional transformation for data integrity between reminders and Slack Lists.
 */
class SlackFormatUtils {
  // canonical `<@ID>` / `<@ID|label>` mention-token grammar, shared by ExtractUserMentions
  // (iteration) and ReplaceUserMentions (substitution) so the two never drift apart (GH-429).
  // Re-wrapped in `new RegExp(...)` at each call site rather than reused directly, since a shared
  // `g`-flagged RegExp instance carries mutable `lastIndex` state across calls.
  static #MENTION_TOKEN_PATTERN = /<@([^>|]+)(?:\|[^>]*)?>/g;

  /**
   * Convert Slack mrkdwn text to Block Kit rich_text structure.
   * Properly handles user mentions, channel references, and links.
   *
   * @param {string} ArgMrkdwn Raw Slack mrkdwn text
   * @returns {Object} Block Kit rich_text element
   *
   * Example:
   * Input: "<@U08BHQEAX> - follow up on <https://slack.com/msg|this>"
   * Output: {
   *   type: 'rich_text',
   *   elements: [{
   *     type: 'rich_text_section',
   *     elements: [
   *       { type: 'user', user_id: 'U08BHQEAX' },
   *       { type: 'text', text: ' - follow up on ' },
   *       { type: 'link', url: 'https://slack.com/msg', text: 'this' }
   *     ]
   *   }]
   * }
   */
  static MrkdwnToRichText(ArgMrkdwn) {
    if(!ArgMrkdwn || typeof ArgMrkdwn !== 'string') {
      return {
        type: 'rich_text',
        elements: [{
          type: 'rich_text_section',
          elements: [{ type: 'text', text: '' }]
        }]
      };
    }

    const Elements = [];
    // Pattern matches: <@USER>, <#CHANNEL|name>, <URL|text>, <URL>
    const Pattern = /(<@[^>]+>|<#[^>]+>|<[^|>]+\|[^>]+>|<https?:\/\/[^>]+>)/g;

    let LastIndex = 0;
    let Match;

    while((Match = Pattern.exec(ArgMrkdwn)) !== null) {
      // Add text before match
      if(Match.index > LastIndex) {
        Elements.push({
          type: 'text',
          text: ArgMrkdwn.slice(LastIndex, Match.index)
        });
      }

      const Token = Match[0];

      if(Token.startsWith('<@')) {
        // User mention: <@U12345678>
        const UserId = Token.slice(2, -1);
        Elements.push({ type: 'user', user_id: UserId });
      } else if(Token.startsWith('<#')) {
        // Channel reference: <#C12345678|channel-name>
        const ChannelParts = Token.slice(2, -1).split('|');
        Elements.push({ type: 'channel', channel_id: ChannelParts[0] });
      } else if(Token.includes('|')) {
        // Link with display text: <url|text>
        const [Url, Text] = Token.slice(1, -1).split('|');
        Elements.push({ type: 'link', url: Url, text: Text });
      } else {
        // Plain URL: <url>
        const Url = Token.slice(1, -1);
        Elements.push({ type: 'link', url: Url });
      }

      LastIndex = Pattern.lastIndex;
    }

    // Add remaining text
    if(LastIndex < ArgMrkdwn.length) {
      Elements.push({
        type: 'text',
        text: ArgMrkdwn.slice(LastIndex)
      });
    }

    return {
      type: 'rich_text',
      elements: [{
        type: 'rich_text_section',
        elements: Elements.length > 0 ? Elements : [{ type: 'text', text: ArgMrkdwn }]
      }]
    };
  }

  /**
   * Extract plain text from Block Kit rich_text structure.
   * Handles nested structures returned by Slack Lists API.
   *
   * @param {any} ArgRichText Block Kit rich_text object, array, or string
   * @returns {string} Plain text representation
   */
  static RichTextToPlainText(ArgRichText) {
    if(typeof ArgRichText === 'string') {
      return ArgRichText;
    }

    if(!ArgRichText || typeof ArgRichText !== 'object') {
      return '';
    }

    // Handle array (e.g., from Slack Lists items.list response)
    if(Array.isArray(ArgRichText)) {
      return ArgRichText.map(Item => this.RichTextToPlainText(Item)).join('');
    }

    // Handle Block Kit elements
    switch(ArgRichText.type) {
      case 'text':
        return ArgRichText.text || '';
      case 'user':
        return `@${ArgRichText.user_id}`;
      case 'channel':
        return `#${ArgRichText.channel_id}`;
      case 'link':
        return ArgRichText.text || ArgRichText.url || '';
      case 'rich_text':
      case 'rich_text_section':
      case 'rich_text_list':
      case 'rich_text_preformatted':
      case 'rich_text_quote':
        if(ArgRichText.elements) {
          return ArgRichText.elements.map((/** @type {any} */ El) => this.RichTextToPlainText(El)).join('');
        }
        break;
    }

    // Fallback: try elements property
    if(ArgRichText.elements) {
      return ArgRichText.elements.map((/** @type {any} */ El) => this.RichTextToPlainText(El)).join('');
    }

    return '';
  }

  /**
   * Convert Block Kit rich_text structures back into Slack mrkdwn-like text.
   * Preserves user mentions, channel references, and links so edited Slack List rows
   * can round-trip back into ReminderMessageText without degrading into plain IDs.
   *
   * @param {any} ArgRichText Block Kit rich_text object, array, or string.
   * @returns {string}
   */
  static RichTextToMrkdwn(ArgRichText) {
    if(typeof ArgRichText === 'string') {
      return ArgRichText;
    }

    if(!ArgRichText || typeof ArgRichText !== 'object') {
      return '';
    }

    if(Array.isArray(ArgRichText)) {
      return ArgRichText.map(Item => this.RichTextToMrkdwn(Item)).join('');
    }

    switch(ArgRichText.type) {
      case 'text':
        return ArgRichText.text || '';
      case 'user':
        return ArgRichText.user_id ? `<@${ArgRichText.user_id}>` : '';
      case 'channel':
        return ArgRichText.channel_id ? `<#${ArgRichText.channel_id}>` : '';
      case 'link': {
        const Url = ArgRichText.url || '';
        const Text = ArgRichText.text || '';
        if(!Url) return Text;
        if(Text && Text !== Url) return `<${Url}|${Text}>`;
        return `<${Url}>`;
      }
      case 'emoji':
        return ArgRichText.name ? `:${ArgRichText.name}:` : '';
      case 'rich_text':
      case 'rich_text_section':
      case 'rich_text_preformatted':
      case 'rich_text_quote':
        if(Array.isArray(ArgRichText.elements)) {
          return ArgRichText.elements.map((/** @type {any} */ El) => this.RichTextToMrkdwn(El)).join('');
        }
        return '';
      case 'rich_text_list':
        if(Array.isArray(ArgRichText.elements)) {
          return ArgRichText.elements
            .map((/** @type {any} */ El) => this.RichTextToMrkdwn(El))
            .join('\n');
        }
        return '';
      default:
        if(Array.isArray(ArgRichText.elements)) {
          return ArgRichText.elements.map((/** @type {any} */ El) => this.RichTextToMrkdwn(El)).join('');
        }
        return '';
    }
  }

  /**
   * Extract a clean, human-readable summary from mrkdwn text.
   * Strips raw markup while preserving semantic meaning.
   *
   * @param {string} ArgMrkdwn Raw Slack mrkdwn text
   * @param {Object} [ArgOptions] Options for extraction
   * @param {number} [ArgOptions.maxLength=200] Maximum summary length
   * @returns {string} Clean summary text
   */
  static ExtractCleanSummary(ArgMrkdwn, ArgOptions = {}) {
    const MaxLength = ArgOptions.maxLength || 200;

    if(!ArgMrkdwn || typeof ArgMrkdwn !== 'string') {
      return 'Untitled reminder';
    }

    let Clean = ArgMrkdwn
      // Convert user mentions to @user format (but we'll strip these later for summary)
      .replace(/<@([^>]+)>/g, '@$1')
      // Convert channel refs to #channel format
      .replace(/<#([^|>]+)(?:\|[^>]+)?>/g, '#$1')
      // Extract link display text, falling back to [link]
      .replace(/<([^|>]+)\|([^>]+)>/g, '$2')
      .replace(/<(https?:\/\/[^>]+)>/g, '[link]')
      // Remove "please follow up on" boilerplate commonly added by Sleuth
      .replace(/,?\s*-?\s*please follow up on\s*/gi, ' - ')
      // Remove quoted text (lines starting with >)
      .replace(/^>.*$/gm, '')
      // Remove "Key task(s):" section header
      .replace(/Key task\(s\):\s*/gi, '')
      // Remove bullet points but keep content
      .replace(/^[•\-\*]\s*/gm, '')
      // Clean up multiple spaces/newlines
      .replace(/\s+/g, ' ')
      .trim();

    // Truncate if needed
    if(Clean.length > MaxLength) {
      Clean = Clean.substring(0, MaxLength - 3) + '...';
    }

    return Clean || 'Untitled reminder';
  }

  /**
   * Extract the key task(s) from a reminder message.
   * The reminder message typically has a structure like:
   * "@user - please follow up on <link|this>:
   * >quoted message
   *
   * Key task(s):
   * • Task 1
   * • Task 2"
   *
   * @param {string} ArgMrkdwn Full reminder message text
   * @returns {string} Extracted key tasks or clean summary
   */
  static ExtractKeyTasks(ArgMrkdwn) {
    if(!ArgMrkdwn || typeof ArgMrkdwn !== 'string') {
      return 'Untitled reminder';
    }

    // Look for "Key task(s):" section
    const KeyTaskMatch = ArgMrkdwn.match(/Key task\(s\):\s*([\s\S]*?)$/i);
    if(KeyTaskMatch && KeyTaskMatch[1]) {
      let Tasks = KeyTaskMatch[1]
        // Remove bullet points
        .replace(/^[•\-\*]\s*/gm, '')
        // Clean up whitespace
        .replace(/\s+/g, ' ')
        .trim();

      if(Tasks.length > 0) {
        return Tasks;
      }
    }

    // Fallback to clean summary
    return this.ExtractCleanSummary(ArgMrkdwn, { maxLength: 100 });
  }

  /**
   * Replace the mutable task-summary portion of a reminder message while preserving the
   * original Sleuth-authored header/quoted-message envelope when present.
   *
   * If the reminder has a `Key task(s):` section, only that section is rewritten.
   * Otherwise the message is treated as a plain list-authored summary and replaced whole.
   *
   * @param {string} ArgReminderMessageText Existing reminder message text.
   * @param {string} ArgNewSummaryMrkdwn New summary text in Slack mrkdwn.
   * @returns {string}
   */
  static ReplaceReminderSummary(ArgReminderMessageText, ArgNewSummaryMrkdwn) {
    const NewSummary = typeof ArgNewSummaryMrkdwn === 'string' ? ArgNewSummaryMrkdwn.trim() : '';
    if(!NewSummary) {
      return typeof ArgReminderMessageText === 'string' ? ArgReminderMessageText : '';
    }

    const NormalizedLines = NewSummary
      .split(/\r?\n/)
      .map(ArgLine => ArgLine.trim().replace(/^[•\-\*]\s*/, ''))
      .filter(Boolean);
    const SummaryBlock = NormalizedLines.length > 0
      ? NormalizedLines.map(ArgLine => `• ${ArgLine}`).join('\n')
      : `• ${NewSummary}`;

    if(typeof ArgReminderMessageText !== 'string' || ArgReminderMessageText.length === 0) {
      return NewSummary;
    }

    const Marker = '\n\nKey task(s):';
    const MarkerIndex = ArgReminderMessageText.indexOf(Marker);
    if(MarkerIndex === -1) {
      return NewSummary;
    }

    return `${ArgReminderMessageText.substring(0, MarkerIndex + Marker.length)}\n${SummaryBlock}`;
  }

  /**
   * Extract all user IDs mentioned in a mrkdwn string.
   * Returns user IDs in order of appearance.
   *
   * @param {string} ArgMrkdwn Raw Slack mrkdwn text
   * @returns {Array<string>} Array of user IDs (without the <@ and > wrappers)
   */
  static ExtractUserMentions(ArgMrkdwn) {
    if(!ArgMrkdwn || typeof ArgMrkdwn !== 'string') {
      return [];
    }

    /** @type {string[]} */
    const UserIds = [];
    const Pattern = new RegExp(SlackFormatUtils.#MENTION_TOKEN_PATTERN);
    let Match;

    while((Match = Pattern.exec(ArgMrkdwn)) !== null) {
      const UserId = Match[1];
      // Avoid duplicates
      if(!UserIds.includes(UserId)) {
        UserIds.push(UserId);
      }
    }

    return UserIds;
  }

  /**
   * Replace every `<@ID>` / `<@ID|label>` mention token in mrkdwn text via a caller-supplied
   * resolver. Canonical single owner of the mention-token grammar for substitution, mirroring
   * `ExtractUserMentions` for extraction — callers that need custom replacement text (e.g.
   * resolving a user id to a display name) should route through this instead of re-deriving the
   * token regex (GH-429: this regex previously existed as a second, independently-written copy).
   * @param {string} ArgText Raw Slack mrkdwn text.
   * @param {(ArgUserId: string) => string} ArgResolve Maps a mentioned user id to its replacement text.
   * @returns {string}
   */
  static ReplaceUserMentions(ArgText, ArgResolve) {
    if(!ArgText || typeof ArgText !== 'string') return ArgText;
    return ArgText.replace(
      new RegExp(SlackFormatUtils.#MENTION_TOKEN_PATTERN),
      (ArgMatch, ArgUserId) => ArgResolve(ArgUserId)
    );
  }

  /**
   * Convert plain `@U12345678` mentions to Slack mrkdwn `<@U12345678>` tokens.
   * Leaves existing `<@USER>` and `<@USER|label>` mentions unchanged.
   * @param {string} ArgText Text that may contain plain Slack user-id mentions.
   * @returns {string}
   */
  static NormalizeUserMentionsToMrkdwn(ArgText) {
    if(!ArgText || typeof ArgText !== 'string')
      return ArgText;

    return ArgText.replace(/(?<!<)@(U[A-Z0-9]+)/g, '<@$1>');
  }

  /**
   * Extract the quoted original message from a reminder message text.
   * The quoted section starts after ":\n>" and contains the original message.
   *
   * @param {string} ArgReminderMessageText Full reminder message text
   * @returns {string|null} The quoted original message text or null if not found
   */
  static ExtractQuotedOriginalMessage(ArgReminderMessageText) {
    if(!ArgReminderMessageText || typeof ArgReminderMessageText !== 'string') {
      return null;
    }

    // Find the quoted section which starts with ":\n>" (colon, newline, blockquote)
    const QuoteStartIndex = ArgReminderMessageText.indexOf(':\n>');
    if(QuoteStartIndex === -1) {
      return null;
    }

    // Extract everything after ":\n>"
    const QuotedSection = ArgReminderMessageText.substring(QuoteStartIndex + 3);

    // The quoted section ends before "Key task(s):" if present, or at the end
    const KeyTasksIndex = QuotedSection.indexOf('\n\nKey task(s):');
    if(KeyTasksIndex !== -1) {
      return QuotedSection.substring(0, KeyTasksIndex);
    }

    return QuotedSection;
  }

  /**
   * Extract the assignee from a reminder message.
   * The assignee is extracted from the quoted original message section (not from the formatted reminder header).
   * The assignee is the first human @mention in the quoted original message (excluding the bot).
   *
   * @param {string} ArgReminderMessageText Full reminder message text
   * @param {string} [ArgRequesterID] The requester's user ID (not used, kept for compatibility)
   * @param {string} [ArgBotUserID] The bot's user ID to always exclude
   * @returns {string|null} Assignee user ID or null if not found
   */
  static ExtractAssignee(ArgReminderMessageText, ArgRequesterID, ArgBotUserID) {
    // Extract the quoted original message section
    const QuotedMessage = this.ExtractQuotedOriginalMessage(ArgReminderMessageText);
    
    // If no quoted section found, fall back to extracting from entire message
    const TextToSearch = QuotedMessage || ArgReminderMessageText;
    
    const UserIds = this.ExtractUserMentions(TextToSearch);

    if(UserIds.length === 0) {
      return null;
    }

    // Filter out the bot user ID - the bot should never be the assignee
    const HumanUserIds = ArgBotUserID
      ? UserIds.filter(Id => Id !== ArgBotUserID)
      : UserIds;

    if(HumanUserIds.length === 0) {
      return null;
    }

    // Return the first human user mentioned in the quoted original message
    return HumanUserIds[0];
  }

  /**
   * Format a timestamp for display in Slack Lists.
   * Converts to format like "Nov 26 5:00 PM"
   *
   * @param {Date|number} ArgTimestamp Date object or Unix timestamp (ms)
   * @returns {string} Formatted date string
   */
  static FormatTimestampForDisplay(ArgTimestamp) {
    const DateObj = ArgTimestamp instanceof Date
      ? ArgTimestamp
      : new Date(ArgTimestamp);

    if(isNaN(DateObj.getTime())) {
      return 'Invalid date';
    }

    const Months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const Month = Months[DateObj.getMonth()];
    const Day = DateObj.getDate();
    let Hours = DateObj.getHours();
    const Minutes = DateObj.getMinutes().toString().padStart(2, '0');
    const AmPm = Hours >= 12 ? 'PM' : 'AM';

    Hours = Hours % 12;
    if(Hours === 0) Hours = 12;

    return `${Month} ${Day} ${Hours}:${Minutes} ${AmPm}`;
  }

  /**
   * Extract due date text from a reminder message.
   * Looks for patterns like "by Wednesday at 10 PM PT", "by tomorrow", "by Friday EOD", etc.
   *
   * @param {string} ArgMrkdwn Full reminder message text
   * @returns {string|null} Due date text or null if not found
   */
  static ExtractDueDate(ArgMrkdwn) {
    if(!ArgMrkdwn || typeof ArgMrkdwn !== 'string') {
      return null;
    }

    // Pattern matches "by <day/time>" phrases
    // Examples: "by Wednesday at 10 PM PT", "by tomorrow", "by Friday EOD", "by end of day"
    const Patterns = [
      // "by [day] at [time] [timezone]" - e.g., "by Wednesday at 10 PM PT"
      /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:pt|pst|pdt|et|est|edt|ct|cst|cdt|mt|mst|mdt)?/gi,
      // "by [day] [time]" - e.g., "by Friday 5pm"
      /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi,
      // "by [day] EOD/COB" - e.g., "by Friday EOD"
      /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\s+(?:eod|cob|end of day|close of business)/gi,
      // "by [day]" - e.g., "by Wednesday"
      /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)/gi,
      // "by end of [day/week]" - e.g., "by end of week"
      /by\s+end\s+of\s+(?:day|week|the\s+day|the\s+week)/gi,
      // "by [month] [day]" - e.g., "by November 30"
      /by\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?/gi,
      // "by [time] [timezone]" - e.g., "by 5 PM PT"
      /by\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*(?:pt|pst|pdt|et|est|edt|ct|cst|cdt|mt|mst|mdt)?/gi
    ];

    for(const Pattern of Patterns) {
      const Match = ArgMrkdwn.match(Pattern);
      if(Match && Match[0]) {
        // Clean up and return the match (capitalize first letter)
        const DueText = Match[0].trim();
        return DueText.charAt(0).toUpperCase() + DueText.slice(1);
      }
    }

    return null;
  }

  /**
   * Parse a value that might be a Slack List field.
   * Handles the various formats Slack returns:
   * - Plain string
   * - Array with single value
   * - Rich text structure
   * - Link object array
   *
   * @param {any} ArgValue Value from Slack List item
   * @param {'string'|'number'|'channel'|'link'|'user'|'rich_text'} ArgType Expected field type
   * @returns {any} Parsed value or null
   */
  static ParseListFieldValue(ArgValue, ArgType) {
    if(ArgValue === null || ArgValue === undefined) {
      return null;
    }

    switch(ArgType) {
      case 'string':
      case 'rich_text':
        // May be plain string or rich_text structure
        if(typeof ArgValue === 'string') {
          return ArgValue;
        }
        return this.RichTextToPlainText(ArgValue);

      case 'number':
        // May be number, string, or array [number]
        if(typeof ArgValue === 'number') {
          return ArgValue;
        }
        if(Array.isArray(ArgValue) && ArgValue.length > 0) {
          const First = ArgValue[0];
          return typeof First === 'number' ? First : parseInt(First, 10) || null;
        }
        if(typeof ArgValue === 'string') {
          return parseInt(ArgValue, 10) || null;
        }
        return null;

      case 'channel':
      case 'user':
        // May be string or array [string]
        if(typeof ArgValue === 'string') {
          return ArgValue;
        }
        if(Array.isArray(ArgValue) && ArgValue.length > 0) {
          return ArgValue[0];
        }
        return null;

      case 'link':
        // May be string URL or array [{original_url, display_name, ...}]
        if(typeof ArgValue === 'string') {
          return ArgValue;
        }
        if(Array.isArray(ArgValue) && ArgValue.length > 0) {
          const LinkObj = ArgValue[0];
          return LinkObj.original_url || LinkObj.url || null;
        }
        if(ArgValue && typeof ArgValue === 'object') {
          return ArgValue.original_url || ArgValue.url || null;
        }
        return null;

      default:
        return ArgValue;
    }
  }

  /**
   * Build a compact plain-text snippet from raw Slack mrkdwn reminder text.
   * Strips link syntax, bare angle-bracket URLs, and blockquote markers before
   * collapsing whitespace, so the result renders cleanly in notifications.
   *
   * @param {string} ArgReminderMessageText Raw Slack mrkdwn text.
   * @param {number} [ArgMaxLength=120] Maximum length before truncation with "...".
   * @returns {string} Sanitized, single-line snippet.
   */
  static BuildReminderSnippet(ArgReminderMessageText, ArgMaxLength = 120) {
    let Text = ArgReminderMessageText || '';

    // convert Slack link syntax to display text only: <url|display> → display.
    Text = Text.replace(/<[^|>]+\|([^>]+)>/g, '$1');

    // strip bare Slack angle-bracket URLs: <https://...> → https://...
    Text = Text.replace(/<(https?:[^>]+)>/g, '$1');

    // strip blockquote markers at the start of each line (Slack mrkdwn ">").
    Text = Text.replace(/^>/gm, '');

    // collapse all whitespace (including newlines) to a single space.
    const SingleLineText = Text.replace(/\s+/g, ' ').trim();

    if(SingleLineText.length <= ArgMaxLength) return SingleLineText;
    return `${SingleLineText.substring(0, ArgMaxLength - 3)}...`;
  }

  /**
   * Compare two reminder data representations for integrity validation.
   *
   * @param {any} ArgOriginal Original ReminderInfo
   * @param {any} ArgRestored Data restored from List item
   * @returns {{isEqual: boolean, differences: Array<string>}}
   */
  static CompareReminderData(ArgOriginal, ArgRestored) {
    /** @type {string[]} */
    const Differences = [];

    // Compare scheduled time (allow 1 second tolerance for rounding)
    const OriginalTime = ArgOriginal.ShouldPostOn?.getTime() || 0;
    const RestoredTime = ArgRestored.scheduledTime || 0;
    if(Math.abs(OriginalTime - RestoredTime) > 1000) {
      Differences.push(`Scheduled time: expected ${OriginalTime}, got ${RestoredTime}`);
    }

    // Compare source channel
    if(ArgOriginal.OriginalChannelID !== ArgRestored.sourceChannel) {
      Differences.push(`Source channel: expected ${ArgOriginal.OriginalChannelID}, got ${ArgRestored.sourceChannel}`);
    }

    // Compare reminder ID (if stored in list)
    if(ArgRestored.reminderId && ArgOriginal.ReminderID !== ArgRestored.reminderId) {
      Differences.push(`Reminder ID: expected ${ArgOriginal.ReminderID}, got ${ArgRestored.reminderId}`);
    }

    return {
      isEqual: Differences.length === 0,
      differences: Differences
    };
  }

  /**
   * Sanitize text for inline use in a single-line Slack diagnostic string.
   * Collapses whitespace/newlines to single spaces, escapes embedded double quotes,
   * and truncates overly long values so diagnostic lines stay readable.
   * @param {string|undefined|null} ArgText Raw text to sanitize.
   * @param {number} [ArgMaxLength] Maximum length before truncation (default 160).
   * @returns {string}
   */
  static SanitizeForInlineSlack(ArgText, ArgMaxLength = 160) {
    if(typeof ArgText !== 'string' || ArgText.length === 0) return '';
    const Collapsed = ArgText.replace(/\s+/g, ' ').trim().replace(/"/g, '\\"');
    if(Collapsed.length <= ArgMaxLength) return Collapsed;
    return `${Collapsed.slice(0, ArgMaxLength - 1)}…`;
  }

  /**
   * Convert standard CommonMark-ish markdown produced by an LLM into Slack's
   * mrkdwn dialect so it renders correctly in a channel message instead of
   * showing literal asterisks and hashes.
   *
   * Handles:
   * - ATX headings (`#`, `##`, `###`, `####`+) → bolded line prefixed with an
   *   emoji so the hierarchy is still visually distinguishable in Slack (which
   *   has no real heading support).
   * - `**bold**` and `__bold__` → `*bold*` (Slack's single-asterisk bold).
   * - Setext headings (lines underlined with `===` or `---`) → bolded line.
   * - Bullet lists written with `-` → `•` so Slack renders a clean bullet
   *   regardless of client platform.
   *
   * Intentionally does NOT touch inline code, fenced code blocks, Slack-style
   * mrkdwn that's already present, or link syntax. The goal is to normalize
   * the model's output minimally, not to fully parse markdown.
   *
   * @param {string} ArgText Raw LLM output (may be empty/null).
   * @param {{ HeadingStyle?: 'emoji'|'plain-bold' }} [ArgOptions] Formatting options.
   * @returns {string} Slack-mrkdwn-safe text.
   */
  static NormalizeModelMarkdownForSlack(ArgText, ArgOptions = {}) {
    if(typeof ArgText !== 'string' || ArgText.length === 0) return '';
    const HeadingStyle = ArgOptions.HeadingStyle === 'plain-bold' ? 'plain-bold' : 'emoji';

    // Work line-by-line so we can:
    // (a) detect fenced code blocks and pass their contents through unchanged
    // (b) apply heading rules only at the start of a line
    const Lines = ArgText.split('\n');
    /** @type {string[]} */
    const OutLines = [];
    let InFence = false;

    for(let i = 0; i < Lines.length; i++) {
      const Line = Lines[i];

      // Fenced code block toggle — pass through the fence line and any content
      // inside the fence unchanged. Slack renders triple-backtick blocks
      // correctly already.
      if(/^\s*```/.test(Line)) {
        InFence = !InFence;
        OutLines.push(Line);
        continue;
      }
      if(InFence) {
        OutLines.push(Line);
        continue;
      }

      // Setext heading: the CURRENT line is all `=` or `-` and the previous
      // line is non-empty. Convert the previous emitted line to bold and drop
      // the underline.
      if(/^\s*={3,}\s*$/.test(Line) && OutLines.length > 0 && OutLines[OutLines.length - 1].trim().length > 0) {
        const Prev = OutLines.pop();
        if(typeof Prev !== 'string') continue;
        OutLines.push(HeadingStyle === 'plain-bold' ? `*${Prev.trim()}*` : `:round_pushpin: *${Prev.trim()}*`);
        continue;
      }
      if(/^\s*-{3,}\s*$/.test(Line) && OutLines.length > 0 && OutLines[OutLines.length - 1].trim().length > 0) {
        const Prev = OutLines.pop();
        if(typeof Prev !== 'string') continue;
        OutLines.push(HeadingStyle === 'plain-bold' ? `*${Prev.trim()}*` : `:small_blue_diamond: *${Prev.trim()}*`);
        continue;
      }

      let Transformed = Line;

      // ATX headings — most-specific (more hashes) first so `####` doesn't
      // accidentally match `##` mid-replace.
      if(HeadingStyle === 'plain-bold') {
        Transformed = Transformed.replace(/^\s*#{1,6}\s+(.+?)\s*$/, '*$1*');
      } else {
        Transformed = Transformed.replace(/^\s*#{4,}\s+(.+?)\s*$/, ':small_orange_diamond: *$1*');
        Transformed = Transformed.replace(/^\s*###\s+(.+?)\s*$/, ':point_right: *$1*');
        Transformed = Transformed.replace(/^\s*##\s+(.+?)\s*$/, ':small_blue_diamond: *$1*');
        Transformed = Transformed.replace(/^\s*#\s+(.+?)\s*$/, ':round_pushpin: *$1*');
      }

      // Bullet list with leading `-` → `•`. Preserves indentation.
      Transformed = Transformed.replace(/^(\s*)-\s+/, '$1• ');

      // Bold pass — `**bold**` / `__bold__` / `***triple***` → `*bold*`. Done
      // per-line inside the fence-aware loop so fenced code block contents
      // are never touched. The `\*{2,}` form also catches the rare triple.
      Transformed = Transformed.replace(/\*{2,}([^*\n]+?)\*{2,}/g, '*$1*');
      Transformed = Transformed.replace(/__([^_\n]+?)__/g, '*$1*');

      OutLines.push(Transformed);
    }

    return OutLines.join('\n');
  }

  /**
   * Truncate ArgText to at most ArgMaxWords whitespace-separated words and append the
   * horizontal-ellipsis character ("…") when truncation occurred, so a cut excerpt looks
   * intentional instead of broken. Returns ArgText unchanged when it has at most ArgMaxWords
   * words; returns the empty string for empty input.
   *
   * Word boundaries are runs of non-whitespace (`\S+`), which means markdown tokens like
   * `**State**` or backticked identifiers count as one word — a word-based cut is far less
   * likely to slice mid-pair than a character-based cut. The original whitespace structure
   * (including newlines) is preserved up to the cut point so multi-line markdown reads cleanly.
   *
   * @param {string} ArgText
   * @param {number} ArgMaxWords
   * @returns {string}
   */
  static TruncateToWords(ArgText, ArgMaxWords) {
    if(!ArgText || ArgMaxWords <= 0) return '';
    let WordCount = 0;
    let LastWordEnd = 0;
    const WordRe = /\S+/g;
    let Match;
    while((Match = WordRe.exec(ArgText)) !== null) {
      WordCount++;
      LastWordEnd = Match.index + Match[0].length;
      if(WordCount >= ArgMaxWords) break;
    }
    // If we never hit the cap, nothing to truncate.
    if(WordCount < ArgMaxWords) return ArgText;
    // If only whitespace remains after the last counted word, nothing was actually cut.
    if(ArgText.slice(LastWordEnd).trim().length === 0) return ArgText;
    return ArgText.slice(0, LastWordEnd) + '…';
  }
}

module.exports = SlackFormatUtils;
