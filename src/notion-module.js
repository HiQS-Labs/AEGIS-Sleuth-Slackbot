// import required modules.
const { Client } = require('@notionhq/client');
const SlackApp = require('./slack-app');

/**
 * Allows Slack users to search a linked Notion workspace.
 */
class NotionModule {
  /**
   * Slack app instance.
   * @type {SlackApp}
   */
  #SlackApp;

  /**
   * Notion client instance or null when token is missing.
   * @type {Client|null}
   */
  #NotionClient;

  /**
   * Was the Notion connectivity test successful?
   * @type {boolean|null}
   */
  #Connectivity = null;

  /**
   * Initialize a new instance with the given Slack app.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   */
  constructor(ArgSlackApp) {
    this.#SlackApp = ArgSlackApp;
    const token = this.#SlackApp.WorkspaceInfo.NOTION_TOKEN;
    this.#NotionClient = token ? new Client({ auth: token }) : null;
    this.#SlackApp.HandleAppMention(this.#OnAppMentionAsync.bind(this));
  }

  /**
   * Check Notion connectivity if token is configured.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async TestConnectivityAsync() {
    if(!this.#NotionClient) return { ok: true };
    try {
      await this.#NotionClient.search({ query: 'test', page_size: 1 });
      return { ok: true };
    } catch(error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Initialize module.
   * @returns {Promise<void>}
   */
  async StartAsync() {
    const Result = await this.TestConnectivityAsync();
    this.#Connectivity = Result.ok;
    if(Result.ok) this.#SlackApp.Logger.info('Notion API connectivity test succeeded.');
    else this.#SlackApp.Logger.error('Notion API connectivity test failed:', Result.error);
  }

  /**
   * Handle Slack app mention event.
   * @param {SlackApp} ArgSlackApp Slack app instance.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Event info.
   * @returns {Promise<boolean>}
   */
  async #OnAppMentionAsync(ArgSlackApp, ArgEventInfo) {
    if(!this.#NotionClient) return false;

    const CleanText = ArgEventInfo.text.replace(ArgSlackApp.AppMentionString, '').trim();
    const Patterns = [
      /notion\s+search\s+(.+)/i,
      /search\s+notion\s+(?:for\s+)?(.+)/i
    ];
    let QueryMatch = null;
    for(const pat of Patterns) {
      const m = CleanText.match(pat);
      if(m) { QueryMatch = m; break; }
    }
    if(!QueryMatch) return false;

    const Query = QueryMatch[1];
    try {
      const SearchResp = await this.#NotionClient.search({ query: Query });
      const Results = SearchResp.results;
      if(Results.length === 0) {
        await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, 'No results found.');
        return true;
      }
      const Lines = Results.slice(0, 5).map(
        /** @param {any} Res */
        (Res) => {
        let title = '';
        if(Res.object === 'page' && Res.properties) {
          for(const key in Res.properties) {
            const prop = Res.properties[key];
            if(prop.type === 'title') {
              title = prop.title.map(
                /** @param {any} t */
                (t) => t.plain_text
              ).join('');
              break;
            }
          }
        }
        if(!title) title = Res.url;
        return `• <${Res.url}|${title}>`;
      });
      const MessageText = Lines.join('\n');
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, MessageText);
    } catch(error) {
      ArgSlackApp.Logger.error('Notion search error:', error);
      await ArgSlackApp.PostMessageTextAsync(ArgEventInfo.channel, ArgEventInfo.ts, 'Notion search failed.');
    }
    return true;
  }
}

module.exports = NotionModule;
