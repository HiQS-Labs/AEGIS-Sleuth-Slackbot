#!/usr/bin/env node
/**
 * code-task-cloud-trigger.js
 *
 * Desktop watcher (poller) for the code-task relay — the reverse of snapshot-sleuth-forward.js.
 *
 * Sleuth writes synthesized task files to <drop>/code-tasks/*.md (synced into the shared private
 * repo by git-pulse). This script, run on a schedule (launchd/cron) on a Mac with a logged-in
 * `claude` CLI, picks up each new task, launches a Claude Code Cloud session via
 * `claude --remote "<prompt>"`, and writes an ack file back to <drop>/code-tasks/acks/ carrying
 * the originating Slack channel/thread + the session URL. git-pulse syncs the ack back, and
 * Sleuth's code-task relay poll posts it into the original Slack thread.
 *
 * Env gates:
 *   code_task_cloud=true          — opt-in master switch; if not "true", exits 0 immediately.
 *   code_task_cloud_dryrun=true   — build the prompt + ack, print, but do NOT run claude.
 *
 * Env config:
 *   SNAPSHOT_SLEUTH_DROP_DIR / CODE_TASK_DROP_DIR — the synced repo clone (e.g. ~/git-pulse-sync).
 *   CODE_TASK_REPO_DIR        — local clone of the target code repo to run `claude --remote` in
 *                               (defaults to the current working directory).
 *   CODE_TASK_CLAUDE_BIN      — path to the claude CLI (defaults to "claude").
 *
 * Dependency-free (node builtins only) so it can run from anywhere on the laptop.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const HEADER_TAG = 'code-task-relay';

function expandHome(p) {
  if(!p) return p;
  if(p === '~') return HOME;
  if(p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

const DROP_DIR = expandHome(process.env.CODE_TASK_DROP_DIR || process.env.SNAPSHOT_SLEUTH_DROP_DIR) || path.join(HOME, '.sleuth-snapshot-drop');
const REPO_DIR = expandHome(process.env.CODE_TASK_REPO_DIR) || process.cwd();
const CLAUDE_BIN = process.env.CODE_TASK_CLAUDE_BIN || 'claude';
const LOG_PATH = path.join(HOME, '.claude', 'code-task-cloud-trigger.log');

function appendLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_PATH, line); } catch(_) { /* ignore */ }
  process.stderr.write(line);
}

/** Parse the shared code-task-relay metadata header comment into a key/value map. */
function parseMetadata(content) {
  const match = (content || '').match(new RegExp(`<!--\\s*${HEADER_TAG}:\\s*([^>]*?)\\s*-->`));
  if(!match) return {};
  const fields = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m;
  while((m = re.exec(match[1])) !== null) fields[m[1]] = m[2];
  return fields;
}

/** Build the `claude --remote` prompt from a task file: drop the metadata comment, keep the spec. */
function buildPrompt(content) {
  return (content || '')
    .replace(new RegExp(`<!--\\s*${HEADER_TAG}:[^>]*-->\\s*`), '')
    .trim();
}

/** Best-effort extraction of a Claude Code session URL from CLI output. */
function extractSessionUrl(text) {
  const m = (text || '').match(/https?:\/\/\S*claude\.ai\/code\/\S+/i) || (text || '').match(/https?:\/\/\S+/);
  return m ? m[0].replace(/[)\].,]+$/, '') : '';
}

/** Atomic write: temp file + rename. */
function atomicWrite(destPath, content) {
  const tmp = path.join(path.dirname(destPath), `.${path.basename(destPath)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, destPath);
}

function buildAck(meta, { status, sessionUrl, prUrl, error }) {
  const fields = {
    'task-id': meta['task-id'],
    channel: meta.channel,
    'thread-ts': meta['thread-ts'],
    status,
    'session-url': sessionUrl,
    'pr-url': prUrl,
    error,
    'acked-at': new Date().toISOString(),
  };
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && `${v}` !== '')
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`);
  return [
    `<!-- ${HEADER_TAG}: ${parts.join(' ')} -->`,
    '',
    `# Cloud dispatch: ${status}`,
    sessionUrl ? `Session: ${sessionUrl}` : '',
    prUrl ? `PR: ${prUrl}` : '',
    error ? `Error: ${error}` : '',
    '',
  ].filter((l) => l !== '').join('\n');
}

function main() {
  if(process.env.code_task_cloud !== 'true') process.exit(0);
  const isDryRun = process.env.code_task_cloud_dryrun === 'true';

  const tasksDir = path.join(DROP_DIR, 'code-tasks');
  const acksDir = path.join(tasksDir, 'acks');
  if(!fs.existsSync(tasksDir)) { appendLog(`INFO: no tasks dir at ${tasksDir} — nothing to do.`); process.exit(0); }
  fs.mkdirSync(acksDir, { recursive: true });

  const taskFiles = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.md'));
  for(const file of taskFiles) {
    const taskId = file.replace(/\.md$/, '');
    const ackPath = path.join(acksDir, file);
    if(fs.existsSync(ackPath)) continue; // already processed (ack exists).

    let content;
    try { content = fs.readFileSync(path.join(tasksDir, file), 'utf8'); }
    catch(err) { appendLog(`ERROR: cannot read ${file}: ${err.message}`); continue; }

    const meta = parseMetadata(content);
    const prompt = buildPrompt(content);
    const repoDir = fs.existsSync(REPO_DIR) ? REPO_DIR : process.cwd();

    appendLog(`INFO: dispatching ${taskId} (repo=${meta.repo || '?'} branch=${meta.branch || '?'})${isDryRun ? ' [DRY RUN]' : ''}`);

    if(isDryRun) {
      process.stdout.write(`=== claude --remote (DRY RUN) for ${taskId} ===\n${prompt}\n=== END ===\n`);
      atomicWrite(ackPath, buildAck(meta, { status: 'dry-run', sessionUrl: '' }));
      continue;
    }

    let status = 'started';
    let sessionUrl = '';
    let error = '';
    try {
      const result = spawnSync(CLAUDE_BIN, ['--remote', prompt], { cwd: repoDir, encoding: 'utf8', timeout: 120000 });
      const out = `${result.stdout || ''}\n${result.stderr || ''}`;
      if(result.status === 0) {
        sessionUrl = extractSessionUrl(out);
        appendLog(`INFO: ${taskId} launched — session: ${sessionUrl || '(no url parsed)'}`);
      } else {
        status = 'failed';
        error = (out.trim().slice(-300)) || `claude exited ${result.status}`;
        appendLog(`ERROR: ${taskId} claude exited ${result.status}: ${error}`);
      }
    } catch(err) {
      status = 'failed';
      error = err.message;
      appendLog(`ERROR: ${taskId} spawn failed: ${err.message}`);
    }

    try { atomicWrite(ackPath, buildAck(meta, { status, sessionUrl, error })); }
    catch(err) { appendLog(`ERROR: ${taskId} could not write ack: ${err.message}`); }
  }
}

try { main(); }
catch(err) { try { appendLog(`FATAL: ${err.message}`); } catch(_) {} process.exit(0); }
