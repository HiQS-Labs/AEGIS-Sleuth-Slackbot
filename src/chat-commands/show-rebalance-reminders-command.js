const os = require('os');
const fs = require('fs');
const path = require('path');
const RemindersDisplayUtils = require('../reminders-display-utils');

// Debug dump of the *published* rebalance reminders export — the actual file the
// rebalance-OS dashboard consumes, fetched live from the private git repo via the
// GitHub contents API. This is the consumer-side ground truth (it reflects publisher
// staleness), as opposed to the in-process `?format=rebalance` payload which always
// looks fresh. The published file is written by deploy/reminders-export/.

/**
 * Resolve the repo/path/branch of the published export. Mirrors the publisher's own
 * resolution in deploy/reminders-export/publish-reminders-export.mjs EXACTLY — same env
 * overrides and the same literal `'neochrome'` workspace default — so this command always
 * reads the same file the publisher writes, regardless of the live WORKSPACE_NAME (which on
 * prod is `neochrome` but locally is `neochrome-dev`; the export path tracks the publisher,
 * not the runtime workspace name).
 *
 * @returns {{ Workspace: string, Repo: string, FilePath: string, Branch: string }}
 */
function ResolveExportLocation() {
  const Workspace = process.env.SLEUTH_EXPORT_WORKSPACE || 'neochrome';
  const Repo = process.env.SLEUTH_EXPORT_REPO || '';
  const FilePath = process.env.SLEUTH_EXPORT_PATH || `sync/sleuth/reminders-${Workspace}.json`;
  const Branch = process.env.SLEUTH_EXPORT_BRANCH || 'main';
  return { Workspace, Repo, FilePath, Branch };
}

/**
 * Format an instant as `YYYY-MM-DD HH:MM:SS` in a specific IANA time zone, deterministically
 * (built from Intl parts rather than a locale string so the layout never drifts).
 *
 * @param {number} ArgMs Epoch milliseconds.
 * @param {string} ArgTimeZone IANA time zone (e.g. `UTC`, `America/New_York`).
 * @returns {string}
 */
function FormatYmdHms(ArgMs, ArgTimeZone) {
  const Formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: ArgTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  /** @type {Record<string, string>} */
  const Parts = {};
  for(const Part of Formatter.formatToParts(new Date(ArgMs))) Parts[Part.type] = Part.value;
  // en-CA with hour12:false renders midnight as hour '24'; normalize to '00'.
  const Hour = Parts.hour === '24' ? '00' : Parts.hour;
  return `${Parts.year}-${Parts.month}-${Parts.day} ${Hour}:${Parts.minute}:${Parts.second}`;
}

/**
 * Render the same instant in both UTC (offset 0) and the workspace-local time zone, as the
 * user asked. When the workspace has no MAIN_TIMEZONE the local stamp falls back to UTC and
 * is labelled as such.
 *
 * @param {number} ArgMs Epoch milliseconds.
 * @param {string} ArgTimeZone Workspace IANA time zone.
 * @returns {string}
 */
function FormatDualStamp(ArgMs, ArgTimeZone) {
  const Utc = FormatYmdHms(ArgMs, 'UTC');
  const Local = FormatYmdHms(ArgMs, ArgTimeZone);
  return `${Utc} UTC  |  ${Local} (${ArgTimeZone})`;
}

/**
 * Human-readable elapsed time between two instants (e.g. `32m ago`, `2h 5m ago`, `1d 3h ago`).
 *
 * @param {number} ArgFromMs Earlier instant (epoch ms).
 * @param {number} ArgToMs Later instant (epoch ms).
 * @returns {string}
 */
