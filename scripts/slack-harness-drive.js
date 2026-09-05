'use strict';

/**
 * Drive a live Sleuth command end-to-end from this machine (GH-168 follow-up).
 *
 * `slack:harness:post` posts AS THE BOT, and the app ignores its own messages, so it can never
 * trigger a command. This harness posts `<@bot> <command>` AS A USER (an xoxp user token with
 * `chat:write` + `channels:history` user scopes), then polls the thread for the bot's reply and
 * prints it. `--expect` turns one run into a smoke assertion. Read-only apart from the one post.
 *
 * Run (dry-run by default — validates the token, channel and bot ID, posts nothing):
 *   node scripts/slack-harness-drive.js --channel 2-sleuth-dev-branch --bot-name sleuth-dev --text models
 *   node scripts/slack-harness-drive.js ... --execute --expect '*Aliases*'
 *
 * Token: `SLACK_DEV_USER_TOKEN` env, else `--token-file` (default ~/secrets/sleuth/aegis-dev-user-token.txt).
 * The token is never printed. Exit: 0 reply received (and matched) · 3 no reply before timeout ·
 * 4 reply did not contain --expect · 2 usage / auth error.
 *
 * ponytail: no lock file, no retries — one operator drives dev at a time; add a lock if that changes.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebClient } = require('@slack/web-api');

const DEFAULT_TIMEOUT_MS = 45000;
const MAX_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 2000;
const MAX_HISTORY_PAGES = 20;
const DEFAULT_TOKEN_FILE = path.join(os.homedir(), 'secrets', 'sleuth', 'aegis-dev-user-token.txt');

/**
 * @param {string[]} ArgArgv
 * @returns {{ Channel: string|null, ChannelID: string|null, BotName: string|null, BotUserID: string|null,
 *   Text: string|null, Execute: boolean, Expect: string|null, TimeoutMs: number, TokenFile: string, Help: boolean }}
 */
function ParseArgs(ArgArgv) {
  const Options = {
    Channel: null, ChannelID: null, BotName: null, BotUserID: null, Text: null,
    Execute: false, Expect: null, TimeoutMs: DEFAULT_TIMEOUT_MS, TokenFile: DEFAULT_TOKEN_FILE, Help: false,
  };
  for(let Index = 0; Index < ArgArgv.length; Index++) {
    const Arg = ArgArgv[Index];
    const Next = () => {
      const Value = ArgArgv[++Index];
      if(!Value) throw new Error(`Missing value after ${Arg}.`);
      return Value;
    };
    if(Arg === '--channel') Options.Channel = Next();
    else if(Arg === '--channel-id') Options.ChannelID = Next();
    else if(Arg === '--bot-name') Options.BotName = Next().toLowerCase();
    else if(Arg === '--bot-user-id') Options.BotUserID = Next();
    else if(Arg === '--text') Options.Text = Next();
    else if(Arg === '--expect') Options.Expect = Next();
    else if(Arg === '--token-file') Options.TokenFile = Next();
    else if(Arg === '--timeout-ms') Options.TimeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1000, Number(Next()) || DEFAULT_TIMEOUT_MS));
    else if(Arg === '--execute') Options.Execute = true;
    else if(Arg === '--help' || Arg === '-h') Options.Help = true;
    else throw new Error(`Unknown argument: ${Arg}`);
  }
  return Options;
}

function PrintUsage() {
  console.log('Usage: node scripts/slack-harness-drive.js (--channel NAME | --channel-id ID) (--bot-name NAME | --bot-user-id ID) --text CMD [options]');
  console.log('');
  console.log('Options:');
  console.log('  --execute             actually post. default is dry-run (auth + lookups only).');
  console.log('  --expect SUBSTRING    exit 4 unless the bot reply contains SUBSTRING.');
  console.log(`  --timeout-ms N        wait for the reply (${DEFAULT_TIMEOUT_MS} default, ${MAX_TIMEOUT_MS} max).`);
  console.log(`  --token-file PATH     xoxp user token file (default ${DEFAULT_TOKEN_FILE}); env SLACK_DEV_USER_TOKEN wins.`);
}

/**
 * @param {string} ArgTokenFile
 * @returns {string}
 */
