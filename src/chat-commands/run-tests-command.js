const path = require('path');
const { spawn } = require('child_process');

const JestRunTimeoutMs = 5 * 60 * 1000;
const MaxJestOutputChars = 50000;

/**
 * Spawn `npm test` for the workspace, buffer the trailing portion of stdout/stderr, and
 * return the final summary message. Internal helper for HandleRunTestsCommandAsync.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {(ExitCode:number|null, DurationMs:number, StdoutText:string, StderrText:string, DidTimeOut:boolean) => string} ArgBuildJestResultMessage
 *   Formats the final Slack message — supplied by chat-module so the formatter statics on
 *   ChatModule (which are tested directly) stay in one place.
 * @returns {Promise<void>}
 */
async function RunJestSuiteAsync(ArgSlackApp, ArgEventInfo, ArgBuildJestResultMessage) {
  const RepoRootPath = path.join(__dirname, '..', '..');
  const NpmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const StartedOnMs = Date.now();

  const Result = await new Promise((resolve, reject) => {
    const JestProcess = spawn(NpmCommand, ['test'], {
      cwd: RepoRootPath,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let StdoutText = '';
    let StderrText = '';
    let DidTimeOut = false;
    /** @type {NodeJS.Timeout|null} */
    let KillEscalationHandle = null;

    /** @type {NodeJS.Timeout} */
    const TimeoutHandle = setTimeout(() => {
      DidTimeOut = true;
      ArgSlackApp.Logger.error(`[jest-runner] Jest suite timed out after ${JestRunTimeoutMs} ms`);
      JestProcess.kill('SIGTERM');

      KillEscalationHandle = setTimeout(() => {
        JestProcess.kill('SIGKILL');
      }, 5000);
    }, JestRunTimeoutMs);

    /**
     * @param {string} ArgCurrentText
     * @param {Buffer|string} ArgChunk
     * @returns {string}
     */
    const AppendOutputText = (ArgCurrentText, ArgChunk) => {
      const NextText = `${ArgCurrentText}${ArgChunk.toString()}`;
      if(NextText.length <= MaxJestOutputChars) return NextText;
      return NextText.slice(-MaxJestOutputChars);
    };

    JestProcess.stdout.on('data', (ArgChunk) => {
      StdoutText = AppendOutputText(StdoutText, ArgChunk);
    });

    JestProcess.stderr.on('data', (ArgChunk) => {
      StderrText = AppendOutputText(StderrText, ArgChunk);
    });

    JestProcess.once('error', (error) => {
      clearTimeout(TimeoutHandle);
      if(KillEscalationHandle) clearTimeout(KillEscalationHandle);
      reject(error);
    });

    JestProcess.once('close', (ArgExitCode, ArgSignal) => {
      clearTimeout(TimeoutHandle);
      if(KillEscalationHandle) clearTimeout(KillEscalationHandle);

      resolve({
        ExitCode: ArgExitCode,
        Signal: ArgSignal,
        StdoutText,
        StderrText,
        DidTimeOut,
      });
    });
  });

  const DurationMs = Date.now() - StartedOnMs;
  const FinalMessage = ArgBuildJestResultMessage(
    Result.ExitCode,
    DurationMs,
    Result.StdoutText,
    Result.StderrText,
    Result.DidTimeOut
  );

  if(Result.StdoutText.trim())
    ArgSlackApp.Logger.info(`[jest-runner] stdout for ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME}:\n${Result.StdoutText}`);

  if(Result.StderrText.trim())
    ArgSlackApp.Logger.error(`[jest-runner] stderr for ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME}:\n${Result.StderrText}`);

  ArgSlackApp.Logger.info(
    `[jest-runner] completed Jest suite for workspace ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME} ` +
    `requested by ${ArgEventInfo.user} with exit code ${Result.ExitCode} and signal ${Result.Signal || 'none'}`
  );

  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, FinalMessage);
}

/**
 * Handle the `run-tests` admin command — kicks off the Jest suite in the background and posts
 * results when it completes. A run-already-in-flight check uses the JestState callbacks below
 * so the active-run state stays owned by chat-module rather than this handler.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @param {{ IsActive: () => boolean, TrackRun: (ArgPromise: Promise<*>) => void }} ArgJestState
 *   IsActive returns whether a Jest run is already in flight; TrackRun stores the in-flight
 *   promise on chat-module so subsequent invocations can reject early.
 * @param {(ExitCode:number|null, DurationMs:number, StdoutText:string, StderrText:string, DidTimeOut:boolean) => string} ArgBuildJestResultMessage
 *   Final message formatter (ChatModule.BuildJestResultMessage).
 * @returns {Promise<void>}
 */
async function HandleRunTestsCommandAsync(ArgSlackApp, ArgEventInfo, ArgJestState, ArgBuildJestResultMessage) {
  const HasAccess = await ArgSlackApp.IsAdminOrOwnerAsync(ArgEventInfo.user);
  if(!HasAccess) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'sorry, only workspace admins or owners can run the Jest suite.'
    );
    return;
  }

  if(ArgJestState.IsActive()) {
    await ArgSlackApp.PostMessageTextAsync(
      ArgEventInfo.channel,
      ArgEventInfo.ts,
      'Jest test suite is already running. Please wait for the current run to finish.'
    );
    return;
  }

  await ArgSlackApp.PostMessageTextAsync(
    ArgEventInfo.channel,
    ArgEventInfo.ts,
    'Jest test suite running. Results will be posted here when the suite completes.'
  );

  ArgSlackApp.Logger.info(
    `[jest-runner] starting Jest suite for workspace ${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME} requested by ${ArgEventInfo.user}`
  );

  const RunPromise = RunJestSuiteAsync(ArgSlackApp, ArgEventInfo, ArgBuildJestResultMessage)
    .catch(async (error) => {
      ArgSlackApp.Logger.error('[jest-runner] failed during Jest run:', error);
      try {
        await ArgSlackApp.PostMessageTextAsync(
          ArgEventInfo.channel,
          ArgEventInfo.ts,
          'Jest suite failed to run. Check application logs for details.'
        );
      } catch(postError) {
        ArgSlackApp.Logger.error('[jest-runner] failed to post Jest error message:', postError);
      }
    });

  ArgJestState.TrackRun(RunPromise);
}

module.exports = HandleRunTestsCommandAsync;
