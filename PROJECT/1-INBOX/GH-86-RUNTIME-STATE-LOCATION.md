---
gh_issue: 86
source: https://github.com/HiQS-Suite/AEGIS-Sleuth-Slackbot/issues/86
title: "Enabled-channels state is bound to the install directory, and shutdown writes memory over disk"
status: Proposed (1-INBOX — not yet active)
created: 2026-08-18
doc_type: bugfix
related: "GH-88 (diagnostics baseline should surface the resolved runtime path); GH-60 introduced SLEUTH_DATA_DIR, which this adopts in production"
---

# GH-86 — Runtime state must not live inside the install directory

## The reported symptom, and what it actually was

> "I could have sworn reminders were enabled on this channel before but not 100% sure."

**Deploys do not reset the toggle.** Verified, not assumed:

- `data/runtime/` is gitignored; `git ls-files | grep enabled_channels` returns nothing. A `git pull`
  cannot touch it.
- Across the 1.4.298 production restart the file survived intact:
  ```
  03:46:26  (old pid) saved 10 enabled channels to file
  03:46:32  (new pid) loaded 10 enabled channels from file
  04:24:54  (new pid) saved 11 enabled channels to file   <- operator action, not the deploy
  ```

The memory is still probably right, for a different reason.

## Root cause 1 — the runtime tree follows the code

`src/workspaces.js:63-71`:

```js
return path.resolve(path.join(__dirname, '..', 'data', 'runtime'));
```

The fallback is relative to **`__dirname`** — where the code lives. Move the install, move the state.
Production has two trees and they disagree:

| Directory | `neochrome_enabled_channels.json` | mtime |
|---|---|---|
| `/root/sleuth-app-v3` (live per systemd drop-in) | 11 channels | 2026-08-18 04:24 |
| `/root/sleuth-app` (dead) | 10 channels | 2026-08-11 04:58 |

`systemctl cat sleuth-app` shows the base unit still pointing at `/root/sleuth-app` with a drop-in
overriding to `-v3`. Anything enabled in the old tree after the copy was stranded — which presents
exactly as "the toggle reset after a deploy."

`scripts/deploy.sh:6` compounds it: `APP_DIR="${SLEUTH_APP_DIR:-/root/sleuth-app}"` defaults to the
**dead** directory.

## Root cause 2 — shutdown persists memory over disk with no floor

`src/reminders-module.js:1403` (`StopAsync`) calls `SaveEnabledChannelsAsync()` unconditionally.
`src/reminders-channel-settings.js:59-62` treats `ENOENT` as "start empty".

Compose them: a process that starts against a tree where the file is missing, then shuts down
cleanly, writes `[]` to that path. Today this is **latent** — non-`ENOENT` load errors throw, so the
empty set only arises where there was genuinely no file. But there is no invariant preventing a
shutdown write from shrinking the set, and the shutdown save buys nothing: `EnableRemindersForChannelAsync`
and `DisableRemindersForChannelAsync` already save eagerly on every change.

## Plan

**Phase 1 — stop the bleeding (ops, no code).**
Set `SLEUTH_DATA_DIR=/var/lib/aegis-sleuth` (or similar, outside any install dir) in the systemd
unit on both servers, after copying the live tree there. `GetRuntimeDirPath()` already honours it —
GH-60 added the lever; production simply never used it.

**Phase 2 — make the wrong target impossible.**
`scripts/deploy.sh` must not default to a directory the service does not run from. **Derive it from
systemd** — `systemctl show sleuth-app -p WorkingDirectory --value` — falling back to
`$SLEUTH_APP_DIR` and failing loudly only if neither resolves.

Deliberately *not* "require `SLEUTH_APP_DIR`": the script's own header calls it the canonical
post-deploy hook for DeployHQ, so making it fail on an unset variable would break any caller that
does not already export one. Deriving from systemd asks nothing of the caller and cannot disagree
with the unit that actually runs the process — it removes the coupling rather than documenting it.
`docs/deployhq.md` currently mentions neither `deploy.sh` nor `APP_DIR`, so the DeployHQ side is
undocumented either way; confirm its job config before shipping, and write down whatever is found.

**Phase 3 — remove the shutdown write.**
Delete the `SaveEnabledChannelsAsync()` call in `StopAsync()`. If it is kept instead, gate it so it
can only persist a set that is a superset of what was loaded, unless an explicit disable was
recorded this process lifetime.

**Phase 4 — reconcile and archive.**
Diff the two trees, merge anything only present in `/root/sleuth-app`, move it off the box.

## Acceptance

- [ ] Moving the install directory does not change which runtime tree is read (assert
      `GetRuntimeDirPath()` is env-pinned in the deployed unit).
- [ ] A test pins that load-then-shutdown with no user action cannot shrink the enabled set.
- [ ] `scripts/deploy.sh` cannot silently target a directory the service does not run from.
- [ ] `/root/sleuth-app` is archived and its unique state merged.

## Sequencing against GH-88 / GH-89

**Phase 1 ships immediately and alone.** It is a live state-divergence hazard fixed by configuration,
and nothing about it depends on the diagnostics work. Only the *verification* step — reading the
resolved runtime path back off a diagnostic surface — wants GH-88, and that is a convenience, not a
prerequisite: `systemctl show` answers the same question today.

Phases 2-4 are independent of GH-88 entirely.

## Risks

- Phase 1 is a **state move**: copy, verify counts per workspace, then switch. A wrong order loses
  the newer tree. Do it with the service stopped.
- Phase 2 touches a script an external deploy system may invoke. Deriving from systemd is chosen
  precisely to avoid requiring a coordinated config change, but confirm the DeployHQ job before
  shipping.
- Phase 3 changes shutdown behaviour; confirm no other state depends on that call ordering.