function FormatAge(ArgFromMs, ArgToMs) {
  const DeltaMs = Math.max(0, ArgToMs - ArgFromMs);
  const TotalMinutes = Math.floor(DeltaMs / 60000);
  if(TotalMinutes < 60) return `${TotalMinutes}m ago`;
  const TotalHours = Math.floor(TotalMinutes / 60);
  if(TotalHours < 24) return `${TotalHours}h ${TotalMinutes % 60}m ago`;
  const TotalDays = Math.floor(TotalHours / 24);
  return `${TotalDays}d ${TotalHours % 24}h ago`;
}

/**
 * @typedef {object} DebugSummaryInput
 * @property {string} Repo `owner/name` of the export repo.
 * @property {string} FilePath Path of the export file within the repo.
 * @property {string} Branch Branch the file was read from.
 * @property {number} NowMs When the dump was pulled (epoch ms).
 * @property {string} TimeZone Workspace IANA time zone for the local stamp.
 * @property {number|string} ReminderCount Count of reminders in the file (`?` if unparseable).
 * @property {number} MemoryCount Count of memories in the file.
 * @property {string|null} ExportGeneratedAtIso The file's `exportGeneratedAt` heartbeat, if present.
 * @property {string|null} CommitIso ISO date of the last commit that touched the file, if known.
 */

/**
 * Build the multi-line debug summary that accompanies the dump. Includes the pull time, the
 * file's own `exportGeneratedAt` heartbeat, and the last git commit time — each in UTC and the
 * workspace-local zone, with an age — so staleness of a dead/lagging publisher is obvious.
 *
 * @param {DebugSummaryInput} ArgInput
 * @returns {string}
 */
function BuildDebugSummary(ArgInput) {
  const Lines = [];
  Lines.push(':outbox_tray: *Rebalance reminders export — published file*');
  Lines.push(`*Repo:* \`${ArgInput.Repo}\``);
  Lines.push(`*Path:* \`${ArgInput.FilePath}\` (branch \`${ArgInput.Branch}\`)`);
  Lines.push(`*Pulled at:* ${FormatDualStamp(ArgInput.NowMs, ArgInput.TimeZone)}`);

  if(ArgInput.ExportGeneratedAtIso) {
    const Ms = Date.parse(ArgInput.ExportGeneratedAtIso);
    if(Number.isFinite(Ms))
      Lines.push(`*exportGeneratedAt:* ${FormatDualStamp(Ms, ArgInput.TimeZone)} — ${FormatAge(Ms, ArgInput.NowMs)}`);
    else
      Lines.push(`*exportGeneratedAt:* ${ArgInput.ExportGeneratedAtIso} (unparseable)`);
  } else {
    Lines.push('*exportGeneratedAt:* (absent from file)');
  }

  if(ArgInput.CommitIso) {
    const Ms = Date.parse(ArgInput.CommitIso);
    if(Number.isFinite(Ms))
      Lines.push(`*Last commit:* ${FormatDualStamp(Ms, ArgInput.TimeZone)} — ${FormatAge(Ms, ArgInput.NowMs)}`);
  }

  Lines.push(`*Reminders:* ${ArgInput.ReminderCount}   *Memories:* ${ArgInput.MemoryCount}`);
  return Lines.join('\n');
}

/**
 * Collapse whitespace to single spaces and cap the length, ellipsizing when trimmed. Keeps
 * one reminder/memory per Slack line regardless of embedded newlines in the source text.
 *
 * @param {unknown} ArgText Source text (tolerates null/undefined/non-strings).
 * @param {number} ArgMaxChars Maximum rendered length.
 * @returns {string}
 */
function TrimToOneLine(ArgText, ArgMaxChars) {
  const OneLine = String(ArgText ?? '').replace(/\s+/g, ' ').trim();
  return OneLine.length > ArgMaxChars ? `${OneLine.slice(0, ArgMaxChars - 1)}…` : OneLine;
}

