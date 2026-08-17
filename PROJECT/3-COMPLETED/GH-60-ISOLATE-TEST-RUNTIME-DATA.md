# GH-60: Isolate test runtime data across Jest workers (prevent cross-process races)

**Status:** COMPLETED  
**Issue:** [#60](https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/60) (Ported from NeochromeTeam/sleuth-app#435)  
**Branch:** `gh-60-isolate-test-runtime-data`  
**Parent branch:** `development`  

---

## 1. Problem Statement & Background

Jest runs test suites across multiple parallel worker processes (`npx jest --maxWorkers=100%`). Currently, several modules and test suites write directly to the checked-in `data/runtime/` tree:
- `data/runtime/events/<workspace>_events.jsonl`
- `data/runtime/context-memory/<workspace>_thread_memory.json`
- `data/runtime/workspaces/lists/<workspace>_lists_cache.json`
- `data/runtime/client-project-map/default.json`
- `data/runtime/reminders/<workspace>_trashed_examples.jsonl`
- `data/runtime/shadow/<workspace>_router-shadow.jsonl`

When parallel test workers execute concurrently, worker A may overwrite, mutate, or delete files that worker B is reading mid-assertion, producing silent and misattributed flaky failures.

---

## 2. Goals & Acceptance Criteria

1. **Centralize Runtime Root Resolution**: Centralize `SLEUTH_DATA_DIR` (and `AEGIS_DATA_DIR`) resolution so all runtime stores (`workspaces`, `reminders`, `stats`, `events`, `shadow`, `bugs`, `context-memory`, `client-project-map`, `client-mapping-overlay`, `settings`, `admin-auth`, `snapshot-relay`, `code-task-relay`) respect the override.
2. **Per-Worker Test Isolation**: Configure Jest test environments (via Jest setup / worker init) to point `SLEUTH_DATA_DIR` at a per-worker temporary directory (e.g. `os.tmpdir()/sleuth-test-runtime-<JEST_WORKER_ID>-<pid>`), pre-seeding any necessary static test fixtures.
3. **Clean Teardown & Invariant Guard**: Ensure test suites clean up temporary paths and add a regression test confirming that running tests leaves `data/runtime/` clean (`git status --porcelain data/` is empty).
4. **Parallel Stability**: Verify `npm test` and `npx jest --maxWorkers=100%` pass reliably across multiple runs without flakes.

---

## 3. Plan & Workstreams

- [x] **Workstream 1 (Runtime Root Helper)**: Update `src/workspaces.js` to export `GetRuntimeDirPath()` and `GetSubdirPath()`, and ensure all modules in `src/` and `tests/` use them consistently when building paths under `data/runtime/`.
- [x] **Workstream 2 (Jest Environment Setup)**: Added `tests/runtime-setup.js` and registered in `package.json` `"setupFiles"` to isolate runtime data per Jest worker PID and pre-create runtime directories.
- [x] **Workstream 3 (Clean Existing data/runtime)**: Removed untracked runtime test residue from `data/runtime/`.
- [x] **Workstream 4 (Regression Guard & Verification)**: Added `tests/test-runtime-isolation.test.js` guarding against runtime tree pollution and verifying path overrides.
- [x] **Workstream 5 (Full Verification)**: Verified `npm run build`, `npm test` (112/112 suites, 1915/1915 tests), and all validation guards (`validate:workspace-isolation`, `validate:reminder-render`, `validate:fsm`, `validate:ai`, `validate:changelog-tone`).
