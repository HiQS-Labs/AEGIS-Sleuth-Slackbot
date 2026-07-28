'use strict';

const DateUtils = require('./date-utils');
const {
  ParseStratalistUrlInfo,
  ValidateStratalistPayload,
  FetchStratalistPublicListAsync,
} = require('./stratalist');

const DueLookingTextRegex = /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+week|this\s+week|tonight|morning|afternoon|evening|noon|midnight|eod|cob|end\s+of|\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i;

/**
 * @typedef {'timestamp'|'date-only'|'undated'} StratalistDueDateKind
 */

/**
 * @typedef {{
 *   success: boolean,
 *   shareUrl: string|null,
 *   assigneeToken: string|null,
 *   assigneeMode: 'default'|'me'|'explicit',
 *   undatedFallbackText: string|null,
 *   errors: string[]
 * }} StratalistImportCommandParseResult
 */

/**
 * @typedef {{
 *   DuplicateKey: string,
 *   SourceListSlug: string,
 *   SourceListTitle: string,
 *   SourceShareUrl: string,
 *   SourceItemId: string,
 *   Position: number,
 *   Text: string,
 *   AssigneeID: string,
 *   DueDateKind: StratalistDueDateKind,
 *   DueAt: Date|null,
 *   UndatedFallbackText: string|null,
 *   Completed: boolean,
 *   Trashed: boolean
 * }} NormalizedStratalistImportCandidate
 */

/**
 * @typedef {{
 *   ItemId: string,
 *   Text: string,
 *   Position: number
 * }} StratalistSkippedItem
 */

/**
 * @typedef {{
 *   Type: 'undated-item-contains-time-like-text',
 *   ItemId: string,
 *   Message: string
 * }} StratalistNormalizationWarning
 */

/**
 * @typedef {{
 *   ListSlug: string,
 *   ListTitle: string,
 *   ShareUrl: string,
 *   ImportCandidates: NormalizedStratalistImportCandidate[],
 *   SkippedCompletedItems: StratalistSkippedItem[],
 *   SkippedTrashedItems: StratalistSkippedItem[],
 *   SkippedUndatedItems: StratalistSkippedItem[],
 *   Warnings: StratalistNormalizationWarning[]
 * }} StratalistNormalizationResult
 */

/**
 * @param {string} ArgListSlug
 * @param {string} ArgItemId
 * @returns {string}
 */
function BuildStratalistDuplicateKey(ArgListSlug, ArgItemId) {
  return `stratalist:${ArgListSlug}:${ArgItemId}`;
}

/**
 * Parse the mention-stripped command text for the Stratalist spike grammar.
 * Grammar for the spike:
 * - import <url>
 * - import <url> assign me|<@USER>
 * - import <url> undated <phrase>
 * - import <url> assign me|<@USER> undated <phrase>
 * `assign` must come before `undated` when both are present.
 *
 * @param {string} ArgCommandText
 * @returns {StratalistImportCommandParseResult}
 */
function ParseStratalistImportCommandText(ArgCommandText) {
  const CommandText = String(ArgCommandText || '').trim().replace(/\s+/g, ' ');
  const Match = CommandText.match(
    /^import\s+(\S+)(?:\s+assign\s+(me|<@[A-Z0-9]+>))?(?:\s+undated\s+(.+))?$/i
  );

  if(!Match) {
    return {
      success: false,
      shareUrl: null,
      assigneeToken: null,
      assigneeMode: 'default',
      undatedFallbackText: null,
      errors: [
        'Expected `import <stratalist-url> [assign me|<@USER>] [undated <date phrase>]`.',
      ],
    };
  }

  const ShareUrl = Match[1];
  const AssigneeToken = Match[2] || null;
  const UndatedFallbackText = Match[3] ? Match[3].trim() : null;

  if(UndatedFallbackText && /\bassign\s+(?:me|<@[A-Z0-9]+>)/i.test(UndatedFallbackText)) {
    return {
      success: false,
      shareUrl: ShareUrl,
      assigneeToken: AssigneeToken,
      assigneeMode: AssigneeToken === 'me' ? 'me' : AssigneeToken ? 'explicit' : 'default',
      undatedFallbackText: UndatedFallbackText,
      errors: [
        'When both clauses are present, place `assign ...` before `undated ...`.',
      ],
    };
  }

  try {
    ParseStratalistUrlInfo(ShareUrl);
  } catch(error) {
    return {
      success: false,
      shareUrl: ShareUrl,
      assigneeToken: AssigneeToken,
      assigneeMode: AssigneeToken === 'me' ? 'me' : AssigneeToken ? 'explicit' : 'default',
      undatedFallbackText: UndatedFallbackText,
      errors: [error.message],
    };
  }

  return {
    success: true,
    shareUrl: ShareUrl,
    assigneeToken: AssigneeToken,
    assigneeMode: AssigneeToken === 'me' ? 'me' : AssigneeToken ? 'explicit' : 'default',
    undatedFallbackText: UndatedFallbackText,
    errors: [],
  };
}

/**
 * @param {number} ArgYear
 * @param {number} ArgMonthOneBased
 * @param {number} ArgDay
 * @param {number} ArgHour
 * @param {number} ArgMinute
 * @param {string} ArgTimeZone
 * @returns {Date}
 */
