const { GetMapping } = require('../../product-compass');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

module.exports = {
  Name: 'lookback-skip-bad',
  async Run(Context) {
    if (GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is Compass-mapped');
    const file = path.join(os.tmpdir(), `fix-${Date.now()}.txt`);
    const content = 'a'.repeat(250 * 1024);
    await fs.writeFile(file, content);
    await Context.Upload(file, 'large', 'large.txt');
    await Context.Mention('what is the marker?');
    const replies = await Context.Fixture.GetRepliesAsync();
    Context.Expect(!replies.some(r => r.text && r.text.includes('too large')), 'no "too large" post');
    const lastReply = replies[replies.length - 1];
    Context.Expect(lastReply && lastReply.user !== 'U_SLEUTH_SELFTEST', 'normal answer');
  }
};
