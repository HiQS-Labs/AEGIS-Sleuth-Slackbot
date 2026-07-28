---
gh_issue: 423
source: https://github.com/NeochromeTeam/sleuth-app/issues/423
title: "Stand up a public, zero-history Sleuth repo (sanitized docs + AGPL/commercial dual license) and cut over"
status: Proposed (1-INBOX — not yet active)
created: 2026-07-20
doc_type: project
related: "GH-420 (committed credentials) — hard dependency, blocking gate; rotation owned there, not here"
target_window: 2026-07-20 → 2026-07-27 (7 days)
---

# GH-423 — Public repo cutover

## Readiness scorecard (rubric)

**Publication readiness: 96.5%** · **Artifact readiness: 96%** — re-scored 2026-07-28 against the
**published** repo `hiqs-suite/aegis-sleuth-slack-bot`, after running the gates rather than reading
them.

> **The number has now moved down twice, for the same reason both times.** The checkbox audit cut it
> once; running the CI gates cut it again — dimension **G** was resting on a run that reported green
> having scanned **0 bytes**. Every defect found today (`grep -IL` platform drift, a ghcr tag that
> 404s, a zero-byte scan, an unverified count nobody could see) was invisible to review and obvious
> on execution. Three of them survived a two-round adversarial swarm review. **Do not score a
> dimension on the existence of a gate — score it on what the gate reports it examined.**

> **Trajectory: 71/84 → 69/81 (audit) → 73/86 (Phase 3 complete).** The middle step matters most —
> the checkbox audit moved the number **down**, because ticking 93 boxes surfaced three things RC-01
> had recorded as done or not recorded at all. A scoring system that can only go up is a progress
> bar, not a measurement. Dimension **B** is still carrying that correction.

> **Why this exists, and why it is not a checkbox count.** As of the 2026-07-27 audit the boxes
> *are* ticked (93/129) — but each `[x]` was set by re-running a command, not by recollection, and
> several carry the evidence inline. The rubric stays the headline number because a box count still
> weights "install TruffleHog" equal to "decide the CLA". Every dimension below has a command or
> artifact that decides its score, so the number is reproducible by someone who doesn't trust it.

### Checkbox audit — 2026-07-27

| Doc | Ticked | Note |
|---|---|---|
| `SANITIZATION-PLAN.md` | **61/68 (90%)** | Phases 1, 3, 4, 5 fully closed |
| `GH-423` (this doc) | **32/61 (52%)** | Phases 1–2 closed; 0, 6, 7 are publication-time |
| | | Phase 7 (cutover) is **out of scope** per E11 — its 0/6 is correct, not a gap |

**Three findings.** Two fixed on the spot, one needs an operator call:

1. **🔧 FIXED — 10 sensitive files still sat in the repo root**, including a **private SSH key**
   (`oci-sleuth-vm`), a New Relic log, and internal docs. All gitignored, so never a *publication*
   risk — but Phase 6 builds the public tree from this working directory, and `cp -r` does not read
   `.gitignore`. RC-01 had this item unticked and it was read as done. Now moved to quarantine.
2. **🔧 FIXED — the CHANGELOG had no leading note** framing the pre-public period. ~888 entries
   naming `Client A`–`G` and citing unreachable `GH-###` issues were shipping with no explanation,
   which reads as link rot rather than deliberate redaction.
