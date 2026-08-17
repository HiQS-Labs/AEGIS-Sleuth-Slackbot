#!/usr/bin/env node
// Sleuth Code RAG — corpus ingest.
// Walks docs + changelog + GitHub PRs, chunks, embeds via Gemini, writes sqlite-vec.
// Run: npm run rag:ingest
// Env: GOOGLE_API_KEY (required), SLEUTH_RAG_GITHUB_PAT (optional — skips PR fetch if unset)

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import { Octokit } from '@octokit/rest';
import { createRequire } from 'node:module';

// Bridge CJS helpers into this ESM module so the pure functions have a single
// source of truth and can be unit-tested in isolation.
const require = createRequire(import.meta.url);
const {
  PRIORITY,
  CHUNK_TARGET_CHARS,
  MAX_CODE_CHUNKS_PER_FILE,
  chunkText,
  chunkTextWithinBudget,
  chunkChangelog,
  classifyDoc,
  shouldExcludeRepoPath,
  shouldIncludeDocPath,
  shouldIncludeCodePath,
} = require('./helpers.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(REPO_ROOT, 'data', 'rag');
const DB_PATH = join(DATA_DIR, 'sleuth-rag.sqlite');

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error('FATAL: GOOGLE_API_KEY not set. Export it, or source the env file that holds it.');
  process.exit(1);
}

const GITHUB_PAT = process.env.SLEUTH_RAG_GITHUB_PAT;
// The PR corpus lives in the product repo, which is private and is NOT this one. Both are
// env-overridable so a fork points at its own history instead of inheriting ours, and so the
// deployment — not this file — decides which repo gets read.
const GITHUB_OWNER = process.env.SLEUTH_RAG_GITHUB_OWNER || '';
const GITHUB_REPO = process.env.SLEUTH_RAG_GITHUB_REPO || '';
const PR_FETCH_LIMIT = 200;

const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIM = 768;
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GOOGLE_API_KEY}`;

// ---------- file walker ----------

function walkRepoFiles() {
  const docs = [];
  const code = [];
  function walk(absDir) {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      const rel = relative(REPO_ROOT, abs);
      if (shouldExcludeRepoPath(rel)) continue;
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile()) {
        if (shouldIncludeDocPath(rel)) {
          docs.push({ abs, rel, type: 'doc' });
        } else if (shouldIncludeCodePath(rel)) {
          code.push({ abs, rel, type: 'code', sizeBytes: statSync(abs).size });
        }
      }
    }
  }
  walk(REPO_ROOT);
  return {
    docs: docs.sort((a, b) => a.rel.localeCompare(b.rel)),
    code: code.sort((a, b) => a.rel.localeCompare(b.rel)),
  };
}

// ---------- embeddings ----------

async function embedOne(text, taskType = 'RETRIEVAL_DOCUMENT') {
  const body = {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
    outputDimensionality: EMBED_DIM,
  };
  const res = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini embed ${res.status}: ${t.slice(0, 400)}`);
  }
  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values) || values.length !== EMBED_DIM) {
    throw new Error(`Gemini embed: unexpected shape, got ${values?.length} dims`);
  }
  return values;
}

