#!/usr/bin/env node
'use strict';

// GH-367 Phase 3 — local, zero-network reminder query. Reads the published mirror files
// (reminders-<ws>.json always; completions-<ws>.json when present) and runs the SAME deterministic
// query core the Slack `ask-reminders` command uses (src/reminder-query-engine.js). Prints the
// narrowed, cited candidate set; the calling model (Claude, via the talk-to-reminders skill)
// synthesizes the human answer. This script decides membership deterministically — the model never does.
//
// Usage:
//   node query-reminders.mjs [--workspace neochrome] [--client client-a] [--user U08ABC]
//        [--user-name mike] [--keywords "plugin,upgrade"] [--since "last week"] [--days 14]
//        [--include-completed] [--tz America/Los_Angeles] [--limit 50] [--json]
//
// Privacy: the local operator is the workspace admin querying their OWN workspace's mirror, so there
// is no cross-user boundary here (that scoping is the Slack surface's job). All candidates are
// treated as visible. ponytail: the mirror carries no per-channel private flag; if this skill ever
// serves non-admins, add channelIsPrivate to the export and a real allowedChannelIds scope.

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import QueryEngine from '../../src/reminder-query-engine.js';

const { FilterCandidates, ResolveTimeWindow, DAY_MS } = QueryEngine;
const HERE = path.dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------------------- arg parsing */

function ParseArgs(ArgArgv) {
  /** @type {Record<string, string|boolean>} */
  const Out = {};
  for(let i = 0; i < ArgArgv.length; i++) {
    const Token = ArgArgv[i];
    if(!Token.startsWith('--')) continue;
    const Key = Token.slice(2);
    const Next = ArgArgv[i + 1];
    if(Next === undefined || Next.startsWith('--')) { Out[Key] = true; }
    else { Out[Key] = Next; i++; }
  }
  return Out;
}

const Args = ParseArgs(process.argv.slice(2));
const Workspace = typeof Args.workspace === 'string' ? Args.workspace : (process.env.SLEUTH_EXPORT_WORKSPACE || 'neochrome');
const TimeZone = typeof Args.tz === 'string' ? Args.tz : (process.env.SLEUTH_TZ || 'America/Los_Angeles');
const MirrorDir = process.env.SLEUTH_MIRROR_DIR || '$HOME/git-pulse-sync/sync/sleuth';
const IncludeCompleted = Boolean(Args['include-completed']);
const Limit = Number.isFinite(Number(Args.limit)) && Number(Args.limit) > 0 ? Math.floor(Number(Args.limit)) : 50;
const AsJson = Boolean(Args.json);
const NowMs = Date.now();

/* --------------------------------------------------------------------------- load + normalize */

async function ReadJsonOrNull(ArgPath) {
  try { return JSON.parse(await readFile(ArgPath, 'utf8')); }
  catch(ArgErr) { if(ArgErr.code === 'ENOENT') return null; throw ArgErr; }
}

/** Active mirror record → ReminderCandidate (dated by createdOn). */
function ActiveToCandidate(ArgRecord) {
  const CreatedMs = Date.parse(ArgRecord.createdOn ?? '');
  return {
    id: ArgRecord.reminderId,
    text: ArgRecord.reminderMessageText || ArgRecord.display?.summary || '',
    assigneeId: ArgRecord.assigneeId || null,
    senderId: ArgRecord.originalSenderId || null,
    clientId: ArgRecord.clientId || null,
    channelId: ArgRecord.originalChannelId || null,
    channelIsPrivate: false,
    timestampMs: Number.isFinite(CreatedMs) ? CreatedMs : 0,
    state: ArgRecord.state || 'scheduled',
    isCompleted: false,
    // display extras (for the model's synthesis + citations — ignored by the filter core)
    summary: ArgRecord.display?.summary || null,
    assigneeName: ArgRecord.display?.assigneeName || null,
    permalink: ArgRecord.display?.permalink || null,
    channelName: ArgRecord.originalChannelName || null,
  };
}

/** Completions mirror record → ReminderCandidate (dated by completedMs). */
function CompletedToCandidate(ArgRecord) {
  return {
    id: ArgRecord.reminderId,
    text: ArgRecord.summary || '',
    assigneeId: ArgRecord.assigneeId || null,
    senderId: null,
    clientId: ArgRecord.clientId || null,
    channelId: ArgRecord.sourceChannelId || null,
    channelIsPrivate: false,
    timestampMs: typeof ArgRecord.completedMs === 'number' ? ArgRecord.completedMs : 0,
    state: 'completed',
    isCompleted: true,
    summary: ArgRecord.summary || null,
    assigneeName: null,
    permalink: null,
    channelName: null,
    completedAt: ArgRecord.completedAt || null,
  };
}

