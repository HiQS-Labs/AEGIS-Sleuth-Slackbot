# SHAKEDOWN index

Newest first. Each entry is one `/shakedown` run — a CWD/install-path robustness audit of the
repo's bundled shell scripts and script-calling skills.

- **2026-07-28 08:38** — [aegis-public-repo](2026-07-28/aegis-public-repo-0838.md) — **[warnings only]**.
  First run against the **published public repo** from a fresh anonymous clone at a foreign path with
  no spaces (the GH-423 Phase 6 re-run, never previously done). No discovery bug: 18/18 scripts have
  shebang + exec bit + parse; 17/18 self-locate (the exception has no relative refs and is dismissed);
  `sanitize-scan.sh` scanned **433 files from every CWD including `/` and a path with spaces**.
  2 low findings — a stale `your-org/sleuth.git` example in the macOS installer's error message, and
  `server-install.sh` hardcoding an install root its sibling makes overridable. Live coverage 9/18;
  macOS only.
