# Third-Party Licenses

AEGIS is licensed under **AGPL-3.0-only** (see [`LICENSE`](./LICENSE)), with a commercial
option (see [`LICENSE-COMMERCIAL.md`](./LICENSE-COMMERCIAL.md)). It incorporates third-party
open-source packages, each governed by its own license.

This file records the dependency-license audit. It exists because AGPL-3.0 has real
compatibility constraints: a single GPL-incompatible dependency in the distributed set would
block the license outright. The audit was run before publication, not after.

**Audit result: no blocker.** Every dependency is under a permissive, GPL-compatible license.
There is no GPL, LGPL, AGPL, MPL, EPL, CDDL, SSPL, BUSL, Commons Clause, or other
source-available/non-free license anywhere in the tree.

## Method

```bash
npx license-checker --production --summary   # distributed set (352 packages)
npx license-checker --summary                # including devDependencies (616 packages)
```

Audited 2026-07-26 against the committed `package-lock.json`. Re-run after any dependency
change; the checks are cheap and the failure mode is expensive.

## Direct production dependencies

These are the packages AEGIS requires directly. All are permissive.

| Package | Range | License |
|---|---|---|
| `@anthropic-ai/sdk` | ^0.96.0 | MIT |
| `@modelcontextprotocol/sdk` | ^1.29.0 | MIT |
| `@notionhq/client` | ^2.3.0 | MIT |
| `@octokit/rest` | ^22.0.1 | MIT |
| `@slack/bolt` | ^4.6.0 | MIT |
| `@slack/web-api` | ^7.17.0 | MIT |
| `better-sqlite3` | ^12.9.0 | MIT |
| `express` | ^5.0.1 | MIT |
| `newrelic` | ^12.16.1 | Apache-2.0 |
| `nodemailer` | ^8.0.1 | MIT-0 |
| `openai` | ^6.9.1 | Apache-2.0 |
| `sqlite-vec` | ^0.1.9 | MIT |

## License distribution

**Production set — 352 packages** (what a deployment actually ships):

| License | Packages | AGPL-3.0 compatible |
|---|---|---|
| MIT | 280 | Yes — permissive |
| Apache-2.0 | 27 | Yes — GPLv3-family compatible (see note) |
| ISC | 19 | Yes — permissive |
| BSD-3-Clause | 15 | Yes — permissive |
| BSD-2-Clause | 2 | Yes — permissive |
| MIT (declared in file, not `package.json`) | 2 | Yes — permissive |
| Apache-2.0 (declared in file) | 1 | Yes |
| Python-2.0 | 1 | Yes (see note) |
| MIT OR WTFPL | 1 | Yes — MIT elected |
| BSD-2-Clause OR MIT OR Apache-2.0 | 1 | Yes — MIT elected |
| Unlicense | 1 | Yes — public-domain dedication |
| MIT-0 | 1 | Yes — permissive, no attribution required |
| BSD (unversioned) | 1 | Yes — permissive |

Including `devDependencies`, the tree is **616 packages**, adding only MIT, ISC, Apache-2.0,
BSD-3-Clause, BlueOak-1.0.0 (4, permissive), and CC-BY-4.0 (1). Dev dependencies are build- and
test-time only and are not distributed, but they were audited anyway and contain nothing
copyleft.

## Notes on the non-obvious ones

**Apache-2.0 → AGPL-3.0 is one-way compatible.** Apache-2.0 code may be incorporated into a
GPLv3/AGPLv3 work; the combined work is governed by the AGPL. The reverse does not hold, and
Apache-2.0 is *not* compatible with GPLv2. AEGIS is AGPL-3.0-**only** (not "or later"), which
is in the GPLv3 family, so the direction that matters here is satisfied. This affects
`newrelic`, `openai`, and 25 transitive packages.

**`argparse@2.0.1` — Python-2.0.** A JavaScript port of Python's `argparse`, pulled in
transitively by `js-yaml`. The Python Software Foundation License v2 is classified by the FSF
as a free, GPL-compatible license. (Only the historical Python 1.6b1 license was
GPL-incompatible.)

**`caniuse-lite@1.0.30001780` — CC-BY-4.0.** Browser-support *data*, not code, reached through
`browserslist` in the dev toolchain. It is not part of the distributed application. CC-BY-4.0
imposes attribution only, with no copyleft.

**`sqlite-vec@0.1.9` / `sqlite-vec-darwin-arm64@0.1.9` — reported as `MIT*`.** The asterisk is
`license-checker` noting that the license was read from a `LICENSE` file rather than declared
in `package.json`. Both are MIT. `@newrelic/security-agent@2.4.2` (`Apache*`) is the same
situation with Apache-2.0.

**Dual/multi-licensed packages.** Where a package offers a choice (`MIT OR WTFPL`,
`BSD-2-Clause OR MIT OR Apache-2.0`, `MIT OR CC0-1.0`), AEGIS elects the MIT option in each
case. All alternatives listed are independently GPL-compatible, so the election is a matter of
record-keeping rather than risk.

## Obligations this creates for you

If you redistribute AEGIS, the permissive licenses above carry attribution requirements of
their own: MIT, ISC, and BSD require the copyright notice and license text to travel with the
code, and Apache-2.0 §4 additionally requires you to carry forward any `NOTICE` file content
from those packages. Standard practice is to ship `node_modules` license files with the
distribution, or generate an aggregated notices file:

```bash
npx license-checker --production --customPath /dev/null > NOTICES.txt
```

These obligations are separate from, and additional to, the AGPL obligations on AEGIS's own
code.

---

*This inventory is offered in good faith and is not legal advice. The authoritative license for
any dependency is the text shipped in that package.*
