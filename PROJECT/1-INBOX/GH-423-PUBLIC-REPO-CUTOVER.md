---
gh_issue: 423
source: https://github.com/NeochromeTeam/sleuth-app/issues/423
title: "Stand up a public, zero-history Sleuth repo (sanitized docs + AGPL/commercial dual license) and cut over"
status: "Published 2026-07-28 — Phases 0-6 complete; Phase 7 (cutover) out of scope per E11"
created: 2026-07-20
doc_type: project
related: "GH-420 (committed credentials) — never a publication gate (zero-history repo, clean scans); CLOSED 2026-07-28 by the operator as an accepted risk, not rotated"
target_window: 2026-07-20 → 2026-07-27 (7 days); published 2026-07-28, one day over
---

# GH-423 — Public repo cutover

## Readiness scorecard (rubric)

**Publication readiness: 95%** · **Artifact readiness: 94%** — re-scored 2026-07-28 against the
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
| **F** | Onboarding & public docs | 10 | **75** ↓ | **Was scored 90 — which is not a legal value.** This rubric permits only 0/25/50/75/100 and says "never a finer grain — false precision here is worse than a round number". A 90 was the scorecard breaking its own rule to avoid rounding down. Corrected 2026-07-28 by actually running the check: **`/front-door` re-run from a fresh anonymous clone** (the Phase 6 run that had never happened), producing `FRONTDOOR.md` — a board where every status is decided by a command. **2 findings fixed on the spot:** `package.json` metadata still read `your-org/your-repo` on a published repo, and the first install command was an unrunnable placeholder (`git clone <your-fork-or-clone-url>`). **3 named residual gaps, each tracked with a check:** FD-03 `.env.example` documents 1 of 31 env vars `src/` reads; FD-04 seven internal-process root docs absent from the Documentation map; FD-06 no outsider has completed a live first run. **FD-05 withdrawn** — it flagged `neochrome` as a surviving workspace identifier, but E5 had already settled that deliberately (the denylist rule is disabled *with the reason written inline*), and there is no vulnerability behind it: the team ID is not a credential and the value is not in the repo. It was re-litigating a decision by reading D6 without checking what refined it |
| **G** | Automated gates in CI | 10 | **75** ↓ | **Scored DOWN from 100 on 2026-07-28 — the previous evidence cited a run that scanned nothing.** It read "BOTH GATES EXECUTED IN ANGER AND PASSED… CI run `30318895391`". That run's TruffleHog steps reported **`chunks: 0, bytes: 0`**: the action derives its range from the event, and on a first push `github.event.before` is the zero SHA, so it scanned zero bytes and reported green. The `pull_request` run `30321845101` was real but scanned only the diff — **10,436 bytes, 4 files**. **Now fixed and PROVEN:** `schedule` + `workflow_dispatch` declared, which the action resolves to its whole-repo path; dispatch run `30322218876` scanned **5,435,279 bytes / 751 chunks, 0 verified** (the 2 unverified are the documented decoys, see A). Pre-commit hook independently **blocked a real staged Slack-shaped token** (commit refused, history unchanged). **Named residual gaps (why this is 75, not 100):** (1) push/PR runs still scan only the event diff, so whole-tree verified-credential coverage rides on the weekly cron — and GitHub **disables scheduled workflows after 60 days of repo inactivity**, silently; (2) CI runs **shape rules only** (32 of 60) because the literal denylist cannot ship. Compensating control for (1): `sanitize-scan.sh` reads **every tracked file** (`git ls-files -z`) on *every* run |
| **H** | Identity — repo name + org | 5 | **100** ↑ | **Decided 2026-07-27.** Product renamed **Sleuth → AEGIS**. Target repo `hiqs-suite/aegis-sleuth-slack-bot` — **already created, private, empty**, default `main`; operator is org **admin** and the org was already OAuth-authorized, so no new auth wall. Rename scoped to the **product name only** (149 replacements / 25 docs): `SLEUTH_*` env vars (34), code identifiers, `sleuth-app` paths and `@Sleuth` (functional in 18 src files) all deliberately unchanged |
| **I** | Publication execution | 10 | **100** ↑ | **PUBLIC 2026-07-28**, verified anonymously (unauthenticated web `200`, API `private=false`) — not from the authenticated view, which is what caught an earlier flip that had silently not taken. Zero-history single commit (author *and* committer `Neochrome <devops@neochro.me>`), 432 files. Everything the private repo blocked is now on: **secret scanning, push protection, Dependabot security updates**, and **branch protection on `main`** (required check `test`, `enforce_admins`, no force-push, no deletions). Branch protection means changes now land by PR — **PR #1 merged**, which also exercised the `pull_request` CI path for the first time |

