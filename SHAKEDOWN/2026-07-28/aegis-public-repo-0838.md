# [SHAKEDOWN] aegis-sleuth-slack-bot — 2026-07-28 08:38

**Target:** `hiqs-suite/aegis-sleuth-slack-bot` — the **published public repo**, cloned anonymously
to `/private/tmp/.../scratchpad/sd/aegis` (foreign path, **no spaces**, new repo name)
**Target HEAD:** `34a0c23` — docs: withdraw FD-05 (E5 already settled it); close GH-420 as accepted risk (#6)
**Env:** Darwin 24.6.0 arm64 · GNU bash 3.2.57(1)-release
**Verdict:** **[warnings only]** — no discovery bug reproduced. Every runnable script located itself
and its siblings from every CWD tested, including `/` and a path with spaces. Three stale-placeholder
warnings, none blocking; all three fixed.

This is the **Phase 6 re-run** GH-423 calls *"the one that counts"* — new repo name, foreign path,
no spaces — which had never been performed. The Phase 2 run happened locally in a directory named
`sleuth-app` under `GH Repos` (a path *with* a space), by someone who already had the code.

---

## Scope note — why the skill audit is one line

`skills/talk-to-reminders/` is the repo's only `SKILL.md`, and it is **pure prose: zero bundled
`.sh` scripts**. Shakedown's own calibration rule ("No bundled scripts → say so and stop") applies,
and `audit.sh` agrees:

```
### Invocation paths (graded from SKILL.md)
(no .sh invocation tokens in SKILL.md — nothing to grade)
### Bundled-script hygiene
(no bundled .sh scripts — pure-prose skill; nothing to harden)
Verdict: [clean]          (exit 0)
```

The real exposure is elsewhere: **18 tracked shell scripts** in `scripts/`, `utils/`, `deploy/` and
the repo root, which an outside user runs from an arbitrary clone path. That is where the Phase 2
run found its actual bug (both installers hardcoding a repo URL in the old org — a guaranteed 404 on
step one), so that is what this run audits.

## Static audit — all 18 tracked scripts

| Property | Result |
|---|---|
| Shebang present | **18 / 18** |
| Executable bit set | **18 / 18** |
| `bash -n` parses | **18 / 18** |
| Self-locates (`BASH_SOURCE` / `$0`) | **17 / 18** — the one exception is dismissed below |
| Sources a sibling by CWD-relative path | **0** — the six `pdda-*` scripts all use `. "$HERE/pdda-lib.sh"`, which is the correct pattern |
| Hardcoded `/Users/` or `GH Repos` paths | **0 real** — the four matches are *detection patterns inside the scanner's own rules*, not paths it uses |
| `cd` into a fixed directory | **0** |

Independent corroboration: the repo's own `pdda-check-hardcoded-paths` check reports `errors=0`.

## Live harness

Run by **absolute path** from each CWD. "found" means the script and its own resources resolved;
a non-zero rc from a *located* script would be a runtime error, not a discovery bug.

### `utils/sanitize-scan.sh` — read-only, and the highest-stakes script here

| Scenario | Found | rc | Files scanned | Result |
|---|---|---|---|---|
| control (repo root) | found | 0 | **433** | ✓ CLEAN |
| foreign CWD | found | 0 | **433** | ✓ CLEAN |
| nested CWD (`foreign/nested/deep`) | found | 0 | **433** | ✓ CLEAN |
| **spaces-in-path** (`with spaces/aegis clone`) | found | 0 | **433** | ✓ CLEAN |
| `/` (root CWD) | found | 0 | **433** | ✓ CLEAN |

**The file count is the load-bearing evidence, not the `✓ CLEAN`.** A scanner invoked from a
non-git CWD could plausibly have found no files and reported clean — that is precisely the
false-green this project hit four separate times on 2026-07-27/28. It scanned **433 files in every
scenario**, so it genuinely self-locates to its own repo root rather than trusting CWD.

### `utils/pdda/pdda.sh frontmatter` — sources a sibling (`pdda-lib.sh`)

| Scenario | Found | rc | Last line |
|---|---|---|---|
| control | found | 0 | `errors=0 warns=0 info=0` |
| foreign CWD | found | 0 | `errors=0 warns=0 info=0` |
| nested CWD | found | 0 | `errors=0 warns=0 info=0` |
| spaces-in-path | found | 0 | `errors=0 warns=0 info=0` |
| `/` (root CWD) | found | 0 | `errors=0 warns=0 info=0` |

This is the scenario the `source`-a-sibling pattern exists for, and `$HERE` holds under all five.

### `utils/install-git-hooks.sh` — mutates `git config --local` only

| Scenario | Found | rc | Result |
|---|---|---|---|
| control | found | 0 | configured, `core.hooksPath=.githooks` |
| foreign CWD | found | 0 | **"already configured"** |
| spaces-in-path | found | 0 | configured, `core.hooksPath=.githooks` |

The `foreign CWD` result is the informative one: `$SP/foreign` is **not a git repo**, so
`git config --local` would have failed had the script trusted CWD. Reporting "already configured"
proves it resolved back to its own repository. Verified `--local` (never `--global`) before running.

## Findings

| ID | Sev | File | Finding |
|---|---|---|---|
| **SD-01** | 🟡 low | `macos-local-install.sh:100` | The error message still offers `SLEUTH_REPO_URL=https://github.com/your-org/sleuth.git` as its example. Same stale-placeholder class as FD-02 (the README clone command), which is now fixed — a user copy-pasting this example gets a 404. **Not a 404 by default:** `SLEUTH_REPO_URL` has no default and the script fails closed with a clear instruction, which is correct behaviour. Only the example URL is stale, and a real public URL now exists to name |
| **SD-02** | 🟡 low | `scripts/server-install.sh:37` | `APP_DIRECTORY="/root/sleuth-app"` is hardcoded, while its sibling `deploy/reminders-export/install.sh:14` uses `APP_DIR="${SLEUTH_APP_DIR:-/root/sleuth-app}"`. Two installers in one repo disagree on whether the install root is overridable. `/root/sleuth-app` is a defensible convention for a root-owned server install; the inconsistency is the finding, not the default |
| **SD-03** | 🟡 low | `scripts/quick-install.sh:105` | Same stale placeholder as SD-01, in the *slug* form: `SLEUTH_REPO=your-org/sleuth`. This one feeds `https://raw.githubusercontent.com/${SLEUTH_REPO}/.../scripts/server-install.sh`, so the example names a repo that exists nowhere. **Found only after fixing SD-01 — see the detection-gap note below** |

### My own detection missed SD-03

SD-01 and SD-03 are the same defect in two spellings. My sweep grepped
`https://github\.com/[A-Za-z0-9._/-]+`, which matches the **URL** form in `macos-local-install.sh`
but not the bare **`owner/repo` slug** form in `quick-install.sh`. SD-03 surfaced only because the
post-fix verification grep (`your-org`) was written differently from the discovery grep.

Recording it because it is the same failure this whole project keeps hitting: **the check that
looks right finds nothing, and nothing looks like clean.** A pattern narrower than the thing it is
hunting reports a false all-clear. The discovery sweep should have been `your-org|your-repo|your-fork`
from the start — matching on the *placeholder token*, not on one syntax that happens to carry it.

### Graded and dismissed — not a defect

`scripts/ssh-setup.sh` is the only script that does **not** self-locate, which the static table
flags. On inspection it references **no siblings and no relative paths** — its single filesystem
target is `~/.ssh/config`, an absolute path. There is nothing for it to locate, so adding
`SCRIPT_DIR` would be ceremony. Recording it as dismissed rather than silently dropping it, and
rather than reporting a warning that isn't real.

## Patch — APPLIED

Shakedown's default is *propose, don't apply*. These were applied instead: three one-line string
changes plus one env-var default, all reversible, per the operator's standing preference for small
high-confidence fixes. `bash -n` passes on all three scripts.

### Deliberately NOT changed — and blanket-replacing would have been a bug

Seven other `your-org` placeholders remain, in `config/workspace-template.json`,
`deploy/reminders-export/README.md` and `docs/web-api.md`. **These are correct.** They stand for
*the operator's own* repository — `GITHUB_ACTIONS_REPO`, `SLEUTH_EXPORT_REPO` — not for AEGIS.
Replacing them with `hiqs-suite/aegis-sleuth-slack-bot` would instruct every user to point their
GitHub Actions integration and reminder export at **this project's** repo, which is worse than the
stale placeholder. The distinction that decides it: *does this variable name the software being
installed, or the user's own project?* Only the former was stale.

```diff
--- a/macos-local-install.sh
+++ b/macos-local-install.sh
@@
     elif [ -z "$SLEUTH_REPO_URL" ]; then
         log_error "Set SLEUTH_REPO_URL to the repository to clone, e.g.:"
-        log_error "  SLEUTH_REPO_URL=https://github.com/your-org/sleuth.git $0"
+        log_error "  SLEUTH_REPO_URL=https://github.com/hiqs-suite/aegis-sleuth-slack-bot.git $0"
         exit 1
```

```diff
--- a/scripts/quick-install.sh
+++ b/scripts/quick-install.sh
@@
     echo "ERROR: set SLEUTH_REPO to the GitHub repo to install from, e.g.:"
-    echo "  SLEUTH_REPO=your-org/sleuth $0"
+    echo "  SLEUTH_REPO=hiqs-suite/aegis-sleuth-slack-bot $0"
```

```diff
--- a/docs/server-installation-guide.md
+++ b/docs/server-installation-guide.md
@@
-- **Repository**: `owner/repository-name` (e.g., `your-org/sleuth`)
+- **Repository**: `owner/repository-name` — your fork or clone of AEGIS (canonical: `hiqs-suite/aegis-sleuth-slack-bot`)
@@
-export GITHUB_REPO="your-org/sleuth"   # your fork/clone
+export GITHUB_REPO="hiqs-suite/aegis-sleuth-slack-bot"   # or your own fork/clone
```

```diff
--- a/scripts/server-install.sh
+++ b/scripts/server-install.sh
@@
 APP_USER="root"
-APP_DIRECTORY="/root/sleuth-app"
+# Overridable, to match deploy/reminders-export/install.sh which already honours SLEUTH_APP_DIR.
+APP_DIRECTORY="${SLEUTH_APP_DIR:-/root/sleuth-app}"
```

## What I could not verify

- **Shakedown does not instrument Claude Code's skill resolver.** It tests whether a *documented
  command* is CWD-robust, not how the runtime itself locates a skill. Moot here anyway — the one
  skill ships no scripts.
- **Nine of the eighteen scripts were never executed**, because running them mutates a machine or
  needs a live server: `macos-local-install.sh`, `scripts/server-install.sh`,
  `scripts/quick-install.sh`, `scripts/quick-admin-setup.sh`, `scripts/ssh-setup.sh`,
  `deploy/reminders-export/install.sh`, `backup-sleuth-data.sh`, `backup-sleuth-data-fixed.sh`,
  `utils/sanitize-apply.sh`. They were audited **statically only** (shebang, exec bit, `bash -n`,
  self-location, sibling sourcing, hardcoded paths). A path bug reachable only at runtime in one of
  these would not have been caught. Live coverage is **9 / 18**.
- **Not tested on Linux.** All scenarios ran on macOS/bash 3.2. Given that a macOS-only `grep -IL`
  portability bug in `sanitize-scan.sh` was the headline defect of 2026-07-27 — it silently reported
  0 binaries on macOS while failing on Linux — a single-platform pass is a real limitation. CI does
  exercise `sanitize-scan.sh` on ubuntu-latest every run, which partly covers the most important one.
- **No `SHAKEDOWN/` report existed before this one.** GH-423 Phase 2 recorded that its run was
  "run and acted on, but no report folder was persisted". This file is the first re-readable matrix,
  so there is no prior run to diff against — "no regression" cannot be claimed, only "clean today".
