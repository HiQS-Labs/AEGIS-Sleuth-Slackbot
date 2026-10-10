const fs = require('fs').promises;
const path = require('path');
const { MockSlackApp } = require('./mocks/mock-slack-app');
const SelftestModule = require('../src/selftest/selftest-module');
const Runner = require('../src/selftest/runner');

jest.mock('../src/selftest/scenarios/pass.js', () => ({
  Name: 'pass',
  Run: async () => {}
}), { virtual: true });

jest.mock('../src/selftest/scenarios/fail.js', () => ({
  Name: 'fail',
  Run: async (Context) => { Context.Expect(false, 'failed assertion'); }
}), { virtual: true });

jest.mock('../src/selftest/scenarios/skip.js', () => ({
  Name: 'skip',
  Run: async (Context) => { Context.Skip('not applicable'); }
}), { virtual: true });

jest.mock('../src/selftest/scenarios/throw.js', () => ({
  Name: 'throw',
  Run: async () => { throw new Error('unexpected crash'); }
}), { virtual: true });

describe('SelftestModule', () => {
  let slackApp;

  beforeEach(() => {
    slackApp = new MockSlackApp();
    slackApp.UploadFileAsync = jest.fn();
  });

  test('factory returns null when env channel is unset', () => {
    const module = SelftestModule.Create(slackApp, undefined);
    expect(module).toBeNull();
  });

  test('refuses execution from wrong channel', async () => {
    const module = SelftestModule.Create(slackApp, 'C_QA');
    const handled = await slackApp.SimulateAppMentionAsync({
      channel: 'C_WRONG',
      text: '<@UBOT123> selftest all'
    });
    expect(handled).toBe(true);
    expect(slackApp.SentMessages).toContainEqual(expect.objectContaining({
      text: 'selftest is dev-only',
      channel: 'C_WRONG'
    }));
  });
});

describe('Runner', () => {
  let slackApp;
  
  beforeEach(() => {
    slackApp = new MockSlackApp();
    slackApp.UploadFileAsync = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('unknown scenario replies with list', async () => {
    jest.spyOn(fs, 'readdir').mockResolvedValue(['pass.js']);
    
    await Runner.RunScenariosAsync(slackApp, 'C_QA', null, 'nonexistent');
    
    expect(slackApp.SentMessages).toContainEqual(expect.objectContaining({
      text: 'unknown scenario. available: pass'
    }));
  });

  test('runner formats report for pass, fail, skip, throw', async () => {
    jest.spyOn(fs, 'readdir').mockResolvedValue(['pass.js', 'fail.js', 'skip.js', 'throw.js']);
    
    const mockChatModule = { ClearThreadMemoryAsync: jest.fn() };
    await Runner.RunScenariosAsync(slackApp, 'C_QA', mockChatModule, 'all');

    // Root messages for each scenario
    const roots = slackApp.SentMessages.filter(m => m.text.startsWith('selftest: running scenario'));
    expect(roots.length).toBe(4);

    // Final report
    const report = slackApp.SentMessages[slackApp.SentMessages.length - 1];
    expect(report.text).toContain('✅ pass — Passed');
    expect(report.text).toContain('❌ fail — Assertion failed: failed assertion (https://mock.slack.test');
    expect(report.text).toContain('⏭ skip — not applicable');
    expect(report.text).toContain('❌ throw — unexpected crash (https://mock.slack.test');
    expect(report.text).toContain('*Total: 4, ✅ 1, ❌ 2, ⏭ 1*');

    // Cleanup was called for all
    expect(mockChatModule.ClearThreadMemoryAsync).toHaveBeenCalledTimes(4);
  });

  test('cleanup runs on failure of scenario', async () => {
    jest.spyOn(fs, 'readdir').mockResolvedValue(['throw.js']);
    
    const mockChatModule = { ClearThreadMemoryAsync: jest.fn() };

    await Runner.RunScenariosAsync(slackApp, 'C_QA', mockChatModule, 'all');

    const report = slackApp.SentMessages[slackApp.SentMessages.length - 1];
    expect(report.text).toContain('❌ throw — unexpected crash');
    expect(mockChatModule.ClearThreadMemoryAsync).toHaveBeenCalledTimes(1);
  });
});