/**
 * Render reminders carrying pre-rendered `display` fields (export v1.4.184+) in the EXACT
 * `show reminders` digest style: `Pending reminders (N total):`, the four due-date section
 * headers, and the canonical `A.) <permalink|summary> (X days old) - <@user> - <!date…>` line
 * via the shared BuildCompactReminderLine. Ages are recomputed from `createdOn` at render time
 * (the baked `display.ageDays` goes stale in the hourly-published file). Returns null when any
 * reminder lacks display fields (older published file) so the caller can fall back to the
 * legacy rendering.
 *
 * @param {any} ArgParsed Parsed export file.
 * @param {{ MaxReminders?: number, NowMs?: number }} [ArgLimits] Global line cap + clock.
 * @returns {string|null}
 */
function BuildDisplayReminderLines(ArgParsed, ArgLimits = {}) {
  const Reminders = Array.isArray(ArgParsed?.reminders) ? ArgParsed.reminders : [];
  if(!Reminders.length) return null;
  const WithDisplay = Reminders.filter((/** @type {any} */ ArgReminder) => ArgReminder?.display && typeof ArgReminder.display === 'object');
  if(WithDisplay.length !== Reminders.length) return null;

  const NowMs = ArgLimits.NowMs ?? Date.now();
  const MaxReminders = ArgLimits.MaxReminders ?? Infinity;
  const SectionOrder = (Array.isArray(ArgParsed?.display?.sectionOrder) && ArgParsed.display.sectionOrder.length)
    ? ArgParsed.display.sectionOrder
    : RemindersDisplayUtils.REMINDER_DUE_SECTIONS.map(Section => ({ key: Section.key, label: Section.label.replace(/\*/g, '') }));

  const Lines = [`Pending reminders (${Reminders.length} total):`];
  let Shown = 0;
  let Matched = 0;

  for(const Section of SectionOrder) {
    const InSection = WithDisplay.filter((/** @type {any} */ ArgReminder) => ArgReminder.display.sectionKey === Section.key);
    if(!InSection.length) continue;
    Matched += InSection.length;

    const Remaining = MaxReminders - Shown;
    if(Remaining <= 0) continue;

    Lines.push(`*${Section.label}*`);
    for(const Reminder of InSection.slice(0, Remaining)) {
      const DueMs = Date.parse(Reminder.shouldPostOn ?? '');
      const CreatedMs = Date.parse(Reminder.createdOn ?? '');
      const AgeDays = Number.isFinite(CreatedMs)
        ? Math.floor((NowMs - CreatedMs) / (24 * 60 * 60 * 1000))
        : (Reminder.display.ageDays ?? 0);

      Lines.push(RemindersDisplayUtils.BuildCompactReminderLine({
        Label: Reminder.display.label,
        Summary: Reminder.display.slackSummary || Reminder.display.summary || '(no text)',
        PermaLink: Reminder.display.permalink || null,
        AgeDays,
        TaggedUserMention: Reminder.display.taggedUserId ? `<@${Reminder.display.taggedUserId}>` : '_unassigned_',
        ShouldPostOnMs: Number.isFinite(DueMs) ? DueMs : 0,
      }));
      Shown++;
    }
  }

  const Hidden = Matched - Shown + (Reminders.length - Matched); // capped + unknown-section records
  if(Hidden > 0)
    Lines.push(`_… and ${Hidden} more — use \`show-rebalance-reminders\` for the full JSON._`);

  return Lines.join('\n');
}

/**
 * Render the parsed export as Slack-formatted lines instead of a raw JSON dump. When the file
 * carries pre-rendered `display` fields, reminders are rendered in the exact `show reminders`
 * digest style (sections + canonical compact lines) via BuildDisplayReminderLines; otherwise a
 * legacy due-time-sorted bullet list is used. Memories follow either way (captured date,
 * channel, preview). Counts always reflect the full file; line lists are capped so the post
 * stays under Slack's message size limit, with an explicit "… and N more" note when truncated.
 *
 * @param {any} ArgParsed Parsed export file (`reminders`/`memories` arrays, both optional).
 * @param {string} ArgTimeZone Workspace IANA time zone for the due/captured stamps.
 * @param {{ MaxReminders?: number, MaxMemories?: number, NowMs?: number }} [ArgLimits] Caps + clock.
 * @returns {string}
 */
