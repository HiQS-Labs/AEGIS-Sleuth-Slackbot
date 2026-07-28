/**
 * Thin client for the WP DB Toolkit RAG service.
 */

/**
 * @typedef {import('./workspaces').WorkspaceInfo} WorkspaceInfo
 */

const DefaultTimeoutMs = 30000;
const MaxQuestionLength = 2000;
const EnabledFlags = new Set(['true', 'yes']);

/**
 * Structured error for WP DB Toolkit client failures.
 */
class WpdbtkRagError extends Error {
  /**
   * @param {string} ArgMessage Error message.
   * @param {string} ArgCode Stable error code.
   * @param {number|null} [ArgStatusCode] Upstream status code when available.
   * @param {string|null} [ArgRequestId] Correlation ID when available.
   * @param {string|null} [ArgDetail] Additional detail for logs.
   */
  constructor(ArgMessage, ArgCode, ArgStatusCode = null, ArgRequestId = null, ArgDetail = null) {
    super(ArgMessage);
    this.name = 'WpdbtkRagError';
    this.code = ArgCode;
    this.statusCode = ArgStatusCode;
    this.requestId = ArgRequestId;
    this.detail = ArgDetail;
  }
}

/**
 * Get whether the WPDBTK RAG command is enabled for a workspace.
 * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info.
 * @returns {boolean}
 */
function IsWpdbtkRagEnabled(ArgWorkspaceInfo) {
  const RawFlag = String(ArgWorkspaceInfo.WPDBTK_RAG_ENABLED || '').trim().toLowerCase();
  return EnabledFlags.has(RawFlag);
}

/**
 * Build the normalized client config or throw a configuration error.
 * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info.
 * @returns {{ BaseUrl: string, ServiceToken: string, DefaultSource: string }}
 */
function GetWpdbtkRagConfiguration(ArgWorkspaceInfo) {
  if(!IsWpdbtkRagEnabled(ArgWorkspaceInfo))
    throw new WpdbtkRagError('WPDBTK RAG is not enabled for this workspace.', 'not-enabled');

  const BaseUrl = String(ArgWorkspaceInfo.WPDBTK_RAG_BASE_URL || '').trim().replace(/\/+$/, '');
  const ServiceToken = String(ArgWorkspaceInfo.WPDBTK_RAG_SERVICE_TOKEN || '').trim();
  const DefaultSource = String(ArgWorkspaceInfo.WPDBTK_RAG_DEFAULT_SOURCE || '').trim();

  /** @type {string[]} */
  const MissingFields = [];
  if(!BaseUrl) MissingFields.push('WPDBTK_RAG_BASE_URL');
  if(!ServiceToken) MissingFields.push('WPDBTK_RAG_SERVICE_TOKEN');
  if(!DefaultSource) MissingFields.push('WPDBTK_RAG_DEFAULT_SOURCE');

  if(MissingFields.length > 0) {
    throw new WpdbtkRagError(
      `Missing WPDBTK RAG configuration: ${MissingFields.join(', ')}.`,
      'not-configured'
    );
  }

  return { BaseUrl, ServiceToken, DefaultSource };
}

/**
 * Build a structured error from a non-OK upstream response.
 * @param {number} ArgStatusCode HTTP status code.
 * @param {any} ArgPayload Parsed upstream payload.
 * @param {string|null} ArgRequestId Correlation ID.
 * @returns {WpdbtkRagError}
 */
function BuildUpstreamError(ArgStatusCode, ArgPayload, ArgRequestId) {
  const Detail = typeof ArgPayload?.detail === 'string'
    ? ArgPayload.detail
    : typeof ArgPayload?.error === 'string'
      ? ArgPayload.error
      : typeof ArgPayload?.message === 'string'
        ? ArgPayload.message
        : null;

  if(ArgStatusCode === 401 || ArgStatusCode === 403)
    return new WpdbtkRagError('WPDBTK RAG authorization failed.', 'auth', ArgStatusCode, ArgRequestId, Detail);

  if(ArgStatusCode === 408 || ArgStatusCode === 504)
    return new WpdbtkRagError('WPDBTK RAG request timed out.', 'timeout', ArgStatusCode, ArgRequestId, Detail);

  if(ArgStatusCode >= 500)
    return new WpdbtkRagError('WPDBTK RAG service failed.', 'upstream', ArgStatusCode, ArgRequestId, Detail);

  return new WpdbtkRagError('WPDBTK RAG request was rejected.', 'http', ArgStatusCode, ArgRequestId, Detail);
}

