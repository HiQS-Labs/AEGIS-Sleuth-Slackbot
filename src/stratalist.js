'use strict';

const SlackFormatUtils = require('./slack-format-utils');

const StratalistShareHost = 'stratalist.net';
const StratalistSlugRegex = /^[A-Za-z0-9_-]{1,128}$/;
const SharePathRegex = /^\/go\/([A-Za-z0-9_-]{1,128})\/?$/;
const ApiPathRegex = /^\/api\/public\/share\/([A-Za-z0-9_-]{1,128})\/?$/;
const DefaultRenderedItemLimit = 20;

/**
 * @typedef {{
 *   ShareUrl: string,
 *   ApiUrl: string,
 *   Slug: string
 * }} StratalistUrlInfo
 */

/**
 * @typedef {{
 *   ItemId: string,
 *   Text: string,
 *   Position: number,
 *   Completed: boolean,
 *   Trashed: boolean,
 *   DueAtText: string|null,
 *   DueDateOnly: boolean
 * }} StratalistValidatedItem
 */

/**
 * @typedef {{
 *   ListSlug: string,
 *   ListTitle: string,
 *   ShareUrl: string,
 *   Items: StratalistValidatedItem[]
 * }} StratalistValidatedPayload
 */

/**
 * @typedef {{
 *   ok: boolean,
 *   status: number,
 *   errorCode?: string,
 *   message?: string,
 *   payload?: any,
 *   urlInfo?: StratalistUrlInfo
 * }} StratalistFetchResult
 */

/**
 * @param {string} ArgSlug
 * @returns {StratalistUrlInfo}
 */
function BuildStratalistUrlInfoFromSlug(ArgSlug) {
  const Slug = String(ArgSlug || '').trim();
  if(!StratalistSlugRegex.test(Slug))
    throw new Error('Stratalist slug must use only letters, numbers, underscores, or hyphens.');

  return {
    ShareUrl: `https://${StratalistShareHost}/go/${Slug}`,
    ApiUrl: `https://${StratalistShareHost}/api/public/share/${Slug}`,
    Slug,
  };
}

/**
 * @param {string} ArgShareUrl
 * @returns {StratalistUrlInfo}
 */
function ParseStratalistUrlInfo(ArgShareUrl) {
  let ParsedUrl;
  try {
    ParsedUrl = new URL(String(ArgShareUrl || '').trim());
  } catch(error) {
    throw new Error('Stratalist URL is invalid.');
  }

  if(ParsedUrl.protocol !== 'https:')
    throw new Error('Stratalist URL must use https.');

  if(ParsedUrl.hostname !== StratalistShareHost)
    throw new Error(`Stratalist URL must use ${StratalistShareHost}.`);

  const ShareMatch = ParsedUrl.pathname.match(SharePathRegex);
  if(ShareMatch)
    return BuildStratalistUrlInfoFromSlug(ShareMatch[1]);

  const ApiMatch = ParsedUrl.pathname.match(ApiPathRegex);
  if(ApiMatch)
    return BuildStratalistUrlInfoFromSlug(ApiMatch[1]);

  throw new Error('Stratalist URL must match /go/:slug or /api/public/share/:slug.');
}

/**
 * Accept a raw slug, share URL, or public API URL and normalize it to the canonical Stratalist
 * share + API pair. This lets read-only view mode stay slug-first while future import flows can
 * still accept full URLs without duplicating parsing rules.
 *
 * @param {string} ArgReference
 * @returns {StratalistUrlInfo}
 */
