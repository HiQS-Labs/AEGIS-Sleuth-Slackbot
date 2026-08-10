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
 * @property {string}   [ModelName]      Pin a non-default model (e.g. the complex model). Omitted
 * uses the workspace default, which is what every pre-GH-44 caller did.
 * @property {string}   [PromptVersion]  Stamped on each corpus record so an offline replay can
 * bucket by prompt revision (GH-44; mirrors the router-shadow `promptVersion`).
 * @property {string}   [SchemaVersion]  Stamped on each corpus record; same purpose.
 * @property {(ArgResponse: any) => void} [Validate] Caller-supplied validation run INSIDE the
 * chokepoint, after RequiredFields. Its throw propagates unchanged, so a caller with specific error
 * messages keeps them byte-identical instead of losing them to the generic RequiredFields error —
 * and the corpus still gets to classify the record `invalid` rather than recording a false `ok`.
 * `RequiredFields` only tests presence (see {@link HasRequiredFields}); anything type-shaped, or
 * any message a test asserts on, belongs here.
 * @property {(ArgInput: any, ArgResponse: any) => object} [DebugFacts] Pure extractor producing the
 * small fact bag surfaced by the explain surface and stored on the corpus record. Must not throw;
 * if it does, the throw is swallowed and the record lands without facts.
 */

/**
 * Per-call failure policy. This is the parameter that distinguishes use cases: a decision whose
 * wrong answer is cheap fails open to a permissive default, one whose wrong answer is expensive
 * fails closed to a restrictive default.
 * @typedef {Object} AiDecisionOptions
 * @property {any}    [Fallback] Value returned when the model errors or answers unusably. Null or
 * omitted rethrows instead, which is the right choice when the caller already handles the throw.
 * @property {{warn: Function}} [Logger] Logger used to record a fallback. Optional.
 * @property {AiDecisionCapture} [Capture] Corpus capture config. **Absent means no capture** — the
 * subsystem is off unless a caller explicitly opts in, so no existing call site changed behavior
 * when GH-44 landed.
 */

/**
 * Corpus capture configuration for one call.
 * @typedef {Object} AiDecisionCapture
 * @property {{append: Function}} Store  A decision-corpus store (see decision-corpus-store.js).
 * @property {string} Workspace          Workspace key the record is filed under.
 * @property {string} [Mode]             Free-form marker recorded on the row (e.g. 'shadow').
 */

/** Record outcomes. `invalid` = the model answered but the answer was rejected; `error` = it did not answer. */
const DecisionOutcome = Object.freeze({ Ok: 'ok', Invalid: 'invalid', Error: 'error' });

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
 * Run a spec's DebugFacts extractor defensively. A debug-fact bug must never cost the record it was
 * attached to, so a throw is swallowed and the record simply lands without facts.
 * @param {AiDecisionSpec} ArgSpec
 * @param {any} ArgInput
 * @param {any} ArgResponse
 * @returns {object|null}
 */
function SafeDebugFacts(ArgSpec, ArgInput, ArgResponse) {
  if(typeof ArgSpec.DebugFacts !== 'function') return null;
  try {
    const Facts = ArgSpec.DebugFacts(ArgInput, ArgResponse);
    return (Facts && typeof Facts === 'object' && !Array.isArray(Facts)) ? Facts : null;
  } catch(error) {
    return null;
  }
}

/**
 * Append one corpus record, best effort. This function NEVER throws and never alters the decision's
 * own outcome: the store contract already resolves `{ok,error}` instead of rejecting, and the extra
 * try/catch here covers a caller-supplied store that does not honor that contract.
 * @param {AiDecisionCapture|null} ArgCapture
 * @param {AiDecisionSpec} ArgSpec
 * @param {any} ArgInput
 * @param {any} ArgResponse
 * @param {string} ArgOutcome
 * @param {any} ArgError
 * @param {number} ArgStartedAtMs
 * @param {{warn: Function}|null} ArgLogger
 * @returns {Promise<void>}
 */