function BuildUtcDateForLocalTime(ArgYear, ArgMonthOneBased, ArgDay, ArgHour, ArgMinute, ArgTimeZone) {
  const LocalAsUtc = new Date(Date.UTC(ArgYear, ArgMonthOneBased - 1, ArgDay, ArgHour, ArgMinute, 0));
  const Localized = DateUtils.GetLocalizedUtcDate(ArgTimeZone, LocalAsUtc);
  const OffsetMs = Localized.getTime() - LocalAsUtc.getTime();
  return new Date(LocalAsUtc.getTime() - OffsetMs);
}

/**
 * @param {string} ArgDueAtText
 * @param {string} ArgTimeZone
 * @returns {Date}
 */
function ConvertDateOnlyDueAtToWorkspaceDate(ArgDueAtText, ArgTimeZone) {
  const Match = String(ArgDueAtText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!Match)
    throw new Error(`Date-only dueAt must begin with YYYY-MM-DD. Received: ${ArgDueAtText}`);

  const Year = Number.parseInt(Match[1], 10);
  const Month = Number.parseInt(Match[2], 10);
  const Day = Number.parseInt(Match[3], 10);
  return BuildUtcDateForLocalTime(Year, Month, Day, 10, 0, ArgTimeZone);
}

/**
 * @param {any} ArgItem
 * @returns {StratalistSkippedItem}
 */
function BuildSkippedItem(ArgItem) {
  return {
    ItemId: String(ArgItem?.id || ''),
    Text: String(ArgItem?.text || ''),
    Position: Number.isFinite(ArgItem?.position) ? ArgItem.position : 0,
  };
}

/**
 * @param {any} ArgPayload
 * @param {{
 *   WorkspaceTimeZone: string,
 *   AssigneeID: string,
 *   UndatedFallbackText?: string|null
 * }} ArgOptions
 * @returns {StratalistNormalizationResult}
 */
function NormalizeStratalistPayload(ArgPayload, ArgOptions) {
  const ValidatedPayload = ValidateStratalistPayload(ArgPayload);
  const ListSlug = ValidatedPayload.ListSlug;
  const ListTitle = ValidatedPayload.ListTitle;
  const ShareUrl = ValidatedPayload.ShareUrl;

  /** @type {NormalizedStratalistImportCandidate[]} */
  const ImportCandidates = [];
  /** @type {StratalistSkippedItem[]} */
  const SkippedCompletedItems = [];
  /** @type {StratalistSkippedItem[]} */
  const SkippedTrashedItems = [];
  /** @type {StratalistSkippedItem[]} */
  const SkippedUndatedItems = [];
  /** @type {StratalistNormalizationWarning[]} */
  const Warnings = [];

  for(const Item of ValidatedPayload.Items) {
    if(Item.Completed === true) {
      SkippedCompletedItems.push(BuildSkippedItem({
        id: Item.ItemId,
        text: Item.Text,
        position: Item.Position,
      }));
      continue;
    }

    if(Item.Trashed === true) {
      SkippedTrashedItems.push(BuildSkippedItem({
        id: Item.ItemId,
        text: Item.Text,
        position: Item.Position,
      }));
      continue;
    }

    /** @type {StratalistDueDateKind} */
    let DueDateKind = 'undated';
    /** @type {Date|null} */
    let DueAt = null;
    let UndatedFallbackText = null;
    const RawDueAt = Item.DueAtText;

    if(RawDueAt && Item.DueDateOnly === true) {
      DueDateKind = 'date-only';
      DueAt = ConvertDateOnlyDueAtToWorkspaceDate(RawDueAt, ArgOptions.WorkspaceTimeZone);
    } else if(RawDueAt) {
      const ParsedDueAt = new Date(RawDueAt);
      DueDateKind = 'timestamp';
      DueAt = ParsedDueAt;
    } else if(ArgOptions.UndatedFallbackText) {
      DueDateKind = 'undated';
      UndatedFallbackText = ArgOptions.UndatedFallbackText;
    } else {
      SkippedUndatedItems.push(BuildSkippedItem({
        id: Item.ItemId,
        text: Item.Text,
        position: Item.Position,
      }));
      if(DueLookingTextRegex.test(Item.Text)) {
        Warnings.push({
          Type: 'undated-item-contains-time-like-text',
          ItemId: Item.ItemId,
          Message: `Item ${Item.ItemId} contains time-like text but payload dueAt is null.`,
        });
      }
      continue;
    }

    ImportCandidates.push({
      DuplicateKey: BuildStratalistDuplicateKey(ListSlug, Item.ItemId),
      SourceListSlug: ListSlug,
      SourceListTitle: ListTitle,
      SourceShareUrl: ShareUrl,
      SourceItemId: Item.ItemId,
      Position: Item.Position,
      Text: Item.Text,
      AssigneeID: ArgOptions.AssigneeID,
      DueDateKind,
      DueAt,
      UndatedFallbackText,
      Completed: false,
      Trashed: false,
    });
  }

  return {
    ListSlug,
    ListTitle,
    ShareUrl,
    ImportCandidates,
    SkippedCompletedItems,
    SkippedTrashedItems,
    SkippedUndatedItems,
    Warnings,
  };
}

module.exports = {
  ParseStratalistUrlInfo,
  BuildStratalistDuplicateKey,
  ParseStratalistImportCommandText,
  ConvertDateOnlyDueAtToWorkspaceDate,
  NormalizeStratalistPayload,
  FetchStratalistPublicListAsync,
};
