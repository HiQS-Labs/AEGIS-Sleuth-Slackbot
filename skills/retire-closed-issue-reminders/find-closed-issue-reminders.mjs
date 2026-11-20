#!/usr/bin/env node
// find-closed-issue-reminders.mjs — read a bulk-edit-reminders backup and classify each pending
// reminder by the live state of the GitHub issues/PRs it links (GH-332). Read-only: the only
// network call is `gh api` (REST) per unique link; nothing is written to Sleuth. Retiring stays
// with bulk-edit-reminders.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const USAGE = 'usage: find-closed-issue-reminders.mjs <backup.json>';
// case-insensitive like src/github-url-utils.js: `GitHub.com` is the same host, and a missed open
// link would turn a mixed reminder into an all-closed one.
const LINK_PATTERN = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/gi;

function fail(ArgMessage) {
  process.stderr.write(`${ArgMessage}\n`);
  process.exit(2);
}

/** links from the server-tagged GitHubUrls and from the reminder text, as `owner/repo/number`. */
function ExtractRefs(ArgReminder) {
  const text = [...(Array.isArray(ArgReminder.GitHubUrls) ? ArgReminder.GitHubUrls : []), ArgReminder.ReminderMessageText || ''].join(' ');
  return [...new Set([...text.matchAll(LINK_PATTERN)].map(ArgMatch => `${ArgMatch[1]}/${ArgMatch[2]}/${ArgMatch[3]}`))];
}

/** the issues endpoint answers for PRs too; any failure is `unknown`, never closed. */
function LookUp(ArgRef) {
  const [owner, repo, number] = ArgRef.split('/');
  const result = spawnSync('gh', ['api', `repos/${owner}/${repo}/issues/${number}`], { encoding: 'utf8' });
  if(result.status !== 0) return { state: 'unknown', error: (result.stderr || result.error?.message || '').trim().slice(0, 200) };
  try {
    const data = JSON.parse(result.stdout);
    if(data.state !== 'open' && data.state !== 'closed') return { state: 'unknown', error: 'unexpected state' };
    return { state: data.state, stateReason: data.state_reason || null, mergedAt: data.pull_request?.merged_at || null, title: data.title || '' };
  } catch {
    return { state: 'unknown', error: 'unparseable gh output' };
  }
}

function classify(ArgStates) {
  if(ArgStates.length === 0) return 'none';
  if(ArgStates.some(ArgState => ArgState === 'unknown')) return 'unknown';
  if(ArgStates.every(ArgState => ArgState === 'closed')) return 'all-closed';
  return ArgStates.includes('closed') ? 'mixed' : 'open';
}

function FirstTitle(ArgText) {
  const lines = (ArgText || '').split('\n');
  const KeyTask = lines.findIndex(ArgLine => ArgLine.startsWith('Key task'));
  const bullet = KeyTask >= 0 ? lines.slice(KeyTask + 1).find(ArgLine => ArgLine.startsWith('• ')) : null;
  return (bullet ? bullet.slice(2) : lines[0] || '').trim().slice(0, 90);
}

const BackupPath = process.argv[2];
if(!BackupPath || process.argv.length > 3) fail(USAGE);
let reminders;
try {
  reminders = JSON.parse(fs.readFileSync(BackupPath, 'utf8'));
} catch(error) {
  fail(`cannot read backup ${BackupPath}: ${error.message}`);
}
if(!Array.isArray(reminders)) fail(`backup ${BackupPath} is not a JSON array of reminders`);

const states = new Map();
const rows = reminders.map(ArgReminder => {
  const refs = ExtractRefs(ArgReminder);
  for(const ref of refs) if(!states.has(ref)) states.set(ref, LookUp(ref));
  const links = refs.map(ArgRef => ({ ref: ArgRef, ...states.get(ArgRef) }));
  return { ReminderID: ArgReminder.ReminderID, class: classify(links.map(ArgLink => ArgLink.state)), links, ReminderMessageText: ArgReminder.ReminderMessageText || '' };
});

const counts = Object.fromEntries(['all-closed', 'mixed', 'unknown', 'open', 'none'].map(ArgClass => [ArgClass, rows.filter(ArgRow => ArgRow.class === ArgClass).length]));
process.stdout.write(`reminders=${rows.length} links=${states.size} ${Object.entries(counts).map(([ArgKey, ArgValue]) => `${ArgKey}=${ArgValue}`).join(' ')}\n`);
for(const row of rows.filter(ArgRow => ArgRow.class !== 'none')) {
  const LinkText = row.links.map(ArgLink => `${ArgLink.ref}:${ArgLink.mergedAt ? 'merged' : ArgLink.state}`).join(', ');
  process.stdout.write(`${row.class.padEnd(10)} ${String(row.ReminderID).slice(0, 8)}  ${FirstTitle(row.ReminderMessageText)}  [${LinkText}]\n`);
}

// review input: everything that might be retirable, with text and link states. Private, like the backup.
const ReviewPath = `${BackupPath}.closed-issues.json`;
// private from the first byte: tighten a file left by an earlier run, create a new one as 0600.
if(fs.existsSync(ReviewPath)) fs.chmodSync(ReviewPath, 0o600);
fs.writeFileSync(ReviewPath, JSON.stringify(rows.filter(ArgRow => ['all-closed', 'mixed', 'unknown'].includes(ArgRow.class)), null, 1), { mode: 0o600 });
process.stdout.write(`review file: ${ReviewPath}\n`);
