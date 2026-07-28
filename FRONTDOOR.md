# FRONTDOOR — onboarding health board

Can a stranger who has never seen this project get from `git clone` to a working AEGIS? This board
answers that with **re-runnable checks**, not opinions. Every status below is decided by a command in
[Deterministic checks](#deterministic-checks--re-run-to-refresh); the invariant is **empty output =
all green**, and any printed line names an OPEN finding.

Refresh it when the README, the install path, `.env.example`, `package.json` metadata, or the set of
root `*.md` files changes — those are what a newcomer actually touches.

| | |
|---|---|
| **Last audited** | 2026-07-28, against `main` at a **fresh anonymous clone** (not a working copy) at a foreign path with no spaces |
| **Method** | `/front-door` walk — clone → docs → install → auth → first success, plus a secret sweep |
| **Verdict** | ⚠️ **Bumpy** — an agent-assisted newcomer reaches a running process. The two install-path blockers found in this audit are fixed; what remains is an incomplete env-var story and unlabelled internal docs. No leaked secrets. |

## Health at a glance

| Dimension | | Note |
|---|---|---|
| 🔑 Leaked secrets | ✅ | 0 verified secrets across the full tree (5,445,696 bytes / 756 chunks in CI). Only `.env.example` is tracked; no `.env`. No real Slack team ID anywhere |
| One front door | ⚠️ | README is clearly canonical and has a TOC + Documentation map — but 17 root `*.md` files exist and 8 of them are internal-process docs the map never mentions |
| Install path | ✅ | Clone command is a real, anonymously-verified URL (was a placeholder — FD-02) |
| Auth & access | ✅ | Honest about the walls: a Slack app you create, and an AI key you pay for. Neither is hidden |
| First success works | ⚠️ | `@Sleuth help` is a real checkpoint, but **no outsider has completed a live first run** |
| Config discoverability | 🚧 | `.env.example` documents **1** variable; `src/` reads **31** |
| Doc ↔ code drift | ✅ | `package.json` metadata now points at the real repo (was `your-org/your-repo` — FD-01) |

## Findings

| ID | Area | Sev | Status | Fix |
|---|---|---|---|---|
| FD-01 | Drift | 🟠 | ✅ FIXED | `package.json` `repository`, `bugs` and `homepage` all pointed at `your-org/your-repo`, breaking GitHub's sidebar links and "report an issue" on a *published* repo. Now `hiqs-suite/aegis-sleuth-slack-bot` |
| FD-02 | Install | 🟠 | ✅ FIXED | The first install command was `git clone <your-fork-or-clone-url> sleuth` — a placeholder that fails as written, naming the directory `sleuth` rather than `aegis`. Now the real public URL, verified by cloning from it anonymously |
| FD-03 | Config | 🟠 | ⬜ OPEN | `.env.example` defines **1** variable (`ADMIN_ENCRYPTION_KEY`) while `src/` reads **31** distinct `process.env` keys, 11 of them `SLEUTH_*`. The README's Configuration reference is prose, not a list. A newcomer has no single place to learn what is configurable |
| FD-04 | Front door | 🟡 | ⬜ OPEN | 17 root `*.md` files. The Documentation map lists 9; it never mentions `ROUTER.md`, `SENTINEL.md`, `CLAUDE.md`, `ROADMAP.md`, `GUIDING-PRINCIPLES.md`, `ARCHITECTURE-DECISIONS.md` or `RELEASES.md`. These are internal-process docs; a newcomer opening `ROUTER.md` first learns nothing about running the app. Either list them as internal, or move them under `PROJECT/` |
| FD-05 | Sanitization | 🟠 | ⬜ OPEN — **operator decision** | Decision **D6** said scrub `neochrome` as a *workspace identifier* (`LICENSE`/`NOTICE` keep it as the **vendor**, which is D2 and correct). It survives in **97 files** — 41 under `PROJECT/`, 8 in `src/` (`NEOCHROME_TEAM_ID`). `ROADMAP.md` states outright which workspace runs which experimental flag, which is the exact leak D6 named. **No credential is exposed** — the team-ID *value* lives outside the repo. This is disclosure/positioning, and it needs a decision, not a script |
| FD-06 | First success | 🟡 | ⬜ OPEN | No outsider has completed a first run against live Slack + a live AI key. The fresh-clone test proves it *builds and tests*, which is not the same thing. This is the open half of rubric dimension F |

### Why FD-05 can't be closed by CI

`sanitize-scan.sh` runs **32 of its 60 rules** in CI. The other 28 are literal client and workspace
names — that denylist *is* the de-anonymization key, so it cannot ship in a public repo. The scanner
says so out loud rather than implying full coverage:

```
no --rules given: shape rules only (client-name leaks will NOT be detected)
active rules: 32
```

So FD-05 is invisible to the automated gate **by construction**. It is listed here because a board
that only tracks what CI can see would score this repo green on a question CI is structurally unable
to answer.

## Verified baselines (keep green)

These are the facts that must not regress. Each has a check below.

| Baseline | Evidence |
|---|---|
| No verified secrets | TruffleHog full-tree in CI: `verified_secrets: 0` over 756 chunks / 5,445,696 bytes |
| No committed `.env` | Only `.env.example` is tracked |
| Entry point resolves | `package.json` `main` → `src/app.js`, exists |
| README links resolve | Every relative link in `README.md` points at a real path |
| Test suite green | jest **1470/1470 across 89 suites**; `node --test` 30/30 |
| No critical/high prod vulns | `npm audit --omit=dev`: 0 critical, 0 high (12 moderate) |

## Deterministic checks — re-run to refresh

Run from the repo root. **Empty output = all green.** Any printed line names an OPEN finding.
Read-only: no mutations, no network, and this block never executes the repo's own scripts or tests.

```bash
# --- Findings -------------------------------------------------------------
grep -q 'your-org/your-repo' package.json \
  && echo "FD-01 OPEN: package.json still has your-org/your-repo placeholders"

grep -q '<your-fork-or-clone-url>' README.md \
  && echo "FD-02 OPEN: README install command is still a placeholder"

ENV_IN_EXAMPLE=$(grep -cE '^[A-Z][A-Z0-9_]*=' .env.example)
ENV_IN_SRC=$(git ls-files -z 'src/*.js' | xargs -0 grep -ohE 'process\.env\.[A-Z0-9_]+' \
             | sort -u | wc -l | tr -d ' ')
[ "$ENV_IN_EXAMPLE" -lt "$ENV_IN_SRC" ] \
  && echo "FD-03 OPEN: .env.example documents $ENV_IN_EXAMPLE of $ENV_IN_SRC env vars read by src/"

for f in ROUTER.md SENTINEL.md CLAUDE.md ROADMAP.md GUIDING-PRINCIPLES.md \
         ARCHITECTURE-DECISIONS.md RELEASES.md; do
  [ -f "$f" ] && ! grep -q "$f" README.md \
    && echo "FD-04 OPEN: $f is a root doc that the README's Documentation map never mentions"
done

NEO=$(git ls-files -z | xargs -0 grep -oil 'neochrome' 2>/dev/null \
      | grep -vE '^(LICENSE|NOTICE|CONTRIBUTING\.md|LICENSE-COMMERCIAL\.md|SECURITY\.md|README\.md|FRONTDOOR\.md)$' \
      | wc -l | tr -d ' ')
[ "$NEO" -gt 0 ] \
  && echo "FD-05 OPEN: 'neochrome' used as a workspace identifier in $NEO files (D6 partially executed)"

grep -q 'no outsider has' FRONTDOOR.md 2>/dev/null \
  && echo "FD-06 OPEN: no verified outsider first run against live Slack"

# --- Baselines (must stay silent) -----------------------------------------
git ls-files | grep -qE '^\.env$' \
  && echo "BASELINE BROKEN: a real .env is tracked — rotate those credentials, then untrack"

node -e 'const m=require("./package.json").main;
         if(!require("fs").existsSync(m)) console.log("BASELINE BROKEN: package.json main "+m+" missing")'

grep -oE '\]\(([^)]+)\)' README.md | sed 's/](//;s/)$//' \
  | grep -vE '^https?://|^#|^mailto:' | sort -u \
  | while read -r l; do [ -e "${l%%#*}" ] || echo "BASELINE BROKEN: dead README link -> $l"; done

# Recorded by hand after a manual run -- NEVER auto-derived by this block, because
# deriving it would mean executing the suite, which this board must not do.
EXPECTED_TESTS=1470
grep -q "$EXPECTED_TESTS" README.md 2>/dev/null || true   # informational anchor only
```

> **On the test count:** it is a literal you update by hand after running the suite yourself. This
> block will not run jest to derive it. Piping a real test run through `sed` is execution wearing a
> read-only disguise, and a board that mutates or builds the repo it audits is a footgun.

## What this board does not verify

- **It has never run AEGIS against live Slack.** Everything here is static analysis plus a build/test
  check. FD-06 exists precisely because that gap cannot be closed by inspection.
- **It cannot see the 28 private scanner rules** (FD-05). A green CI secret gate does not mean
  "no client identifiers"; it means "no *shapes* of credentials".
- **It does not audit git history** — this repo is zero-history by construction (one squashed initial
  commit), so there is no history to sweep. That property is what makes the claim cheap here and
  would not hold in a repo with real history.
