'use strict';

// import required modules.
const fs = require('fs').promises;
const path = require('path');

/**
 * @typedef {import('./workspace-ai').ResponseSchema} ResponseSchema
 */

/**
 * Describes one AI decision use case: which prompt assets back it and which response fields
 * must be present for the answer to count as usable.
 * @typedef {Object} AiDecisionSpec
 * @property {string}   Name             Use-case name, used in log lines (e.g. "reminder-dedup").
 * @property {string}   InstructionsFile Instructions filename under data/static/ai/.
 * @property {string}   SchemaFile       Response-schema filename under data/static/ai/.
 * @property {string[]} RequiredFields   Response keys that must be present and non-empty.
 */

/**
 * Per-call failure policy. This is the parameter that distinguishes use cases: a decision whose
 * wrong answer is cheap fails open to a permissive default, one whose wrong answer is expensive
 * fails closed to a restrictive default.
 * @typedef {Object} AiDecisionOptions
 * @property {any}    [Fallback] Value returned when the model errors or answers unusably. Null or
 * omitted rethrows instead, which is the right choice when the caller already handles the throw.
 * @property {{warn: Function}} [Logger] Logger used to record a fallback. Optional.
 */

// prompt assets live alongside the other static AI files, resolved relative to /src.
const AssetBasePath = path.join(__dirname, '..', 'data', 'static', 'ai');

// cache of in-flight or resolved asset loads, keyed by "<instructions>|<schema>". Prompt assets are
// static repo files and identical for every workspace, so this holds no per-workspace state and is
// not the global-singleton pattern that scripts/validate-workspace-isolation.js guards against.
// The promise itself is cached so concurrent first calls share one read instead of racing.
const AssetCache = new Map();

/**
 * Load and parse the instructions and schema for a decision spec, reusing a cached read.
 * @param {AiDecisionSpec} ArgSpec Decision spec naming the asset files.
 * @returns {Promise<{Instructions: string, Schema: ResponseSchema}>}
 */
function LoadAssetsAsync(ArgSpec) {
  const CacheKey = `${ArgSpec.InstructionsFile}|${ArgSpec.SchemaFile}`;
  const Cached = AssetCache.get(CacheKey);
  if(Cached) return Cached;

  const Pending = (async () => {
    const [Instructions, SchemaContent] = await Promise.all([
      fs.readFile(path.join(AssetBasePath, ArgSpec.InstructionsFile), 'utf8'),
      fs.readFile(path.join(AssetBasePath, ArgSpec.SchemaFile), 'utf8'),
    ]);
    return { Instructions, Schema: JSON.parse(SchemaContent) };
  })().catch(error => {
    // do not cache a failed read, so a transient error does not poison every later call.
    AssetCache.delete(CacheKey);
    throw error;
  });

  AssetCache.set(CacheKey, Pending);
  return Pending;
}

/**
 * Report whether a model response carries every field the spec requires.
 * A field is missing when it is undefined, null, or an empty string. Zero and false are values,
 * not absences, so a numeric confidence of 0 counts as present.
 * @param {any} ArgResponse Parsed model response.
 * @param {string[]} ArgRequiredFields Field names that must be present.
 * @returns {boolean}
 */
function HasRequiredFields(ArgResponse, ArgRequiredFields) {
  if(!ArgResponse || typeof ArgResponse !== 'object') return false;
  for(const FieldName of ArgRequiredFields) {
    const Value = ArgResponse[FieldName];
    if(Value === undefined || Value === null || Value === '') return false;
  }
  return true;
}

/**
 * Ask the workspace's AI for a schema-constrained decision.
 *
 * Owns the mechanics every decision use case shares — asset loading and caching, the model call,
 * required-field validation, and the failure policy — so a caller supplies only its prompt payload
 * and what to do when the answer is unusable.
 *
 * ArgWorkspaceAI is passed in rather than resolved from module state: WorkspaceAI is per-workspace,
 * and every workspace shares this process (AGENTS.md section 0.1).
 *
 * @param {import('./workspace-ai')} ArgWorkspaceAI Workspace-scoped AI client.
 * @param {AiDecisionSpec} ArgSpec Decision spec naming the prompt assets and required fields.
 * @param {any} ArgInput Prompt payload; objects are serialized as pretty JSON.
 * @param {AiDecisionOptions} [ArgOptions] Failure policy and logger.
 * @returns {Promise<any>} Validated model response, or the configured fallback.
 */
async function DecideAsync(ArgWorkspaceAI, ArgSpec, ArgInput, ArgOptions = {}) {
  const Fallback = ArgOptions.Fallback ?? null;
  const Logger = ArgOptions.Logger ?? null;

  try {
    const { Instructions, Schema } = await LoadAssetsAsync(ArgSpec);
    const InputText = typeof ArgInput === 'string' ? ArgInput : JSON.stringify(ArgInput, null, 2);

    const Response = await ArgWorkspaceAI.ProcessMessageWithJsonResponseAsync(
      InputText, Instructions, Schema,
    );

    if(!HasRequiredFields(Response, ArgSpec.RequiredFields))
      throw new Error(`Invalid ${ArgSpec.Name} response from the AI model.`);

    return Response;
  } catch(error) {
    // no fallback configured means the caller owns the failure — preserve the throw.
    if(Fallback === null) throw error;

    if(Logger) Logger.warn(`[ai-decision] ${ArgSpec.Name} failed, falling back:`, error);
    return Fallback;
  }
}

/**
 * Drop cached prompt assets. Test-only seam so a suite can re-stub the filesystem between cases.
 * @returns {void}
 */
function ResetAssetCache() {
  AssetCache.clear();
}

// export the decision surface.
module.exports = {
  DecideAsync,
  ResetAssetCache,
};
