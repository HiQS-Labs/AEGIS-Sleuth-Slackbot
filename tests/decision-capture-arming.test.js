'use strict';

const RemindersAIPipeline = require('../src/reminders-ai-pipeline');

// GH-50 — the ARMING gate for decision capture.
//
// tests/reminders-decision-capture.test.js already proves that a pipeline WITH a capture config
// emits records. It proves nothing about whether production ever supplies one — and it did not:
// `SetDecisionCapture` had no caller outside tests, so the corpus was dead code everywhere it was
// deployed. These tests cover the gate that decides, which is the part that was missing.
//
// The corpus carries raw message text, so "default off" is a privacy property, not a preference.
// The first test is the one that must never go green by accident.

const ENABLED = 'DECISION_CAPTURE_ENABLED';
const ALLOWLIST = 'DECISION_CAPTURE_WORKSPACES';

/** Restore the env between cases so one test's flag cannot arm another's. */
let SavedEnabled;
let SavedAllowlist;

beforeEach(() => {
  SavedEnabled = process.env[ENABLED];
  SavedAllowlist = process.env[ALLOWLIST];
  delete process.env[ENABLED];
  delete process.env[ALLOWLIST];
});

afterEach(() => {
  if(SavedEnabled === undefined) delete process.env[ENABLED]; else process.env[ENABLED] = SavedEnabled;
  if(SavedAllowlist === undefined) delete process.env[ALLOWLIST]; else process.env[ALLOWLIST] = SavedAllowlist;
});

describe('GH-50 — decision capture is off unless an operator arms it', () => {
  test('unset means OFF — the default must never capture tenant text', () => {
    expect(RemindersAIPipeline.IsDecisionCaptureEnabled()).toBe(false);
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('acme')).toBe(false);
  });

  test('blank and whitespace-only are OFF, not "set"', () => {
    for(const Value of ['', '   ', '\t']) {
      process.env[ENABLED] = Value;
      expect(RemindersAIPipeline.IsDecisionCaptureEnabled()).toBe(false);
    }
  });

  test('an unrecognized token is OFF — a typo must fail closed, never open', () => {
    for(const Value of ['maybe', 'ON_PLEASE', '2', 'yess', 'off']) {
      process.env[ENABLED] = Value;
      expect(RemindersAIPipeline.IsDecisionCaptureEnabled()).toBe(false);
    }
  });

  test('the documented truthy tokens arm it', () => {
    for(const Value of ['on', 'true', '1', 'yes', 'enabled', 'ON', 'True']) {
      process.env[ENABLED] = Value;
      expect(RemindersAIPipeline.IsDecisionCaptureEnabled()).toBe(true);
    }
  });
});

describe('GH-50 — the per-workspace allowlist', () => {
  test('unset allowlist permits every workspace once the master flag is on', () => {
    process.env[ENABLED] = 'on';
    expect(RemindersAIPipeline.IsDecisionCaptureWorkspaceAllowed('acme')).toBe(true);
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('acme')).toBe(true);
  });

  test('a set allowlist excludes every workspace not named in it', () => {
    process.env[ENABLED] = 'on';
    process.env[ALLOWLIST] = 'acme,globex';
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('acme')).toBe(true);
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('globex')).toBe(true);
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('initech')).toBe(false);
  });

  test('allowlist entries tolerate surrounding whitespace', () => {
    process.env[ENABLED] = 'on';
    process.env[ALLOWLIST] = '  acme , globex  ';
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('acme')).toBe(true);
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('globex')).toBe(true);
  });

  test('matching is exact — a workspace whose name merely contains an allowed one is excluded', () => {
    process.env[ENABLED] = 'on';
    process.env[ALLOWLIST] = 'acme';
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('acme-staging')).toBe(false);
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('not-acme')).toBe(false);
  });

  test('the allowlist ALONE cannot arm capture — the master flag still governs', () => {
    // guards against a refactor that collapses the two gates into one: naming a workspace must
    // never be sufficient to start writing tenant text to disk.
    process.env[ALLOWLIST] = 'acme';
    expect(RemindersAIPipeline.IsDecisionCaptureEnabled()).toBe(false);
    expect(RemindersAIPipeline.IsDecisionCaptureArmedFor('acme')).toBe(false);
  });
});
