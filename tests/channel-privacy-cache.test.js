
'use strict';

const { ChannelPrivacyCache, UNRESOLVED } = require('../src/channel-privacy-cache');

describe('ChannelPrivacyCache', () => {
  test('fresh hit returns cached value without calling resolver', async () => {
    const cache = new ChannelPrivacyCache();
    const resolver = jest.fn().mockResolvedValue(true);

    // first call: miss, populates cache.
    const res1 = await cache.ResolvePrivacyAsync('C1', resolver, 1000, 5000);
    expect(res1).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);

    // second call: fresh hit, age 2000 < 5000.
    const res2 = await cache.ResolvePrivacyAsync('C1', resolver, 3000, 5000);
    expect(res2).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  test('miss calls resolver and caches result', async () => {
    const cache = new ChannelPrivacyCache();
    const resolver = jest.fn().mockResolvedValue(false);

    const res1 = await cache.ResolvePrivacyAsync('C1', resolver, 1000, 5000);
    expect(res1).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  test('stale entry calls resolver again and updates cache', async () => {
    const cache = new ChannelPrivacyCache();
    const resolver = jest.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    // first call: age 0, caches true.
    const res1 = await cache.ResolvePrivacyAsync('C1', resolver, 1000, 5000);
    expect(res1).toBe(true);

    // second call: age 6000 >= 5000 (stale), refetches and gets false.
    const res2 = await cache.ResolvePrivacyAsync('C1', resolver, 7000, 5000);
    expect(res2).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2);

    // third call: age 1000 < 5000, hit for the updated false value.
    const res3 = await cache.ResolvePrivacyAsync('C1', resolver, 8000, 5000);
    expect(res3).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  test('resolver error returns UNRESOLVED and does not cache', async () => {
    const cache = new ChannelPrivacyCache();
    const resolver = jest.fn().mockRejectedValue(new Error('Slack API down'));

    const res1 = await cache.ResolvePrivacyAsync('C1', resolver, 1000, 5000);
    expect(res1).toBe(UNRESOLVED);
    expect(resolver).toHaveBeenCalledTimes(1);

    // second call: still calls resolver because nothing was cached.
    const resolver2 = jest.fn().mockResolvedValue(true);
    const res2 = await cache.ResolvePrivacyAsync('C1', resolver2, 2000, 5000);
    expect(res2).toBe(true);
    expect(resolver2).toHaveBeenCalledTimes(1);
  });

  test('resolver returning null returns UNRESOLVED and does not cache', async () => {
    const cache = new ChannelPrivacyCache();
    const resolver = jest.fn().mockResolvedValue(null);

    const res1 = await cache.ResolvePrivacyAsync('C1', resolver, 1000, 5000);
    expect(res1).toBe(UNRESOLVED);
    expect(resolver).toHaveBeenCalledTimes(1);

    // second call: still calls resolver because null is not cached.
    const resolver2 = jest.fn().mockResolvedValue(false);
    const res2 = await cache.ResolvePrivacyAsync('C1', resolver2, 2000, 5000);
    expect(res2).toBe(false);
    expect(resolver2).toHaveBeenCalledTimes(1);
  });
});