3. **✅ RESOLVED — `RELEASES.md` = KEEP** (operator, 2026-07-27). Dropping it would have been
   inconsistent rather than protective: E7 already ships all of `PROJECT/`, PDDA internals included,
   and the file carries no client data (scanner CLEAN). (`HONEST.md`, also on that list, is likewise
   a **KEEP** — the README's maturity table cites it as its source.)

**Also reclassified:** `DOC-INVENTORY.md` was never written; its function is served by
`moved-files.md` + `SANITIZE-MAP.md`. And **GH-420 is no longer a publication gate** — the RC is
zero-history and both TruffleHog passes are clean, so nothing it covers can reach the public repo.
It stays urgent for *this* repo.

### How to score

Each dimension gets **0 / 25 / 50 / 75 / 100**, never a finer grain — false precision here is
worse than a round number. The rule for each step:

| Score | Meaning |
|---|---|
| **0** | Not started, or blocked on a decision nobody has made |
| **25** | Started; the approach is chosen but the work is mostly ahead |
| **50** | Substantially built, **not yet verified** by its own check |
| **75** | Verified by its check, with a **named, written-down** residual gap |
| **100** | Verified by its check, no known gap. Requires evidence, not confidence |

**Publication readiness** is the weighted sum of all nine dimensions.
**Artifact readiness** is the same sum over **A–G only**, renormalised — it answers "is the tree
fit to publish?" separately from "has it been published?", because those two numbers move at very
different speeds and blending them hides which one is stuck.

### Current score

| | Dimension | Weight | Score | Evidence |
|---|---|---|---|---|
| **A** | Secret & PII sanitization | 20 | **100** | `sanitize-scan` CLEAN, 60 rules / 427 files. TruffleHog 3.96.0: **0 verified** on the filesystem artifact, a simulated zero-history squash, and (2026-07-28) the published tree in CI — 5,435,279 bytes / 751 chunks, run `30322218876`. **Evidence corrected 2026-07-28:** this row previously read "0 verified, **0 unverified**". The unverified half was wrong — there are **2**, both decoys that must stay: a `your-email:your-token@github.com` doc placeholder, and the scanner's own `xoxb-…xxxSECRETxxx` canary. It went unnoticed because the documented re-score command passed `--results=verified,unknown`, omitting `unverified` from the printout while the row asserted a count for it. **0 verified is and always was the gate**, and it holds in every mode |
| **B** | Structural scope (what ships) | 10 | **100** ↑ | 551 → 427 tracked files. `relay-system/`, `phases/`, RAG index, prod dumps, 11 internal docs, `ask_self`, 4 internal workflows, `xyz-tick/` all out; every move logged and reversible. **Audit gap now closed:** the 10 sensitive untracked files (incl. a private SSH key) are quarantined, and the last DROP-list verdict is recorded — **`RELEASES.md` = KEEP** (operator, 2026-07-27), consistent with E7 already shipping all of `PROJECT/` |
| **C** | Portability from a fresh clone | 10 | **100** ↑ | `/shakedown` fixed both installers' hardcoded repo URLs; slugs are env-driven with no vendor default. **PROVEN 2026-07-27:** cloned fresh from `hiqs-suite` at a foreign path — `npm ci` exit 0, jest **1470/1470**, `npm run hooks:install` configured `core.hooksPath`, and no `/Users/` path leaks. Same suite also green on Linux in CI |
| **D** | Build & test health | 10 | **100** | jest **1470/1470 across 89 suites**; `tsc` at parity with the `development` baseline (50 pre-existing, no net-new) |
| **E** | Legal & licensing | 15 | **100** ↑ | **Phase 3 complete (7/7).** `LICENSE` (verbatim AGPL-3.0, cross-verified byte-identical against two upstream copies), `NOTICE`, `LICENSE-COMMERCIAL.md`, `THIRD-PARTY.md` (616 pkgs, zero GPL-incompatible), `CONTRIBUTING.md` (CLA question answered — lightweight inbound grant, DCO rejected with reason), `SECURITY.md`, `package.json` |
| **F** | Onboarding & public docs | 10 | **90** | README rewritten for an outside reader and graded against `HONEST.md`; `/front-door` run, human-blocking findings fixed. **Gap:** no outsider has actually completed a first run |
| **G** | Automated gates in CI | 10 | **75** ↓ | **Scored DOWN from 100 on 2026-07-28 — the previous evidence cited a run that scanned nothing.** It read "BOTH GATES EXECUTED IN ANGER AND PASSED… CI run `30318895391`". That run's TruffleHog steps reported **`chunks: 0, bytes: 0`**: the action derives its range from the event, and on a first push `github.event.before` is the zero SHA, so it scanned zero bytes and reported green. The `pull_request` run `30321845101` was real but scanned only the diff — **10,436 bytes, 4 files**. **Now fixed and PROVEN:** `schedule` + `workflow_dispatch` declared, which the action resolves to its whole-repo path; dispatch run `30322218876` scanned **5,435,279 bytes / 751 chunks, 0 verified** (the 2 unverified are the documented decoys, see A). Pre-commit hook independently **blocked a real staged Slack-shaped token** (commit refused, history unchanged). **Named residual gaps (why this is 75, not 100):** (1) push/PR runs still scan only the event diff, so whole-tree verified-credential coverage rides on the weekly cron — and GitHub **disables scheduled workflows after 60 days of repo inactivity**, silently; (2) CI runs **shape rules only** (32 of 60) because the literal denylist cannot ship. Compensating control for (1): `sanitize-scan.sh` reads **every tracked file** (`git ls-files -z`) on *every* run |
| **H** | Identity — repo name + org | 5 | **100** ↑ | **Decided 2026-07-27.** Product renamed **Sleuth → AEGIS**. Target repo `hiqs-suite/aegis-sleuth-slack-bot` — **already created, private, empty**, default `main`; operator is org **admin** and the org was already OAuth-authorized, so no new auth wall. Rename scoped to the **product name only** (149 replacements / 25 docs): `SLEUTH_*` env vars (34), code identifiers, `sleuth-app` paths and `@Sleuth` (functional in 18 src files) all deliberately unchanged |
| **I** | Publication execution | 10 | **100** ↑ | **PUBLIC 2026-07-28**, verified anonymously (unauthenticated web `200`, API `private=false`) — not from the authenticated view, which is what caught an earlier flip that had silently not taken. Zero-history single commit (author *and* committer `Neochrome <devops@neochro.me>`), 432 files. Everything the private repo blocked is now on: **secret scanning, push protection, Dependabot security updates**, and **branch protection on `main`** (required check `test`, `enforce_admins`, no force-push, no deletions). Branch protection means changes now land by PR — **PR #1 merged**, which also exercised the `pull_request` CI path for the first time |

**Weighted:** `20 + 10 + 10 + 10 + 15 + 9 + 7.5 + 5 + 10 = 96.5 / 100`
**Artifact (A–G):** `81.5 / 85 = 96%`

> **Note the shape of this update (2026-07-28).** Publication readiness did not move — **I** gained
> 2.5 (the repo is public with every protection enabled) and **G** lost exactly 2.5 (its evidence
> cited a CI run that scanned zero bytes). Artifact readiness fell **99% → 96%**. A static headline
> hiding two real movements in opposite directions is the argument for keeping the two numbers
> separate, and for the rule that a dimension is scored on what its check *observed*, never on the
> fact that a green tick appeared.

### What the remaining 3.5% actually is

Nearly all of it is **small in effort and large in consequence** — the reverse of the work done so
far. Sequenced by what unblocks what:

| # | Item | Dim | Effort | Reversible? |
|---|---|---|---|---|
| 1 | ~~Decide repo name + GitHub org~~ — **done**: `hiqs-suite/aegis-sleuth-slack-bot`, created private+empty | H | done | Yes, until published |
| 2 | ~~Record the `RELEASES.md` DROP-list verdict~~ — **KEEP** (operator, 2026-07-27) | B | done | Yes |
| 3 | ~~Wire TruffleHog + a pre-commit hook~~ — **built + reviewed 2026-07-27**; proof pending first real run | G | done | Yes |
| 4 | Create private repo, re-run both gates **from a real fresh clone** | C, I | ~1 hour | Yes |
| 5 | Flip public | I | minutes | **No.** This is the one-way door |

> ~~`CONTRIBUTING.md` + CLA decision; `SECURITY.md`~~ — **done 2026-07-27.** The CLA was the
> one-way door in this list: a PR merged under the wrong inbound terms cannot be un-merged out of a
> commercially licensed build. It is now answered *before* the repo is public, which was the point
> of deciding it here rather than at first PR.

**Deliberately excluded from this rubric:** GH-420 credential rotation. The public RC carries zero
history and both TruffleHog passes are clean, so rotation cannot gate *publication*. It remains a
real and separate security obligation on **this private repo**, owned by GH-420. Scoring it here
would make the publication number wrong in both directions — it isn't blocking, and it isn't done.

### Re-scoring — run these, then update the table

Read-only. Empty output where noted means that dimension holds.

```bash
# A — secret & PII gate (60 rules; the private denylist lives outside the repo)
./utils/sanitize-scan.sh --rules temp/moved-private-files/sanitize-rules.private.tsv \
                         --allowlist utils/sanitize-allowlist.txt   # expect: ✓ CLEAN, exit 0

# TruffleHog. Use GIT mode, not `filesystem .` -- filesystem mode also scans `.git/objects`,
# so the same placeholder gets counted once per compressed blob (14.8MB/1802 chunks and 7 hits,
# vs 5.4MB/751 chunks and 2 hits for the 5,430,106 bytes actually tracked). And ALWAYS list
# `unverified` in --results: the old command here said `--results=verified,unknown` while
# claiming "expect 0 unverified", so it filtered out of the printout the very thing it asked
# you to confirm. (The summary counter reports them either way -- read that line, not silence.)
trufflehog git "file://$PWD" --results=verified,unverified,unknown --no-update
#
# THE GATE IS `verified_secrets: 0`. Nothing else.
#
# Do NOT pin an expected unverified count here. The first version of this block said "expect 2" and
# was stale within one commit: documenting the two decoys (in CHANGELOG + this file) quoted their
# literal strings, which the detectors then found too -- 2 became 8 in CI. A brittle magic number
# goes stale on any doc edit and trains the reader to ignore the line. Check the INVARIANT instead:
# every unverified finding must resolve to a known placeholder. Two real ones exist in the code --
#   docs/server-installation-guide.md  https://your-email:your-token@github.com  (doc placeholder)
#   utils/sanitize-scan.sh             xoxb-1234567890-9876543210-xxxSECRETxxx   (the scanner's OWN
#       canary -- the fake token it greps for to prove grep works before it scans anything)
# -- and the rest are docs quoting those two. Anything in a file that is NOT documentation or the
# scanner itself is a real result, whatever the total says.
#
# List them by file rather than eyeballing the count:
trufflehog git "file://$PWD" --results=verified,unverified,unknown --no-update --json 2>/dev/null \
  | python3 -c 'import sys,json,collections
c=collections.Counter()
for l in sys.stdin:
    l=l.strip()
    if l.startswith("{"):
        d=json.loads(l)
        c[(d.get("DetectorName"), d.get("SourceMetadata",{}).get("Data",{}).get("Git",{}).get("file"))]+=1
[print(f"{n}x  {det:8} {f}") for (det,f),n in sorted(c.items(), key=lambda x:-x[1])]'
#
# Do NOT suppress the canary: a scanner configured to ignore its own canary can no longer tell you
# it is still working -- which is the exact failure this project has now hit three times.

# B — scope: nothing quarantined has crept back
git ls-files | wc -l                                                # expect: ~427
git ls-files | grep -E '^(relay-system|phases|xyz-tick|ask_self)/' # expect: empty
ls .github/workflows/                                               # expect: ci.yml only

# D — build & test health (read jest's OWN tally, never a wrapper's summary line)
npx jest --silent > /tmp/jest.txt 2>&1; grep -E '^(Tests|Test Suites):' /tmp/jest.txt

# E — legal files present
for f in LICENSE NOTICE LICENSE-COMMERCIAL.md THIRD-PARTY.md CONTRIBUTING.md SECURITY.md; do
  [ -f "$f" ] || echo "E MISSING: $f"; done
shasum LICENSE   # expect 78e50e186b04c8fe1defaa098f1c192181b3d837 (verbatim AGPL-3.0)
npx license-checker --production --summary   # expect: no GPL/LGPL/AGPL/MPL/EPL/SSPL/BUSL

# G — gates actually wired
grep -q trufflehog .github/workflows/*.yml || echo "G OPEN: TruffleHog not in CI"
[ -d .githooks ] || echo "G OPEN: no pre-commit hook"
```

> **Trap, learned the hard way:** `npx jest | tail` under this shell prints a wrapper summary
> (`PASS (1470) FAIL (0)`) that **hides suite-level failures** — a suite that fails to *parse*
> contributes zero passes and zero fails, so the line reads perfect. It once reported a green
> 1449/0 while ~99 tests never ran. Always read jest's own `Test Suites:` line from a captured
> file. The same instinct applies to every check above: score the artifact, not the summary of it.

## Context

Sleuth has run in daily production for ~2.5 years across 7 workspaces for a ~10-person team
(see `HONEST.md` for the ground-truth maturity read). The codebase has never been public. This
project creates a **new, publicly available repository with zero commit history**, moves active
development to it, and archives this repo read-only.

The trigger is [GH-420](https://github.com/NeochromeTeam/sleuth-app/issues/420): live Slack and
OpenAI credentials were found committed in the README's "Creating Workspaces" curl example. That
issue's remediation is *rotate → scrub history → sanitize README → prevent recurrence*.

**A zero-history repo structurally eliminates the scrub step** — there is nothing to `filter-repo`,
because commit #1 *is* the first commit. No force-push across branches and tags, no "everyone
delete your clones", no residue in forks of the new repo.

**It does not eliminate rotation.** Anything already committed here is already exposed to anyone
who has cloned or forked this repo. Rotation is the only action that neutralizes that, and it is
**owned entirely by GH-420 and out of scope for this doc** — carried here only as a blocking gate.

## Why now (and why not just clean this repo)

| Option | Verdict |
|---|---|
| `git filter-repo` this repo, then flip it public | Rejected. 1124 commits of internal history — client names, prod IPs, roadmap, agent-harness experiments, scratch work. Filtering secrets doesn't make the *history* fit for publication; it just makes it not-leaking. |
| New repo, zero history | **Chosen.** The publishable artifact is the current state of the code, not the path that produced it. One clean commit is auditable in a way a rewritten 1124-commit history never is. |

The cost is real and acknowledged: **contributor history, blame, and bisect are lost.** For a
codebase that has had essentially one author and no external contributors, that cost is low. This
repo survives as the archived historical record.

## Decisions (operator, 2026-07-20)

These are settled. Phases below implement them; they are not re-litigated mid-build.

| # | Decision | Choice | Note |
|---|---|---|---|
| D1 | License | **AGPL-3.0-only** + commercial exception | Strongest deterrent against a hosted clone; OSI-approved, familiar to buyers |
| D2 | Attribution | **`Copyright (c) 2023-2026 Neochrome`** | Entity holds rights — required to sell commercial licenses cleanly. No individual names in headers. |
| D3 | CHANGELOG | **Full rewrite, redacted in place** | All ~888 entries kept. The 2.5-year track record is the credibility signal; losing it is a real cost. |
| D4 | Cutover | New repo canonical, old **archived read-only**, prod CI/CD repointed | |
| D5 | Rotation | **Out of scope** — owned by GH-420 | Blocking gate at Phase 6 |
| D6 | Sanitization | **Full scrub** — no real client or infra identifier anywhere | Includes `neochrome` itself |
| D7 | Doc set | **Minimal public set**, docs rebuilt for outsiders | PDDA/agent-harness internals dropped |
| D8 | Repo name | **Open** — naming check gates creation | "Sleuth" is contested |

### On D6 — why scrub `neochrome` too

Neochrome is the vendor and will appear in `LICENSE` and `NOTICE` deliberately. But `neochrome`
as a *workspace identifier* baked into 155 files of config, fixtures, and examples is different:
it makes the public codebase read as one company's internal tool with a special-cased tenant,
and it leaks which workspace runs which experimental feature flags (e.g. the GH-397 router is
scoped to `neochrome` on prod). Examples get a generic tenant.

## Scope surface (measured 2026-07-20)

```
neochrome        155 files
Client A / client-a   91 files    (real client name)
xoxb-             53 files
45.x              30 files    (prod IP pattern)
C0BB…              5 files    (real Slack channel IDs)
noel@neochro.me    4 files
sk-proj-           3 files
```

Test fixtures and assertions reference these strings. **Expect test fallout from the scrub** —
that is the phase's main risk, not the find-and-replace itself.

---

## Phase 0 — Name and availability check `[gate]`

Blocks repo creation. Nothing else depends on it, so it can run in parallel with Phase 1.

- [ ] Confirm the collision set: Spring Cloud Sleuth (Pivotal/VMware), sleuth.io (deploy analytics),
      any others found
- [ ] Check availability: GitHub org + repo, npm package name, `.com`/`.dev` domain
- [ ] Decide: keep `sleuth` with a qualifier (`sleuth-bot`, `sleuthhq`), or rename outright
- [ ] Decide publishing identity: `NeochromeTeam/<name>` vs a dedicated org
- [ ] **Operator sign-off on the final name** — everything downstream hardcodes it

**Exit:** a written name + org decision, recorded in this doc.
**DECIDED 2026-07-27:** org **`hiqs-suite`**, repo **`aegis-sleuth-slack-bot`**, product renamed **Sleuth → AEGIS**. Repo already exists (private, empty). The repo slug deliberately retains `sleuth` — this is a transitional identity, not an erasure, which is why docs say AEGIS while env vars and code keep `SLEUTH_`/`sleuth-app`.

## Phase 1 — Inventory and sanitization map

Produces the artifacts Phase 2 executes against. No code changes yet.

- [x] `DOC-INVENTORY.md` — every root `*.md` and top-level directory with a
      **KEEP / DROP / REWRITE** verdict and a one-line reason
      — **delivered under different filenames.** No file named `DOC-INVENTORY.md` exists; the
      verdict-per-path record is `moved-files.md` (path · why · tracked? · reversible?) and the
      replacement table is `SANITIZE-MAP.md`. Function met; name not. One verdict was never
      recorded and is still open — `RELEASES.md`, see the sanitization plan's Phase 2
  - Provisional DROP: `PROJECT/`, `relay-system/`, `scratch/`, `temp/`, `phases/`, `xyz-tick/`,
    `ROUTER.md`, `ROADMAP.md`, `HONEST.md`, `DASHBOARD.md`, `snapshot.md`, `4X4.md`,
    `AGENTS-PROPOSED.md`, `AI-TRIAGE.md`, `OCI-TEST-VM.local.md`, `REPO_MAP.md`,
    `ASKCODE_INTEGRATION_COPY.md`, `SKILL-DEBUG.md`, `PIPELINE.md`, `RELEASES.md`
  - Provisional REWRITE: `README.md` (contains the GH-420 creds), `ARCHITECTURE.md`,
    `macos-install-guide.md`, `docs/`
  - Provisional KEEP: `src/`, `tests/`, `config/`, `scripts/`, `utils/`, `public/`, `mcp/`,
    `recipes/`, `skills/`, `deploy/` (redacted), `CHANGELOG.md` (redacted)
- [x] `SANITIZE-MAP.md` — every identifier → its replacement, as an executable table
      (real workspace names, client names, IPs → TEST-NET-3 `203.0.113.0/24`, Slack channel IDs,
      emails → `example.com`, token shapes → obvious placeholders)
- [x] Enumerate `data/`, `config/`, `deploy/` for runtime state, logs, and real workspace configs
      that must not ship at all — `data/rag/` quarantined; only `data/`, `data/static/`,
      `data/static/ai/` still tracked, all sanitized in place
- [x] **Operator approves both files before Phase 2** — E5/E6, 2026-07-26

**Exit:** two approved artifacts. This is the phase where being wrong is cheap.

## Phase 2 — Build the sanitized tree (local, not yet a repo)

Work in a scratch checkout. Nothing is pushed anywhere in this phase.

- [x] ~~Copy the KEEP set into a clean directory~~ — **superseded by decision E1.** Sanitized
      **in place** on a branch instead, so every redaction is a reviewable diff against
      `development`. An allowlist-copy hides what it dropped; a denylist-in-place shows it. The
      compensating control for the denylist risk is the deterministic scanner plus TruffleHog
- [x] Apply `SANITIZE-MAP.md` across code, tests, fixtures, configs, and docs
- [x] Delete all runtime/ephemeral state (`data/runtime/`, `data/logs/`, `data/rag/`, caches)
      — quarantined rather than deleted, per the move-don't-delete rule
- [x] Author `.gitignore` — everything secret-bearing or runtime, verified against the real tree (492 lines)
- [x] Author `.env.example` with placeholders only
- [x] **Run the full test suite; fix fallout from renamed fixtures**
      (note: jest false-fails 3 web-api suites under the command sandbox on `listen EPERM` —
      run unsandboxed) — **1470/1470 across 89 suites**
- [x] Verify the app actually starts from `.env.example` + placeholder config
- [x] **Run `/shakedown` over every script-calling skill in `skills/`** — see below

**Exit:** green test suite on the sanitized tree, app boots, shakedown clean.

### `/shakedown` — why it belongs here specifically

The repo ships `skills/`, `scripts/`, and `utils/` containing bundled `.sh` scripts. `/shakedown`
audits exactly one failure mode: **scripts that resolve paths relative to CWD, so they run fine in
the session that wrote them and come back "not found" in another repo, path, or install.**

That failure mode is *dormant today and guaranteed to fire at cutover*, because this project changes
all three variables at once:

- the **repo directory name changes** (Phase 0 renames it)
- the clone path changes — public users clone to arbitrary directories, not `~/Documents/GH Repos/sleuth-app`
- paths with **spaces** are currently normal here (`GH Repos`) and won't be for everyone

Anything hardcoding `sleuth-app` in a path, or assuming CWD is the repo root, breaks silently for the
first outside user — and it breaks as a "doesn't work" first impression, not a clean error.

- [x] Run `/shakedown` against each script-calling skill; capture the graded report
      — **caveat:** run and acted on, but no `SHAKEDOWN/` report folder was persisted, so the
      record is the CHANGELOG v1.4.245 entry rather than a re-readable matrix
- [x] Fix path-resolution findings **in the sanitized tree** (and backport to this repo if the bug
      exists here too — it almost certainly does) — both installers hardcoded a repo URL in the old
      org (a guaranteed 404 on step one for every outside user); now `SLEUTH_REPO`/`SLEUTH_REPO_URL`
- [x] Re-run under the skill's scenario matrix: foreign CWD, nested dir, spaces-in-path, stripped
      exec bit, project-vs-user install
- [x] Decide per skill whether it ships publicly at all (some are internal-harness-only —
      cross-check against `DOC-INVENTORY.md`) — `ask_self` removed; `relay-system/` quarantined

**Risk:** a scrub that silently changes behavior (a workspace key used as a lookup, not a label).
Mitigation: the test suite is the check, and it is why this phase runs before publication, not after.

## Phase 3 — License and legal files

- [x] `LICENSE` — verbatim AGPL-3.0-only text. **Cross-verified, not typed from memory:** fetched
      from two independent upstream projects (Mastodon, Nextcloud) and confirmed byte-identical.
      sha1 `78e50e186b04c8fe1defaa098f1c192181b3d837`, 661 lines, §13 at line 540
- [x] `LICENSE-COMMERCIAL.md` — the commercial exception: what it grants (relief from AGPL §13
      network-source obligations), who to contact, that terms are negotiated not click-through
- [x] `NOTICE` — `Copyright (c) 2023-2026 Neochrome. All rights reserved.` + dual-license statement
      + an explicit trademark exclusion
- [x] ~~`SPDX-License-Identifier: AGPL-3.0-only` headers~~ **where the project's conventions call
      for them** — they don't. Zero source files in this repo carry an SPDX header today, so adding
      400+ would be inventing a convention, not following one. The identifier lives in `NOTICE` and
      `package.json`. Revisit only if the project adopts per-file headers generally
- [x] `THIRD-PARTY.md` — dependency license audit. **AGPL-3.0 has real compatibility constraints;
      any GPL-incompatible transitive dependency is a blocker, not a footnote.**
      → **616 packages (352 distributed), ZERO GPL-incompatible or source-available licenses.**
      Apache-2.0 (27) verified one-way compatible *into* the GPLv3 family; `argparse` (Python-2.0),
      `caniuse-lite` (CC-BY-4.0 data, not distributed) and the `MIT*`/`Apache*` entries each
      checked individually rather than waved through
- [x] `package.json` `license` field → `AGPL-3.0-only`
- [x] `CONTRIBUTING.md` — including whether inbound contributions require a CLA/DCO.
      **Selling commercial licenses requires holding rights to all the code — without a CLA, an
      accepted external PR can compromise the ability to relicense.** Decide before the repo is public.
      → **Resolved as a lightweight inbound licence grant, not a signed CLA.** Contributors keep
      copyright and license under the AGPL, *and* grant Neochrome the right to include the work
      under other terms. Agreement is recorded by opening a PR; no signing bot.
      **A DCO was considered and rejected:** it certifies provenance but grants only the outbound
      licence (AGPL), which is exactly the thing that would break the commercial option. The grant
      in point 3 of `CONTRIBUTING.md` is the smallest addition that keeps dual-licensing viable.
      **Upgrade path:** a signature-tracked CLA can replace it later, applying to future
      contributions only
- [x] `SECURITY.md` — disclosure contact and policy. Private reporting to `security@neochro.me`
      (already present in the tree, so it routes), honest response windows rather than an
      aspirational SLA, latest-version-only support, explicit scope, and an **operator
      responsibilities** section that names the `WEB_API_BEARER_TOKEN` → `test` fallback outright
      — verified verbatim against `src/app.js#GetWebApiBearerToken`, not paraphrased

**Exit:** legal files complete; no GPL-incompatible dependency outstanding; CLA question answered.
**Status 2026-07-27: Phase 3 COMPLETE (7/7).** Dependency constraint cleared; all licence, legal
and community files landed; the CLA question is answered.

**Open (operator, non-blocking):** the commercial-license contact is **provisionally
`support@neochro.me`** — chosen because it already appears in the tree and therefore demonstrably
routes; a dedicated `licensing@` alias is a one-line swap in `LICENSE-COMMERCIAL.md` if preferred.

## Phase 4 — CHANGELOG redaction and public docs

- [x] Redact `CHANGELOG.md` in place across all ~888 entries: strip secrets, client names, prod
      hostnames/IPs, internal issue chatter, and Slack channel IDs — **preserving the release
      narrative and dates**
  - Per house convention, entries lead with a friendly first-person TL;DR then `**Technical:**`;
    keep that shape
  - [x] **🔎 AUDIT — was MISSED in RC-01, fixed 2026-07-27.** Add a leading note framing the
    pre-public history honestly. Without it, ~888 entries naming `Client A`–`G` and citing `GH-###`
    issues nobody outside can open read as link rot rather than deliberate redaction. Placed above
    the first `## ` heading so the Slack `changelog` command still never surfaces it
- [x] Rewrite `README.md` from scratch for an outside reader: what Sleuth is, what it does, install,
      first run, configuration, license. **Placeholder credentials only** — this is the exact file
      that caused GH-420
- [x] Rewrite `docs/` for outsiders; drop PDDA/agent-harness internals per `DOC-INVENTORY.md`
- [x] Honest positioning per `HONEST.md`: core is Proven; Notion, plugins, and the event ledger are
      early. **Do not let the public README overstate maturity** the internal baseline doesn't support.
- [x] **Run `/front-door` against the sanitized tree** — see below
- [x] Fix every finding classed as *human-blocking* friction; log agent-absorbable friction as
      follow-up issues rather than fixing inline
- [ ] **OPEN.** Save the audit as `FRONTDOOR.md` in the new repo — it's a re-runnable health board
      with a deterministic check per finding, so onboarding rot is detectable later instead of
      discovered by a stranger. **Not written:** the board mode is opt-in and was not taken, so the
      front-door record is prose in CHANGELOG v1.4.245. Re-scoring onboarding later means re-running
      the skill rather than reading a board. Belongs in the new repo

**Exit:** a doc set a stranger can act on, verified by front-door rather than asserted.

### `/front-door` — why here, and why it is the honest check

Phase 4 is written by someone who already knows how Sleuth works. That is exactly the condition
under which a README passes review and still fails a real newcomer. `/front-door` walks the repo as
a brand-new user and reports whether they get from clone to working — **not whether the docs exist.**

Four of the things it checks map directly onto known risks in this project:

| What it checks | Why it matters here |
|---|---|
| Competing / duplicate onboarding docs, unclear source of truth | This repo has 24 root `*.md` files today, several overlapping (`README`, `macos-install-guide`, `docs/`, `AGENTS`). The DROP list reduces that, but whatever ships must have one obvious entry point |
| Committed secrets in tree **and git history** | An **independent second opinion on GH-420's blast radius**, run by a different mechanism than Phase 5's gitleaks. Two unrelated checks agreeing is meaningfully stronger than one |
| Auth / login / credential gates in the first-run path | Sleuth needs Slack tokens + an OpenAI key before it does anything. That is a hard gate for an outside user and the README must be honest about it |
| Doc-vs-code drift | The scrub in Phase 2 changes identifiers across 155 files. Docs describing the old names are a predictable drift source |

It also separates friction an AI agent can absorb from friction that needs a human — useful here,
because a good chunk of Sleuth's setup is genuinely agent-assistable and shouldn't be over-corrected.

## Phase 5 — Automated secret gate

Built *before* publication so it can be run *as* the publication check.

- [x] ~~`gitleaks` config~~ → **built as `utils/sanitize-scan.sh` instead** (60 rules: token shapes
      `xoxb-`/`xapp-`/`sk-proj-`/`ghp_`, client names, prod IP patterns, real channel IDs, personal
      emails), plus **TruffleHog 3.96.0** as the independent second opinion. TruffleHog beats
      gitleaks for the decisive property here: it *verifies* findings against the provider's API,
      separating live secrets from dead placeholders
- [x] Run it over the entire Phase 2 tree — **zero findings required** → CLEAN, and TruffleHog
      **0 verified / 0 unverified** on both the filesystem artifact and a simulated zero-history squash
- [ ] **OPEN — largest remaining gap in the automated gate (rubric dimension G, scored 40).** Wire
      it as a CI workflow in the new repo so a PR reintroducing any of it fails. Today `ci.yml`
      runs `sanitize-scan.sh` only, and **in CI it can only run 32 of the 60 rules** — the literal
      denylist is itself the de-anonymization key and cannot ship. TruffleHog is not wired at all,
      which is exactly the half that would cover the rules CI can't carry
- [ ] **OPEN.** Add a pre-commit hook mirroring the CI check — no `.githooks/`, no husky

**Exit:** clean scan, gate wired. **Status 2026-07-27:** scan clean ✅, gate **not** wired ❌.

This closes GH-420's "prevent recurrence" item structurally, which is the part of GH-420 this
project genuinely does absorb.

## Phase 6 — Create and publish `[gate]`

**Hard gates — all must be green before the repo is made public:**

- [ ] Phase 0 name signed off — **operator decision, not started**
- [x] Phase 2 tests green — 1470/1470 across 89 suites
- [ ] Phase 3 legal complete, no incompatible dependency, CLA decided
      — dependency constraint **cleared**; licence files done; **CLA still open**
- [ ] Phase 5 scan clean **and gate wired** — scan clean ✅, gate not wired ❌
- [ ] **GH-420 CLOSED** — all four secrets rotated, Web API bearer no longer `test`.
      **Reclassified 2026-07-27: this is no longer a publication gate.** The public repo carries
      zero history and both TruffleHog passes are clean, so nothing GH-420 covers can reach it.
      Rotation remains a real and urgent obligation on **this private repo** — TruffleHog
      authenticated the OpenAI key against OpenAI's API, so it is live — but blocking publication
      on it conflates two unrelated exposures
- [ ] Clean-machine test: fresh clone → working first run using the public README alone
- [ ] **`/front-door` re-run against the pushed private repo** (not the local tree) — this is the
      first time the artifact is a real clone at a foreign path with a new repo name, which is the
      condition that surfaces the bugs `/shakedown` predicts. A clean local run does not substitute
- [ ] **`/shakedown` re-run from that same fresh clone** — same reason: new name, new path, and
      possibly no spaces in it for the first time

Then:

- [ ] `gh repo create <org>/<name> --private` — **private first**
- [ ] Single initial commit of the sanitized tree
- [ ] Re-run the secret scan against the pushed repo
- [ ] Enable GitHub secret scanning + **push protection**
- [ ] Branch protection on `main`
- [ ] Flip to **public**

**Why private-first even with a clean tree:** it gives one last look at the thing as GitHub renders
it, and force-push is still free. After the flip it is not.

## Phase 7 — Cutover `[gate, human-decided]`

Do not run this phase on momentum. It moves production.

- [ ] Repoint prod CI/CD (`.github/workflows/cicd.yml`, self-hosted runner) at the new repo
      — note `.env.runtime` is gitignored and app env is hand-managed on prod, so the runtime
      env survives, but **verify this rather than assuming it**
- [ ] **Deploy to prod from the new repo and verify a real reminder round-trip end to end**
- [ ] Only after a verified deploy: move active development to the new repo
- [ ] Migrate open issues worth carrying (this repo's issue history does not follow the code)
- [ ] Update every external reference: Slack app manifests, docs, bookmarks, skills that point at
      `sleuth-app` paths
- [ ] **Archive this repo read-only** — last, and only once prod is proven on the new path

**Exit:** prod runs from the new repo; this repo is archived.

**Rollback:** until the archive step, this repo is untouched and can resume as canonical.

---

## Anti-goals

- **Not** rewriting or filtering this repo's history — that is precisely what a new repo avoids
- **Not** rotating credentials — GH-420 owns that; this doc only gates on it
- **Not** refactoring, restructuring, or "cleaning up" code during the scrub. The public tree is the
  current tree with identifiers replaced. Mixing a refactor into this makes the diff unreviewable
  and the secret gate meaningless
- **Not** building a two-repo sync process — the old repo is archived, not maintained in parallel
- **Not** a marketing or launch plan (announcement, landing page, HN post) — separate work
- **Not** changing product behavior. If the scrub changes what the app does, that is a bug

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Something secret survives the scrub and goes public | **High** | Two independent checks — Phase 5 gitleaks + `/front-door`'s own tree-and-history secret sweep — plus private-first and the clean-machine check. Manual review alone is not sufficient at 155-file scale |
| Bundled scripts break for the first outside user (new repo name, foreign clone path) | **Medium-High** | `/shakedown` in Phase 2, re-run from a real fresh clone in Phase 6. This risk is *created* by this project — renaming the repo is the trigger |
| README passes internal review but fails a real newcomer | Medium | `/front-door` in Phase 4, re-run in Phase 6; `FRONTDOOR.md` kept as a re-runnable board so it stays true after cutover |
| A GPL-incompatible dependency blocks AGPL | **High** | Audited in Phase 3, *before* the repo exists. Discovering this after publication is very expensive |
| Scrub silently breaks behavior | Medium | Full test suite in Phase 2; app-boot check |
| No CLA → cannot relicense later | Medium | Decided in Phase 3, before the repo is public |
| Prod deploy breaks at cutover | Medium | Phase 7 verifies the deploy *before* archiving; old path stays live until proven |
| 7-day window slips | Low | Phases 0-5 are all reversible. Only Phase 6's public flip and Phase 7's archive are one-way |

## Open questions for the operator

1. **Final name and publishing org** (Phase 0) — everything downstream hardcodes it
2. **Commercial-license contact address** for `LICENSE-COMMERCIAL.md`
3. **CLA or DCO for inbound contributions?** Blocks the ability to sell commercial licenses if
   answered wrong, and it must be answered before the repo is public
4. Does the public `CHANGELOG` keep the existing `v1.4.x` numbering, or does the public release
   reset to `v2.0.0` with prior entries preserved beneath it?

## Sequencing note

Phases 0 and 1 can run today in parallel. Phase 2 is the long pole. Phases 6 and 7 are the only
irreversible steps and both are explicitly human-gated — the 7-day target applies to reaching
Phase 6, not to forcing the archive.

## Tooling — existing local skills used

Both are already installed; neither needs building.

| Skill | Runs at | Purpose |
|---|---|---|
| `/shakedown` | Phase 2, re-run Phase 6 | CWD-sensitive path bugs in bundled scripts — the failure mode this project's repo rename actively triggers |
| `/front-door` | Phase 4, re-run Phase 6 | Clone-to-working audit as a newcomer; duplicate-doc and doc-drift detection; independent secret sweep of tree **and** history |

**Both run twice, and the second run is the one that counts.** The Phase 2/4 runs are local, in a
directory named `sleuth-app` at a path with a space in it, by someone who knows the codebase. The
Phase 6 runs are against a real fresh clone of the renamed repo at a foreign path — which is the
actual condition an outside user hits. A clean first run does not license skipping the second.

`/front-door`'s secret sweep is deliberately **not** treated as redundant with Phase 5's gitleaks
gate. They use different mechanisms; agreement between them is the evidence, and a disagreement is
a finding worth chasing rather than reconciling away.
