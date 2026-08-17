'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs');

// Isolate test runtime data per worker process to prevent cross-process state races (GH-60).
// If SLEUTH_DATA_DIR is already explicitly set by the test runner / caller, respect it.
if(!process.env.SLEUTH_DATA_DIR || process.env.SLEUTH_DATA_DIR.trim().length === 0) {
  const WorkerId = process.env.JEST_WORKER_ID || '1';
  const IsolatedDir = path.join(os.tmpdir(), `sleuth-test-runtime-${WorkerId}-${process.pid}`);
  fs.mkdirSync(IsolatedDir, { recursive: true });
  const Subdirs = [
    'workspaces',
    path.join('workspaces', 'lists'),
    'reminders',
    'stats',
    'events',
    'context-memory',
    'client-project-map',
    'client-mapping-overlay',
    'shadow',
    'bugs',
    'decisions',
  ];
  for(const sub of Subdirs) {
    fs.mkdirSync(path.join(IsolatedDir, sub), { recursive: true });
  }
  process.env.SLEUTH_DATA_DIR = IsolatedDir;
}
