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
});
