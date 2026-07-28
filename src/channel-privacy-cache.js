
'use strict';

/**
 * Sentinel value returned when channel privacy cannot be resolved.
 */
const UNRESOLVED = Symbol('UNRESOLVED');

class ChannelPrivacyCache {
  /**
   * Internal cache map.
   * @type {Map<string, { IsPrivate: boolean, AtMs: number }>}
   */
  #cache = new Map();

  /**
   * Resolves channel privacy, using cached value if fresh.
   * @param {string} ArgChannelId Channel ID.
   * @param {function} ArgLiveResolver Live resolver function.
   * @param {number} ArgNowMs Current timestamp in milliseconds.
   * @param {number} ArgTtlMs Time to live in milliseconds.
   * @returns {Promise<boolean|symbol>}
   */
  async ResolvePrivacyAsync(ArgChannelId, ArgLiveResolver, ArgNowMs, ArgTtlMs = 3600000) {
    const cached = this.#cache.get(ArgChannelId);
    if (cached && (ArgNowMs - cached.AtMs) < ArgTtlMs) return cached.IsPrivate;

    try {
      const IsPrivate = await ArgLiveResolver(ArgChannelId);
      if (IsPrivate === true || IsPrivate === false) {
        this.#cache.set(ArgChannelId, { IsPrivate, AtMs: ArgNowMs });
        return IsPrivate;
      }
    } catch (error) {
      // do not store anything in the cache on error.
    }

    return UNRESOLVED;
  }
}

module.exports = {
  UNRESOLVED,
  ChannelPrivacyCache
};
