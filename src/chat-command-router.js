/**
 * Lightweight registry for chat command routing. Built so that adding a new chat command means
 * registering one route entry rather than editing a long if/else chain in two places (the
 * dispatcher and the diagnostic route describer).
 *
 * @typedef {Object} CommandRoute
 * @property {RegExp|((ArgStrippedText: string, ArgEventInfo: import('./slack-app').AppMentionEventInfo) => (Array<*>|null))} Pattern
 *   Either a RegExp matched against the mention-stripped command text, or a function returning
 *   the captured arguments array (or null when the route does not match). RegExp capture groups
 *   (1+) are passed positionally to the handler.
 * @property {RegExp|((ArgStrippedText: string, ArgEventInfo: import('./slack-app').AppMentionEventInfo) => boolean)} [DescribePattern]
 *   Optional looser pattern used only by DescribeRoute. When present, DescribeRoute uses it
 *   instead of Pattern so route classification can stay generous (e.g. match `switch-models:` by
 *   prefix) while dispatch stays strict (e.g. require the full `switch-models:'<model>'` format).
 *   Falls back to Pattern when omitted.
 * @property {string} Route Stable route name returned from DescribeRoute and used in diagnostics.
 * @property {(ArgEventInfo: import('./slack-app').AppMentionEventInfo, ...ArgCaptures: *[]) => Promise<void>} Handle
 *   Async handler invoked when the pattern matches. Receives the original event info plus any
 *   captured args.
 */

class CommandRouter {
  /** @type {CommandRoute[]} */
  #Routes = [];

  /**
   * Register a route. Routes are evaluated in registration order — earlier registrations win,
   * so register more specific patterns (e.g. `web-search-advanced`) before broader ones
   * (e.g. `web-search`).
   * @param {CommandRoute} ArgEntry
   */
  Register(ArgEntry) {
    this.#Routes.push(ArgEntry);
  }

  /**
   * Return a snapshot of all registered routes in order.
   * @returns {CommandRoute[]}
   */
  GetRoutes() {
    return [...this.#Routes];
  }

  /**
   * Find the first matching route for the supplied text and run its handler.
   * @param {string} ArgStrippedText Mention-stripped command text.
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo Original Slack event info.
   * @returns {Promise<boolean>} True when a route handled the command.
   */
  async RouteAsync(ArgStrippedText, ArgEventInfo) {
    const Matched = this.#FindMatch(ArgStrippedText, ArgEventInfo);
    if(!Matched) return false;
    await Matched.Entry.Handle(ArgEventInfo, ...Matched.Captures);
    return true;
  }

  /**
   * Find the first matching route's name without executing its handler.
   * @param {string} ArgStrippedText Mention-stripped command text.
   * @param {import('./slack-app').AppMentionEventInfo} [ArgEventInfo] Original Slack event info.
   *   Optional — only required when classifying a route whose DescribePattern is a function that
   *   reads from it (none of the current routes do).
   * @returns {string|null}
   */
  DescribeRoute(ArgStrippedText, ArgEventInfo) {
    for(const Entry of this.#Routes) {
      if(this.#DescribeMatches(Entry, ArgStrippedText, ArgEventInfo)) return Entry.Route;
    }
    return null;
  }

  /**
   * Strict route classification WITHOUT executing the handler: returns the name of the first route
   * whose (strict) `Pattern` matches, or null. Unlike DescribeRoute — which uses the looser
   * DescribePattern — this mirrors exactly what RouteAsync would dispatch, so callers needing the
   * real would-execute outcome (e.g. the GH-397 router-shadow corpus) get an honest, side-effect-free
   * signal.
   * @param {string} ArgStrippedText Mention-stripped command text.
   * @param {import('./slack-app').AppMentionEventInfo} [ArgEventInfo] Original Slack event info.
   * @returns {string|null}
   */
  MatchRouteName(ArgStrippedText, ArgEventInfo) {
    const Matched = this.#FindMatch(ArgStrippedText, /** @type {any} */ (ArgEventInfo));
    return Matched ? Matched.Entry.Route : null;
  }

  /**
   * Test whether a route matches under its DescribePattern (or Pattern when no DescribePattern is
   * set). Used solely by DescribeRoute — we deliberately do not invoke handlers here.
   * @param {CommandRoute} ArgEntry
   * @param {string} ArgStrippedText
   * @param {import('./slack-app').AppMentionEventInfo} [ArgEventInfo]
   * @returns {boolean}
   */
  #DescribeMatches(ArgEntry, ArgStrippedText, ArgEventInfo) {
    const Pattern = ArgEntry.DescribePattern ?? ArgEntry.Pattern;
    if(Pattern instanceof RegExp) return Pattern.test(ArgStrippedText);
    if(typeof Pattern === 'function') return !!Pattern(ArgStrippedText, ArgEventInfo);
    return false;
  }

  /**
   * @param {string} ArgStrippedText
   * @param {import('./slack-app').AppMentionEventInfo} ArgEventInfo
   * @returns {{ Entry: CommandRoute, Captures: *[] }|null}
   */
  #FindMatch(ArgStrippedText, ArgEventInfo) {
    for(const Entry of this.#Routes) {
      let Captures = null;
      if(Entry.Pattern instanceof RegExp) {
        const Match = ArgStrippedText.match(Entry.Pattern);
        if(Match) Captures = Match.slice(1);
      } else if(typeof Entry.Pattern === 'function') {
        Captures = Entry.Pattern(ArgStrippedText, ArgEventInfo);
      }
      if(Captures) return { Entry, Captures };
    }
    return null;
  }
}

module.exports = { CommandRouter };
