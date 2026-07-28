#!/usr/bin/env node

/**
 * Spike A: GitHub URL extraction test.
 * Tests regex extraction against all Slack message formats and verifies
 * that adding a GitHubUrls field to existing reminder JSON is safe.
 *
 * Usage: node scripts/spike-github-url-extraction.js
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// regex under test.
// ---------------------------------------------------------------------------

/**
 * Extract GitHub issue and PR URLs from raw Slack message text.
 * Handles bare URLs, <angle-bracket> URLs, and <url|anchor text> URLs.
 * @param {string} ArgMessageText Raw message text from Slack.
 * @returns {string[]}
 */
function ExtractGitHubUrls(ArgMessageText) {
  const GitHubUrlRegex = /(?:<)?(https:\/\/github\.com\/[^\/\s>|]+\/[^\/\s>|]+\/(?:issues|pull)\/\d+)/gi;
  const Matches = [];
  let CurrentMatch;
  while((CurrentMatch = GitHubUrlRegex.exec(ArgMessageText)) !== null) {
    Matches.push(CurrentMatch[1]);
  }
  return [...new Set(Matches)];
}

// ---------------------------------------------------------------------------
// test cases.
// ---------------------------------------------------------------------------

const TestCases = [
  {
    name: "Bare URL",
    input: "Hey team, please review https://github.com/NeochromeTeam/sleuth-app/issues/42 by Friday",
    expected: ["https://github.com/NeochromeTeam/sleuth-app/issues/42"]
  },
  {
    name: "Angle-bracket (Slack auto-wrap)",
    input: "Look into <https://github.com/NeochromeTeam/sleuth-app/pull/15> when you get a chance",
    expected: ["https://github.com/NeochromeTeam/sleuth-app/pull/15"]
  },
  {
    name: "Anchor text (embedded link — URL hidden behind display text)",
    input: 'Can you <https://github.com/NeochromeTeam/sleuth-app/pull/15|review the Client A Theme PR> and merge it?',
    expected: ["https://github.com/NeochromeTeam/sleuth-app/pull/15"]
  },
  {
    name: "Multiple GitHub URLs in one message",
    input: "Close <https://github.com/NeochromeTeam/sleuth-app/issues/10> and check https://github.com/NeochromeTeam/sleuth-app/pull/11",
    expected: ["https://github.com/NeochromeTeam/sleuth-app/issues/10", "https://github.com/NeochromeTeam/sleuth-app/pull/11"]
  },
  {
    name: "URL with fragment (issuecomment)",
    input: "See https://github.com/NeochromeTeam/sleuth-app/issues/42#issuecomment-1234567890",
    expected: ["https://github.com/NeochromeTeam/sleuth-app/issues/42"]
  },
  {
    name: "Non-GitHub URL (should NOT match)",
    input: "Check <https://woocommerce.com/products/subscription-churn-saver/|this plugin>",
    expected: []
  },
  {
    name: "No URL at all",
    input: "Write up Client A plans for next 7 days",
    expected: []
  },
  {
    name: "REAL: Anchor text 'GH issue 693' (from screenshot)",
    input: '<@U032TCHJ8> let\'s "Restart the Share A Sale -> Awin plugin migration - <https://github.com/ClientA/flavor-starter-flavor/issues/693|GH issue 693>" by tonight at 11 PM PT',
    expected: ["https://github.com/ClientA/flavor-starter-flavor/issues/693"]
  },
  {
    name: "REAL: Mixed GitHub + non-GitHub URLs",
    input: 'Follow up on <https://woocommerce.com/products/churn-saver/|churn saver> and also <https://github.com/NeochromeTeam/sleuth-app/pull/36|this PR> by Monday',
    expected: ["https://github.com/NeochromeTeam/sleuth-app/pull/36"]
  },
  {
    name: "Duplicate same URL appears twice",
    input: "Check https://github.com/org/repo/issues/5 and also https://github.com/org/repo/issues/5 again",
    expected: ["https://github.com/org/repo/issues/5"]
  },
  {
    name: "Angle-bracket URL with trailing path after issue number",
    input: "<https://github.com/org/repo/pull/99/files>",
    expected: ["https://github.com/org/repo/pull/99"]
  },
];

// ---------------------------------------------------------------------------
// run extraction tests.
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Spike A: GitHub URL Extraction Tests ===');
console.log('');

let PassCount = 0;
let FailCount = 0;

for(let i = 0; i < TestCases.length; i++) {
  const TestCase = TestCases[i];
  const Result = ExtractGitHubUrls(TestCase.input);
  const IsPass = JSON.stringify(Result) === JSON.stringify(TestCase.expected);

  const StatusIcon = IsPass ? '  PASS' : '  FAIL';
  console.log(`${StatusIcon}  Test ${i + 1}: ${TestCase.name}`);

  if(!IsPass) {
    console.log(`         Expected: ${JSON.stringify(TestCase.expected)}`);
    console.log(`         Got:      ${JSON.stringify(Result)}`);
    FailCount++;
  } else {
    if(Result.length > 0)
      console.log(`         Extracted: ${JSON.stringify(Result)}`);
    else
      console.log(`         Extracted: [] (correct, no GitHub URLs)`);
    PassCount++;
  }
}

