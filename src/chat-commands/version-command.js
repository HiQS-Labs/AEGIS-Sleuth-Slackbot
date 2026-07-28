'use strict';

const fs = require('fs').promises;
const path = require('path');

const PackageJsonPath = path.join(__dirname, '..', '..', 'package.json');

/**
 * @param {import('../slack-app')} ArgSlackApp
 * @param {import('../slack-app').AppMentionEventInfo} ArgEventInfo
 * @returns {Promise<void>}
 */
async function HandleVersionCommandAsync(ArgSlackApp, ArgEventInfo) {
  try {
    const PackageJson = JSON.parse(await fs.readFile(PackageJsonPath, 'utf-8'));
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, `Sleuth version ${PackageJson.version}`);
  } catch(error) {
    ArgSlackApp.Logger.error('failed to read version from package.json:', error);
    await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, 'Unable to retrieve version information.');
  }
}

module.exports = HandleVersionCommandAsync;
