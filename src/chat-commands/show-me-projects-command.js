'use strict';

const fs = require('fs');
const path = require('path');
const { WriteFileDurableSync } = require('../durable-write');
const SlackFormatUtils = require('../slack-format-utils');
const {
  ResolveMentionToUserId,
  GetActiveRemindersForUser,
  BuildGitHubContextAsync,
  ReminderHasActivePR,
} = require('./show-me-context');
const { DoesReminderMatchClient } = require('../client-mapping');

// ---------------------------------------------------------------------------
// Persisted client/project map  (data/runtime/client-project-map/<ws>.json)
// ---------------------------------------------------------------------------

const RUNTIME_MAP_DIR = path.join(__dirname, '..', '..', 'data', 'runtime', 'client-project-map');

/**
 * Absolute path for a workspace's persisted project map.
 * @param {string} ArgWorkspaceId
 * @returns {string}
 */
function GetProjectMapPath(ArgWorkspaceId) {
  return path.join(RUNTIME_MAP_DIR, `${ArgWorkspaceId}.json`);
}

/**
 * Load the persisted client/project map for a workspace.
 * Returns an empty map object when the file is missing or corrupt (fail open).
 * @param {string} ArgWorkspaceId
 * @returns {{ generatedAt: string, entries: Record<string, { projectName: string, client: string, clientId: string|null, status: 'confirmed'|'proposed' }> }}
 */
function LoadProjectMap(ArgWorkspaceId) {
  const EmptyMap = { generatedAt: new Date().toISOString(), entries: {} };
  if(!ArgWorkspaceId) return EmptyMap;
  try {
    const Raw = fs.readFileSync(GetProjectMapPath(ArgWorkspaceId), 'utf8');
    const Parsed = JSON.parse(Raw);
    if(Parsed && typeof Parsed === 'object' && Parsed.entries && typeof Parsed.entries === 'object') {
      return Parsed;
    }
    return EmptyMap;
  } catch(_) {
    return EmptyMap;
  }
}

/**
 * Persist the project map for a workspace. Silently no-ops on write failure (fail open).
 * @param {string} ArgWorkspaceId
 * @param {{ generatedAt: string, entries: Record<string, any> }} ArgMap
 * @returns {void}
 */
function SaveProjectMap(ArgWorkspaceId, ArgMap) {
  if(!ArgWorkspaceId) return;
  try {
    fs.mkdirSync(RUNTIME_MAP_DIR, { recursive: true });
    // Crash-atomic (GH-12); sync variant because SaveProjectMap is a synchronous helper.
    WriteFileDurableSync(GetProjectMapPath(ArgWorkspaceId), JSON.stringify(ArgMap, null, 2));
  } catch(_) {
    // fail open — a write failure must never block show-me-projects.
  }
}

/**
 * Look up a stable key for a reminder in the project map: prefer ReminderID, fall back to
 * a content hash built from channel + title to handle reminders without stable IDs.
 * @param {import('../reminders-module').ReminderInfo} ArgReminder
 * @returns {string}
 */
function ReminderMapKey(ArgReminder) {
  if(ArgReminder.ReminderID) return String(ArgReminder.ReminderID);
  return `${ArgReminder.OriginalChannelName || ''}::${ExtractReminderTitle(ArgReminder.ReminderMessageText)}`;
}

/**
 * Deterministically assign a project identity to a reminder from the persisted map and the
 * client-mapping config. Returns the matching entry (or null) without making any LLM call.
 *
 * Authority order (mirrors Phase C spec):
 *   1. Confirmed entry by exact key in the persisted map (operator-blessed).
 *   2. Confirmed entry sharing a GitHub repo or channel with a known project (structural match).
 *
 * Note: a client-only match (DoesReminderMatchClient) with no known project name does NOT qualify
 * as a deterministic match — the LLM is still needed to propose a project name for that task.
 *
 * @param {import('../reminders-module').ReminderInfo} ArgReminder
 * @param {Array<any>} ArgClients  (unused in deterministic path; kept for API compat)
 * @param {{ entries: Record<string, any> }} ArgMap
 * @returns {{ projectName: string, client: string, clientId: string|null, status: 'confirmed'|'proposed' }|null}
 */
