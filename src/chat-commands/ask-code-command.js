const fs = require('fs').promises;
const path = require('path');
const SlackFormatUtils = require('../slack-format-utils');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'remote-rag-projects.json');
// data/runtime/ survives deploys (see scripts/deploy.sh). A tracked config/
// edit is what wiped the live `ltvera` entry in GH-211.
const DEFAULT_OVERLAY_PATH = path.join(
  __dirname, '..', '..', 'data', 'runtime', 'remote-rag-projects.overlay.json'
);
const REQUEST_TIMEOUT_MS = 90_000;

/** @type {{ integration_version: string, projects: Record<string, RemoteRagProject> } | null} */
let _config = null;

/**
 * @typedef {{
 *   label: string,
 *   endpoint: string,
 *   secretEnvVar: string,
 *   description?: string
 * }} RemoteRagProject
 */

/**
 * Overlay project keys win. Missing overlay is a no-op.
 * @param {{ integration_version?: string, projects?: Record<string, RemoteRagProject> }} ArgBase
 * @param {{ integration_version?: string, projects?: Record<string, RemoteRagProject> } | null | undefined} ArgOverlay
 * @returns {{ integration_version?: string, projects: Record<string, RemoteRagProject> }}
 */
function mergeRemoteRagConfig(ArgBase, ArgOverlay) {
  const BaseProjects = (ArgBase && ArgBase.projects && typeof ArgBase.projects === 'object')
    ? ArgBase.projects
    : {};
  if (!ArgOverlay || typeof ArgOverlay !== 'object') {
    return { ...ArgBase, projects: { ...BaseProjects } };
  }
  const OverlayProjects = (ArgOverlay.projects && typeof ArgOverlay.projects === 'object')
    ? ArgOverlay.projects
    : {};
  return {
    ...ArgBase,
    integration_version: ArgOverlay.integration_version || ArgBase.integration_version,
    projects: { ...BaseProjects, ...OverlayProjects },
  };
}

function overlayPath() {
  return process.env.REMOTE_RAG_PROJECTS_OVERLAY || DEFAULT_OVERLAY_PATH;
}

/**
 * @returns {Promise<Record<string, RemoteRagProject>>}
 */
