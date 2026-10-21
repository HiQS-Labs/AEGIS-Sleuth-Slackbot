# GH-261 smoke receipt

- `npx jest --runInBand tests/validate-fsm-invariants.test.js` — PASS (8 tests, including DecisionSpec, Key task parser, threshold, context-header, and deletion red controls).
- `npm run validate:reminder-pipeline` — PASS (`3/6/3/4/2`).
- `npm run build` — PASS.

- `npm test` — PASS (145 suites, 2,787 tests; 1 suite / 4 tests intentionally skipped).
- `./utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt` — PASS (773 tracked files; no findings).
