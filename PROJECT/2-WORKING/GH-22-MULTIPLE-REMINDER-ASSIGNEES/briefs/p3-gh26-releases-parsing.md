# p3 — GH-26: RELEASES.md fixture error + Codename absorbed by preceding block

Release 1.4.270 "Roundup" · issue [#26] · depends on p2

Two defects in one file and one check. Fixing them together is what finally gets
`pdda.sh releases` to `errors=0`.

## Defect 1 — the `<!--test-->` fixture errors on every run

`RELEASES.md:9-17` holds a leftover fixture whose `Release:` value is empty:

```
ERROR [pdda-check-releases] RELEASES.md:11 a 'Release:' block near line 11 has no version
```

The check is **correct** — this is a true positive, and the empty-`Release:` guard must stay. The
question is only the fixture.

Preferred fix: **delete the fixture block.** It is titled `Codename: "Test"` / `Description: FTest`
and contains two typos (`Shakdedown`, `reviwed`); it is scratch content, not a spec.

If instead a fenced-fixture concept is wanted, have `pdda-check-releases` skip regions between
`<!--test-->` markers — but then add a test proving a *malformed real* block outside such a region
still errors. Do not weaken the guard itself.

## Defect 2 — `Codename:` is absorbed by the preceding block

The parser starts a new block at each `Release:` line, so any field appearing **before** a block's
own `Release:` is attributed to the **previous** block. `RELEASES.md` has:

```text
Codename: "Silverlining"
Release: TBD
```

so `"Silverlining"` attaches to the fixture block above it. Observed live: inserting a new block
above it made that block render as `1.5.0 ("Silverlining")`. It was worked around in #23 by placing
the new block last — the trap is still there, and it is **silent**.

Fix both halves:

- normalise `RELEASES.md` so every block leads with `Release:`
- **and** have the check `warn` when a recognised field appears before the first `Release:` of a
  block, so the trap reports itself instead of relying on authoring discipline

The second half is the durable one. Without it the file drifts back the first time someone adds a
block by copy-paste.

## Constraint

`pdda.sh` / `pdda-lib.sh` are synced in from a canonical PDDA repo (`utils/pdda/PDDA-INSTALL.md`,
`PDDA-SOURCE.md`). Changing them here creates a **diverged target** on the next
`pdda-sync.sh push`. Note in the turn that this change needs pushing upstream, or it will be
overwritten. Do not silently fork the vendored copy.

## Done when

- `bash utils/pdda/pdda.sh releases` reports **errors=0, warns=0**
- `bash utils/pdda/pdda.sh releases-current` still renders both `1.5.0 ("Ledger")` and
  `1.4.270 ("Roundup")` with correct codenames and Iterations bands
- a test (or a documented manual check with output) shows the new warn fires on a field-before-
  `Release:` block, and does **not** fire on a well-formed one
- `pdda.sh run` shows no new findings
- the upstream-sync consequence is stated in the turn

## Out of scope

Any other PDDA check. The 3 pre-existing governance dead-reference warnings in `ROUTER.md` /
`AGENTS.md` are **not** part of this issue — leave them.
