#!/usr/bin/env node
// Publish the rebalance-format reminders export to a private git repo via the
// GitHub contents API, so consumers (rebalance-OS) can read it with a plain
// authenticated GET — no inbound access to this box, no SSH tunnel.
//
// Runs ON the Sleuth server (loopback to the local API), driven by a systemd
// timer. Reuses the credentials already present in /root/sleuth-app/.env.runtime:
//   - WEB_API_BEARER_TOKEN  → read the local Sleuth API
//   - SLEUTH_RAG_GITHUB_PAT → push the file (classic PAT, repo scope)
//
// Idempotent: the published file stamps an hourly-rounded `exportGeneratedAt`
// (the freshness heartbeat) and drops `fetchedAt`, so within an hour unchanged
// data produces no commit. Node 18+ (global fetch).

import { createRequire } from 'module';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';
import ExportPayload from './export-payload.js';
import CompletionsPayload from './completions-payload.js';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const API_PORT   = process.env.WEB_API_PORT || '2020';
const API_TOKEN  = process.env.WEB_API_BEARER_TOKEN || 'test';
const WORKSPACE  = process.env.SLEUTH_EXPORT_WORKSPACE || 'neochrome';
// default false so the export carries the ENTIRE pending queue — the exact same population the
// Slack `show reminders` digest displays (completed/cancelled reminders are deleted from the
// queue, so no state filter is what "pending" already means).
const ACTIVE_ONLY = (process.env.SLEUTH_EXPORT_ACTIVE_ONLY || 'false');
const GH_PAT     = process.env.SLEUTH_RAG_GITHUB_PAT;
const GH_REPO    = process.env.SLEUTH_EXPORT_REPO || '';
const GH_PATH    = process.env.SLEUTH_EXPORT_PATH || `sync/sleuth/reminders-${WORKSPACE}.json`;
const GH_BRANCH  = process.env.SLEUTH_EXPORT_BRANCH || 'main';
// GH-367 Phase 2: bounded completion history, published beside the active mirror for the local skill.
const COMPLETIONS_PATH = process.env.SLEUTH_COMPLETIONS_PATH || `sync/sleuth/completions-${WORKSPACE}.json`;
const COMPLETIONS_WINDOW_DAYS = Number(process.env.SLEUTH_COMPLETIONS_WINDOW_DAYS || '90');

function fail(msg) { console.error(`[publish-reminders-export] ${msg}`); process.exit(1); }
if (!GH_PAT) fail('missing SLEUTH_RAG_GITHUB_PAT in environment');

const ghHeaders = {
  Authorization: `Bearer ${GH_PAT}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'sleuth-reminders-export',
  'X-GitHub-Api-Version': '2022-11-28',
};

/**
 * Publish one file to the export repo via the GitHub contents API: GET the current sha, skip the
 * commit when byte-identical, else PUT. Returns a one-line status string. Throws only on a real
 * GitHub error (a 404 on GET means "new file", not an error).
 */
async function publishFile(ghPath, content, describe) {
  const ghBase = `https://api.github.com/repos/${GH_REPO}/contents/${encodeURIComponent(ghPath).replace(/%2F/g, '/')}`;
  let existingSha = null;
  const getRes = await fetch(`${ghBase}?ref=${encodeURIComponent(GH_BRANCH)}`, { headers: ghHeaders });
  if (getRes.status === 200) {
    const meta = await getRes.json();
    existingSha = meta.sha;
    const existing = Buffer.from(meta.content || '', 'base64').toString('utf8');
    if (existing === content) return `unchanged ${ghPath} (${describe}) — no commit`;
  } else if (getRes.status !== 404) {
    throw new Error(`GitHub GET ${getRes.status} for ${ghPath}: ${(await getRes.text()).slice(0, 200)}`);
  }
  const putRes = await fetch(ghBase, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `chore(sleuth): publish ${ghPath}`,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: GH_BRANCH,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (putRes.status !== 200 && putRes.status !== 201)
    throw new Error(`GitHub PUT ${putRes.status} for ${ghPath}: ${(await putRes.text()).slice(0, 300)}`);
  const r = await putRes.json();
  return `published ${ghPath} (${describe}) @ ${r.commit?.sha?.slice(0, 7)}`;
}

// 1. Pull the rebalance export from the local API (loopback — no tunnel).
const apiUrl = `http://127.0.0.1:${API_PORT}/workspace/${encodeURIComponent(WORKSPACE)}` +
  `/reminders?format=rebalance&activeOnly=${encodeURIComponent(ACTIVE_ONLY)}`;
let apiBody;
try {
  const apiRes = await fetch(apiUrl, { headers: { Authorization: `Bearer ${API_TOKEN}` } });
  apiBody = await apiRes.json();
} catch (e) {
  fail(`local API request failed: ${e.message}`);
}
// Auth failures return HTTP 200 with success:false — check the body, not the status.
if (!apiBody || apiBody.success !== true || !apiBody.data) {
  fail(`local API did not return success:true — ${JSON.stringify(apiBody).slice(0, 200)}`);
}

// Load thread memories directly from the on-disk DB (read-only; doesn't touch the
// main process's write connection). Returns [] when no DB file exists yet.
let Memories = [];
try {
  const { ListThreadMemoriesForExport } = require('../../src/thread-memory');
  Memories = ListThreadMemoriesForExport(WORKSPACE);
} catch (e) {
  console.warn(`[publish-reminders-export] memories load failed (non-fatal): ${e.message}`);
}

// Deterministic payload (drop volatile `fetchedAt`, stamp hourly-rounded
// `exportGeneratedAt` heartbeat). Pure logic lives in export-payload.js (unit-tested).
const { payload, content } = ExportPayload.BuildExportContent(apiBody.data, Date.now(), Memories);

// 2. Build the bounded completions export from the on-disk completion history. Read directly (same
// no-inbound-access pattern as the memories load): the script runs ON the Sleuth box. A missing file
// (workspace with no completions yet) degrades to an empty export, never a failure.
let CompletionRecords = [];
try {
  const CompletedPath = path.join(REPO_ROOT, 'data', 'runtime', 'reminders', `${WORKSPACE}_completed.json`);
  const Parsed = JSON.parse(await readFile(CompletedPath, 'utf8'));
  if (Array.isArray(Parsed)) CompletionRecords = Parsed;
} catch (e) {
  if (e.code !== 'ENOENT') console.warn(`[publish-reminders-export] completions load failed (non-fatal): ${e.message}`);
}
const completions = CompletionsPayload.BuildCompletionsContent(CompletionRecords, Date.now(), COMPLETIONS_WINDOW_DAYS, WORKSPACE);

// 3. Publish both files. A completions failure must not sink the (more important) active mirror, so
// each is independent and the active one is published first.
try {
  console.log(`[publish-reminders-export] ${await publishFile(GH_PATH, content, `${payload.reminders?.length ?? '?'} reminders, ${payload.memories?.length ?? 0} memories`)}`);
} catch (e) {
  fail(e.message);
}
try {
  console.log(`[publish-reminders-export] ${await publishFile(COMPLETIONS_PATH, completions.content, `${completions.payload.count} completions, ${completions.payload.windowDays}d`)}`);
} catch (e) {
  console.error(`[publish-reminders-export] completions publish failed (active mirror already published): ${e.message}`);
  process.exit(1);
}