/**
 * Ask the configured WP DB Toolkit RAG service a question.
 * @param {WorkspaceInfo} ArgWorkspaceInfo Workspace info.
 * @param {{
 *   question: string,
 *   caller: {
 *     app: string,
 *     workspace_name: string,
 *     team_id: string|null,
 *     slack_user_id: string,
 *     channel_id: string,
 *     thread_ts: string,
 *   },
 *   forceMode?: string|null,
 *   scope?: string,
 *   topK?: number,
 *   timeoutMs?: number,
 * }} ArgOptions Request options.
 * @returns {Promise<{ answer: string, mode: string|null, requestId: string|null, diagnostics: any }>} 
 */
async function AskQuestionAsync(ArgWorkspaceInfo, ArgOptions) {
  const Config = GetWpdbtkRagConfiguration(ArgWorkspaceInfo);
  const Question = String(ArgOptions.question || '').trim();
  if(!Question)
    throw new WpdbtkRagError('question must not be empty', 'invalid-request');

  if(Question.length > MaxQuestionLength) {
    throw new WpdbtkRagError(
      `question too long (max ${MaxQuestionLength} characters)`,
      'invalid-request'
    );
  }

  const TimeoutMs = Math.max(1, Number(ArgOptions.timeoutMs) || DefaultTimeoutMs);
  const AbortControllerInstance = new AbortController();
  const TimeoutId = setTimeout(() => AbortControllerInstance.abort(), TimeoutMs);

  try {
    const Response = await fetch(`${Config.BaseUrl}/api/ask`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Config.ServiceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        question: Question,
        source: Config.DefaultSource,
        force_mode: ArgOptions.forceMode || null,
        scope: ArgOptions.scope || 'all',
        top_k: ArgOptions.topK || 5,
        caller: ArgOptions.caller,
      }),
      signal: AbortControllerInstance.signal,
    });

    const ResponseText = await Response.text();
    let Payload = null;
    if(ResponseText) {
      try {
        Payload = JSON.parse(ResponseText);
      } catch(error) {
        throw new WpdbtkRagError('WPDBTK RAG returned invalid JSON.', 'invalid-response', Response.status);
      }
    }

    const RequestId = Response.headers.get('x-rag-request-id') || Payload?.diagnostics?.request_id || null;
    if(!Response.ok)
      throw BuildUpstreamError(Response.status, Payload, RequestId);

    if(typeof Payload?.answer !== 'string' || Payload.answer.trim().length === 0) {
      throw new WpdbtkRagError(
        'WPDBTK RAG response is missing a usable answer.',
        'invalid-response',
        Response.status,
        RequestId
      );
    }

    return {
      answer: Payload.answer.trim(),
      mode: typeof Payload.mode === 'string' ? Payload.mode : null,
      requestId: RequestId,
      diagnostics: Payload.diagnostics || null,
    };
  } catch(error) {
    if(error && error.name === 'AbortError')
      throw new WpdbtkRagError('WPDBTK RAG request timed out.', 'timeout');

    if(error instanceof WpdbtkRagError)
      throw error;

    throw new WpdbtkRagError(
      'Unable to reach the WPDBTK RAG service.',
      'network',
      null,
      null,
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(TimeoutId);
  }
}

module.exports = {
  AskQuestionAsync,
  GetWpdbtkRagConfiguration,
  IsWpdbtkRagEnabled,
  MaxQuestionLength,
  WpdbtkRagError,
};