function ResolveStratalistReferenceInfo(ArgReference) {
  const Reference = String(ArgReference || '').trim();
  if(!Reference)
    throw new Error('Stratalist reference is required.');

  if(/^https?:\/\//i.test(Reference))
    return ParseStratalistUrlInfo(Reference);

  return BuildStratalistUrlInfoFromSlug(Reference);
}

/**
 * @param {any} ArgPayload
 * @returns {StratalistValidatedPayload}
 */
function ValidateStratalistPayload(ArgPayload) {
  if(!ArgPayload || ArgPayload.success !== true || typeof ArgPayload !== 'object')
    throw new Error('Stratalist payload must be a success JSON object.');

  if(!ArgPayload.list || typeof ArgPayload.list !== 'object')
    throw new Error('Stratalist payload is missing the list object.');

  const ListSlug = String(ArgPayload.list.slug || '').trim();
  const ListTitle = String(ArgPayload.list.title || '').trim();
  const ShareUrl = String(ArgPayload.list.shareUrl || '').trim();
  if(!ListSlug || !ListTitle || !ShareUrl)
    throw new Error('Stratalist payload is missing required list fields (slug, title, or shareUrl).');

  if(!Array.isArray(ArgPayload.items))
    throw new Error('Stratalist payload is missing the items array.');

  /** @type {StratalistValidatedItem[]} */
  const Items = [];
  for(const ArgItem of ArgPayload.items) {
    const ItemId = String(ArgItem?.id || '').trim();
    const Text = String(ArgItem?.text || '').trim();
    const Position = Number.isFinite(ArgItem?.position) ? ArgItem.position : 0;
    const DueAtText = typeof ArgItem?.dueAt === 'string' && ArgItem.dueAt.trim()
      ? ArgItem.dueAt.trim()
      : null;
    const DueDateOnly = ArgItem?.dueDateOnly === true;

    if(!ItemId || !Text)
      throw new Error('Every Stratalist item must include id and text.');

    if(DueAtText) {
      if(DueDateOnly && !/^\d{4}-\d{2}-\d{2}/.test(DueAtText))
        throw new Error(`Date-only dueAt must begin with YYYY-MM-DD. Received: ${DueAtText}`);

      if(Number.isNaN(new Date(DueAtText).getTime()))
        throw new Error(`Invalid dueAt timestamp for item ${ItemId}: ${DueAtText}`);
    }

    Items.push({
      ItemId,
      Text,
      Position,
      Completed: ArgItem?.completed === true,
      Trashed: ArgItem?.trashed === true,
      DueAtText,
      DueDateOnly,
    });
  }

  Items.sort((ArgLeft, ArgRight) => ArgLeft.Position - ArgRight.Position || ArgLeft.ItemId.localeCompare(ArgRight.ItemId));

  return {
    ListSlug,
    ListTitle,
    ShareUrl,
    Items,
  };
}

/**
 * @param {string} ArgDueAtText
 * @returns {string}
 */
function FormatDateOnlyDueForDisplay(ArgDueAtText) {
  const Match = String(ArgDueAtText || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!Match)
    throw new Error(`Date-only dueAt must begin with YYYY-MM-DD. Received: ${ArgDueAtText}`);

  const UtcDate = new Date(`${Match[1]}-${Match[2]}-${Match[3]}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(UtcDate);
}

/**
 * @param {string} ArgDueAtText
 * @param {string} ArgTimeZone
 * @returns {string}
 */
function FormatTimestampDueForDisplay(ArgDueAtText, ArgTimeZone) {
  const ParsedDate = new Date(ArgDueAtText);
  if(Number.isNaN(ParsedDate.getTime()))
    throw new Error(`Invalid timestamp dueAt: ${ArgDueAtText}`);

  return new Intl.DateTimeFormat('en-US', {
    timeZone: ArgTimeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ParsedDate);
}

/**
 * @param {string|null} ArgDueAtText
 * @param {boolean} ArgDueDateOnly
 * @param {string} ArgTimeZone
 * @returns {string|null}
 */
function FormatStratalistDueForDisplay(ArgDueAtText, ArgDueDateOnly, ArgTimeZone) {
  if(!ArgDueAtText) return null;
  return ArgDueDateOnly
    ? FormatDateOnlyDueForDisplay(ArgDueAtText)
    : FormatTimestampDueForDisplay(ArgDueAtText, ArgTimeZone);
}

/**
 * @param {any} ArgPayload
 * @param {{
 *   TimeZone: string,
 *   MaxItems?: number
 * }} ArgOptions
 * @returns {string}
 */
function RenderStratalistListForSlack(ArgPayload, ArgOptions) {
  const ValidatedPayload = ValidateStratalistPayload(ArgPayload);
  const TimeZone = String(ArgOptions?.TimeZone || '').trim();
  if(!TimeZone)
    throw new Error('RenderStratalistListForSlack requires a workspace time zone.');

  const MaxItems = Number.isFinite(ArgOptions?.MaxItems) && ArgOptions.MaxItems > 0
    ? Math.floor(ArgOptions.MaxItems)
    : DefaultRenderedItemLimit;

  const VisibleItems = ValidatedPayload.Items.filter((ArgItem) => !ArgItem.Trashed);
  const RenderedItems = VisibleItems.slice(0, MaxItems);
  const HiddenVisibleItemCount = Math.max(VisibleItems.length - RenderedItems.length, 0);
  const HiddenTrashedItemCount = ValidatedPayload.Items.length - VisibleItems.length;

  /** @type {string[]} */
  const Lines = [
    `*${SlackFormatUtils.SanitizeForInlineSlack(ValidatedPayload.ListTitle, 120)}*`,
  ];

  if(RenderedItems.length === 0) {
    Lines.push('_No visible items._');
  } else {
    for(const Item of RenderedItems) {
      const Checkbox = Item.Completed ? '☑' : '☐';
      const DueText = FormatStratalistDueForDisplay(Item.DueAtText, Item.DueDateOnly, TimeZone);
      const ItemLine = `${Checkbox} ${SlackFormatUtils.SanitizeForInlineSlack(Item.Text, 220)}`;
      Lines.push(DueText ? `${ItemLine} - due ${DueText}` : ItemLine);
    }
  }

  if(HiddenVisibleItemCount > 0)
    Lines.push(`_...and ${HiddenVisibleItemCount} more item${HiddenVisibleItemCount === 1 ? '' : 's'}._`);

  if(HiddenTrashedItemCount > 0)
    Lines.push(`_${HiddenTrashedItemCount} trashed item${HiddenTrashedItemCount === 1 ? '' : 's'} hidden._`);

  Lines.push('', `Stratalist: ${ValidatedPayload.ShareUrl}`);
  return Lines.join('\n');
}

/**
 * @param {string} ArgInputReference
 * @param {(input: string, init?: RequestInit) => Promise<Response>} [ArgFetchImpl]
 * @returns {Promise<StratalistFetchResult>}
 */
async function FetchStratalistPublicListAsync(ArgInputReference, ArgFetchImpl = fetch) {
  const UrlInfo = ResolveStratalistReferenceInfo(ArgInputReference);
  const Response = await ArgFetchImpl(UrlInfo.ApiUrl, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
    },
  });

  if(Response.status === 404) {
    return {
      ok: false,
      status: 404,
      errorCode: 'not-found',
      message: `No public Stratalist list found for slug ${UrlInfo.Slug}.`,
      urlInfo: UrlInfo,
    };
  }

  if(Response.status === 403) {
    return {
      ok: false,
      status: 403,
      errorCode: 'not-public',
      message: `Stratalist list ${UrlInfo.Slug} is not public.`,
      urlInfo: UrlInfo,
    };
  }

  if(Response.status !== 200) {
    return {
      ok: false,
      status: Response.status,
      errorCode: 'unexpected-status',
      message: `Unexpected Stratalist status ${Response.status}.`,
      urlInfo: UrlInfo,
    };
  }

  let Payload;
  try {
    Payload = await Response.json();
  } catch(error) {
    return {
      ok: false,
      status: 200,
      errorCode: 'invalid-json',
      message: 'Stratalist returned invalid JSON.',
      urlInfo: UrlInfo,
    };
  }

  return {
    ok: true,
    status: 200,
    payload: Payload,
    urlInfo: UrlInfo,
  };
}

module.exports = {
  BuildStratalistUrlInfoFromSlug,
  ParseStratalistUrlInfo,
  ResolveStratalistReferenceInfo,
  ValidateStratalistPayload,
  FormatStratalistDueForDisplay,
  RenderStratalistListForSlack,
  FetchStratalistPublicListAsync,
};