function DetermineProjectForReminder(ArgReminder, ArgClients, ArgMap) {
  const Key = ReminderMapKey(ArgReminder);

  // 1 — exact confirmed map entry wins immediately; no LLM needed.
  const Existing = ArgMap.entries[Key];
  if(Existing && Existing.status === 'confirmed') return Existing;

  // 2 — structural match: a confirmed entry that shares a GitHub repo or Slack channel.
  //     This is the deterministic zero-token path for "a task matching a known project via
  //     shared repo/channel" (Phase C acceptance criterion).
  const ReminderRepos = Array.isArray(ArgReminder.GitHubUrls)
    ? ArgReminder.GitHubUrls.map(ArgUrl => {
      const M = ArgUrl.match(/github\.com\/([^/]+\/[^/]+)/i);
      return M ? M[1].toLowerCase() : null;
    }).filter(Boolean)
    : [];
  const ReminderChannel = ArgReminder.OriginalChannelName || null;

    for(const Entry of Object.values(ArgMap.entries || {})) {
    const TypedEntry = /** @type {{ status: 'confirmed'|'proposed', projectName: string, client: string, clientId: string|null, repos?: string[], channel?: string }} */ (Entry);
    if(TypedEntry.status !== 'confirmed') continue;
    // Must have a project name to be useful as a structural match.
    if(!TypedEntry.projectName) continue;

    // Shared repo check.
    if(ReminderRepos.length > 0 && Array.isArray(TypedEntry.repos)) {
      const EntryRepos = TypedEntry.repos.map((/** @type {any} */ ArgR) => (ArgR || '').toLowerCase());
      if(ReminderRepos.some(ArgRepo => EntryRepos.includes(ArgRepo))) return TypedEntry;
    }

    // Shared channel check.
    if(ReminderChannel && TypedEntry.channel && TypedEntry.channel === ReminderChannel) return TypedEntry;
  }

  // No deterministic match — caller must send to LLM.
  return null;
}

/**
 * Build an advisory context block from the project map, suitable for injection into LLM prompts.
 * Returns null when the map is empty, missing, or corrupt — callers must fail open.
 * @param {string} ArgWorkspaceId
 * @returns {{ generatedAt: string, summary: string }|null}
 */
function BuildProjectMapContext(ArgWorkspaceId) {
  try {
    const Map = LoadProjectMap(ArgWorkspaceId);
    const Entries = Object.values(Map.entries || {});
    if(Entries.length === 0) return null;
    const ConfirmedCount = Entries.filter(ArgE => ArgE.status === 'confirmed').length;
    const Summary = `Client/project map (generatedAt: ${Map.generatedAt}): ${Entries.length} entries, ${ConfirmedCount} confirmed. Projects: ${
      [...new Set(Entries.map(ArgE => `${ArgE.client} · ${ArgE.projectName || '(TBD)'}`))].slice(0, 10).join(', ')
    }`;
    return { generatedAt: Map.generatedAt, summary: Summary };
  } catch(_) {
    return null;
  }
}

// deterministic urgency ladder shared with show-me's prompt rules: lower rank = more urgent.
// an open authored PR on an overdue/due item is the highest urgency (in-flight work with a deadline).
/** @type {Record<string, number>} */
const STATE_URGENCY_RANK = { overdue: 1, due: 2, scheduled: 3, snoozed: 4 };
const ACTIVE_PR_BOOST = 0.5;

