'use strict';

const path = require('path');
const fs = require('fs');
const workspaces = require('../src/workspaces');

describe('GH-60: Test Suite Runtime Data Isolation', () => {
  const RepoRuntimeDir = path.resolve(path.join(__dirname, '..', 'data', 'runtime'));

  test('SLEUTH_DATA_DIR is active and points to an isolated directory outside repo data/runtime', () => {
    expect(process.env.SLEUTH_DATA_DIR).toBeDefined();
    expect(process.env.SLEUTH_DATA_DIR.length).toBeGreaterThan(0);

    const CurrentRuntimeDir = workspaces.GetRuntimeDirPath();
    expect(CurrentRuntimeDir).toBe(path.resolve(process.env.SLEUTH_DATA_DIR));
    expect(CurrentRuntimeDir).not.toBe(RepoRuntimeDir);
  });

  test('workspaces.GetDirPath returns workspaces subdir inside isolated SLEUTH_DATA_DIR', () => {
    const WorkspaceDir = workspaces.GetDirPath();
    expect(WorkspaceDir).toBe(path.join(workspaces.GetRuntimeDirPath(), 'workspaces'));
  });

  test('workspaces.GetSubdirPath returns correctly nested paths inside isolated SLEUTH_DATA_DIR', () => {
    const RemindersDir = workspaces.GetSubdirPath('reminders');
    expect(RemindersDir).toBe(path.join(workspaces.GetRuntimeDirPath(), 'reminders'));

    const FilePath = workspaces.GetSubdirPath('events', 'acme_events.jsonl');
    expect(FilePath).toBe(path.join(workspaces.GetRuntimeDirPath(), 'events', 'acme_events.jsonl'));
  });

  test('no test writes occur directly in repo data/runtime directory', () => {
    function FindRepoRuntimeFiles(dir) {
      if(!fs.existsSync(dir)) return [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      let files = [];
      for(const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if(entry.isDirectory()) {
          files = files.concat(FindRepoRuntimeFiles(fullPath));
        } else if(entry.isFile() && !entry.name.startsWith('.git')) {
          files.push(fullPath);
        }
      }
      return files;
    }

    const FoundFiles = FindRepoRuntimeFiles(RepoRuntimeDir);
    expect(FoundFiles).toEqual([]);
  });

  test('GH-271: the worker dir is always a fresh per-worker temp dir, never an inherited one', () => {
    // runtime-setup.js no longer honours a pre-set SLEUTH_DATA_DIR (it may be a live server dir).
    const RuntimeDir = workspaces.GetRuntimeDirPath();
    expect(path.dirname(RuntimeDir)).toBe(path.resolve(require('os').tmpdir()));
    expect(path.basename(RuntimeDir)).toMatch(/^sleuth-test-runtime-\w+-\d+$/);
  });
});

describe('GH-271: AssertNotLiveRuntimeDir', () => {
  const WorkerDataDir = process.env.SLEUTH_DATA_DIR;
  let MarkedDir;

  beforeEach(() => {
    MarkedDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sleuth-live-marker-'));
    process.env.SLEUTH_DATA_DIR = MarkedDir;
  });

  afterEach(() => {
    process.env.SLEUTH_DATA_DIR = WorkerDataDir;
    fs.rmSync(MarkedDir, { recursive: true, force: true });
  });

  test('refuses a runtime root carrying the .live-data marker', () => {
    fs.writeFileSync(path.join(MarkedDir, '.live-data'), '');
    expect(() => workspaces.AssertNotLiveRuntimeDir('some-harness')).toThrow(/some-harness: refusing to run against live data/);
  });

  test('allows an unmarked runtime root', () => {
    expect(() => workspaces.AssertNotLiveRuntimeDir('some-harness')).not.toThrow();
  });
});
