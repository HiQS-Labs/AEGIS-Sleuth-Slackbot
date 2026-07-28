#!/usr/bin/env node
/**
 * snapshot-sleuth-forward.js
 *
 * PostToolUse hook handler (Phase 1 — Option B file-drop transport).
 *
 * Invoked by Claude Code's PostToolUse hook when the Write or Edit tool
 * touches a file whose basename is exactly "snapshot.md".
 *
 * Stdin: JSON like { "tool_name": "Write", "tool_input": { "file_path": "/abs/path/snapshot.md" }, ... }
 *
 * Env-var gates:
 *   snapshot_sleuth=true        — opt-in master switch; if absent/not "true", exits 0 immediately.
 *   snapshot_sleuth_dryrun=true — dry-run: builds payload + prints to stdout, skips git ops.
 *
 * Drop path:  ~/.sleuth-snapshot-drop/
 * Payload:    ~/.sleuth-snapshot-drop/snapshots/<UTC-compact>__<hostname>.md
 * Log:        ~/.sleuth-snapshot-drop/forward.log  (fallback: ~/.claude/snapshot-sleuth-forward.log)
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HOME = os.homedir();

/** Expand a leading ~ to the home dir. */
function expandHome(p) {
  if (!p) return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  return p;
}

// Drop location: a private git repo clone the Sleuth watcher pulls. Configurable
// via SNAPSHOT_SLEUTH_DROP_DIR so the committed script stays generic (no personal
// path baked in); set it in your hook env, e.g. to ~/git-pulse-sync (the private,
// solo-access sync repo we reuse). Defaults to ~/.sleuth-snapshot-drop.
const DROP_DIR = expandHome(process.env.SNAPSHOT_SLEUTH_DROP_DIR) || path.join(HOME, '.sleuth-snapshot-drop');

// The log ALWAYS lives outside the drop repo, so reusing a shared repo never
// commits a stray log file into it.
const LOG_PATH = path.join(HOME, '.claude', 'snapshot-sleuth-forward.log');

function logFile() {
  return LOG_PATH;
}

function appendLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(logFile(), line);
  } catch (_) {
    // If we can't log, don't crash — just emit to stderr.
  }
  process.stderr.write(line);
}

/** Compact UTC timestamp for filenames, to seconds: 20260617T203045Z */
function utcCompact() {
  const now = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return (
    now.getUTCFullYear() +
    pad(now.getUTCMonth() + 1) +
    pad(now.getUTCDate()) +
    'T' +
    pad(now.getUTCHours()) +
    pad(now.getUTCMinutes()) +
    pad(now.getUTCSeconds()) +
    'Z'
  );
}

/** Attempt scutil --get ComputerName; fall back to os.hostname(). */
function deviceName() {
  try {
    const result = spawnSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 2000 });
    if (result.status === 0 && result.stdout.trim()) {
      return result.stdout.trim();
    }
  } catch (_) {}
  return os.hostname();
}

/**
 * Derive the source repo name from the directory containing snapshot.md.
 * Tries `git rev-parse --show-toplevel`; if that fails, uses the parent dir name.
 */
function repoName(snapshotPath) {
  const dir = path.dirname(snapshotPath);
  try {
    const result = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (result.status === 0 && result.stdout.trim()) {
      return path.basename(result.stdout.trim());
    }
  } catch (_) {}
  // Fallback: parent directory name
  return path.basename(dir);
}

/** True if a line is a snapshot entry header (`# 📸 Snapshot — ...`). */
function isEntryHeader(line) {
  return line.startsWith('# 📸 Snapshot');
}

/**
 * Extract the newest (first) entry from a newest-first snapshot.md.
 *
 * Entries start with a heading line: `# 📸 Snapshot — ...`. The newest entry is
 * delimited by the NEXT entry header (or EOF) — NOT by a bare `---` line, because
 * the verbatim "Last response" body can itself contain `---` (horizontal rules,
 * tables), which would truncate the entry. We then strip the trailing inter-entry
 * `---` separator and surrounding blank lines.
 *
 * Returns the trimmed text of the first entry, or null if parsing fails.
 */
function extractNewestEntry(content) {
  if (!content || !content.trim()) {
    return null;
  }

  const lines = content.split('\n');

  // Newest entry starts at the first entry header; if there is none, take from the top.
  let start = lines.findIndex(isEntryHeader);
  if (start === -1) {
    start = 0;
  }

  // It ends just before the NEXT entry header (or EOF).
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (isEntryHeader(lines[i])) {
      end = i;
      break;
    }
  }

  const entryLines = lines.slice(start, end);

  // Strip trailing blank lines and the trailing inter-entry `---` separator.
  while (
    entryLines.length &&
    (entryLines[entryLines.length - 1].trim() === '' ||
      entryLines[entryLines.length - 1] === '---')
  ) {
    entryLines.pop();
  }

  const entry = entryLines.join('\n').trim();
  if (!entry) {
    return null;
  }

  if (!entry.startsWith('#')) {
    appendLog('WARN: newest entry does not start with a # heading — forwarding anyway.');
  }

  return entry;
}