const SYSTEM_INSTRUCTIONS = `You are Sleuth's work-organization assistant. A Slack user wants a colleague's \
open task reminders grouped so they can see the shape of the work, not just a flat list.

Do two things:
1. CLIENT: assign every task to the billable client/account the work is for. Signals: the Slack channel \
name, GitHub repo owner (e.g. "ClientA/..."), product/domain names in the task (e.g. "ClientA.com", \
"NN Photo App", "Client B"), and the task wording. Seed mapping: channels/repos mentioning "client-a" = client \
"Client A"; "Client B" is a Client A sub-account. Infer all other clients yourself; internal team work is its \
own client (e.g. "Neochrome" or "Sleuth").
2. PROJECT: cluster tasks that belong to the same coherent body of work / initiative, even though no project \
is formally defined (same feature, system, repo area, or goal). A task related to nothing else is its own \
single-task project. Give each project a short descriptive name and the client it belongs to.

Rules:
- Every task id must appear in exactly one project. Never drop a task and never invent tasks or task text.
- Do not rank or reorder — the caller applies prioritization. Only group and name.
- Return only the grouping in the required schema.`;

const GROUPING_SCHEMA = {
  name: 'show_me_projects',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      projects: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            projectName: { type: 'string', description: 'Short descriptive project name' },
            client: { type: 'string', description: 'Client/account this project is for' },
            taskIds: { type: 'array', items: { type: 'integer' }, description: 'Task ids belonging to this project' },
          },
          required: ['projectName', 'client', 'taskIds'],
        },
      },
    },
    required: ['projects'],
  },
};

/**
 * Extract a concise, data-derived title for a reminder. Prefers the `Key task(s):` bullet that the
 * reminder pipeline writes; falls back to the message body with the digest "follow up" prefix stripped.
 * Rendering from stored data (never the model) keeps titles verbatim and prevents invented names.
 * @param {string} ArgText
 * @returns {string}
 */
function ExtractReminderTitle(ArgText) {
  const Text = typeof ArgText === 'string' ? ArgText : '';
  const KeyTaskMatch = Text.match(/Key task\(s\):\s*\n?\s*(?:[•\-*]\s*)?([^\n]+)/i);
  if(KeyTaskMatch && KeyTaskMatch[1].trim()) return KeyTaskMatch[1].trim();
  const Stripped = Text.replace(/^.*?please follow up on <[^>]*>:?\s*/is, '').replace(/^>\s*/, '');
  const FirstLine = Stripped.split('\n').map(ArgLine => ArgLine.trim()).find(ArgLine => ArgLine.length > 0) || Text.trim();
  return FirstLine.length > 140 ? `${FirstLine.slice(0, 137)}…` : FirstLine;
}

/**
 * Build a compact card for the grouping model from a reminder — stable id plus the signals that drive
 * client/project inference (channel, GitHub repos, cleaned task text).
 * @param {import('../reminders-module').ReminderInfo} ArgReminder
 * @param {number} ArgId
 * @returns {{ id: number, channel: string, repos: string[], task: string }}
 */
function BuildTaskCard(ArgReminder, ArgId) {
  const Repos = Array.isArray(ArgReminder.GitHubUrls)
    ? ArgReminder.GitHubUrls.map(ArgUrl => {
      const Match = ArgUrl.match(/github\.com\/([^/]+\/[^/]+)/i);
      return Match ? Match[1] : ArgUrl;
    })
    : [];
  return {
    id: ArgId,
    channel: ArgReminder.OriginalChannelName || '(none)',
    repos: Repos,
    task: ExtractReminderTitle(ArgReminder.ReminderMessageText),
  };
}

/**
 * Deterministic urgency rank for a reminder. Lower is more urgent. Mirrors show-me's priority ladder.
 * @param {import('../reminders-module').ReminderInfo} ArgReminder
 * @param {Set<string>} ArgActivePRUrls
 * @returns {number}
 */
function GetReminderUrgencyRank(ArgReminder, ArgActivePRUrls) {
  const Base = STATE_URGENCY_RANK[ArgReminder.State] ?? STATE_URGENCY_RANK.scheduled;
  const HasActivePR = ReminderHasActivePR(ArgReminder, ArgActivePRUrls);
  const IsDeadlineState = ArgReminder.State === 'overdue' || ArgReminder.State === 'due';
  return HasActivePR && IsDeadlineState ? Base - ACTIVE_PR_BOOST : Base;
}

