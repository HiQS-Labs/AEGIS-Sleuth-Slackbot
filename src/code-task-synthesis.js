'use strict';

// Synthesis + rendering helpers for the code-task relay (Slack → Claude Code Cloud).
//
// This module is intentionally pure and side-effect free apart from reading the static AI
// assets. It (1) turns a freeform Slack request into a structured TaskSpec via WorkspaceAI
// (the "Claude synthesis" step), and (2) renders that spec into the markdown task file and the
// `claude --remote` prompt, plus the shared metadata-header format used to route feedback back
// to the originating Slack thread. The GitHub transport lives in code-task-relay-module.js.

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const AssetsBasePath = path.join(__dirname, '..', 'data', 'static', 'ai');

// Default Claude model used for the synthesis pass so the "clean-up" is genuinely Claude,
// regardless of the workspace's default chat model. Overridable via CODE_TASK_SYNTH_MODEL.
const DefaultSynthesisModel = process.env.CODE_TASK_SYNTH_MODEL || 'claude-sonnet-4-6';

const HeaderCommentTag = 'code-task-relay';

/**
 * @typedef {Object} TaskSpec
 * @property {string} title
 * @property {string} summary
 * @property {string} target_repo
 * @property {string} target_branch
 * @property {string} instructions
 * @property {string[]} acceptance_criteria
 * @property {string[]} affected_areas
 * @property {string[]} open_questions
 * @property {number} confidence
 */

/** @type {string|null} */
let CachedInstructions = null;
/** @type {import('./workspace-ai').ResponseSchema|null} */
let CachedSchema = null;

/**
 * Load (and cache) the synthesis instructions + JSON schema assets.
 * @returns {Promise<{ Instructions: string, Schema: object }>}
 */
async function LoadSynthesisAssetsAsync() {
  if(!CachedInstructions)
    CachedInstructions = await fs.readFile(path.join(AssetsBasePath, 'code-task-synthesis-instructions.md'), 'utf8');
  if(!CachedSchema) {
    const SchemaText = await fs.readFile(path.join(AssetsBasePath, 'code-task-synthesis-schema.json'), 'utf8');
    CachedSchema = JSON.parse(SchemaText);
  }
  return { Instructions: CachedInstructions, Schema: CachedSchema };
}

/**
 * Run the Claude synthesis pass: freeform request → structured TaskSpec.
 * @param {import('./workspace-ai')} ArgWorkspaceAI WorkspaceAI instance.
 * @param {string} ArgRawRequest The user's freeform request text (mention + keyword stripped).
 * @param {{ modelName?: string, defaultRepo?: string }} [ArgOptions]
 * @returns {Promise<TaskSpec>} The validated TaskSpec object.
 */
async function SynthesizeTaskSpecAsync(ArgWorkspaceAI, ArgRawRequest, ArgOptions = {}) {
  const Request = (ArgRawRequest || '').trim();
  if(!Request) throw new Error('code-task: empty request — nothing to synthesize.');

  const { Instructions, Schema } = await LoadSynthesisAssetsAsync();
  const ModelName = ArgOptions.modelName || DefaultSynthesisModel;

  const Spec = await ArgWorkspaceAI.ProcessMessageWithJsonResponseAsync(
    Request, Instructions, /** @type {*} */ (Schema), ModelName
  );

  return NormalizeSpec(Spec, ArgOptions.defaultRepo);
}

/**
 * Defensive normalization of a model-produced spec so downstream rendering never throws on a
 * missing array or stray type. Does not invent content — only coerces shape.
 * @param {any} ArgSpec
 * @param {string} [ArgDefaultRepo]
 * @returns {TaskSpec}
 */
// No vendor default: an unset default must surface as empty rather than silently targeting
// someone else's repository. Callers pass the deployment's configured repo.
function NormalizeSpec(ArgSpec, ArgDefaultRepo = process.env.CODE_TASK_DEFAULT_REPO || '') {
  const Spec = /** @type {Record<string, any>} */ ((ArgSpec && typeof ArgSpec === 'object') ? ArgSpec : {});
  /** @param {*} ArgValue @returns {string[]} */
  const AsArray = (ArgValue) => Array.isArray(ArgValue) ? ArgValue.filter((ArgItem) => typeof ArgItem === 'string' && ArgItem.trim()) : [];
  /** @param {*} ArgValue @param {string} [ArgFallback] @returns {string} */
  const AsString = (ArgValue, ArgFallback = '') => typeof ArgValue === 'string' && ArgValue.trim() ? ArgValue.trim() : ArgFallback;

  return {
    title: AsString(Spec.title, 'Untitled code task'),
    summary: AsString(Spec.summary),
    target_repo: AsString(Spec.target_repo, ArgDefaultRepo),
    target_branch: AsString(Spec.target_branch, `code-task/${Slugify(AsString(Spec.title, 'change'))}`),
    instructions: AsString(Spec.instructions),
    acceptance_criteria: AsArray(Spec.acceptance_criteria),
    affected_areas: AsArray(Spec.affected_areas),
    open_questions: AsArray(Spec.open_questions),
    confidence: typeof Spec.confidence === 'number' ? Spec.confidence : 0,
  };
}

/**
 * Lowercase kebab-case slug, safe for filenames and branch names.
 * @param {string} ArgText
 * @returns {string}
 */
