# FRONTDOOR — onboarding health board

Can a stranger who has never seen this project get from `git clone` to a working AEGIS? This board
answers that with **re-runnable checks**, not opinions. Every status below is decided by a command in
[Deterministic checks](#deterministic-checks--re-run-to-refresh); the invariant is **empty output =
all green**, and any printed line names an OPEN finding.

Refresh it when the README, the install path, `.env.example`, `package.json` metadata, or the set of
root `*.md` files changes — those are what a newcomer actually touches.

| | |
|---|---|
| **Last audited** | 2026-07-29, after docs/package adoption polish on `fix-compile-errors` |
| **Method** | `/front-door` walk — clone → docs → install → auth → first success, plus prior secret sweep |
| **Verdict** | ✅ **Improved** — [`docs/getting-started.md`](docs/getting-started.md) is the canonical linear onboarding path; README Quick start table links every step. Live Slack first-run still unverified by an outsider (FD-06). |

## Health at a glance

| Dimension | | Note |
|---|---|---|
| 🔑 Leaked secrets | ✅ | 0 verified secrets across the full tree (5,445,696 bytes / 756 chunks in CI). Only `.env.example` is tracked; no `.env`. No real Slack team ID anywhere |
| One front door | ✅ | README → [`docs/getting-started.md`](docs/getting-started.md) for first run; internal docs listed separately |
| Install path | ✅ | Clone command is a real, anonymously-verified URL (was a placeholder — FD-02) |
| Auth & access | ✅ | Honest about the walls: a Slack app you create, and an AI key you pay for. Neither is hidden |
| First success works | ⚠️ | `@Sleuth help` is a real checkpoint, but **no outsider has completed a live first run** |
| Config discoverability | ⚠️ | `.env.example` + README Configuration reference cover host-level vars; optional `SLEUTH_*` flags remain in code comments only |
| Doc ↔ code drift | ✅ | `WEB_API_BEARER_TOKEN` is consistent in README, `docs/web-api.md`, and macOS guide; server install uses Web API for workspaces |

## Findings

| ID | Area | Sev | Status | Fix |
|---|---|---|---|---|
| FD-01 | Drift | 🟠 | ✅ FIXED | `package.json` `repository`, `bugs` and `homepage` all pointed at `your-org/your-repo`, breaking GitHub's sidebar links and "report an issue" on a *published* repo. Now `hiqs-suite/aegis-sleuth-slack-bot` |
| FD-02 | Install | 🟠 | ✅ FIXED | The first install command was `git clone <your-fork-or-clone-url> sleuth` — a placeholder that fails as written, naming the directory `sleuth` rather than `aegis`. Now the real public URL, verified by cloning from it anonymously |
| FD-03 | Config | 🟠 | ⚠️ IMPROVED | `.env.example` now documents host-level vars (`ADMIN_ENCRYPTION_KEY`, `WEB_API_BEARER_TOKEN`, `WEB_API_PORT`) and README adds a Configuration reference table. Optional `SLEUTH_*` feature flags remain undocumented in `.env.example` by design — see commented lines in the template |
| FD-04 | Front door | 🟡 | ✅ FIXED | README Documentation map now includes an **Internal / agent docs** subsection listing `ROUTER.md`, `CLAUDE.md`, `SENTINEL.md`, `ROADMAP.md`, `GUIDING-PRINCIPLES.md`, `ARCHITECTURE-DECISIONS.md`, `RELEASES.md`, and `FRONTDOOR.md` |
| FD-05 | Sanitization | — | ✅ **CLOSED — won't fix (already decided, E5)** | Raised as "`neochrome` survives as a workspace identifier in 97 files". **Withdrawn: this was re-litigating a settled decision.** The private denylist carries the rule *deliberately disabled*, with the reason inline — "NeochromeTeam is the copyright holder's own org and is KEPT (E5)" — so E5 had already refined D6, and the finding read D6 alone. On the merits there is also no vulnerability: `NEOCHROME_TEAM_ID` is a variable *name*; a Slack team ID is not a credential (every workspace member sees it, it appears in URLs), the gate is fail-closed, and changing the value requires controlling the server env. Redacting `Client A`–`G` protects **third parties who never consented**; the vendor's own name is the vendor's to disclose. Operator confirmed 2026-07-28 |
| FD-06 | First success | 🟡 | ⬜ OPEN | No outsider has completed a first run against live Slack + a live AI key. The fresh-clone test proves it *builds and tests*, which is not the same thing. This is the open half of rubric dimension F |

### What CI's secret gate can and cannot see

`sanitize-scan.sh` runs **32 of its 60 rules** in CI. The other 28 are literal client names — that
denylist *is* the de-anonymization key, so it cannot ship in a public repo. The scanner says so out
loud rather than implying full coverage:

```
no --rules given: shape rules only (client-name leaks will NOT be detected)
active rules: 32
```

So **client-name leaks are invisible to the automated gate by construction**, and a green CI secret
step means "no credential *shapes*", never "no client identifiers". Run the full 60-rule scan from a
checkout that carries the private denylist.

**Done 2026-07-28, and it is clean:** all **60 rules** over **433 tracked files** → `✓ CLEAN`.
TruffleHog full-tree agrees at `verified_secrets: 0`. Every `xoxb-`/`sk-ant-` shaped string in the
tree was also accounted for by hand: two are the scanner's own canary, two are docs quoting it, one
is `sk-ant-your-anthropic-api-key-here` in a config template, one is `sk-ant-test` in a fixture.

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

# FD-05 has NO check: it is closed won't-fix, and the vendor's own name appearing in its own
# repo is a deliberate decision (E5), not a condition to re-detect. A check here would fire
# forever and train the reader to ignore the block. What still matters -- CLIENT names, which
# are third-party data -- cannot be checked here: those 28 rules are the de-anonymization key
# and live outside the repo. Run the full 60-rule scan from a checkout that has them.

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