/**
 * Render the grouped projects into a Slack mrkdwn message. Projects and their tasks are ordered by the
 * deterministic urgency ladder; any reminder the model failed to place is appended under "Ungrouped" so
 * nothing is silently dropped. Titles come from reminder data, never the model.
 * @param {string} ArgTargetUserId
 * @param {{ projectName: string, client: string, taskIds: number[] }[]|undefined} ArgProjects
 * @param {import('../reminders-module').ReminderInfo[]} ArgReminders
 * @param {Set<string>} ArgActivePRUrls
 * @param {(ArgMessage: string) => void} ArgWarn
 * @returns {string}
 */
function RenderProjects(ArgTargetUserId, ArgProjects, ArgReminders, ArgActivePRUrls, ArgWarn) {
  const Assigned = new Set();
  /** @type {{ projectName: string, client: string, ids: number[], urgency: number }[]} */
  const Groups = [];

  for(const Project of Array.isArray(ArgProjects) ? ArgProjects : []) {
    // accept each valid id once, marking it assigned immediately so duplicates (within this project
    // or across projects) and out-of-range ids are dropped rather than rendered twice.
    const Ids = [];
    for(const ArgId of Array.isArray(Project.taskIds) ? Project.taskIds : []) {
      if(!Number.isInteger(ArgId) || ArgId < 0 || ArgId >= ArgReminders.length || Assigned.has(ArgId)) continue;
      Assigned.add(ArgId);
      Ids.push(ArgId);
    }
    if(Ids.length === 0) continue;
    Ids.sort((ArgA, ArgB) => GetReminderUrgencyRank(ArgReminders[ArgA], ArgActivePRUrls) - GetReminderUrgencyRank(ArgReminders[ArgB], ArgActivePRUrls));
    Groups.push({
      projectName: Project.projectName || 'Untitled project',
      client: Project.client || '—',
      ids: Ids,
      urgency: Math.min(...Ids.map(ArgId => GetReminderUrgencyRank(ArgReminders[ArgId], ArgActivePRUrls))),
    });
  }

  // completeness guard: surface any reminder the model dropped rather than truncating silently.
  const Missing = ArgReminders.map((_ArgReminder, ArgIndex) => ArgIndex).filter(ArgIndex => !Assigned.has(ArgIndex));
  if(Missing.length > 0) {
    ArgWarn(`show-me-projects: model did not place ${Missing.length} reminder(s); appended under Ungrouped.`);
    Missing.sort((ArgA, ArgB) => GetReminderUrgencyRank(ArgReminders[ArgA], ArgActivePRUrls) - GetReminderUrgencyRank(ArgReminders[ArgB], ArgActivePRUrls));
    Groups.push({ projectName: 'Ungrouped', client: '—', ids: Missing, urgency: 99 });
  }

  Groups.sort((ArgA, ArgB) => ArgA.urgency - ArgB.urgency);

  const Header = `*Projects for <@${ArgTargetUserId}>* — ${ArgReminders.length} open reminder${ArgReminders.length === 1 ? '' : 's'} across ${Groups.length} project${Groups.length === 1 ? '' : 's'}`;
  const Blocks = Groups.map(ArgGroup => {
    const TaskLines = ArgGroup.ids.map(ArgId => {
      const Reminder = ArgReminders[ArgId];
      const State = Reminder.State ?? 'scheduled';
      const ActivePRNote = ReminderHasActivePR(Reminder, ArgActivePRUrls) ? ' `[Active PR]`' : '';
      return `   • [${State}] ${ExtractReminderTitle(Reminder.ReminderMessageText)}${ActivePRNote}`;
    });
    return `*${ArgGroup.client} · ${ArgGroup.projectName}*\n${TaskLines.join('\n')}`;
  });

  return `${Header}\n\n${Blocks.join('\n\n')}`;
}

