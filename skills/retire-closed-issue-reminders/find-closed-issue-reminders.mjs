#!/usr/bin/env node
// find-closed-issue-reminders.mjs — read a bulk-edit-reminders backup and classify each pending
// reminder by the live state of the GitHub issues/PRs it links (GH-332). Read-only: the only
// network call is `gh api` (REST) per unique link; nothing is written to Sleuth. Retiring stays
// with bulk-edit-reminders.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const USAGE = 'usage: find-closed-issue-reminders.mjs <backup.json>';
const LINK_PATTERN = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/(\d+)/g;

function Fail(ArgMessage) {
  process.stderr.write(`${ArgMessage}\n`);
  process.exit(2);
}

/** links from the server-tagged GitHubUrls and from the reminder text, as `owner/repo/number`. */
function ExtractRefs(ArgReminder) {
  const Text = [...(Array.isArray(ArgReminder.GitHubUrls) ? ArgReminder.GitHubUrls : []), ArgReminder.ReminderMessageText || ''].join(' ');
  return [...new Set([...Text.matchAll(LINK_PATTERN)].map(ArgMatch => `${ArgMatch[1]}/${ArgMatch[2]}/${ArgMatch[3]}`))];
}

/** the issues endpoint answers for PRs too; any failure is `unknown`, never closed. */
function LookUp(ArgRef) {
  const [Owner, Repo, Number] = ArgRef.split('/');
  const Result = spawnSync('gh', ['api', `repos/${Owner}/${Repo}/issues/${Number}`], { encoding: 'utf8' });
  if(Result.status !== 0) return { state: 'unknown', error: (Result.stderr || Result.error?.message || '').trim().slice(0, 200) };
  try {
    const Data = JSON.parse(Result.stdout);
    if(Data.state !== 'open' && Data.state !== 'closed') return { state: 'unknown', error: 'unexpected state' };
    return { state: Data.state, stateReason: Data.state_reason || null, mergedAt: Data.pull_request?.merged_at || null, title: Data.title || '' };
  } catch {
    return { state: 'unknown', error: 'unparseable gh output' };
  }
}

function Classify(ArgStates) {
  if(ArgStates.length === 0) return 'none';
  if(ArgStates.some(ArgState => ArgState === 'unknown')) return 'unknown';
  if(ArgStates.every(ArgState => ArgState === 'closed')) return 'all-closed';
  return ArgStates.includes('closed') ? 'mixed' : 'open';
}

function FirstTitle(ArgText) {
  const Lines = (ArgText || '').split('\n');
  const KeyTask = Lines.findIndex(ArgLine => ArgLine.startsWith('Key task'));
  const Bullet = KeyTask >= 0 ? Lines.slice(KeyTask + 1).find(ArgLine => ArgLine.startsWith('• ')) : null;
  return (Bullet ? Bullet.slice(2) : Lines[0] || '').trim().slice(0, 90);
}

const BackupPath = process.argv[2];
if(!BackupPath || process.argv.length > 3) Fail(USAGE);
let Reminders;
try {
  Reminders = JSON.parse(fs.readFileSync(BackupPath, 'utf8'));
} catch(error) {
  Fail(`cannot read backup ${BackupPath}: ${error.message}`);
}
if(!Array.isArray(Reminders)) Fail(`backup ${BackupPath} is not a JSON array of reminders`);

const States = new Map();
const Rows = Reminders.map(ArgReminder => {
  const Refs = ExtractRefs(ArgReminder);
  for(const Ref of Refs) if(!States.has(Ref)) States.set(Ref, LookUp(Ref));
  const Links = Refs.map(ArgRef => ({ ref: ArgRef, ...States.get(ArgRef) }));
  return { ReminderID: ArgReminder.ReminderID, class: Classify(Links.map(ArgLink => ArgLink.state)), links: Links, ReminderMessageText: ArgReminder.ReminderMessageText || '' };
});

const Counts = Object.fromEntries(['all-closed', 'mixed', 'unknown', 'open', 'none'].map(ArgClass => [ArgClass, Rows.filter(ArgRow => ArgRow.class === ArgClass).length]));
process.stdout.write(`reminders=${Rows.length} links=${States.size} ${Object.entries(Counts).map(([Key, Value]) => `${Key}=${Value}`).join(' ')}\n`);
for(const Row of Rows.filter(ArgRow => ArgRow.class !== 'none')) {
  const LinkText = Row.links.map(ArgLink => `${ArgLink.ref}:${ArgLink.mergedAt ? 'merged' : ArgLink.state}`).join(', ');
  process.stdout.write(`${Row.class.padEnd(10)} ${String(Row.ReminderID).slice(0, 8)}  ${FirstTitle(Row.ReminderMessageText)}  [${LinkText}]\n`);
}

// review input: everything that might be retirable, with text and link states. Private, like the backup.
const ReviewPath = `${BackupPath}.closed-issues.json`;
// private from the first byte: tighten a file left by an earlier run, create a new one as 0600.
if(fs.existsSync(ReviewPath)) fs.chmodSync(ReviewPath, 0o600);
fs.writeFileSync(ReviewPath, JSON.stringify(Rows.filter(ArgRow => ['all-closed', 'mixed', 'unknown'].includes(ArgRow.class)), null, 1), { mode: 0o600 });
process.stdout.write(`review file: ${ReviewPath}\n`);
