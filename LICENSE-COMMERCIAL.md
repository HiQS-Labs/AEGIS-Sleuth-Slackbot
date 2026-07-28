# Commercial License

AEGIS is dual-licensed. This file describes the second option. Most users need
only the first.

## Which license applies to you

**The AGPL-3.0-only license in [`LICENSE`](./LICENSE) applies by default, and it is
almost certainly all you need.** It costs nothing and it is a real open-source
license — you may use, study, modify, self-host, and redistribute AEGIS.

You do **not** need a commercial license to:

- Run AEGIS internally for your own team, however large.
- Modify it for your own internal use.
- Self-host it, including on infrastructure you rent.
- Redistribute it or a fork, provided you do so under the AGPL and supply source.

You may want a commercial license if:

- You want to **offer AEGIS (or a modified AEGIS) to third parties over a
  network** — as a hosted product, a managed service, or a feature inside one —
  **without publishing your modifications.**
- You want to **embed AEGIS in a proprietary product** you distribute, and you
  cannot license that product under the AGPL.
- Your organization's policy prohibits AGPL-licensed code in the deployed stack,
  regardless of how you actually use it. (This is common, and it is a legitimate
  reason to ask.)

## What the AGPL actually requires

The obligation people most often miss is **section 13, "Remote Network
Interaction"**. Plain-language summary — the binding text is in [`LICENSE`](./LICENSE):

> If you modify AEGIS and let users interact with your modified version
> remotely over a network, you must prominently offer those users the complete
> corresponding source of your version, at no charge, from a network server.

Two things follow from that. Merely *using* AEGIS over a network, unmodified,
triggers nothing extra. And "modify" is broader than a fork — patches,
custom integrations compiled or bundled in, and changed behavior all count. If
your service is built on a changed AEGIS, section 13 reaches it.

Section 5 also applies to conveyed copies: modified versions carry prominent
change notices and must be licensed as a whole under the AGPL.

## What a commercial license grants

Relief from the AGPL's reciprocal obligations — principally the section 13
network-source requirement and the requirement to license derivative works under
the AGPL — so you can keep your modifications and surrounding product closed.

It does **not** grant trademark rights to "AEGIS" or "Neochrome" (see
[`NOTICE`](./NOTICE)), and it does not change the licensing of the third-party
dependencies AEGIS incorporates (see [`THIRD-PARTY.md`](./THIRD-PARTY.md)).

## How to get one

**Terms are negotiated, not click-through.** There is no self-serve purchase
flow, no price list in this repository, and nothing here is an offer or a
binding quote.

Email **support@neochro.me** with the subject line **"Commercial license —
AEGIS"**. It helps to include:

- Your organization, and how you intend to deploy AEGIS.
- Whether you will modify it, and whether third parties will reach it over a network.
- Whether you need redistribution rights, hosting rights, or both.

## Contributions

Because Neochrome offers commercial licenses, it must hold sufficient rights in
all contributed code to grant them — a contribution accepted under the AGPL
alone could not be included in a commercially licensed build.

The inbound terms that make this work are in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). In short: contributors keep their
copyright and license their work under the AGPL like everyone else, and
additionally grant Neochrome the right to include it under other license terms.
Nothing is assigned away.

---

This document is a plain-language summary offered for orientation. It is not
legal advice, and where it differs from the text of [`LICENSE`](./LICENSE) or a
signed commercial agreement, those control.

Copyright (c) 2023-2026 Neochrome. All rights reserved.
