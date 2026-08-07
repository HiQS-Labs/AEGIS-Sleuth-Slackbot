# Contributing

Thanks for your interest in AEGIS. Please read the **Inbound licensing** section below before
opening a pull request — it is short, and it is the part that actually matters.

## Before you start

- **Open an issue first** for anything beyond a typo or a one-line fix. It is cheaper to disagree
  about an approach in an issue than in a finished branch.
- **Security issues do not go in issues or pull requests.** See [`SECURITY.md`](./SECURITY.md).

## Development setup

**New contributors:** start with [docs/getting-started.md](docs/getting-started.md) for the full
requirements checklist and first-run steps.

Node **>= 18.20.4** (20 or 22 LTS recommended; see `engines` in `package.json`).

```bash
npm ci
cp .env.example .env     # placeholders only — never commit real credentials
npm test
```

`npm run dev` and `node src/app.js` load `.env` from the repo root automatically. For admin setup,
`npm run admin:setup` does the same (requires `ADMIN_ENCRYPTION_KEY` in `.env`).

`npm test` runs the Jest suite plus the `node --test` suites. It should be fully green before you
open a pull request; if a test is failing on `main`, say so in the PR rather than working around it.

There are also standing validation gates (`npm run validate:*`) covering prompt catalogs, FSM
invariants, workspace isolation, reminder rendering, and changelog tone. **Run them locally** —
this public repo has no GitHub Actions CI. DeployHQ’s build pipeline (`.deploybuild.yaml`) is the
gate on deploys to development and production; see [`docs/deployhq.md`](docs/deployhq.md).

Install local git hooks so the secret scan runs before commit:

```bash
npm run hooks:install
```

### The secret gate

`utils/sanitize-scan.sh` blocks credentials, real infrastructure addresses, and personal data from
entering the tree. Run it locally before pushing (DeployHQ also runs it on every deploy):

```bash
./utils/sanitize-scan.sh --allowlist utils/sanitize-allowlist.txt
```

It exits non-zero on a finding and — deliberately — exits `2` rather than `0` if it cannot verify
its own tooling, so a broken scanner can never look like a clean scan. If you hit a false positive,
add it to `utils/sanitize-allowlist.txt` **with a reason** rather than weakening a rule.

## Pull requests

- One logical change per PR. A refactor bundled with a behavior change is hard to review and harder
  to revert.
- Include a test for anything that could regress.
- Update `CHANGELOG.md`. House convention: a friendly, plain-language TL;DR first (what changed for
  a *user*), then a `**Technical:**` block with the engineering detail.
- Match the surrounding code. This codebase has consistent naming and comment habits; a PR that
  reads like it came from somewhere else costs review time.

## Inbound licensing — please read

AEGIS is **dual-licensed**: AGPL-3.0-only (see [`LICENSE`](./LICENSE)) plus a commercial license
for organizations that cannot meet the AGPL's source-disclosure obligations (see
[`LICENSE-COMMERCIAL.md`](./LICENSE-COMMERCIAL.md)).

That second license is why this section exists. **Offering a commercial license requires holding
sufficient rights in all of the code being licensed.** A contribution accepted under the AGPL alone
could not be included in a commercially licensed build — not as a policy choice, but because the
rights would not exist to grant.

So, by submitting a pull request, you confirm that:

1. **You wrote the contribution, or otherwise have the right to submit it.** If it is based on
   someone else's work, you have the right to contribute that work under these terms, and you say
   so in the PR.
2. **You license your contribution under the AGPL-3.0**, like the rest of the project.
3. **You additionally grant Neochrome a perpetual, worldwide, irrevocable, royalty-free license** to
   use, reproduce, modify, and distribute your contribution, **including under license terms other
   than the AGPL** — specifically, as part of the commercial license offering described in
   `LICENSE-COMMERCIAL.md`.
4. **You retain copyright in your contribution.** Point 3 is a license grant, not an assignment. You
   keep every right you had; Neochrome gains the specific right needed to keep dual-licensing.
5. If your employer has rights to work you produce, **you have permission to make the contribution**
   or your employer has waived those rights.

If any of that does not work for you, that's a legitimate position — please open an issue to discuss
before writing code, rather than submitting a PR that cannot be merged.

> **Why not a DCO?** A Developer Certificate of Origin certifies provenance, but grants only the
> project's outbound license — here, the AGPL. That is sufficient for a single-license project and
> insufficient for a dual-licensed one. Point 3 is the smallest addition that keeps the commercial
> option viable.

> **Why no signing bot?** This is a small project and a signature-tracked CLA is disproportionate
> today. Agreement is recorded by the act of opening a pull request against this document. If the
> contributor base grows, a signed CLA may replace this section — it would apply to future
> contributions only.

## Code of conduct

Be decent. Assume good faith, keep criticism about the code, and take conflicts to email rather
than escalating in a thread. Maintainers may close or block on conduct grounds.