/**
 * Handle `@Sleuth show-me-projects @user` — group the tagged user's open reminders into client and
 * project buckets (model), then order projects and tasks by urgency (deterministic). No admin gate.
 *
 * Phase C: deterministic-first. Known reminders are mapped via the persisted client/project map and
 * DoesReminderMatchClient with zero tokens. The LLM is called only for the unmatched remainder; its
 * output is marked `proposed` until operator-confirmed. Confirmed mappings are reused on all subsequent
 * calls. Fails open on a bad/missing map file — falls back to the full-regroup path.
 *
 * @param {import('../slack-app')} ArgSlackApp
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo
 * @param {string} ArgRawMention Raw Slack mention captured by the router, e.g. `<@U000EXAMPLE1>`.
 * @param {{ WorkspaceAI: import('../workspace-ai'), RemindersModule: import('../reminders-module')|null, Clients?: Array<any>, WorkspaceId?: string }} ArgDeps
 * @returns {Promise<void>}
 */
async function HandleShowMeProjectsCommandAsync(ArgSlackApp, ArgEventInfo, ArgRawMention, ArgDeps) {
  if(!ArgDeps.RemindersModule) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'show-me-projects is unavailable — reminders module is not loaded.'
    );
    return;
  }

  const TargetUserId = ResolveMentionToUserId(ArgRawMention);
  if(!TargetUserId) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "I couldn't find a valid @mention. Try: `@Sleuth show-me-projects @username`"
    );
    return;
  }

  const UserReminders = GetActiveRemindersForUser(ArgDeps.RemindersModule, TargetUserId, ArgSlackApp.BotUserID ?? null);

  if(UserReminders.length === 0) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `No open reminders found for <@${TargetUserId}>. Nothing to group right now.`
    );
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    `:card_index_dividers: Grouping ${UserReminders.length} open reminder${UserReminders.length === 1 ? '' : 's'} for <@${TargetUserId}> into projects…`
  );

  // reuse the shared GitHub context only for the [Active PR] urgency signal — grouping needs no live fetch.
  const { ActivePRUrls } = await BuildGitHubContextAsync(ArgSlackApp, TargetUserId);

  // --- Phase C: deterministic-first pass ---
  const WorkspaceId = ArgDeps.WorkspaceId || ArgSlackApp.WorkspaceInfo?.WorkspaceID || 'default';
  const Clients = ArgDeps.Clients || [];

  // Load the persisted map (fail open on corrupt/missing).
  let ProjectMap;
  try {
    ProjectMap = LoadProjectMap(WorkspaceId);
  } catch(_) {
    ProjectMap = { generatedAt: new Date().toISOString(), entries: {} };
  }

  /** @type {number[]} */
  const MatchedIndexes = [];
  /** @type {number[]} */
  const UnmatchedIndexes = [];
  /** @type {Record<number, { projectName: string|null, client: string, clientId: string|null, status: 'confirmed'|'proposed' }>} */
  const DeterministicResults = {};

  for(let Idx = 0; Idx < UserReminders.length; Idx++) {
    const Reminder = UserReminders[Idx];
    const Match = DetermineProjectForReminder(Reminder, Clients, ProjectMap);
    if(Match) {
      MatchedIndexes.push(Idx);
      DeterministicResults[Idx] = Match;
    } else {
      UnmatchedIndexes.push(Idx);
    }
  }

  // If all reminders are matched by deterministic rules, skip the LLM entirely.
  // Otherwise, call LLM only for the unmatched remainder.
  /** @type {{ projects?: { projectName: string, client: string, taskIds: number[] }[] }} */
  let LLMResponse = { projects: [] };

  if(UnmatchedIndexes.length > 0) {
    const UnmatchedCards = UnmatchedIndexes.map(ArgIdx => BuildTaskCard(UserReminders[ArgIdx], ArgIdx));
    const PromptText = `TASKS (JSON):\n${JSON.stringify(UnmatchedCards, null, 1)}`;
    try {
      LLMResponse = /** @type {{ projects?: { projectName: string, client: string, taskIds: number[] }[] }} */ (
        await ArgDeps.WorkspaceAI.ProcessMessageWithJsonResponseAsync(
          PromptText,
          SYSTEM_INSTRUCTIONS,
          GROUPING_SCHEMA,
          ArgDeps.WorkspaceAI.ComplexModelName
        )
      );

      // Persist LLM proposals as `proposed` (never `confirmed`) in the project map.
      const UpdatedMap = {
        generatedAt: new Date().toISOString(),
        entries: { ...ProjectMap.entries },
      };
      for(const Project of (LLMResponse?.projects || [])) {
        for(const TaskId of (Project.taskIds || [])) {
          if(TaskId < 0 || TaskId >= UserReminders.length) continue;
          const Reminder = UserReminders[TaskId];
          const Key = ReminderMapKey(Reminder);
          // Only write proposed if no confirmed entry already exists.
          if(!UpdatedMap.entries[Key] || UpdatedMap.entries[Key].status !== 'confirmed') {
            const Card = BuildTaskCard(Reminder, TaskId);
            UpdatedMap.entries[Key] = /** @type {{ projectName: string, client: string, clientId: string|null, status: 'confirmed'|'proposed' }} */ ({
              projectName: Project.projectName,
              client: Project.client,
              clientId: null,
              channel: Reminder.OriginalChannelName || null,
              repos: Card.repos,
              status: 'proposed',
            });
          }
        }
      }
      // Persist confirmed deterministic results too (they already have channel/repos).
      for(const [IdxStr, Match] of Object.entries(DeterministicResults)) {
        const Idx = Number(IdxStr);
        const Key = ReminderMapKey(UserReminders[Idx]);
        if(!UpdatedMap.entries[Key] || UpdatedMap.entries[Key].status !== 'confirmed') {
          if(Match.status === 'confirmed') UpdatedMap.entries[Key] = Match;
        }
      }
      SaveProjectMap(WorkspaceId, UpdatedMap);
    } catch(ArgError) {
      ArgSlackApp.Logger.error('show-me-projects: AI grouping failed:', ArgError);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        "Sorry — couldn't group the reminders right now. Check the logs."
      );
      return;
    }
  }

  // Merge deterministic results + LLM proposals into a unified project list for rendering.
  // Build a merged project list: start from LLM-proposed projects, then add deterministic-only
  // reminders that the LLM didn't see (because we skipped them).
  const MergedProjects = [...(LLMResponse?.projects || [])];

  // Deterministically matched reminders that the LLM didn't group need synthetic projects.
  // Group them by client from the deterministic result.
  /** @type {Map<string, { projectName: string, client: string, taskIds: number[] }>} */
  const DeterministicByClient = new Map();
  for(const [IdxStr, Match] of Object.entries(DeterministicResults)) {
    const Idx = Number(IdxStr);
    const ClientKey = Match.client || '—';
    if(!DeterministicByClient.has(ClientKey)) {
      DeterministicByClient.set(ClientKey, {
        projectName: Match.projectName || `${ClientKey} (confirmed)`,
        client: Match.client,
        taskIds: [],
      });
    }
    /** @type {{ taskIds: number[] }} */ (DeterministicByClient.get(ClientKey)).taskIds.push(Idx);
  }
  for(const DetermProject of DeterministicByClient.values()) {
    MergedProjects.push(DetermProject);
  }

  const Rendered = RenderProjects(
    TargetUserId,
    MergedProjects,
    UserReminders,
    ActivePRUrls,
    ArgMessage => ArgSlackApp.Logger.warn(ArgMessage)
  );
  const Formatted = SlackFormatUtils.NormalizeUserMentionsToMrkdwn(
    SlackFormatUtils.NormalizeModelMarkdownForSlack(Rendered)
  );
  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Formatted);
}

module.exports = HandleShowMeProjectsCommandAsync;
module.exports.ExtractReminderTitle = ExtractReminderTitle;
module.exports.GetReminderUrgencyRank = GetReminderUrgencyRank;
module.exports.RenderProjects = RenderProjects;
module.exports.LoadProjectMap = LoadProjectMap;
module.exports.SaveProjectMap = SaveProjectMap;
module.exports.GetProjectMapPath = GetProjectMapPath;
module.exports.DetermineProjectForReminder = DetermineProjectForReminder;
module.exports.BuildProjectMapContext = BuildProjectMapContext;
module.exports.ReminderMapKey = ReminderMapKey;
