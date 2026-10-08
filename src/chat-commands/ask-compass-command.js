
const compass = require('../product-compass');
/**
 * @param {import('../slack-app')} ArgSlackApp
 * @param {any} ArgEventInfo
 * @param {string} ArgQuery
 * @param {import('../workspace-ai')} ArgAI
 * @param {string|undefined} ArgModel
 * @param {() => Promise<string>} ArgContext
 */
async function HandleAskCompassCommandAsync(ArgSlackApp, ArgEventInfo, ArgQuery, ArgAI, ArgModel, ArgContext) {
  let reply;
  try {
    if(!compass.GetMapping(ArgSlackApp.WorkspaceInfo, ArgEventInfo.channel)) reply = 'This channel is not mapped to a Product Compass team. Ask your administrator to configure it.';
    else reply = await compass.AskAsync(ArgSlackApp.WorkspaceInfo, ArgEventInfo.channel, ArgQuery, await ArgContext(), ArgAI, ArgModel);
  } catch(error) {
    const code = error.code || 'context';
    ArgSlackApp.Logger.warn(`Product Compass workspace=${ArgSlackApp.WorkspaceInfo.WORKSPACE_NAME} channel=${ArgEventInfo.channel} failure=${code}`);
    reply = ['too-large', 'context-incomplete', 'context'].includes(code)
      ? 'The thread, attachment or retrieved evidence exceeds the context limit. Please start a new thread or narrow your question or document.'
      : code === 'question' ? 'Please ask a question of up to 4,000 characters.'
        : code === 'timeout' ? 'Product Compass took too long. Please try again with a narrower question.'
          : 'I could not safely retrieve Product Compass evidence. Please ask your administrator to check the connection and team mapping.';
  }
  await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.thread_ts || ArgEventInfo.ts, reply);
}
module.exports = HandleAskCompassCommandAsync;

