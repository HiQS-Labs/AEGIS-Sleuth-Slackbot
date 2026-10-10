// Question: What's new in release 1.65?
const { GetMapping } = require('../../product-compass');

module.exports = {
  Name: 'compass-budget',
  async Run(Context) {
    if (!GetMapping(Context.SlackApp.WorkspaceInfo, Context.Channel)) Context.Skip('channel is not Compass-mapped');
    await Context.Mention("What's new in release 1.65?");
    const replies = await Context.Fixture.GetRepliesAsync();
    const calls = Context.Fixture.GetConversationMessagesCalls();
    
    const readCalls = calls.filter(c => c && c.MaxPages !== undefined);
    Context.Expect(readCalls.length === 1, 'exactly one in-scope reply read');
    Context.Expect(readCalls[0].MaxPages <= 5, 'with MaxPages <= 5');
    
    const lastReply = replies[replies.length - 1];
    Context.Expect(lastReply && lastReply.text && lastReply.text.includes('Sources:'), 'successful cited answer');
    
    if (lastReply && lastReply.text) {
      const lines = lastReply.text.split('\n');
      const excerpts = lines.filter(l => l.startsWith('> '));
      const uniqueExcerpts = new Set(excerpts);
      Context.Expect(excerpts.length === uniqueExcerpts.size, 'no excerpt twice');
    }
  }
};
