'use strict';

const { BuildErrorReportAsync } = require('../diagnostics-report');

/**
 * Acknowledge the retired Slack test-suite command without allowing production test execution.
 *
 * @param {import('../slack-app')} ArgSlackApp Slack app instance.
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo Event information.
 * @returns {Promise<void>}
 */
async function HandleTestSuiteUnavailableCommandAsync(ArgSlackApp, ArgEventInfo) {
  const ErrorText = await BuildErrorReportAsync(
    ArgSlackApp,
    ArgEventInfo.channel,
    'Sorry, we cannot run the test suite.'
  );
  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, ErrorText);
}

module.exports = HandleTestSuiteUnavailableCommandAsync;
