const { GetMapping } = require('../../product-compass');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

module.exports = {
  Name: 'lookback-bare',
  async Run(Context) {
    if (GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is Compass-mapped');
    const token = `canary-${Date.now()}-${Math.random()}`;
    const file = path.join(os.tmpdir(), `fix-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify({ marker: token }));
    await Context.Upload(file, 'bare', 'test.json');
    await Context.Mention('');
    const replies = await Context.Fixture.GetRepliesAsync();
    const loaded = replies.filter(r => r.text && r.text.includes("I've loaded"));
    Context.Expect(loaded.length === 1, 'exactly one "I\'ve loaded" post');
    Context.Expect(!replies.some(r => r.text && !r.text.includes("I've loaded") && r.text.includes(token)), 'no AI answer');
  }
};
