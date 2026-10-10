const { GetMapping } = require('../../product-compass');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

module.exports = {
  Name: 'lookback-command',
  async Run(Context) {
    if (GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is Compass-mapped');
    const token = `canary-${Date.now()}-${Math.random()}`;
    const file = path.join(os.tmpdir(), `fix-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify({ marker: token }));
    await Context.Upload(file, 'command', 'test.json');
    await Context.Mention('show-channel-model');
    const replies = await Context.Fixture.GetRepliesAsync();
    Context.Expect(replies.some(r => r.text && r.text.includes("Verified answer")), 'model status reply');
    Context.Expect(!replies.some(r => r.text && r.text.includes(token)), 'not AI chat');
  }
};
