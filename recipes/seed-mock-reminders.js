#!/usr/bin/env node
'use strict';

// ============================================================
// CONFIGURATION — edit this section before running
// ============================================================
const CONFIG = {
  WORKSPACE_NAME: 'Neochrome',
  TASK_COUNT: 9,
  CHANNEL_ID: 'C000EXAMPLE6',
  CHANNEL_NAME: '2-sleuth-ai-noel',
  TIMEZONE: 'America/Los_Angeles',
  HOUR_OF_DAY: 9, // hour (24h) in workspace timezone that "due" tasks fire
  APPEND: false,  // true = append to existing reminders, false = replace all

  // user assignment: ROUND_ROBIN = one task per user per bucket (exact equal distribution).
  // set to false to use random assignment instead.
  ROUND_ROBIN: true,

  // Slack display names (or partial real names) to look up in the user ID LUT.
  // The LUT is cached in /temp/userIDs.json and built from the Slack API on first run.
  USERS: [
    'noel.saw',
    'jsumuano',
    'matthew.taylor',
  ],

  // AI agent — replace or extend this pool (must have >= TASK_COUNT entries).
  TASK_TITLES: [
    'Finalize homepage wireframes for client review',
    'Update brand style guide with new color palette',
    'Write copy for Q2 product launch landing page',
    'Fix responsive layout issues on mobile breakpoints',
    'Conduct accessibility audit on new dashboard',
    'Export production-ready assets for dev handoff',
    'Review and merge open PRs before sprint close',
    'Set up staging environment for client UAT',
    'Prepare weekly status report for stakeholders',
    'Integrate third-party payment gateway API',
    'QA test checkout flow on iOS and Android',
    'Update CMS content for seasonal campaign',
    'Refactor legacy CSS to design tokens',
    'Schedule discovery call with new client',
    'Archive completed project files in shared drive',
    'Draft SOW for Phase 2 engagement',
  ],

  // Due date buckets — counts must sum to TASK_COUNT.
  // 3 users × 3 buckets = 9 tasks, one per user per bucket (ROUND_ROBIN).
  DUE_DATES: [
    { label: 'tomorrow (+1d)',   offsetDays: +1,  count: 3 }, // 📅 Due Today/Upcoming
    { label: '4 days ago (-4d)', offsetDays: -4,  count: 3 }, // ⚠️ Due within last 7 days
    { label: '14 days ago',      offsetDays: -14, count: 3 }, // 🔴 Due older than 7 days
  ],
};


// ============================================================
// GENERATOR — no edits needed below this line
// ============================================================
const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const crypto = require('crypto');
const DateUtils = require('../src/date-utils');

const LUT_PATH = path.resolve(__dirname, '..', 'temp', 'userIDs.json');
const WORKSPACE_CONFIG_PATH = path.resolve(__dirname, '..', 'data', 'runtime', 'workspaces', `${CONFIG.WORKSPACE_NAME}_workspace.json`);

/** Fetch all non-bot, non-deleted members from the Slack users.list API. */
async function FetchSlackUsersAsync(argToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'slack.com',
      path: '/api/users.list?limit=200',
      method: 'GET',
      headers: { Authorization: `Bearer ${argToken}` },
    };
    https.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) return reject(new Error(`Slack API error: ${parsed.error}`));
          const members = (parsed.members || []).filter(m => !m.deleted && !m.is_bot && m.id !== 'USLACKBOT');
          resolve(members);
        } catch (error) { reject(error); }
      });
    }).on('error', reject);
  });
}

/** Load the user ID LUT from cache, or build it from the Slack API and save it. */
async function LoadUserLutAsync() {
  if (fs.existsSync(LUT_PATH)) {
    console.log(`📋 Using cached user ID LUT: ${LUT_PATH}`);
    return JSON.parse(fs.readFileSync(LUT_PATH, 'utf8'));
  }
  console.log('🔍 LUT not found — fetching user list from Slack API...');
  let token;
  try {
    const wsConfig = JSON.parse(fs.readFileSync(WORKSPACE_CONFIG_PATH, 'utf8'));
    token = wsConfig.LIVE_TOKEN;
  } catch (error) {
    throw new Error(`Could not read workspace config at ${WORKSPACE_CONFIG_PATH}: ${error.message}`);
  }
  const members = await FetchSlackUsersAsync(token);
  /** @type {Object.<string, {id: string, name: string, realName: string}>} */
  const lut = {};
  for (const m of members) {
    // index by username (display name) and real_name (lowercased, spaces→dots) for flexible lookup.
    lut[m.name] = { id: m.id, name: m.name, realName: m.real_name || '' };
    const normalised = (m.real_name || '').toLowerCase().replace(/\s+/g, '.');
    if (normalised && !lut[normalised]) lut[normalised] = lut[m.name];
  }
  fs.mkdirSync(path.dirname(LUT_PATH), { recursive: true });
  fs.writeFileSync(LUT_PATH, JSON.stringify(lut, null, 2), 'utf8');
  console.log(`✅ LUT saved → ${LUT_PATH} (${members.length} users)`);
  return lut;
}