function BuildFormattedBody(ArgParsed, ArgTimeZone, ArgLimits = {}) {
  const MaxMemories = ArgLimits.MaxMemories ?? 10;
  const Reminders = Array.isArray(ArgParsed?.reminders) ? ArgParsed.reminders : [];
  const Memories = Array.isArray(ArgParsed?.memories) ? ArgParsed.memories : [];

  const Lines = [];

  const DisplayLines = BuildDisplayReminderLines(ArgParsed, ArgLimits);
  if(DisplayLines !== null) {
    Lines.push(DisplayLines);
  } else {
    const MaxReminders = ArgLimits.MaxReminders ?? 20;

    const DueMsOf = (/** @type {any} */ ArgReminder) => {
      const Ms = Date.parse(ArgReminder?.shouldPostOn ?? '');
      return Number.isFinite(Ms) ? Ms : Number.MAX_SAFE_INTEGER; // undated reminders sort last
    };
    const SortedReminders = [...Reminders].sort((ArgA, ArgB) => DueMsOf(ArgA) - DueMsOf(ArgB));

    Lines.push(`*Reminders (${Reminders.length})* — due times in ${ArgTimeZone}`);
    if(!SortedReminders.length) Lines.push('_none_');
    for(const Reminder of SortedReminders.slice(0, MaxReminders)) {
      const DueMs = Date.parse(Reminder?.shouldPostOn ?? '');
      // drop the seconds from the YYYY-MM-DD HH:MM:SS stamp — minute precision reads better here.
      const Due = Number.isFinite(DueMs) ? FormatYmdHms(DueMs, ArgTimeZone).slice(0, 16) : 'no due date';
      const Assignee = Reminder?.assigneeId ? `<@${Reminder.assigneeId}>` : '_unassigned_';
      const Channel = Reminder?.originalChannelName ? `  _(#${Reminder.originalChannelName})_` : '';
      const Text = TrimToOneLine(Reminder?.reminderMessageText, 140) || '_(no text)_';
      Lines.push(`• \`${Reminder?.state || 'unknown'}\` *${Due}* ${Assignee} — ${Text}${Channel}`);
    }
    if(SortedReminders.length > MaxReminders)
      Lines.push(`_… and ${SortedReminders.length - MaxReminders} more — use \`show-rebalance-reminders\` for the full JSON._`);
  }

  Lines.push('');
  Lines.push(`*Memories (${Memories.length})*`);
  if(!Memories.length) Lines.push('_none_');
  for(const Memory of Memories.slice(0, MaxMemories)) {
    const CapturedMs = Date.parse(Memory?.capturedAt ?? '');
    const Captured = Number.isFinite(CapturedMs) ? FormatYmdHms(CapturedMs, ArgTimeZone).slice(0, 10) : 'unknown date';
    const Channel = Memory?.channelName ? `#${Memory.channelName}` : (Memory?.channelId || 'unknown channel');
    const Preview = TrimToOneLine(Memory?.preview, 120) || '_(no preview)_';
    Lines.push(`• *${Captured}* ${Channel} — ${Preview} _(${Memory?.messageCount ?? '?'} msgs)_`);
  }
  if(Memories.length > MaxMemories)
    Lines.push(`_… and ${Memories.length - MaxMemories} more — use \`show-rebalance-reminders\` for the full JSON._`);

  return Lines.join('\n');
}

/**
 * Build the GitHub REST headers for a contents/commits request.
 * @param {string} ArgToken GitHub PAT.
 * @returns {Record<string, string>}
 */
