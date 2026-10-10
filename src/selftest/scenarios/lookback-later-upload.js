const { GetMapping } = require('../../product-compass');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

// #222 T4, normal-ordering control: a file uploaded AFTER the first answer is neither selected nor downloaded.
// This is NOT the delayed-event race: removing the strictly-earlier-ts filter in the look-back would go
// undetected here (delayed-event coverage stays pending in #222).
module.exports = {
  Name: 'lookback-later-upload',
  /** @param {any} Context */
  async Run(Context) {
    if (GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is Compass-mapped');
    const tokenA = `canary-a-${Date.now()}-${Math.random()}`;
    const tokenB = `canary-b-${Date.now()}-${Math.random()}`;
    const write = async (/** @type {string} */ name, /** @type {string} */ marker) => {
      const file = path.join(os.tmpdir(), `${Date.now()}-${name}`);
      await fs.writeFile(file, JSON.stringify({ file: name, marker }));
      return file;
    };
    const quotes = async (/** @type {string} */ baseTs, /** @type {string} */ token) => (await Context.Fixture.GetRepliesAsync())
      .some(/** @param {any} r */ r => Number(r.ts) > Number(baseTs) && r.text && r.text.includes(token));
    await Context.Upload(await write('old.json', tokenA), 'old file', 'old.json');
    const ts1 = await Context.Mention('what is the marker in the uploaded file?');
    Context.Expect(await quotes(ts1, tokenA), 'first answer quotes token A');
    await Context.Upload(await write('new.json', tokenB), 'new file', 'new.json');
    const ts2 = await Context.Mention('what is the marker in the uploaded file now?');
    Context.Expect(await quotes(ts2, tokenA), 'second answer still quotes token A');
    Context.Expect(!(await quotes('0', tokenB)), 'token B never appears in the thread');
    Context.Expect(Context.Fixture.DownloadCount() === 1, 'new.json was never downloaded');
  }
};