/** Resolve a display-name string to a { id, name } user object via the LUT. */
function ResolveUser(argName, argLut) {
  const entry = argLut[argName] || argLut[argName.toLowerCase()];
  if (!entry) throw new Error(`User "${argName}" not found in LUT. Run the script once to refresh the cache, or check the spelling.`);
  return { id: entry.id, name: entry.name };
}

/** Build a Date at HOUR_OF_DAY in the workspace timezone, offset by N days from today (localized UTC model; host TZ independent). */
function BuildDueDate(argOffsetDays) {
  const NowInWorkspace = DateUtils.GetCurrentDateInTimeZone(CONFIG.TIMEZONE);
  const StartOfToday = new Date(NowInWorkspace);
  StartOfToday.setUTCHours(0, 0, 0, 0);
  StartOfToday.setUTCDate(StartOfToday.getUTCDate() + argOffsetDays);
  StartOfToday.setUTCHours(CONFIG.HOUR_OF_DAY, 0, 0, 0);
  return StartOfToday;
}

/** Pick a random element from an array. */
function PickRandom(argArr) {
  return argArr[Math.floor(Math.random() * argArr.length)];
}

/** Build a single ReminderInfo object. */
function MakeReminder(argTitle, argUser, argDueDate) {
  const now = new Date();
  const fakeTs = `${Math.floor(now.getTime() / 1000)}.${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`;
  return {
    ReminderID: crypto.randomUUID(),
    CreatedOn: now.toISOString(),
    ShouldPostOn: argDueDate.toISOString(),
    TargetChannelID: CONFIG.CHANNEL_ID,
    OriginalChannelID: CONFIG.CHANNEL_ID,
    OriginalChannelName: CONFIG.CHANNEL_NAME,
    OriginalMessageID: fakeTs,
    OriginalSenderID: argUser.id,
    ReminderMessageText: `<@${argUser.id}> Key task(s):\n• ${argTitle}`,
    IgnoreSnooze: false,
    AssigneeID: argUser.id,
    GitHubUrls: null,
    State: 'scheduled',
  };
}

async function MainAsync() {
  // validate config before touching any files.
  const bucketTotal = CONFIG.DUE_DATES.reduce((sum, b) => sum + b.count, 0);
  if (bucketTotal !== CONFIG.TASK_COUNT) {
    console.error(`ERROR: DUE_DATES counts sum to ${bucketTotal} but TASK_COUNT is ${CONFIG.TASK_COUNT}. Adjust bucket counts.`);
    process.exit(1);
  }
  if (CONFIG.TASK_TITLES.length < CONFIG.TASK_COUNT) {
    console.error(`ERROR: CONFIG.TASK_TITLES has ${CONFIG.TASK_TITLES.length} entries but TASK_COUNT is ${CONFIG.TASK_COUNT}. Add more titles.`);
    process.exit(1);
  }

  const lut = await LoadUserLutAsync();
  const resolvedUsers = CONFIG.USERS.map(name => ResolveUser(name, lut));

  // shuffle titles so distribution is random, not sequential.
  const shuffledTitles = [...CONFIG.TASK_TITLES].sort(() => Math.random() - 0.5);
  let titleIndex = 0;

  const newReminders = [];
  for (const bucket of CONFIG.DUE_DATES) {
    const dueDate = BuildDueDate(bucket.offsetDays);
    for (let i = 0; i < bucket.count; i++) {
      const user = CONFIG.ROUND_ROBIN ? resolvedUsers[i % resolvedUsers.length] : PickRandom(resolvedUsers);
      const title = shuffledTitles[titleIndex++];
      newReminders.push(MakeReminder(title, user, dueDate));
    }
  }

  // load existing reminders if appending.
  const outPath = path.resolve(__dirname, '..', 'data', 'runtime', 'reminders', `${CONFIG.WORKSPACE_NAME}_reminders.json`);
  let existing = [];
  if (CONFIG.APPEND) {
    try { existing = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch { /* no existing file is fine */ }
  }

  const final = [...existing, ...newReminders];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(final, null, 2), 'utf8');

  // print summary.
  console.log(`\n✅ Wrote ${final.length} reminder(s) → ${outPath}`);
  console.log(`   New: ${newReminders.length}  |  Preserved: ${existing.length}\n`);
  newReminders.forEach((r, i) => {
    const dateStr = new Date(r.ShouldPostOn).toLocaleDateString('en-US', { timeZone: CONFIG.TIMEZONE, month: 'short', day: 'numeric' });
    const titleStr = r.ReminderMessageText.split('\n')[1] || '';
    console.log(`   [${String(i + 1).padStart(2, '0')}] ${r.AssigneeID}  ${dateStr.padEnd(8)}  ${titleStr}`);
  });
  console.log('\n⚡ Restart the app to load the new data.\n');
}

MainAsync().catch(error => { console.error('Fatal:', error.message); process.exit(1); });

