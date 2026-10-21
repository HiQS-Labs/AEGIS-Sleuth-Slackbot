# GH-261 smoke receipt

- `npx jest --runInBand tests/validate-fsm-invariants.test.js` — PASS (8 tests, including DecisionSpec, Key task parser, threshold, context-header, and deletion red controls).
- `npm run validate:reminder-pipeline` — PASS (`3/6/3/4/2`).
- `npm run build` — PASS.

The full repository suite, public-tree sanitization, and CI receipt are recorded before publication.