async function loadProjects() {
  if (_config) return _config.projects;
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  let parsed = JSON.parse(raw);
  try {
    const overlayRaw = await fs.readFile(overlayPath(), 'utf8');
    parsed = mergeRemoteRagConfig(parsed, JSON.parse(overlayRaw));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  _config = parsed;
  return _config.projects;
}

function resetProjectsCache() {
  _config = null;
}

/**
 * Unescape the common JSON string escapes in a (possibly truncated) string fragment.
 * Single-pass so a literal `\\n` is not double-processed; a dangling trailing backslash
 * (left by a mid-escape truncation) is dropped first so it does not render as a stray `\`.
 * @param {string} ArgFragment
 * @returns {string}
 */
function UnescapeJsonStringFragment(ArgFragment) {
  return ArgFragment
    .replace(/\\+$/, (ArgTrailing) => (ArgTrailing.length % 2 === 1 ? ArgTrailing.slice(0, -1) : ArgTrailing))
    .replace(/\\(u[0-9a-fA-F]{4}|.)/g, (ArgWhole, ArgEsc) => {
      if(ArgEsc[0] === 'u') return String.fromCharCode(parseInt(ArgEsc.slice(1), 16));
      switch(ArgEsc) {
        case 'n': return '\n';
        case 'r': return '\r';
        case 't': return '\t';
        case 'b': return '\b';
        case 'f': return '\f';
        case '"': return '"';
        case '\\': return '\\';
        case '/': return '/';
        default: return ArgEsc;
      }
    });
}

/**
 * Best-effort recovery of the inner `answer` value from a double-encoded payload whose nested
 * JSON failed to parse — typically because the upstream agent serialized its `{answer:"..."}`
 * payload into the `answer` string AND truncated it mid-stream (so the inner JSON has no closing
 * quote/brace). Locates the inner `"answer": "<value>` and returns the unescaped value (which may
 * itself be truncated), or '' if no `answer` field could be found. This keeps a truncated upstream
 * response from surfacing as a raw `{ "answer": "...` JSON blob in Slack.
 * @param {string} ArgRaw
 * @returns {string}
 */
function RecoverPartialNestedAnswer(ArgRaw) {
  // (?:[^"\\]|\\.)* consumes escaped quotes/backslashes and runs to end-of-input when the
  // closing quote was truncated away.
  const Match = ArgRaw.match(/"answer"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if(!Match) return '';
  return UnescapeJsonStringFragment(Match[1]).trim();
}

/**
 * Extract displayable answer text from the remote RAG response payload.
 * Accepts the documented `{ answer: "..." }` shape and defensively unwraps
 * one accidental nested JSON layer when an upstream agent serializes the
 * whole payload into the `answer` string. When that nested layer is present
 * but truncated/malformed, falls back to a best-effort recovery of the inner
 * prose (with a truncation notice) instead of posting the raw JSON blob.
 *
 * @param {any} ArgData Parsed JSON response body from the remote agent.
 * @param {import('../slack-app')} ArgSlackApp Slack app instance for logging.
 * @param {string} ArgSlug Project slug being queried.
 * @returns {string}
 */
function ExtractAnswerText(ArgData, ArgSlackApp, ArgSlug) {
  if(!ArgData || typeof ArgData !== 'object') return '';

  if(typeof ArgData.answer === 'string') {
    const DirectAnswer = ArgData.answer.trim();
    if(!DirectAnswer) return '';

    if(DirectAnswer.startsWith('{')) {
      try {
        const NestedData = JSON.parse(DirectAnswer);
        if(NestedData && typeof NestedData === 'object' && typeof NestedData.answer === 'string') {
          const NestedAnswer = NestedData.answer.trim();
          if(NestedAnswer) {
            ArgSlackApp.Logger.warn(
              `ask-code: unwrapped nested JSON answer for project "${ArgSlug}" (upstream contract drift)`
            );
            return NestedAnswer;
          }
        }
      } catch(error) {
        // The inner JSON failed to parse — most commonly because the upstream agent
        // double-encoded the answer AND truncated it mid-stream (no closing quote/brace),
        // which would otherwise dump a raw `{ "answer": "...` blob into Slack. Best-effort
        // recover the readable prose so the user sees the (partial) answer instead.
        const Recovered = RecoverPartialNestedAnswer(DirectAnswer);
        if(Recovered) {
          ArgSlackApp.Logger.warn(
            `ask-code: recovered partial answer from malformed/truncated nested JSON for project "${ArgSlug}" (likely upstream truncation)`
          );
          return `${Recovered}\n\n_:warning: \`${ArgSlug}\` returned a truncated response, so this answer is incomplete — try asking again or narrowing the question._`;
        }
        // No recoverable `answer` field — fall back to the original (raw) text below.
      }
    }

    return DirectAnswer;
  }

  if(ArgData.answer && typeof ArgData.answer === 'object' && typeof ArgData.answer.answer === 'string') {
    const NestedObjectAnswer = ArgData.answer.answer.trim();
    if(NestedObjectAnswer) {
      ArgSlackApp.Logger.warn(
        `ask-code: unwrapped nested object answer for project "${ArgSlug}" (upstream contract drift)`
      );
      return NestedObjectAnswer;
    }
  }

  return '';
}

/**
 * Handle the `ask-code <slug> <query>` command — proxies the query to the registered
 * remote RAG agent for the named project and posts the answer.
 *
 * Tenancy-gated: only available in the Neochrome workspace (NEOCHROME_TEAM_ID).
 * Unknown project slugs get a helpful reply listing registered projects.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {string} ArgQueryRaw Everything after "ask-code" with separators stripped.
 * @returns {Promise<void>}
 */
async function HandleAskCodeCommandAsync(ArgSlackApp, ArgEventInfo, ArgQueryRaw) {
  const AllowedTeamId = process.env.NEOCHROME_TEAM_ID;
  if (!AllowedTeamId || ArgSlackApp.TeamId !== AllowedTeamId) {
    ArgSlackApp.Logger.warn(
      `ask-code: tenancy gate blocked invocation (workspace: ${ArgSlackApp.TeamId || 'null'})`
    );
    return;
  }

  const Parts = ArgQueryRaw.trim().split(/\s+/);
  const Slug = (Parts[0] || '').toLowerCase();
  const Query = Parts.slice(1).join(' ').trim();

  if (!Slug || !Query) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Usage: `ask-code <project> <question>`\nExample: `ask-code client-b how does the auth flow work?`'
    );
    return;
  }

  let Projects;
  try {
    Projects = await loadProjects();
  } catch (err) {
    ArgSlackApp.Logger.error('ask-code: failed to load remote RAG project registry:', err);
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      "sorry — couldn't load the project registry. Check the logs."
    );
    return;
  }

  const Project = Projects[Slug];
  if (!Project) {
    const Available = Object.keys(Projects);
    const ListText = Available.length > 0
      ? `Available projects: ${Available.map((s) => `\`${s}\``).join(', ')}`
      : 'No projects are registered yet.';
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `unknown project \`${Slug}\`. ${ListText}`
    );
    return;
  }

  const Secret = process.env[Project.secretEnvVar];
  if (!Secret) {
    ArgSlackApp.Logger.error(
      `ask-code: env var ${Project.secretEnvVar} not set for project "${Slug}"`
    );
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      `sorry — \`${Slug}\` is not fully configured on this server. Check the logs.`
    );
    return;
  }

  const Controller = new AbortController();
  const TimeoutId = setTimeout(() => Controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    ArgSlackApp.Logger.info(`ask-code: querying "${Slug}" — ${Query.slice(0, 80)}`);
    const Res = await fetch(Project.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Secret}`,
      },
      body: JSON.stringify({ query: Query }),
      signal: Controller.signal,
    });

    clearTimeout(TimeoutId);

    if (Res.status === 401) {
      ArgSlackApp.Logger.error(`ask-code: auth_failed for project "${Slug}" — check secrets match`);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `sorry — authentication failed for \`${Slug}\`. The server secret may be out of sync.`
      );
      return;
    }

    if (!Res.ok) {
      const Body = await Res.text().catch(() => '');
      ArgSlackApp.Logger.error(`ask-code: HTTP ${Res.status} from "${Slug}":`, Body.slice(0, 200));
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `sorry — \`${Slug}\` returned an error (HTTP ${Res.status}). Check the logs.`
      );
      return;
    }

    const Data = await Res.json();
    const Answer = ExtractAnswerText(Data, ArgSlackApp, Slug);
    if (!Answer) {
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `sorry — \`${Slug}\` returned an empty answer.`
      );
      return;
    }

    const Formatted = SlackFormatUtils.NormalizeModelMarkdownForSlack(Answer);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, Formatted);

  } catch (err) {
    clearTimeout(TimeoutId);
    if (err?.name === 'AbortError') {
      ArgSlackApp.Logger.warn(`ask-code: timeout querying "${Slug}" after ${REQUEST_TIMEOUT_MS}ms`);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `sorry — \`${Slug}\` took too long to respond. Please try again.`
      );
    } else {
      ArgSlackApp.Logger.error(`ask-code: network error querying "${Slug}":`, err);
      await ArgSlackApp.PostMessageTextAsync(
        ArgEventInfo.channel,
        ArgEventInfo.ts,
        `sorry — couldn't reach \`${Slug}\`. Check the logs.`
      );
    }
  }
}

module.exports = HandleAskCodeCommandAsync;
module.exports.mergeRemoteRagConfig = mergeRemoteRagConfig;
module.exports.loadProjects = loadProjects;
module.exports.resetProjectsCache = resetProjectsCache;
