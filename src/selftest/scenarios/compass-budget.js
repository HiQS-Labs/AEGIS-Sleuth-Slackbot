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
    
    if (lastReply && lastReply.text) {
      const text = lastReply.text;
      const parts = text.split('Sources:');
      Context.Expect(parts.length >= 2, 'successful cited answer');
      if (parts.length >= 2) {
        Context.Expect(parts[0].trim().length > 0, 'has answer body');
        const hasExcs = parts.slice(1).join('Sources:').split('\n').some(/** @param {string} l */ l => l.startsWith('> ') && l.trim().length > 2);
        Context.Expect(hasExcs, 'non-empty citation block inside Sources');
      }
      let dup = false;
      const allExcs = text.split('\n').filter(/** @param {string} l */ l => l.startsWith('> ')).map(/** @param {string} l */ l => l.substring(2).trim());
      for (const exc of allExcs) if (text.indexOf(exc) !== text.lastIndexOf(exc)) dup = true;
      Context.Expect(!dup, 'no excerpt twice');
    } else {
      Context.Expect(false, 'successful cited answer');
    }
  }
};