// ---------------------------------------------------------------------------
// Main (wrapped so any throw exits 0, never disrupts snapshot save)
// ---------------------------------------------------------------------------

async function main() {
  // ── 1. Gate: opt-in master switch ─────────────────────────────────────────
  if (process.env.snapshot_sleuth !== 'true') {
    // Silent exit — do not log when the gate is intentionally off.
    process.exit(0);
  }

  const isDryRun = process.env.snapshot_sleuth_dryrun === 'true';

  // ── 2. Parse stdin ────────────────────────────────────────────────────────
  let hookJson;
  try {
    const raw = fs.readFileSync('/dev/stdin', 'utf8');
    hookJson = JSON.parse(raw);
  } catch (err) {
    appendLog(`ERROR: could not parse stdin JSON: ${err.message}`);
    process.exit(0);
  }

  // ── 3. Verify this is a snapshot.md write ─────────────────────────────────
  const filePath = hookJson?.tool_input?.file_path || '';
  if (path.basename(filePath) !== 'snapshot.md') {
    // Not our target file — silently exit.
    process.exit(0);
  }

  appendLog(`INFO: triggered for ${filePath}${isDryRun ? ' [DRY RUN]' : ''}`);

  // ── 4. Read the snapshot file ──────────────────────────────────────────────
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    appendLog(`ERROR: could not read ${filePath}: ${err.message}`);
    process.exit(0);
  }

  // ── 5. Extract newest entry ────────────────────────────────────────────────
  const newestEntry = extractNewestEntry(content);
  if (!newestEntry) {
    appendLog(`WARN: could not extract a valid entry from ${filePath} — skipping forward.`);
    process.exit(0);
  }

  // ── 6. Build metadata header ───────────────────────────────────────────────
  const forwarded_at = new Date().toISOString();
  const device       = deviceName();
  const repo         = repoName(filePath);

  const metaHeader = [
    `<!-- snapshot-sleuth-relay: forwarded-at=${forwarded_at} device="${device}" repo="${repo}" -->`,
    `**Forwarded:** ${forwarded_at}`,
    `**Device:** ${device}`,
    `**Source repo:** ${repo}`,
    '',
    '---',
    '',
  ].join('\n');

  const payload = metaHeader + newestEntry;

  // ── 7. Dry-run: print and exit ─────────────────────────────────────────────
  if (isDryRun) {
    process.stdout.write('=== snapshot-sleuth-forward DRY RUN ===\n');
    process.stdout.write(payload);
    process.stdout.write('\n=== END DRY RUN ===\n');
    appendLog(`INFO: dry-run complete — payload printed to stdout (${payload.length} bytes).`);
    process.exit(0);
  }

  // ── 8. Write to drop dir ───────────────────────────────────────────────────
  if (!fs.existsSync(DROP_DIR)) {
    appendLog(
      `WARN: drop dir ${DROP_DIR} does not exist — skipping forward. ` +
      'Point SNAPSHOT_SLEUTH_DROP_DIR at a private git repo clone (e.g. ~/git-pulse-sync) to enable forwarding.'
    );
    process.exit(0);
  }

  const snapshotsDir = path.join(DROP_DIR, 'snapshots');
  try {
    fs.mkdirSync(snapshotsDir, { recursive: true });
  } catch (err) {
    appendLog(`ERROR: could not create ${snapshotsDir}: ${err.message}`);
    process.exit(0);
  }

  const ts       = utcCompact();
  const hostname = os.hostname().replace(/[^a-zA-Z0-9._-]/g, '-');
  // Short content hash guarantees a distinct filename even for two snapshots in
  // the same second from one host (the QA "distinct forwards" requirement).
  const shortHash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 8);
  const filename = `${ts}__${hostname}__${shortHash}.md`;
  const destPath = path.join(snapshotsDir, filename);

  // ── Atomic write: temp file + rename into place ────────────────────────────
  // No git here. The hook is a pure file producer; the existing git-pulse sync
  // stages/commits/pushes the snapshots/ dir on its next run (it must include
  // snapshots/ in its stage_paths). Writing to a temp file then atomically
  // renaming guarantees the pulse tool never stages a half-written file (a torn
  // read mid `git add`), which — given the server dedupes by filename — would
  // otherwise never be re-posted.
  const tmpPath = path.join(snapshotsDir, `.${filename}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(tmpPath, payload, 'utf8');
    fs.renameSync(tmpPath, destPath);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* best-effort cleanup */ }
    appendLog(`ERROR: could not write payload to ${destPath}: ${err.message}`);
    process.exit(0);
  }

  appendLog(`INFO: forward complete — wrote ${filename} (${payload.length} bytes); git-pulse will sync it.`);
}

// Run; catch anything; always exit 0 so snapshot.md is never blocked.
main().catch((err) => {
  try {
    appendLog(`FATAL: unexpected error — ${err.message}`);
  } catch (_) {}
  process.exit(0);
});
