'use strict';

const { ChannelMembershipCache, UNRESOLVED } = require('../src/channel-membership-cache');

describe('ChannelMembershipCache', () => {
  test('fresh hit returns cached value without calling resolver', async () => {
    const cache = new ChannelMembershipCache();
    const resolver = jest.fn().mockResolvedValue(true);

    const res1 = await cache.ResolveMembershipAsync('C1', 'U1', resolver, 1000, 5000);
    expect(res1).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);

    const res2 = await cache.ResolveMembershipAsync('C1', 'U1', resolver, 3000, 5000);
    expect(res2).toBe(true);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  test('caches per (channel, user) pair — different users do not collide', async () => {
    const cache = new ChannelMembershipCache();
    const resolver = jest.fn()
      .mockResolvedValueOnce(true)   // C1/U1
      .mockResolvedValueOnce(false); // C1/U2

    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver, 1000, 5000)).toBe(true);
    expect(await cache.ResolveMembershipAsync('C1', 'U2', resolver, 1000, 5000)).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2);

    // both are now warm.
    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver, 2000, 5000)).toBe(true);
    expect(await cache.ResolveMembershipAsync('C1', 'U2', resolver, 2000, 5000)).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  test('stale entry refetches and updates cache', async () => {
    const cache = new ChannelMembershipCache();
    const resolver = jest.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver, 1000, 5000)).toBe(false);
    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver, 7000, 5000)).toBe(true); // age 6000 >= 5000
    expect(resolver).toHaveBeenCalledTimes(2);
  });

  test('resolver error returns UNRESOLVED and does not cache (fail-closed)', async () => {
    const cache = new ChannelMembershipCache();
    const resolver = jest.fn().mockRejectedValue(new Error('Slack API down'));

    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver, 1000, 5000)).toBe(UNRESOLVED);

    const resolver2 = jest.fn().mockResolvedValue(true);
    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver2, 2000, 5000)).toBe(true);
    expect(resolver2).toHaveBeenCalledTimes(1); // nothing cached from the failed call
  });

  test('resolver returning null returns UNRESOLVED and does not cache', async () => {
    const cache = new ChannelMembershipCache();
    const resolver = jest.fn().mockResolvedValue(null);

    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver, 1000, 5000)).toBe(UNRESOLVED);

    const resolver2 = jest.fn().mockResolvedValue(false);
    expect(await cache.ResolveMembershipAsync('C1', 'U1', resolver2, 2000, 5000)).toBe(false);
    expect(resolver2).toHaveBeenCalledTimes(1);
  });
});