const ActiveMirror = await ReadJsonOrNull(path.join(MirrorDir, `reminders-${Workspace}.json`));
if(!ActiveMirror) {
  console.error(`[query-reminders] no active mirror at ${path.join(MirrorDir, `reminders-${Workspace}.json`)} — set SLEUTH_MIRROR_DIR?`);
  process.exit(2);
}
const Candidates = new Map(); // id → candidate; completed wins (a finished task shouldn't show as open)
for(const R of (ActiveMirror.reminders || [])) {
  const C = ActiveToCandidate(R);
  if(C.id) Candidates.set(C.id, C);
}
let CompletionsMeta = null;
if(IncludeCompleted) {
  const Completions = await ReadJsonOrNull(path.join(MirrorDir, `completions-${Workspace}.json`));
  if(Completions) {
    CompletionsMeta = { count: Completions.count ?? (Completions.completions || []).length, windowDays: Completions.windowDays ?? null };
    for(const R of (Completions.completions || [])) {
      const C = CompletedToCandidate(R);
      if(C.id) Candidates.set(C.id, C); // completed-wins
    }
  }
}

/* --------------------------------------------------------------------------- build query + filter */

/** @type {{ startMs:number, endMs:number, label:string }|null} */
let TimeWindow = null;
if(typeof Args.since === 'string') TimeWindow = ResolveTimeWindow(Args.since, NowMs, TimeZone);
if(!TimeWindow && Number.isFinite(Number(Args.days)) && Number(Args.days) > 0) {
  const N = Math.floor(Number(Args.days));
  TimeWindow = { startMs: NowMs - N * DAY_MS, endMs: NowMs, label: `last ${N} days` };
}

const UserIds = typeof Args.user === 'string' ? [Args.user] : null;
const Keywords = typeof Args.keywords === 'string' ? Args.keywords.split(',').map(ArgK => ArgK.trim()).filter(Boolean) : null;
const ClientId = typeof Args.client === 'string' ? Args.client : null;

const Query = {
  timeWindow: TimeWindow ? { startMs: TimeWindow.startMs, endMs: TimeWindow.endMs } : null,
  userIds: UserIds,
  clientId: ClientId,
  keywords: Keywords,
  channelScope: { allowedChannelIds: [] }, // local admin: nothing private in the mirror to scope out
};

const AllCandidates = [...Candidates.values()];
let { matched, total } = FilterCandidates(AllCandidates, Query);

// --user-name: display-name substring match (the operator names a person, not a Slack ID). Applied
// after the deterministic core because the mirror only carries the resolved name on active records.
if(typeof Args['user-name'] === 'string') {
  const Needle = Args['user-name'].toLowerCase();
  matched = matched.filter(ArgC => (ArgC.assigneeName || '').toLowerCase().includes(Needle));
}

matched.sort((ArgA, ArgB) => ArgB.timestampMs - ArgA.timestampMs); // newest first
const Limited = matched.slice(0, Limit);

/* --------------------------------------------------------------------------- output */

const Filters = {
  workspace: Workspace, timezone: TimeZone,
  client: ClientId, userIds: UserIds, userName: Args['user-name'] || null,
  keywords: Keywords, timeWindow: TimeWindow ? TimeWindow.label : null,
  includeCompleted: IncludeCompleted,
};

if(AsJson) {
  console.log(JSON.stringify({ filters: Filters, matchedCount: matched.length, totalCandidates: total, returned: Limited.length, completionsMeta: CompletionsMeta, matched: Limited }, null, 2));
} else {
  const Bits = [
    Filters.client && `client=${Filters.client}`,
    Filters.userIds && `user=${Filters.userIds.join(',')}`,
    Filters.userName && `name~${Filters.userName}`,
    Filters.keywords && `keywords=[${Filters.keywords.join(', ')}]`,
    Filters.timeWindow && `when=${Filters.timeWindow}`,
    IncludeCompleted && 'incl. completed',
  ].filter(Boolean).join('  ');
  console.log(`# ${Workspace} reminders — ${matched.length} match / ${total} candidates${Bits ? `  (${Bits})` : ''}`);
  if(CompletionsMeta) console.log(`# history: ${CompletionsMeta.count} completions (last ${CompletionsMeta.windowDays}d)`);
  console.log('');
  for(const C of Limited) {
    const When = new Date(C.timestampMs).toISOString().slice(0, 10);
    const Who = C.assigneeName || C.assigneeId || '—';
    const Client = C.clientId ? `[${C.clientId}]` : '[—]';
    const Flag = C.isCompleted ? '✅' : '⏳';
    console.log(`${Flag} ${Client} ${Who} · ${When} · ${C.state}`);
    console.log(`   ${(C.summary || C.text || '').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
    console.log(`   id:${C.id}${C.permalink ? `  ↗ ${C.permalink}` : ''}`);
  }
  if(matched.length > Limited.length) console.log(`\n… ${matched.length - Limited.length} more (raise --limit)`);
  // machine block so the model can cite exact ids/fields without re-parsing the pretty output
  console.log(`\n---JSON---\n${JSON.stringify({ matched: Limited }, null, 2)}`);
}