async function embedBatch(chunks, taskType = 'RETRIEVAL_DOCUMENT') {
  // Gemini REST doesn't accept free-form batching for outputDimensionality on embedContent in v1beta reliably,
  // so we parallelize with a concurrency cap — simple and fast for our corpus size.
  // Tunable because the hardcoded 4 is what failed: a full re-ingest of this corpus tripped Gemini's
  // rate limit with `RESOURCE_EXHAUSTED`, while a single query against the same key succeeded moments
  // later — so the ceiling is throughput, not a dead quota. Drop to 1 for a slow, reliable rebuild.
  const CONCURRENCY = Number(process.env.RAG_INGEST_CONCURRENCY) || 4;
  const results = new Array(chunks.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < chunks.length) {
      const idx = nextIdx++;
      let attempt = 0;
      while (true) {
        try {
          results[idx] = await embedOne(chunks[idx], taskType);
          break;
        } catch (err) {
          attempt++;
          // A 429 is a rate limit, not a permanent failure, so it deserves real backoff rather than
          // the old 500ms/1s pair that exhausted three attempts inside two seconds and killed a
          // 20-minute ingest. Exponential with a cap, and more attempts for throttling specifically.
          const IsRateLimit = /\b429\b|RESOURCE_EXHAUSTED/.test(String(err && err.message));
          const MaxAttempts = Number(process.env.RAG_INGEST_MAX_ATTEMPTS) || (IsRateLimit ? 8 : 3);
          if (attempt >= MaxAttempts) throw err;
          const BackoffMs = IsRateLimit
            ? Math.min(60_000, 2_000 * 2 ** (attempt - 1))
            : 500 * attempt;
          await new Promise((r) => setTimeout(r, BackoffMs));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return results;
}

// ---------- sqlite ----------

function openDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (existsSync(DB_PATH)) {
    // fresh rebuild each run — we're indexing a small corpus and want deterministic state
    unlinkSync(DB_PATH);
  }
  const db = new Database(DB_PATH);
  sqliteVec.load(db);
  db.exec(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      path TEXT,
      pr_number INTEGER,
      version TEXT,
      priority INTEGER NOT NULL DEFAULT 1,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE VIRTUAL TABLE chunks_vec USING vec0(embedding float[${EMBED_DIM}]);
  `);
  return db;
}

function insertChunk(db, row, embedding) {
  const res = db.prepare(`
    INSERT INTO chunks (source, path, pr_number, version, priority, content)
    VALUES (@source, @path, @pr_number, @version, @priority, @content)
  `).run({
    source: row.source,
    path: row.path ?? null,
    pr_number: row.pr_number ?? null,
    version: row.version ?? null,
    priority: row.priority ?? 1,
    content: row.content,
  });
  const id = res.lastInsertRowid; // already a BigInt under better-sqlite3 default when large
  db.prepare('INSERT INTO chunks_vec(rowid, embedding) VALUES (?, ?)').run(
    typeof id === 'bigint' ? id : BigInt(id),
    new Uint8Array(new Float32Array(embedding).buffer)
  );
}

// ---------- PR fetch ----------

async function fetchMergedPRs() {
  if (!GITHUB_PAT) {
    console.log('  [skip] SLEUTH_RAG_GITHUB_PAT not set — skipping PR fetch');
    return [];
  }
  // Owner/repo are no longer baked in, so an unset pair must skip loudly rather than fire a
  // request at `/repos//` and bury a 404 in a stack trace.
  if (!GITHUB_OWNER || !GITHUB_REPO) {
    console.log('  [skip] SLEUTH_RAG_GITHUB_OWNER/REPO not set — skipping PR fetch');
    return [];
  }
  const octokit = new Octokit({ auth: GITHUB_PAT });
  // Track cumulative count across pages — the previous version compared per-page
  // length (<=100) against PR_FETCH_LIMIT (200) and therefore never stopped early,
  // paginating through all closed PRs before slicing.
  let cumulative = 0;
  const pulls = await octokit.paginate(octokit.pulls.list, {
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    state: 'closed',
    sort: 'updated',
    direction: 'desc',
    per_page: 100,
  }, (res, done) => {
    cumulative += res.data.length;
    if (cumulative >= PR_FETCH_LIMIT) done();
    return res.data;
  });
  const merged = pulls.filter((p) => p.merged_at).slice(0, PR_FETCH_LIMIT);
  return merged.map((p) => ({
    number: p.number,
    title: p.title,
    body: p.body ?? '',
    merged_at: p.merged_at,
    author: p.user?.login ?? 'unknown',
  }));
}

// ---------- architecture summary ----------

// Recursively collect every .js/.mjs file under a directory. Replaces the previous top-level-only
// scan (plus a hardcoded src/rag/ special case), which silently missed src/chat-commands/ (the
// single largest source package — 28 files), src/ai-providers/, src/plugins/, and src/types/.
function collectSourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(abs));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
      files.push(abs);
    }
  }
  return files;
}