**Weighted:** `20 + 10 + 10 + 10 + 15 + 7.5 + 7.5 + 5 + 10 = 95 / 100`
**Artifact (A–G):** `80 / 85 = 94%`

> **Note the shape of 2026-07-28.** Three dimensions moved and the headline barely did. **I** +2.5
> (public, all protections on); **G** −2.5 (its evidence cited a CI run that scanned **0 bytes**);
> **F** −1.5 (90 was never a legal value under this rubric's own 0/25/50/75/100 rule). Net:
> publication **96.5% → 95%**, artifact **99% → 94%**. At one point in the day publication was
> *unchanged* while two dimensions moved 2.5 in opposite directions — which is the argument for
> keeping the two numbers separate, and for the rule that a dimension is scored on what its check
> *observed*, never on the fact that a green tick appeared.

### What the remaining 5% actually is

**Every item on the original list is now done** — the repo is public with all protections on. What
remains is a different, smaller set, and none of it blocks anything:

| # | Item | Dim | Effort | Who |
|---|---|---|---|---|
| 1 | ~~`/front-door` + `/shakedown` re-run from the fresh clone~~ — **both DONE 2026-07-28**; between them found 9, fixed 5 | F, C | done | Me |
| 2 | ~~`FRONTDOOR.md`~~ — **DONE 2026-07-28**, plus `SHAKEDOWN/` reports now persisted | F | done | Me |
| 3 | **An outsider completes a real first run** with live Slack + OpenAI credentials | F | — | Human-gated |
| 4 | ~~GH-420 credential rotation~~ — **closed 2026-07-28 as an accepted risk**; `sleuth-app` stays private, public repo verified clean | — | done | Operator |

<details><summary>Original list (all closed) — kept for the record</summary>

| # | Item | Dim | Status |
|---|---|---|---|
| 1 | Decide repo name + GitHub org | H | **done** — `hiqs-suite/aegis-sleuth-slack-bot`, product AEGIS |
| 2 | Record the `RELEASES.md` DROP-list verdict | B | **done** — KEEP (operator, 2026-07-27) |
| 3 | Wire TruffleHog + a pre-commit hook | G | **done** — and then found broken by running it, three separate ways |
| 4 | Create private repo, re-run both gates from a real fresh clone | C, I | **done** — `npm ci`, jest 1470/1470, hooks installed, no path leaks |
| 5 | Flip public | I | **done 2026-07-28** — the one-way door, verified anonymously |

</details>

> ~~`CONTRIBUTING.md` + CLA decision; `SECURITY.md`~~ — **done 2026-07-27.** The CLA was the
> one-way door in this list: a PR merged under the wrong inbound terms cannot be un-merged out of a
> commercially licensed build. It is now answered *before* the repo is public, which was the point
> of deciding it here rather than at first PR.

**Deliberately excluded from this rubric:** GH-420 credential rotation. The public repo carries zero
history and every scan is clean, so rotation could never gate *publication*; scoring it here would
have made the number wrong in both directions. **Resolved 2026-07-28** — the operator closed GH-420
as an **accepted risk**: `sleuth-app` stays private permanently and the exposure is acceptable for
that repo. Recorded as *accepted, not rotated*; the keys were not rotated. The condition attached to
it — that the **public** repo carry none of those credentials — is verified three ways (60-rule scan
CLEAN over 433 files, TruffleHog full-tree `verified_secrets: 0`, every token-shaped string
identified by hand).

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
| D6 | Sanitization | **Full scrub** — no real **client** or infra identifier anywhere | ~~Includes `neochrome` itself~~ — **refined by E5**: the vendor's own name is KEPT. See the note below |
| D7 | Doc set | **Minimal public set**, docs rebuilt for outsiders | PDDA/agent-harness internals dropped |
| D8 | Repo name | **Open** — naming check gates creation | "Sleuth" is contested |

### On D6 — ~~why scrub `neochrome` too~~ → SUPERSEDED by E5 (operator, confirmed 2026-07-28)

> **D6's original argument, kept for the record:** Neochrome is the vendor and appears in `LICENSE`
> and `NOTICE` deliberately, but `neochrome` as a *workspace identifier* across 155 files makes the
> codebase read as one company's internal tool with a special-cased tenant, and leaks which
> workspace runs which experimental flag.

**That argument does not survive contact with the actual threat model, and E5 already said so.** The
private denylist carries the rule **deliberately disabled**, with the reason written inline:
*"NeochromeTeam is the copyright holder's own org and is KEPT (E5), so it is deliberately NOT a
rule"* and *"Rule retained but disabled so the decision is visible rather than implicit."*

Three reasons the scrub was never justified:

1. **There is no vulnerability.** `NEOCHROME_TEAM_ID` is a variable *name*; the value is not in the
   repo. A Slack team ID is not a credential — every workspace member can see it and it appears in
   URLs. The tenancy gate is fail-closed, and changing the value requires controlling the server's
   environment, at which point the gate is irrelevant anyway.
2. **It is not secret information.** "The company named Neochrome has a Slack workspace probably
   called neochrome" is the first thing anyone would guess. Redacting it protects nothing that
   guessing would not defeat instantly.
3. **The consent distinction is the one that matters.** Redacting `Client A`–`G` protects **third
   parties who never agreed to be named**. That obligation is real and those 28 rules stay. The
   vendor's own name is the vendor's own to disclose — and on an AGPL project that sells a
   commercial exception, the vendor is named in `LICENSE`, `NOTICE` and `LICENSE-COMMERCIAL.md` by
   design.

**Verified 2026-07-28 against the published repo:** full **60-rule** scan (private client denylist
included) over **433 tracked files** → `✓ CLEAN`. TruffleHog full-tree `verified_secrets: 0`. Every
`xoxb-`/`sk-ant-`-shaped string accounted for by hand — the scanner's canary, docs quoting it, one
config-template placeholder, one test fixture.

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

- [x] Confirm the collision set: Spring Cloud Sleuth (Pivotal/VMware), sleuth.io (deploy analytics)
      — resolved by renaming outright rather than qualifying
- [x] Check availability: **GitHub org + repo confirmed** (`hiqs-suite/aegis-sleuth-slack-bot`
      created). **npm package name and `.com`/`.dev` domain were NOT checked** — not needed, since
      nothing is published to npm and there is no marketing site in scope (see Anti-goals)
- [x] Decide: keep `sleuth` with a qualifier, or rename outright — **renamed outright to AEGIS**
- [x] Decide publishing identity: **`hiqs-suite`**, a separate org from `NeochromeTeam`
- [x] **Operator sign-off on the final name** — 2026-07-27

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
      — ~~**caveat:** run and acted on, but no `SHAKEDOWN/` report folder was persisted~~
      **RESOLVED 2026-07-28:** the Phase 6 re-run persisted one at
      `SHAKEDOWN/2026-07-28/aegis-public-repo-0838.md` with `SHAKEDOWN/INDEX.md` as the newest-first
      index. Note it is the *first* report, so there is nothing to diff against — the run can claim
      "clean today", not "no regression"
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
- [x] **DONE 2026-07-28.** Save the audit as `FRONTDOOR.md` in the new repo — a re-runnable health
      board with a deterministic check per finding, so onboarding rot is detectable later instead of
      discovered by a stranger. Written from the fresh-clone re-run: 6 findings (FD-01…FD-06), 2 fixed
      immediately, 1 withdrawn, 3 open with a check each. Invariant is **empty output = all green**;
      read-only by construction (never runs the repo's own scripts or tests). **Its checks block was
      executed, not just written** — the first extraction produced an empty file and therefore a
      silent all-green, which is the same false-green class as everything else found this week

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
      **0 verified** on both the filesystem artifact and a simulated zero-history squash.
      (Corrected 2026-07-28: this originally also claimed "0 unverified". There are 2, both
      documented decoys — see dimension A. `0 verified` is the gate)
- [x] **DONE 2026-07-27/28.** Wire it as a CI workflow in the new repo so a PR reintroducing any of
      it fails. `ci.yml` runs `sanitize-scan.sh` + TruffleHog (verified = gate, unverified =
      non-blocking report) on push to `main`/`development`, PRs targeting them, **and** a weekly
      `schedule` + `workflow_dispatch` for whole-tree coverage.
      **Two residual limits, stated not hidden:** (1) in CI the scanner can only run **32 of the 60
      rules** — the literal denylist is itself the de-anonymization key and cannot ship; (2) on
      push/PR, TruffleHog scans only the **event diff**, so whole-tree verified-credential coverage
      comes from the scheduled/dispatch runs
- [x] **DONE.** Add a pre-commit hook mirroring the CI check — `.githooks/pre-commit` +
      `utils/install-git-hooks.sh` + `npm run hooks:install` (sets `core.hooksPath`; no husky).
      Exit 2 from the scanner is treated as **fatal and non-bypassable** — "it found nothing because
      it scanned nothing" is failed differently from "it found nothing"

**Exit:** clean scan, gate wired.
**Status 2026-07-28: BOTH DONE — and both were then found broken by *running* them.** The gate was
built and passed a two-round adversarial swarm review on 2026-07-27 with three defects still in it:
`grep -IL` binary detection that silently reported 0 on macOS, a TruffleHog ghcr tag that 404s
(`:v3.96.0` — the *release* tag is v-prefixed, the *image* tag is not), and a whole-tree scan that
was never reachable. **None was catchable by inspection; all three were obvious on first execution.**
That is the durable lesson from this phase — see the note at the top of the scorecard.

This closes GH-420's "prevent recurrence" item structurally, which is the part of GH-420 this
project genuinely does absorb.

## Phase 6 — Create and publish `[gate]`

**Hard gates — all must be green before the repo is made public:**

- [x] Phase 0 name signed off — **`hiqs-suite/aegis-sleuth-slack-bot`**, product **AEGIS** (2026-07-27)
- [x] Phase 2 tests green — 1470/1470 across 89 suites
- [x] Phase 3 legal complete, no incompatible dependency, CLA decided — 7/7; CLA answered as a
      lightweight inbound grant, DCO considered and rejected with reason
- [x] Phase 5 scan clean **and gate wired** — both ✅ (see Phase 5 for the two residual limits)
- [x] **GH-420 — CLOSED by the operator 2026-07-28 as an accepted risk.** `sleuth-app` stays private
      permanently and the exposure is acceptable for that repo's purposes; the issue was closed
      manually. The operator's condition was that the **public** repo must not carry those
      credentials, which is **verified** (60-rule scan CLEAN over 433 files; TruffleHog full-tree
      `verified_secrets: 0`; every `xoxb-`/`sk-ant-` string identified by hand). Recorded plainly
      rather than as "rotated" — the credentials were **not** rotated, the risk was accepted
- [x] Clean-machine test: fresh clone → `npm ci` exit 0, jest **1470/1470**, `npm run hooks:install`
      configured `core.hooksPath`, no `/Users/` path leaks. **Caveat:** this proves the repo *builds
      and tests* from a foreign path — it is **not** a working first run against live Slack, which
      still nobody outside has done (that is the open half of dimension F)
- [x] **DONE 2026-07-28 — `/front-door` re-run against the pushed repo** from a fresh anonymous clone
      at a foreign path. Found 6, fixed 2 immediately: `package.json` `repository`/`bugs`/`homepage`
      still read `your-org/your-repo` on a published repo, and the **first install command was an
      unrunnable placeholder** (`git clone <your-fork-or-clone-url> sleuth`). Produced `FRONTDOOR.md`,
      a board where every status is decided by a command. Both were invisible to the Phase 4 local run
      for the obvious reason: locally you already have the repo
- [x] **DONE 2026-07-28 — `/shakedown` re-run from that same fresh clone** (foreign path, **no
      spaces**, new repo name). **Verdict `[warnings only]` — no discovery bug.** 18/18 scripts have
      shebang + exec bit + parse; 17/18 self-locate; 0 source a sibling by CWD-relative path.
      `sanitize-scan.sh` scanned **433 files from all five CWDs** including `/` and a spaces-path —
      the file count being the evidence, not the `✓ CLEAN`. 3 low findings, all fixed: two stale
      `your-org/sleuth` install examples (URL form *and* slug form) and one non-overridable
      `APP_DIRECTORY` its sibling already made configurable.
      **Report persisted at `SHAKEDOWN/2026-07-28/aegis-public-repo-0838.md`** — the first one ever
      written down, which closes the Phase 2 caveat below

Then:

- [x] `gh repo create <org>/<name> --private` — **private first**
- [x] Single initial commit of the sanitized tree — 432 files, author *and* committer `Neochrome <devops@neochro.me>`
- [x] Re-run the secret scan against the pushed repo — from a real fresh clone, and again in CI
- [x] Enable GitHub secret scanning + **push protection** — both on (returned `422` while private on a free org)
- [x] Branch protection on `main` — required check `test`, `enforce_admins`, no force-push, no deletions
- [x] Flip to **public** (2026-07-28) — verified **anonymously**, not from the authenticated view,
      which is what caught an earlier attempt that had silently not taken

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

Answered (2026-07-27/28), kept for the record:

1. ~~**Final name and publishing org**~~ → **`hiqs-suite/aegis-sleuth-slack-bot`**, product **AEGIS**
2. ~~**Commercial-license contact address**~~ → provisionally `support@neochro.me`, because it
   demonstrably routes. A dedicated `licensing@` alias remains a one-line swap
3. ~~**CLA or DCO?**~~ → **lightweight inbound licence grant**, recorded by opening a PR. A DCO was
   considered and **rejected**: it grants only the outbound licence (AGPL), which is precisely what
   would break the ability to sell a commercial exception

Still open:

4. Does the public `CHANGELOG` keep the existing `v1.4.x` numbering, or does the public release
   reset to `v2.0.0` with prior entries preserved beneath it? **Currently still `v1.4.x`** (now
   `1.4.258`) — the default happened by continuing to ship, not by a decision. Worth deciding
   deliberately, since a public `v1.x` implies a stability promise the internal numbering never made
5. ~~**GH-420 credential rotation**~~ → **CLOSED by the operator, 2026-07-28, as an accepted risk.**
   `sleuth-app` stays private permanently, and the exposure is acceptable for that repo's purposes.
   The operator's stated condition was that the **public** repo must not carry those credentials —
   **verified**: 60-rule scan CLEAN over 433 files, TruffleHog full-tree `verified_secrets: 0`, and
   every token-shaped string in the tree identified by hand as a placeholder, fixture or canary

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
