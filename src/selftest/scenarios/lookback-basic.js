const { GetMapping } = require('../../product-compass');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

module.exports = {
  Name: 'lookback-basic',
  /** @param {any} Context */
  async Run(Context) {
    if (GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is Compass-mapped');
    const token = `canary-${Date.now()}-${Math.random()}`;
    const file = path.join(os.tmpdir(), `fix-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify({ marker: token }));
    await Context.Upload(file, 'here is a file', 'test.json');
    const baseTs = await Context.Mention('what is the marker in the uploaded file?');
    const replies = await Context.Fixture.GetRepliesAsync();
    const later = replies.filter(/** @param {any} r */ r => Number(r.ts) > Number(baseTs));
    Context.Expect(later.some(/** @param {any} r */ r => r.text && r.text.includes(token)), 'answer quotes the fixture\'s unique canary token');
    Context.Expect(!later.some(/** @param {any} r */ r => r.text && r.text.includes("I've loaded")), 'no "I\'ve loaded" post');
    Context.Expect(Context.Fixture.DownloadCount() === 1, 'exactly one download of the fixture URL');
  }
};