async function EmitCaptureAsync(
  ArgCapture, ArgSpec, ArgInput, ArgResponse, ArgOutcome, ArgError, ArgStartedAtMs, ArgLogger,
) {
  if(!ArgCapture || !ArgCapture.Store || typeof ArgCapture.Store.append !== 'function') return;

  try {
    const Record = {
      decision: ArgSpec.Name,
      mode: ArgCapture.Mode || 'capture',
      outcome: ArgOutcome,
      promptVersion: ArgSpec.PromptVersion || null,
      schemaVersion: ArgSpec.SchemaVersion || null,
      modelName: ArgSpec.ModelName || null,
      input: ArgInput ?? null,
      output: ArgResponse ?? null,
      debugFacts: SafeDebugFacts(ArgSpec, ArgInput, ArgResponse),
      // message only, never the stack: a stack is noise in a replay corpus and can carry absolute
      // filesystem paths from the host that produced it.
      error: ArgError ? String(ArgError.message || ArgError) : null,
      durationMs: Date.now() - ArgStartedAtMs,
    };

    const Result = await ArgCapture.Store.append(ArgCapture.Workspace, Record);
    if(Result && Result.ok === false && ArgLogger) {
      ArgLogger.warn(`[ai-decision] ${ArgSpec.Name} corpus append failed:`, Result.error);
    }
  } catch(error) {
    if(ArgLogger) ArgLogger.warn(`[ai-decision] ${ArgSpec.Name} corpus append threw:`, error);
  }
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
  const Capture = ArgOptions.Capture ?? null;
  const StartedAtMs = Date.now();

  let Outcome = DecisionOutcome.Ok;
  let Response = null;
  let FailureError = null;

  try {
    const { Instructions, Schema } = await LoadAssetsAsync(ArgSpec);
    const InputText = typeof ArgInput === 'string' ? ArgInput : JSON.stringify(ArgInput, null, 2);

    // Only pass a model name when the spec pins one: WorkspaceAI applies its own default for the
    // 3-arg form, and passing `undefined` explicitly is not guaranteed to be the same thing.
    Response = ArgSpec.ModelName
      ? await ArgWorkspaceAI.ProcessMessageWithJsonResponseAsync(
        InputText, Instructions, Schema, ArgSpec.ModelName,
      )
      : await ArgWorkspaceAI.ProcessMessageWithJsonResponseAsync(
        InputText, Instructions, Schema,
      );

    if(!HasRequiredFields(Response, ArgSpec.RequiredFields)) {
      Outcome = DecisionOutcome.Invalid;
      throw new Error(`Invalid ${ArgSpec.Name} response from the AI model.`);
    }

    // Caller-supplied validation runs INSIDE the chokepoint so its (specific, often test-asserted)
    // error is what propagates, while the corpus still sees `invalid` rather than a false `ok`.
    if(typeof ArgSpec.Validate === 'function') {
      try {
        ArgSpec.Validate(Response);
      } catch(error) {
        Outcome = DecisionOutcome.Invalid;
        throw error;
      }
    }

    return Response;
  } catch(error) {
    // a failure that is not a rejected answer is a failure to get one at all.
    if(Outcome === DecisionOutcome.Ok) Outcome = DecisionOutcome.Error;
    FailureError = error;

    // no fallback configured means the caller owns the failure — preserve the throw.
    if(Fallback === null) throw error;

    if(Logger) Logger.warn(`[ai-decision] ${ArgSpec.Name} failed, falling back:`, error);
    return Fallback;
  } finally {
    // Awaited deliberately rather than fire-and-forget: the append is a non-fsync'd local write, and
    // making it ordered keeps "one decision emits exactly one record" a deterministic assertion
    // instead of a race. Capture is off by default, so this cost is only paid when an operator has
    // asked for it. Never throws — see EmitCaptureAsync.
    await EmitCaptureAsync(Capture, ArgSpec, ArgInput, Response, Outcome, FailureError, StartedAtMs, Logger);
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
  DecisionOutcome,
};
