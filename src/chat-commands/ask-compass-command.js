const Compass = require('../product-compass');
/**
 * @param {import('../slack-app')} ArgSlackApp
 * @param {any} ArgEventInfo
 * @param {string} ArgQuery
 * @param {import('../workspace-ai')} ArgAI
 * @param {string|undefined} ArgModel
 * @param {() => Promise<string>} ArgContext
 */
async function HandleAskCompassCommandAsync(ArgSlackApp, ArgEventInfo, ArgQuery, ArgAI, ArgModel, ArgContext) {
  let Reply;
  try {
    if(!Compass.GetMapping(ArgSlackApp.WorkspaceInfo, ArgEventInfo.channel)) Reply = 'This channel is not mapped to a Product Compass team. Ask your administrator to configure it.';
    else Reply = await Compass.AskAsync(ArgSlackApp.WorkspaceInfo, ArgEventInfo.channel, ArgQuery, await ArgContext(), ArgAI, ArgModel);
  } catch(error) {
    const Code = error.code || 'context';
    ArgSlackApp.Logger.warn(`Product Compass workspace=${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME} channel=${ArgEventInfo.channel} failure=${Code}`);
    Reply = ['too-large', 'context-incomplete', 'context'].includes(Code)
      ? 'I could not load the complete context within the limit. Please start a new thread or narrow the attached document.'
      : Code === 'question' ? 'Please ask a question of up to 4,000 characters.'
        : Code === 'timeout' ? 'Product Compass took too long. Please try again with a narrower question.'
          : 'I could not safely retrieve Product Compass evidence. Please ask your administrator to check the connection and team mapping.';
  }
  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.thread_ts || ArgEventInfo.ts, Reply);
}
module.exports = HandleAskCompassCommandAsync;
