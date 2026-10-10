'use strict';

/**
 * GH-225: one thread read per chat event, shared by every automatic consumer.
 *
 * The hands-free dispatcher, the GH-219 earlier-file look-back, Compass and the chat context
 * builder each used to call `SlackApp.GetConversationMessagesAsync` on their own and decide their
 * own page policy inline. This provider wraps that same reader and memoises the in-flight promise
 * for the lifetime of the inbound event object: a `WeakMap` keyed by the event (one Bolt delivery =
 * one object) holds a small `Map` keyed `threadTs:maxPages`. Nothing outlives the delivery, a
 * redelivered event is a new object and reads afresh, and there is no cap or TTL to tune.
 *
 * The underlying reader is untouched, so the selftest runner's shadow and the jest mocks keep
 * counting real reads.
 */

/** @type {WeakMap<object, Map<string, Promise<{Messages: any[], Complete: boolean}>>>} */
const MemoByEvent = new WeakMap();

/**
 * Read a thread once per event.
 * @param {object} ArgSlackApp Slack app whose `GetConversationMessagesAsync` performs the read.
 * @param {{channel: string, ts: string}} ArgEvent The inbound event the read is for; its identity is
 *   the memo lifetime and, when bounded, its `ts` is Slack's `latest`.
 * @param {string} ArgThreadTs Thread root timestamp.
 * @param {{MaxPages?: number}} [ArgOptions] `MaxPages` opts into the bounded complete read;
 *   omitted means the legacy single unbounded call.
 * @returns {Promise<{Messages: any[], Complete: boolean}>} `Complete` is false only when the bounded
 *   read hit `context-incomplete`; `Messages` is then empty. Every other error rejects as before
 *   and is not memoised, so a later consumer may retry.
 */
function GetThreadAsync(ArgSlackApp, ArgEvent, ArgThreadTs, ArgOptions = {}) {
  const { MaxPages } = ArgOptions;
  let Memo = MemoByEvent.get(ArgEvent);
  if(!Memo) {
    Memo = new Map();
    MemoByEvent.set(ArgEvent, Memo);
  }
  const Key = `${ArgThreadTs}:${MaxPages ?? 0}`;
  let Pending = Memo.get(Key);
  if(Pending) return Pending;

  Pending = (async () => {
    try {
      const Messages = await ArgSlackApp.GetConversationMessagesAsync(
        ArgEvent.channel, ArgThreadTs, MaxPages ? { MaxPages, Latest: ArgEvent.ts } : undefined
      );
      return { Messages, Complete: true };
    } catch(error) {
      if(error?.code === 'context-incomplete') return { Messages: [], Complete: false };
      Memo.delete(Key);
      throw error;
    }
  })();
  Memo.set(Key, Pending);
  return Pending;
}

module.exports = { GetThreadAsync };
