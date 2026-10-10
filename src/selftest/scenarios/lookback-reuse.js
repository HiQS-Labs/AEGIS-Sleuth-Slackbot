const { GetMapping } = require('../../product-compass');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// #222 T6: a second mention in the same thread reuses the loaded memory. The download count is the proof
// of reuse; quoting the canary alone is not, because earlier answers stay in the thread text.
module.exports = {
  Name: 'lookback-reuse',
  /** @param {any} Context */
  async Run(Context) {
    if (GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is Compass-mapped');
    const token = `canary-${Date.now()}-${Math.random()}`;
    const file = path.join(os.tmpdir(), `fix-${Date.now()}.json`);
    await fs.writeFile(file, JSON.stringify({ marker: token }));
    await Context.Upload(file, 'here is a file', 'test.json');
    for (const Question of ['what is the marker in the uploaded file?', 'what is the marker value again?']) {
      const baseTs = await Context.Mention(Question);
      const replies = await Context.Fixture.GetRepliesAsync();
      const later = replies.filter(/** @param {any} r */ r => Number(r.ts) > Number(baseTs));
      Context.Expect(later.some(/** @param {any} r */ r => r.text && r.text.includes(token)), `answer to "${Question}" quotes the canary`);
    }
    Context.Expect(Context.Fixture.DownloadCount() === 1, 'one download across both mentions');
  }
};
