# GH-126 — BM25 baseline + ground-truth scoring results

**Date:** 2026-08-20
**Branch:** `test/gh-126-bm25-baseline-ground-truth`
**Follows:** GH-125 (Gemini vs Cloudflare-BGE spike), agent2agent #321287 (methodology negotiation with rebalanceOS)

## What this run did

The GH-125 spike compared Gemini and BGE-small by having LLMs grade LLM-written answers. A
rebalanceOS maintainer argued that comparison can't tell you *which knob to turn*, and proposed two
additions. Both were agreed in agent2agent #321287 and are implemented here:

1. **A BM25/FTS5 keyword lane** as a "dumb baseline" — scored per question on whether it surfaces
   the same source document the graders cited, not on aggregate relevance.
2. **Source-verified ground truth** — the correct answering document for each question, established
   by reading the actual repo files rather than trusting either grader.

The BM25 lane indexes the **same `chunks` table** the two vector indexes already contain (1,191
chunks, identical chunking), so the three lanes differ only in retrieval mechanism.

### Honest caveat on "ground truth"

The agreed plan called for a **human**-established ground truth. This was established by an LLM
(me) reading the actual source files and citing line numbers — stronger than LLM-grading-LLM-output,
weaker than human adjudication. Every entry in `score-lanes.mjs` carries the file and section it was
verified against, so a human can audit or overturn any of them cheaply. Treat the numbers as
provisional pending that check.

## Headline results

Scored on: did the lane surface the correct source document, at rank 1 and within the top 8?

| Lane | rank-1 correct | correct doc in top-8 |
|---|---|---|
| Gemini (768-dim) | 3/9 | **9/9** |
| BM25 / FTS5 (keyword) | 2/9 | **6/9** |
| BGE-small (384-dim, prefixed) | 1/9 | **3/9** |

Q1 is excluded — see below, it is not a valid retrieval test.

### 1. Plain keyword search beats the BGE embedding lane on our corpus

BM25 surfaces the correct document in 6/9 questions; BGE-small manages 3/9. This reproduces
rebalanceOS's most uncomfortable finding on *our* corpus, and it is the single most decision-relevant
result here: **the vector lane we migrated the dev tool to is outperformed by SQLite full-text search
at finding the right document.**

### 2. Root cause is CHANGELOG.md dominance, not dimension count

Full 20-hit capture for the BGE lane:

- **32% of every chunk BGE retrieves is CHANGELOG.md** (vs. 19.6% of the corpus).
- **CHANGELOG.md is the rank-1 hit on 7 of 10 questions**, including "where is initial routing done
  in code" and "what testing layers does this repo have."

BGE is spending most of its retrieval budget re-fetching the changelog instead of the code and
architecture docs that answer the question.

A tested-and-rejected explanation, recorded so it isn't re-proposed: I hypothesised the fixed
`PRIORITY_BOOST` (changelog carries `priority=5`, a 0.10 score advantage over code's `priority=0`)
was mis-scaled for BGE's distance range. Measured, it is the opposite — that boost is 112% of
Gemini's top-5 distance spread but only 47% of BGE's. **The mechanism behind BGE's changelog
attraction is not established.** The attraction itself is measured and robust.

### 3. The Q8 hallucination is a retrieval failure — rebalanceOS's hypothesis confirmed

GH-125's one confirmed hallucination: BGE answered "recommended test order" from
`PROJECT/3-COMPLETED/P3-GITHUB-ISSUE-SYNC.md` instead of `ARCHITECTURE.md`'s canonical
`## Recommended Usage` section (verified this run at `ARCHITECTURE.md:549-555`).

| Lane | rank of correct doc | retrieved the wrong doc? |
|---|---|---|
| Gemini | 1 | no |
| BM25 | 5 | no |
| BGE-small | **not in top 8** | no |

BGE never retrieved `ARCHITECTURE.md` at all — its top hits were `CHANGELOG.md`, `ASK_SELF.md`,
`FRONTDOOR.md`. Synthesis then answered from whatever adjacent material was in context.

**This is a retrieval failure with a cheap fix, not a model-capacity limit.** BM25 finds the correct
document at rank 5, comfortably inside the context budget — hybrid lexical+vector fusion would have
prevented this specific hallucination outright. A bigger embedder was never the indicated fix.

### 4. Q1 is not a valid retrieval test

`src/rag/index.js:295-297` injects the 50 most recent CHANGELOG entries into the synthesis context
for **every** query, independent of what retrieval returned. "What were the 10 most recent changes?"
is therefore fully answerable with zero correct retrieval.

This resolves one of the three grader disagreements: agy's "tie" on Q1 was the defensible call,
because retrieval could not have changed the answer. Q1 should be replaced in any future question set.

### 5. One scoring error found and corrected

My first pass scored Q2 as MISS for all three lanes. That was a ground-truth error, not a retrieval
failure: `architecture-summary` and `feature-map` are generated corpus digests that legitimately carry
the tech-stack answer, and Gemini answered from them. Corrected in `score-lanes.mjs`; both vector
lanes score rank-1 on Q2. Recorded here because the uncorrected table was briefly persuasive and
wrong in the same direction as the conclusion — exactly the kind of error a ground-truth pass is
supposed to catch.

## What this changes

- **The bge-base-en-v1.5 (768-dim) retest is now clearly not the next move.** The gap is a changelog
  attraction plus a retrieval miss, neither of which more dimensions addresses. Dimension parity was
  already weakly supported by rebalanceOS's data (Qwen at 1024-dim losing to BGE-small at 384-dim);
  this run gives a concrete competing mechanism on our own corpus.
- **Hybrid BM25 + vector fusion is the indicated improvement**, and it now has direct evidence behind
  it: BM25 alone beats BGE alone, and BM25 recovers the one document BGE hallucinated past.
- **Changelog chunks are largely redundant in the vector index** — the changelog is already injected
  live into every synthesis context. 234 chunks (19.6% of the corpus) are competing for retrieval
  budget against content that has no other way in. Down-weighting or excluding them is cheap and
  should help both vector lanes.
- **GH-125's "do not migrate production RAG off Gemini" verdict still stands**, and is now better
  supported: Gemini is 9/9 on surfacing the correct document where BGE is 3/9.

## Reproduction

Scripts are in the session scratchpad (not committed — they hardcode absolute paths and read live
API credentials):

- `spike-bm25.mjs` — builds FTS5 over the existing `chunks` table, runs the 10 questions
- `retrieval-only.mjs` — full 20-hit ranked capture per lane, no synthesis
- `score-lanes.mjs` — ground-truth definitions (with per-entry source citations) and scoring
- `score-results.json` — machine-readable per-question output

Corpus: `spike-gemini.sqlite` / `spike-bge.sqlite`, 1,191 chunks each, built in GH-125.

## Known gap in this run

The Gemini lane's full 20-hit composition was not captured, so there is no Gemini counterpart to the
"32% changelog" figure. The Gemini API key in `~/secrets/sleuth/sleuth-gemini-key.txt` returned
`429 RESOURCE_EXHAUSTED` ("prepayment credits are depleted") for both embeddings and `generateContent`.
The scored comparison above is unaffected — all three lanes are scored on identically-captured
top-8 data from the original spike runs. See the operational note below.

## Operational finding, unrelated to this test

`src/rag/index.js` reads `process.env.GOOGLE_API_KEY` for both embedding (line 143) and synthesis
(line 212). The Sleuth Gemini key on this machine is currently exhausted for both. **If the
production host uses this same key, the live `ask-self` Slack command is broken right now.** Not
verified against the production environment — that check is the next step and is not part of this
issue.