console.log('');
console.log(`Results: ${PassCount} passed, ${FailCount} failed out of ${TestCases.length} tests`);

// ---------------------------------------------------------------------------
// JSON roundtrip test with existing reminder data.
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Spike A.3: Reminder JSON Roundtrip Test ===');
console.log('');

const RemindersFilePath = path.join(__dirname, '..', 'data', 'runtime', 'reminders', 'Neochrome_reminders.json');

try {
  // load existing reminders (same approach as reminders-module.js).
  const FileContents = fs.readFileSync(RemindersFilePath, 'utf8');
  const OriginalReminders = JSON.parse(FileContents, (ArgKey, ArgValue) => {
    if((ArgKey === 'CreatedOn' || ArgKey === 'ShouldPostOn') && typeof ArgValue === 'string')
      return new Date(ArgValue);
    return ArgValue;
  });

  console.log(`Loaded ${OriginalReminders.length} existing reminder(s) from disk.`);

  // add GitHubUrls field to each reminder.
  const AugmentedReminders = OriginalReminders.map(r => ({
    ...r,
    GitHubUrls: ExtractGitHubUrls(r.ReminderMessageText || ''),
  }));

  // write to temp file.
  const TempFilePath = path.join(__dirname, '..', 'data', 'runtime', 'reminders', '_spike_test_reminders.json');
  fs.writeFileSync(TempFilePath, JSON.stringify(AugmentedReminders, null, 2), 'utf8');
  console.log(`Wrote augmented reminders to: ${TempFilePath}`);

  // reload and verify.
  const ReloadedContents = fs.readFileSync(TempFilePath, 'utf8');
  const ReloadedReminders = JSON.parse(ReloadedContents, (ArgKey, ArgValue) => {
    if((ArgKey === 'CreatedOn' || ArgKey === 'ShouldPostOn') && typeof ArgValue === 'string')
      return new Date(ArgValue);
    return ArgValue;
  });

  let RoundtripPass = true;
  for(let i = 0; i < OriginalReminders.length; i++) {
    const Original = OriginalReminders[i];
    const Reloaded = ReloadedReminders[i];

    // verify all original fields survived.
    if(Original.ReminderID !== Reloaded.ReminderID) { console.log('  FAIL  ReminderID mismatch'); RoundtripPass = false; }
    if(Original.CreatedOn.getTime() !== Reloaded.CreatedOn.getTime()) { console.log('  FAIL  CreatedOn date mismatch'); RoundtripPass = false; }
    if(Original.ShouldPostOn.getTime() !== Reloaded.ShouldPostOn.getTime()) { console.log('  FAIL  ShouldPostOn date mismatch'); RoundtripPass = false; }
    if(Original.TargetChannelID !== Reloaded.TargetChannelID) { console.log('  FAIL  TargetChannelID mismatch'); RoundtripPass = false; }
    if(Original.OriginalChannelID !== Reloaded.OriginalChannelID) { console.log('  FAIL  OriginalChannelID mismatch'); RoundtripPass = false; }
    if(Original.OriginalMessageID !== Reloaded.OriginalMessageID) { console.log('  FAIL  OriginalMessageID mismatch'); RoundtripPass = false; }
    if(Original.OriginalSenderID !== Reloaded.OriginalSenderID) { console.log('  FAIL  OriginalSenderID mismatch'); RoundtripPass = false; }
    if(Original.ReminderMessageText !== Reloaded.ReminderMessageText) { console.log('  FAIL  ReminderMessageText mismatch'); RoundtripPass = false; }
    if(Original.IgnoreSnooze !== Reloaded.IgnoreSnooze) { console.log('  FAIL  IgnoreSnooze mismatch'); RoundtripPass = false; }

    // verify new field exists.
    if(!Array.isArray(Reloaded.GitHubUrls)) { console.log('  FAIL  GitHubUrls field missing or not an array'); RoundtripPass = false; }
  }

  if(RoundtripPass) {
    console.log('  PASS  All original fields intact after roundtrip');
    console.log('  PASS  GitHubUrls field present on all reminders');
    console.log(`  INFO  GitHubUrls for existing reminder: ${JSON.stringify(ReloadedReminders[0]?.GitHubUrls)}`);
  }

  // clean up temp file.
  fs.unlinkSync(TempFilePath);
  console.log(`Cleaned up temp file.`);

} catch(error) {
  console.log(`  FAIL  Roundtrip test error: ${error.message}`);
}

// ---------------------------------------------------------------------------
// summary.
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Spike A Summary ===');
console.log('');
if(FailCount === 0)
  console.log('All tests passed. Regex extraction and JSON roundtrip are safe.');
else
  console.log(`${FailCount} test(s) failed. Review regex before proceeding.`);
console.log('');
