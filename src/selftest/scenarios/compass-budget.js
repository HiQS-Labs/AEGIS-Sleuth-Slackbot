// Question: What's new in release 1.65?
const { GetMapping } = require('../../product-compass');

module.exports = {
  Name: 'compass-budget',
  /** @param {any} Context */
  async Run(Context) {
    if (!GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is not Compass-mapped');
    const baseTs = await Context.Mention("What's new in release 1.65?");
    const replies = await Context.Fixture.GetRepliesAsync();
    const calls = Context.Fixture.GetConversationMessagesCalls();
    
    Context.Expect(calls.length === 1, 'exactly one in-scope reply read');
    if (calls.length > 0) Context.Expect(calls[0].MaxPages !== undefined && calls[0].MaxPages <= 5, 'with MaxPages <= 5');
    
    const later = replies.filter(/** @param {any} r */ r => Number(r.ts) > Number(baseTs));
    const lastReply = later[later.length - 1];
    Context.Expect(lastReply && lastReply.text && lastReply.text.includes('Sources:'), 'successful cited answer');
    
    if (lastReply && lastReply.text) {
      const text = lastReply.text;
      const excerpts = text.split('\n')
        .filter(/** @param {string} l */ l => l.startsWith('> '))
        .map(/** @param {string} l */ l => l.substring(2).trim())
        .filter(/** @param {string} e */ e => e.length > 0);
      Context.Expect(excerpts.length > 0, 'non-empty citation block');
      
      let dup = false;
      for (const exc of excerpts) if (text.indexOf(exc) !== text.lastIndexOf(exc)) dup = true;
      Context.Expect(!dup, 'no excerpt twice');
    }
  }
};