function Slugify(ArgText) {
  return (ArgText || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'task';
}

/** Compact UTC timestamp for filenames: 20260620T203045Z. */
function UtcCompact(ArgDate = new Date()) {
  /** @param {number} ArgN @returns {string} */
  const Pad = (ArgN) => String(ArgN).padStart(2, '0');
  return (
    ArgDate.getUTCFullYear() +
    Pad(ArgDate.getUTCMonth() + 1) +
    Pad(ArgDate.getUTCDate()) + 'T' +
    Pad(ArgDate.getUTCHours()) +
    Pad(ArgDate.getUTCMinutes()) +
    Pad(ArgDate.getUTCSeconds()) + 'Z'
  );
}

/**
 * Build a stable task id from the spec + origin, used for the filename and ack correlation.
 * @param {{ title: string, instructions: string }} ArgSpec
 * @param {{ channel?: string, threadTs?: string }} ArgOrigin
 * @param {Date} [ArgDate]
 * @returns {string} e.g. 20260620T203045Z__github-sync-retry__a1b2c3d4
 */
function BuildTaskId(ArgSpec, ArgOrigin, ArgDate = new Date()) {
  const Hash = crypto
    .createHash('sha256')
    .update(`${ArgSpec.title}|${ArgSpec.instructions}|${ArgOrigin.channel || ''}|${ArgOrigin.threadTs || ''}|${ArgDate.toISOString()}`)
    .digest('hex')
    .slice(0, 8);
  return `${UtcCompact(ArgDate)}__${Slugify(ArgSpec.title)}__${Hash}`;
}

/**
 * Build the shared metadata HTML comment carried by both the task file and its ack, so feedback
 * can be routed back to the originating Slack thread. Mirrors the snapshot-relay header style.
 * @param {Record<string, string|undefined>} ArgFields
 * @returns {string}
 */
function BuildMetadataHeader(ArgFields) {
  const Parts = Object.entries(ArgFields)
    .filter(([, ArgValue]) => ArgValue !== undefined && ArgValue !== null && `${ArgValue}` !== '')
    .map(([ArgKey, ArgValue]) => `${ArgKey}="${String(ArgValue).replace(/"/g, '')}"`);
  return `<!-- ${HeaderCommentTag}: ${Parts.join(' ')} -->`;
}

/**
 * Parse the metadata HTML comment from a task/ack file. Returns {} when absent.
 * @param {string} ArgContent
 * @returns {Record<string, string>}
 */
function ParseMetadataHeader(ArgContent) {
  const Match = (ArgContent || '').match(new RegExp(`<!--\\s*${HeaderCommentTag}:\\s*([^>]*?)\\s*-->`));
  if(!Match) return {};
  /** @type {Record<string, string>} */
  const Fields = {};
  const TokenPattern = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let Token;
  while((Token = TokenPattern.exec(Match[1])) !== null) {
    Fields[Token[1]] = Token[2];
  }
  return Fields;
}

/**
 * Render the markdown task file body (metadata header + human-readable spec).
 * @param {TaskSpec} ArgSpec Normalized TaskSpec.
 * @param {{ taskId: string, channel: string, threadTs?: string, user?: string, triggerMode?: string, createdAt?: string }} ArgOrigin
 * @returns {string}
 */
function RenderTaskMarkdown(ArgSpec, ArgOrigin) {
  const CreatedAt = ArgOrigin.createdAt || new Date().toISOString();
  const Header = BuildMetadataHeader({
    'task-id': ArgOrigin.taskId,
    channel: ArgOrigin.channel,
    'thread-ts': ArgOrigin.threadTs,
    user: ArgOrigin.user,
    repo: ArgSpec.target_repo,
    branch: ArgSpec.target_branch,
    'trigger-mode': ArgOrigin.triggerMode,
    'created-at': CreatedAt,
  });

  /** @param {string} ArgTitle @param {string[]} ArgItems @returns {string} */
  const Section = (ArgTitle, ArgItems) =>
    ArgItems.length ? `\n## ${ArgTitle}\n\n${ArgItems.map((ArgItem) => `- ${ArgItem}`).join('\n')}\n` : '';

  return [
    Header,
    '',
    `# ${ArgSpec.title}`,
    '',
    ArgSpec.summary,
    '',
    `**Target:** \`${ArgSpec.target_repo}\` → branch \`${ArgSpec.target_branch}\` (open a PR; do not push to main/development)`,
    `**Confidence:** ${ArgSpec.confidence}`,
    '',
    '## Instructions',
    '',
    ArgSpec.instructions,
    Section('Acceptance criteria', ArgSpec.acceptance_criteria),
    Section('Affected areas', ArgSpec.affected_areas),
    Section('Open questions', ArgSpec.open_questions),
    '',
    '---',
    '_Synthesized by Sleuth from a Slack request. Executed by Claude Code Cloud._',
    '',
  ].join('\n');
}

/**
 * Build the prompt string handed to `claude --remote`.
 * @param {TaskSpec} ArgSpec Normalized TaskSpec.
 * @returns {string}
 */
function BuildRemotePrompt(ArgSpec) {
  const Lines = [
    ArgSpec.instructions,
    '',
    `Open a pull request from a new branch \`${ArgSpec.target_branch}\` against \`${ArgSpec.target_repo}\`. Do not push to main or development.`,
  ];
  if(ArgSpec.acceptance_criteria.length) {
    Lines.push('', 'Acceptance criteria:', ...ArgSpec.acceptance_criteria.map((ArgItem) => `- ${ArgItem}`));
  }
  if(ArgSpec.open_questions.length) {
    Lines.push('', 'Open questions to resolve with reasonable defaults (note assumptions in the PR description):', ...ArgSpec.open_questions.map((ArgItem) => `- ${ArgItem}`));
  }
  return Lines.join('\n');
}

module.exports = {
  DefaultSynthesisModel,
  HeaderCommentTag,
  LoadSynthesisAssetsAsync,
  SynthesizeTaskSpecAsync,
  NormalizeSpec,
  Slugify,
  UtcCompact,
  BuildTaskId,
  BuildMetadataHeader,
  ParseMetadataHeader,
  RenderTaskMarkdown,
  BuildRemotePrompt,
};