function buildArchitectureSummary() {
  const SRC_DIR = join(REPO_ROOT, 'src');
  const rows = [];

  // 1. Module inventory: every .js/.mjs file under src/, recursively.
  const moduleLines = [];
  let totalLines = 0;
  const sourceFiles = collectSourceFiles(SRC_DIR).sort((a, b) => a.localeCompare(b));
  for (const abs of sourceFiles) {
    const rel = relative(SRC_DIR, abs);
    const content = readFileSync(abs, 'utf8');
    const lines = content.split('\n').length;
    totalLines += lines;
    // Extract class name and async method signatures.
    const classMatch = content.match(/^class\s+(\w+)/m);
    const asyncMethods = [...content.matchAll(/^\s*async\s+(?:#?)(\w+)\s*\(/gm)]
      .map((m) => m[1])
      .slice(0, 8); // cap to avoid noise
    moduleLines.push(`  ${rel} (${lines} lines)${classMatch ? ` — class ${classMatch[1]}` : ''}${asyncMethods.length ? ` [${asyncMethods.join(', ')}]` : ''}`);
  }

  const inventoryText = [
    `Architecture summary — Sleuth source tree`,
    `Runtime: Node.js, Express, @slack/bolt (socket mode), OpenAI SDK, better-sqlite3 + sqlite-vec, Gemini API (REST).`,
    `Total source: ~${totalLines} lines across ${moduleLines.length} modules in src/ (recursive).`,
    ``,
    `Module inventory:`,
    ...moduleLines,
    ``,
    `Patterns:`,
    `• Each feature is a class with StartAsync/StopAsync lifecycle, registered on the shared SlackApp instance.`,
    `• External APIs use per-workspace tokens stored in JSON config (GITHUB_PAT, OPENAI_API_KEY, NOTION_TOKEN, GOOGLE_API_KEY). New integrations follow this pattern.`,
    `• Adding a new chat command: one CommandRouter entry in src/chat-module.js #RegisterCommandRoutes + one file under src/chat-commands/, plus a data/static/ai/command-catalog.json entry for NL discovery/help/rmm reachability — no dispatcher edits.`,
    `• Adding a new external integration: new src/<name>-module.js class, wire into src/app.js lifecycle, add token to workspace config schema.`,
  ].join('\n');

  rows.push({
    source: 'feature_map',
    path: 'architecture-summary',
    priority: PRIORITY.feature_map,
    content: inventoryText,
  });

  // 2. Feature map: user-facing commands come from data/static/ai/command-catalog.json — the
  // declarative source of truth for NL discovery/help/rmm since the CommandRouter refactor.
  // (Previously this matched inline `if (/pattern/.test(...))` branches in chat-module.js, which
  // predates that refactor and matches ~zero real command branches today.)
  const catalogPath = join(REPO_ROOT, 'data', 'static', 'ai', 'command-catalog.json');
  if (existsSync(catalogPath)) {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    const commandLines = catalog
      .filter((entry) => entry && entry.Id)
      .map((entry) => `  • ${entry.Id} (${entry.Permission || 'public'}) — ${entry.Description || ''}`);

    // Real HTTP routes from src/web-api.js — not previously listed at all.
    const webApiPath = join(SRC_DIR, 'web-api.js');
    const routeLines = [];
    if (existsSync(webApiPath)) {
      const webApiContent = readFileSync(webApiPath, 'utf8');
      const routeMatches = [...webApiContent.matchAll(/\.(get|post|put|delete)\(\s*['"`](\/[^'"`]*)['"`]/g)];
      for (const m of routeMatches) routeLines.push(`  ${m[1].toUpperCase()} ${m[2]}`);
    }

    const featureMapText = [
      `Feature map — user-facing commands from data/static/ai/command-catalog.json (${commandLines.length} commands):`,
      ...commandLines,
      ``,
      `HTTP routes (src/web-api.js):`,
      ...(routeLines.length ? routeLines : ['  (none detected)']),
      ``,
      `Reactions (:alarm_clock:, :white_check_mark:, :wastebasket:, :wrench:, :mag:) are handled in src/reminders-reaction-handler.js.`,
      `GitHub integration modules: src/github-comment-relay.js, src/github-sync-module.js.`,
      `Notion integration: src/notion-module.js (optional, activated when NOTION_TOKEN exists).`,
    ].join('\n');

    rows.push({
      source: 'feature_map',
      path: 'feature-map',
      priority: PRIORITY.feature_map,
      content: featureMapText,
    });
  }

  return rows;
}

// ---------- main ----------

async function main() {
  console.log(`\n=== Sleuth RAG ingest ===\n`);
  const t0 = Date.now();

  // 1) walk docs + code
  const { docs, code } = walkRepoFiles();
  console.log(`[1/6] Walking repo: found ${docs.length} markdown files, ${code.length} source files`);
  const docRows = [];
  for (const f of docs) {
    const text = readFileSync(f.abs, 'utf8');
    const cls = classifyDoc(f.rel);
    if (cls.source === 'changelog') {
      const entries = chunkChangelog(text);
      for (const e of entries) {
        docRows.push({
          source: 'changelog',
          path: f.rel,
          version: e.version,
          priority: cls.priority,
          content: e.content,
        });
      }
    } else {
      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        docRows.push({
          source: cls.source,
          path: f.rel,
          priority: cls.priority,
          content: chunks[i],
        });
      }
    }
  }
  console.log(`  → ${docRows.length} doc chunks`);

  // 1b) chunk source code files. Each file gets a header line with the path so
  // the synthesis model can cite specific files. Priority stays below docs so code
  // never crowds out docs/strategy for marketing questions, but is available
  // for implementation-level queries.
  const codeRows = [];
  // NOTHING under src/ is skipped any more. The byte guard used to fire before the file was even
  // read, which is how `src/reminders-module.js` — the reminder FSM, the most-asked-about file in
  // the repo — stayed out of the index entirely while ask-self answered FSM questions from docs and
  // changelog prose. Large files are now COARSENED to fit their chunk budget instead of dropped:
  // the property the cap protected (no single module floods retrieval) survives, and every line of
  // the file stays reachable.
  const coarsenedCodeFiles = [];
  const overBudgetCodeFiles = [];
  for (const f of code) {
    const text = readFileSync(f.abs, 'utf8');
    const header = `// FILE: ${f.rel}\n`;
    const budget = chunkTextWithinBudget(header + text, MAX_CODE_CHUNKS_PER_FILE);
    if (budget.coarsened) {
      coarsenedCodeFiles.push({ path: f.rel, chunks: budget.chunks.length, targetChars: budget.targetChars });
    }
    if (budget.overBudget) {
      // Indexed in full regardless. A file this large is rare and losing it silently is the failure
      // mode we just fixed, so it is reported rather than trimmed.
      overBudgetCodeFiles.push({ path: f.rel, chunks: budget.chunks.length });
    }
    for (let i = 0; i < budget.chunks.length; i++) {
      codeRows.push({
        source: 'code',
        path: f.rel,
        priority: PRIORITY.code,
        content: budget.chunks[i],
      });
    }
  }
  console.log(`  → ${codeRows.length} code chunks from ${code.length} files (0 skipped)`);
  for (const c of coarsenedCodeFiles) {
    console.log(`    [coarsened] ${c.path}: ${c.chunks} chunks @ ${c.targetChars} chars/chunk`);
  }
  for (const o of overBudgetCodeFiles) {
    console.log(`    [over-budget, indexed anyway] ${o.path}: ${o.chunks} chunks > ${MAX_CODE_CHUNKS_PER_FILE}`);
  }

  // 2) fetch PRs
  console.log(`[2/6] Fetching GitHub PRs (limit ${PR_FETCH_LIMIT})`);
  const prs = await fetchMergedPRs();
  const prRows = prs.map((p) => ({
    source: 'pr',
    path: `PR #${p.number}`,
    pr_number: p.number,
    priority: PRIORITY.pr,
    content: `PR #${p.number}: ${p.title}\nMerged: ${p.merged_at} by ${p.author}\n\n${p.body}`.slice(0, CHUNK_TARGET_CHARS * 2),
  }));
  console.log(`  → ${prRows.length} PR chunks`);

  // 3) build architecture summary — programmatic, no LLM call.
  // Gives the synthesis model structural signals for feasibility/effort questions:
  // module list, line counts, class/method signatures, integration patterns.
  console.log(`[3/6] Building architecture summary`);
  const archRows = buildArchitectureSummary();
  console.log(`  → ${archRows.length} architecture chunks`);

  // 4) embed
  const allRows = [...docRows, ...codeRows, ...prRows, ...archRows];
  console.log(`[4/6] Embedding ${allRows.length} chunks via ${EMBED_MODEL} (dim=${EMBED_DIM})`);
  const tEmbed = Date.now();
  const embeddings = await embedBatch(allRows.map((r) => r.content));
  console.log(`  → done in ${((Date.now() - tEmbed) / 1000).toFixed(1)}s`);

  // 5) write sqlite
  console.log(`[5/6] Writing ${DB_PATH}`);
  const db = openDb();
  const txn = db.transaction(() => {
    for (let i = 0; i < allRows.length; i++) {
      insertChunk(db, allRows[i], embeddings[i]);
    }
  });
  txn();
  const total = db.prepare('SELECT COUNT(*) as c FROM chunks').get().c;
  const byTable = db.prepare("SELECT source, COUNT(*) as c FROM chunks GROUP BY source ORDER BY c DESC").all();
  db.close();

  console.log(`\n=== Ingest complete in ${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
  console.log(`Total chunks: ${total}`);
  console.log('By source:');
  for (const row of byTable) console.log(`  ${row.source.padEnd(12)} ${row.c}`);
  console.log(`\nDB: ${DB_PATH}`);
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
