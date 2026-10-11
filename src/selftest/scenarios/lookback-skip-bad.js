const { GetMapping } = require('../../product-compass');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

module.exports = {
  Name: 'lookback-skip-bad',
  /** @param {any} Context */
  async Run(Context) {
    if (GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is Compass-mapped');
    const file = path.join(os.tmpdir(), `fix-${Date.now()}.txt`);
    const content = 'a'.repeat(250 * 1024);
    await fs.writeFile(file, content);
    const Up = await Context.Upload(file, 'large', 'large.txt');
    Context.Expect(!!(Up && Up.File && (Up.File.url_private_download || Up.File.url_private)), 'upload returned a tracked URL');
    const baseTs = await Context.Mention('what is the marker?');
    const replies = await Context.Fixture.GetRepliesAsync();
    const later = replies.filter(/** @param {any} r */ r => Number(r.ts) > Number(baseTs));
    Context.Expect(!later.some(/** @param {any} r */ r => r.text && r.text.includes('too large')), 'no "too large" post');
    Context.Expect(later.length > 0 && later.some(/** @param {any} r */ r => r.text && r.text.trim().length > 0), 'normal answer');
    Context.Expect(Context.Fixture.DownloadCount() === 0, 'no download of the oversized file');
  }
};