function BuildGitHubHeaders(ArgToken) {
  return {
    Authorization: `Bearer ${ArgToken}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'sleuth-show-rebalance-reminders',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

/**
 * Best-effort lookup of the most recent commit date that touched the export file. Returns null
 * on any failure — this is supplementary staleness signal, never a hard dependency.
 *
 * @param {string} ArgRepo
 * @param {string} ArgFilePath
 * @param {string} ArgBranch
 * @param {Record<string, string>} ArgHeaders
 * @returns {Promise<string|null>}
 */
async function FetchLastCommitDateAsync(ArgRepo, ArgFilePath, ArgBranch, ArgHeaders) {
  const Url = `https://api.github.com/repos/${ArgRepo}/commits` +
    `?path=${encodeURIComponent(ArgFilePath)}&sha=${encodeURIComponent(ArgBranch)}&per_page=1`;
  const Response = await fetch(Url, { headers: ArgHeaders });
  if(!Response.ok) return null;
  const Commits = await Response.json();
  if(!Array.isArray(Commits) || !Commits.length) return null;
  return Commits[0]?.commit?.committer?.date || Commits[0]?.commit?.author?.date || null;
}

/**
 * Handle the `show-rebalance-reminders` admin command — dumps the *published* rebalance reminders
 * export file (the artifact rebalance-OS consumes) for debugging, with the pull time and the file's
 * heartbeat/commit times stamped in both UTC and the workspace-local time zone. By default the full
 * file is attached verbatim with a summary alongside it; with `Formatted: true` (the
 * `show-rebalance-reminders-formatted` route) the same summary is followed by Slack-formatted
 * reminder/memory lines instead of the raw JSON blob.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {{ Formatted?: boolean }} [ArgOptions] `Formatted` renders Slack lines instead of the file.
 * @returns {Promise<void>}
 */
async function HandleShowRebalanceRemindersCommandAsync(ArgSlackApp, ArgEventInfo, ArgOptions = {}) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can dump the rebalance reminders export.',
      undefined,
      { Tag: 'rebalance-export' }
    );
    return;
  }

  // The published file lives in a private export repo (SLEUTH_EXPORT_REPO); the only token with read
  // access to it is the same one the publisher pushes with (SLEUTH_RAG_GITHUB_PAT). Fall back to
  // the workspace PAT for environments where that env var is the configured one.
  const Token = (
    process.env.SLEUTH_RAG_GITHUB_PAT ||
    ArgSlackApp.WorkspaceInfo?.GITHUB_PAT ||
    process.env.GITHUB_PAT ||
    ''
  ).trim();
  if(!Token) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'cannot read the rebalance export: no GitHub token available (set `SLEUTH_RAG_GITHUB_PAT` or the workspace `GITHUB_PAT`).',
      undefined,
      { Tag: 'rebalance-export' }
    );
    return;
  }

  const { Workspace, Repo, FilePath, Branch } = ResolveExportLocation();
  const TimeZone = ArgSlackApp.WorkspaceInfo?.MAIN_TIMEZONE || 'UTC';
  const Headers = BuildGitHubHeaders(Token);
  const EncodedPath = FilePath.split('/').map(encodeURIComponent).join('/');

  // 1. Fetch the published file via the GitHub contents API.
  let RawContent;
  try {
    const ContentsUrl = `https://api.github.com/repos/${Repo}/contents/${EncodedPath}?ref=${encodeURIComponent(Branch)}`;
    const Response = await fetch(ContentsUrl, { headers: Headers });
    if(Response.status === 404) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `no published rebalance export found at \`${Repo}/${FilePath}\` (branch \`${Branch}\`). The publisher may not have run yet, or the path/workspace is different.`,
        undefined,
        { Tag: 'rebalance-export' }
      );
      return;
    }
    if(!Response.ok) {
      const Body = (await Response.text()).slice(0, 300);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `failed to read the rebalance export — GitHub responded ${Response.status}: ${Body}`,
        undefined,
        { Tag: 'rebalance-export' }
      );
      return;
    }
    const Meta = await Response.json();
    RawContent = Buffer.from(Meta.content || '', 'base64').toString('utf8');
  } catch(error) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `failed to fetch the rebalance export: ${error.message}`,
      undefined,
      { Tag: 'rebalance-export' }
    );
    return;
  }

  // 2. Supplementary last-commit time (best-effort — never blocks the dump).
  let CommitIso = null;
  try {
    CommitIso = await FetchLastCommitDateAsync(Repo, FilePath, Branch, Headers);
  } catch { /* non-fatal: omit the commit line */ }

  // 3. Parse a copy for the summary counts/heartbeat (the dump itself stays verbatim).
  const NowMs = Date.now();
  let Parsed = null;
  try { Parsed = JSON.parse(RawContent); } catch { /* keep dumping raw even if it won't parse */ }
  const Summary = BuildDebugSummary({
    Repo, FilePath, Branch, NowMs, TimeZone,
    ReminderCount: Array.isArray(Parsed?.reminders) ? Parsed.reminders.length : '?',
    MemoryCount: Array.isArray(Parsed?.memories) ? Parsed.memories.length : 0,
    ExportGeneratedAtIso: typeof Parsed?.exportGeneratedAt === 'string' ? Parsed.exportGeneratedAt : null,
    CommitIso,
  });

  // 4a. Formatted mode: post Slack-formatted reminder/memory lines under the same summary
  //     instead of attaching the raw JSON. Falls back to tighter line caps if the first render
  //     exceeds Slack's ~4000-char message limit.
  if(ArgOptions.Formatted) {
    if(!Parsed) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `${Summary}\n\n:warning: the published file is not valid JSON, so it cannot be formatted — use \`show-rebalance-reminders\` for the raw dump.`,
        undefined,
        { Tag: 'rebalance-export' }
      );
      return;
    }
    let Body = BuildFormattedBody(Parsed, TimeZone, { NowMs });
    if(`${Summary}\n\n${Body}`.length > 3900)
      Body = BuildFormattedBody(Parsed, TimeZone, { MaxReminders: 10, MaxMemories: 5, NowMs });
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, `${Summary}\n\n${Body}`, undefined, { Tag: 'rebalance-export' });
    return;
  }

  // 4b. Attach the full file verbatim. Fall back to an inline (truncated) post if upload fails
  //    (e.g. the files:write scope is not granted).
  const FileName = `rebalance-${Workspace}-${Math.floor(NowMs / 1000)}.json`;
  const TmpPath = path.join(os.tmpdir(), FileName);
  try {
    fs.writeFileSync(TmpPath, RawContent, 'utf8');
    await ArgSlackApp.UploadFileAsync(ArgEventInfo.channel, ArgEventInfo.ts, TmpPath, Summary, FileName, { Tag: 'rebalance-export' });
  } catch {
    const Inline = RawContent.length > 3500
      ? `${RawContent.slice(0, 3500)}\n… (truncated — ${RawContent.length} bytes total)`
      : RawContent;
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `${Summary}\n\n\`\`\`\n${Inline}\n\`\`\``,
      undefined,
      { Tag: 'rebalance-export' }
    );
  } finally {
    try { fs.unlinkSync(TmpPath); } catch { /* temp file may not exist if write failed */ }
  }
}

module.exports = HandleShowRebalanceRemindersCommandAsync;
module.exports.ResolveExportLocation = ResolveExportLocation;
module.exports.FormatYmdHms = FormatYmdHms;
module.exports.FormatDualStamp = FormatDualStamp;
module.exports.FormatAge = FormatAge;
module.exports.BuildDebugSummary = BuildDebugSummary;
module.exports.BuildFormattedBody = BuildFormattedBody;
module.exports.BuildDisplayReminderLines = BuildDisplayReminderLines;
module.exports.TrimToOneLine = TrimToOneLine;
