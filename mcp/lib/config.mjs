// Read-only configuration + workspace resolution for the Sleuth MCP connector.
//
// The connector is a SEPARATE process from the Slack app: Claude Desktop spawns it over stdio.
// It must never open a Slack socket or mutate Sleuth state — it only reads the on-disk runtime
// data the live app owns, plus makes read-only Slack Web API calls. To stay aligned with the
// app's file conventions (paths, naming, validation) it reuses src/workspaces.js verbatim rather
// than re-deriving them, so the two can never drift.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// src/workspaces.js is CommonJS and depends only on `path`/`fs` (no Slack/AI side effects), so it
// is safe to pull into this ESM process for its path helpers and validating loader.
/** @type {any} */
const Workspaces = require('../../src/workspaces.js');

const ThisDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the `data/runtime` directory that holds per-workspace state.
 *
 * Resolution order:
 *   1. SLEUTH_DATA_DIR env var (point at a `data/runtime` dir — useful when the connector runs on
 *      a different host/path than the repo checkout).
 *   2. The sibling of the workspaces directory the app itself uses, so a default checkout "just works".
 * @returns {string}
 */
export function GetRuntimeDir() {
  if(process.env.SLEUTH_DATA_DIR && process.env.SLEUTH_DATA_DIR.trim().length > 0) {
    return path.resolve(process.env.SLEUTH_DATA_DIR.trim());
  }
  // Workspaces.GetDirPath() === <repo>/data/runtime/workspaces; its parent is data/runtime.
  return path.dirname(Workspaces.GetDirPath());
}

/** Absolute path to the per-workspace reminders directory. @returns {string} */
export function GetRemindersDir() {
  return path.join(GetRuntimeDir(), 'reminders');
}

/** Absolute path to the per-workspace config directory. @returns {string} */
export function GetWorkspacesDir() {
  return path.join(GetRuntimeDir(), 'workspaces');
}

/** @returns {string} Absolute path to a workspace's pending-reminders JSON file. */
export function GetRemindersFilePath(ArgWorkspaceName) {
  return path.join(GetRemindersDir(), `${ArgWorkspaceName}_reminders.json`);
}

/** @returns {string} Absolute path to a workspace's completion-history JSON file. */
export function GetCompletedFilePath(ArgWorkspaceName) {
  return path.join(GetRemindersDir(), `${ArgWorkspaceName}_completed.json`);
}

/**
 * Names of all configured workspaces. Enumerated against GetWorkspacesDir() (which honors
 * SLEUTH_DATA_DIR) rather than Workspaces.EnumerateWorkspaceNamesAsync, whose root is hardcoded to
 * the repo checkout — otherwise reminders and workspaces could resolve from different roots.
 * @returns {Promise<string[]>}
 */
export async function ListWorkspaceNames() {
  const Dir = GetWorkspacesDir();
  let FileNames;
  try {
    FileNames = await fs.readdir(Dir);
  } catch(error) {
    if(error && error.code === 'ENOENT') return [];
    throw error;
  }
  return FileNames
    .filter(ArgName => ArgName.endsWith('_workspace.json'))
    .map(ArgName => Workspaces.GetWorkspaceNameFromFilePath(ArgName));
}

/**
 * Resolve the workspace a tool call should operate on.
 * - An explicit name is validated against the configured set.
 * - When omitted, a single configured workspace is used implicitly; with several, the caller is
 *   told to choose rather than guessing the wrong tenant.
 * @param {string} [ArgRequested]
 * @returns {Promise<string>} The resolved workspace name.
 */
export async function ResolveWorkspaceName(ArgRequested) {
  const Names = await ListWorkspaceNames();
  if(Names.length === 0) {
    throw new Error(`No Sleuth workspaces found under ${GetRuntimeDir()}. Set SLEUTH_DATA_DIR to the app's data/runtime directory.`);
  }
  if(ArgRequested && ArgRequested.trim().length > 0) {
    const Requested = ArgRequested.trim();
    if(!Names.includes(Requested)) {
      throw new Error(`Unknown workspace "${Requested}". Available workspaces: ${Names.join(', ')}.`);
    }
    return Requested;
  }
  if(Names.length === 1) return Names[0];
  throw new Error(`Multiple workspaces configured; pass "workspace" explicitly. Available: ${Names.join(', ')}.`);
}

/**
 * Load a validated workspace config (includes Slack tokens). Used by the live Slack tools.
 * @param {string} ArgWorkspaceName
 * @returns {Promise<any>}
 */
export async function LoadWorkspace(ArgWorkspaceName) {
  // Build the path from GetWorkspacesDir() (SLEUTH_DATA_DIR-aware), then reuse the app's validating
  // loader so the workspace shape is checked exactly as the live app checks it.
  const FilePath = path.join(GetWorkspacesDir(), `${ArgWorkspaceName}_workspace.json`);
  return Workspaces.LoadWorkspaceInfoAsync(FilePath);
}