function LoadToken(ArgTokenFile) {
  // Validate AFTER choosing the source, never per-source: the env var used to short-circuit the
  // check, so an exported `xoxb-` bot token would run this harness — and a bot token can never
  // trigger a command (the app ignores its own messages), so the run would look like a dead bot.
  const FromEnv = (process.env.SLACK_DEV_USER_TOKEN || '').trim();
  const Source = FromEnv ? 'SLACK_DEV_USER_TOKEN' : ArgTokenFile;
  const Raw = FromEnv || fs.readFileSync(ArgTokenFile, 'utf8').trim().replace(/^[A-Za-z_]+=/, '');
  if(!Raw.startsWith('xoxp-'))
    throw new Error(`Token from ${Source} is not a user (xoxp) token — a bot token cannot trigger commands.`);
  return Raw;
}

/**
 * Exact-name channel lookup over the channels the user can see.
 * @param {WebClient} ArgClient
 * @param {string} ArgName
 * @returns {Promise<string>}
 */
async function ResolveChannelIdAsync(ArgClient, ArgName) {
  const Wanted = ArgName.replace(/^#/, '');
  let Cursor;
  do {
    // public only: listing private channels needs groups:read, which the dev user token lacks — pass
    // --channel-id for a private channel instead.
    const Page = await ArgClient.conversations.list({ types: 'public_channel', limit: 200, cursor: Cursor, exclude_archived: true });
    const Hit = (Page.channels || []).find((ArgChannel) => ArgChannel.name === Wanted);
    if(Hit && Hit.id) return Hit.id;
    Cursor = Page.response_metadata?.next_cursor || undefined;
  } while(Cursor);
  throw new Error(`Could not find a channel named exactly "${Wanted}".`);
}

/**
 * Find the bot's user ID from its recent posts in the channel (needs no users:read scope).
 *
 * REFUSES on ambiguity rather than guessing (2026-09-05): the first version returned the first
 * name match and, once this harness's own posts shifted the history window, silently resolved a
 * DIFFERENT bot — so run 1 addressed `$SLEUTH_DEV_BOT_USER_ID` and run 2 addressed `U032TCHJ8`, which never
 * replied. A mention aimed at the wrong app is worse than an error: it looks like a hung bot.
 * Every distinct candidate must agree, and only messages carrying a `bot_profile` are considered.
 *
 * @param {WebClient} ArgClient
 * @param {string} ArgChannelID
 * @param {string} ArgBotName lower-cased bot display/username, e.g. "sleuth-dev"
 * @returns {Promise<string>}
 */
async function DiscoverBotUserIdAsync(ArgClient, ArgChannelID, ArgBotName) {
  /** @type {Set<string>} */
  const Candidates = new Set();
  // Page the WHOLE history, not just the first 200 messages: a second same-named app posting
  // earlier than one page would otherwise be invisible, and "sole candidate on page 1" is not
  // "unambiguous in this channel". Bounded so a busy channel cannot spin forever.
  let Cursor;
  let PagesRead = 0;
  do {
    const History = await ArgClient.conversations.history({ channel: ArgChannelID, limit: 200, cursor: Cursor });
    for(const Message of History.messages || []) {
      if(!Message.user || !Message.bot_profile) continue;
      const Name = String(Message.bot_profile.name || Message.username || '').toLowerCase();
      if(Name === ArgBotName) Candidates.add(Message.user);
    }
    Cursor = History.response_metadata?.next_cursor || undefined;
    PagesRead++;
  } while(Cursor && PagesRead < MAX_HISTORY_PAGES);
  if(Candidates.size === 1) return /** @type {string} */ (Array.from(Candidates)[0]);
  if(Candidates.size === 0)
    throw new Error(`No recent message from a bot named "${ArgBotName}" in this channel — pass --bot-user-id instead.`);
  throw new Error(`Ambiguous: "${ArgBotName}" matched ${Candidates.size} user IDs (${Array.from(Candidates).join(', ')}) — pass --bot-user-id to disambiguate.`);
}

/**
 * @param {number} ArgMs
 * @returns {Promise<void>}
 */
function SleepAsync(ArgMs) {
  return new Promise((ArgResolve) => setTimeout(ArgResolve, ArgMs));
}

async function MainAsync() {
  const Options = ParseArgs(process.argv.slice(2));
  if(Options.Help) { PrintUsage(); return 0; }
  ValidateOptions(Options);

  const Client = new WebClient(LoadToken(Options.TokenFile));
  return RunAsync(Options, Client);
}

/**
 * Validate a parsed option set. Conflicting selectors are REFUSED, not silently ranked: a stale
 * copied ID alongside a human-readable name would otherwise target a different channel or app than
 * the operator is reading on the command line, and this command exists to be safe before a real post.
 * @param {ReturnType<typeof ParseArgs>} ArgOptions
 * @returns {void}
 */
function ValidateOptions(ArgOptions) {
  if(ArgOptions.Channel && ArgOptions.ChannelID)
    throw new Error('Pass --channel OR --channel-id, not both — they can disagree.');
  if(ArgOptions.BotName && ArgOptions.BotUserID)
    throw new Error('Pass --bot-name OR --bot-user-id, not both — they can disagree.');
  if(!ArgOptions.Channel && !ArgOptions.ChannelID) throw new Error('--channel or --channel-id is required.');
  if(!ArgOptions.BotName && !ArgOptions.BotUserID) throw new Error('--bot-name or --bot-user-id is required.');
  if(!ArgOptions.Text || !ArgOptions.Text.trim()) throw new Error('--text is required.');
}

/**
 * Post the command (unless dry-run) and wait for the addressed bot's reply.
 * @param {ReturnType<typeof ParseArgs>} ArgOptions Validated options.
 * @param {WebClient} ArgClientInstance Slack client — injected so this is testable without a token.
 * @returns {Promise<number>} process exit code
 */
async function RunAsync(ArgOptions, ArgClientInstance) {
  const Options = ArgOptions;
  const Client = ArgClientInstance;
  const Auth = await Client.auth.test();
  const ChannelID = Options.ChannelID || await ResolveChannelIdAsync(Client, /** @type {string} */ (Options.Channel));
  const BotUserID = Options.BotUserID || await DiscoverBotUserIdAsync(Client, ChannelID, /** @type {string} */ (Options.BotName));
  const Text = `<@${BotUserID}> ${Options.Text.trim()}`;

  console.log(`auth: user ${Auth.user} on ${Auth.team} · channel ${ChannelID} · bot ${BotUserID}`);
  console.log(`text: ${Text}`);
  if(!Options.Execute) { console.log('dry-run: nothing posted (add --execute).'); return 0; }

  const Posted = await Client.chat.postMessage({ channel: ChannelID, text: Text });
  const ThreadTs = /** @type {string} */ (Posted.ts);
  const Deadline = Date.now() + Options.TimeoutMs;
  /** @type {string[]} */
  const SeenTs = [];
  /** @type {string[]} */
  const ReplyTexts = [];

  // A command can answer in SEVERAL messages — `rmm ifl` posts "On it — running …" and THEN the
  // command's own reply. Taking the first one made a passing command look like a failed --expect
  // (dev, 2026-09-05). So: with --expect, keep collecting until one reply matches or the deadline
  // passes; without it, the first reply is the answer.
  while(Date.now() < Deadline) {
    await SleepAsync(POLL_INTERVAL_MS);
    const Thread = await Client.conversations.replies({ channel: ChannelID, ts: ThreadTs, limit: 50 });
    // only the bot we addressed counts — a different app answering in-thread is not our reply.
    const Replies = (Thread.messages || []).filter((Message) => Message.ts !== ThreadTs && Message.user === BotUserID);
    for(const Reply of Replies) {
      if(SeenTs.includes(String(Reply.ts))) continue;
      SeenTs.push(String(Reply.ts));
      const ReplyText = String(Reply.text || '');
      ReplyTexts.push(ReplyText);
      console.log('--- bot reply ---');
      console.log(ReplyText);
      if(!Options.Expect) return 0;
      if(ReplyText.includes(Options.Expect)) return 0;
    }
  }

  if(ReplyTexts.length === 0) {
    console.error(`TIMEOUT: no bot reply within ${Options.TimeoutMs} ms (thread ${ThreadTs}).`);
    return 3;
  }
  console.error(`EXPECT FAILED: none of the ${ReplyTexts.length} bot replies contain ${JSON.stringify(Options.Expect)}`);
  return 4;
}

if(require.main === module) {
  MainAsync().then((ArgCode) => process.exit(ArgCode)).catch((error) => {
    console.error(`slack-harness-drive: ${error.message}`);
    // Slack names the gap on missing_scope — print it so the operator knows what to grant/reinstall.
    if(error?.data?.error === 'missing_scope')
      console.error(`  needed: ${error.data.needed || '?'}\n  token has: ${error.data.provided || '?'}`);
    process.exit(2);
  });
}

module.exports = {
  LoadToken,
  ParseArgs,
  ValidateOptions,
  RunAsync,
  ResolveChannelIdAsync,
  DiscoverBotUserIdAsync,
  POLL_INTERVAL_MS,
};
