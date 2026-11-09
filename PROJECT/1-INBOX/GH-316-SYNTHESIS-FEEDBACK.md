---
gh_issue: 316
source: https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/316
title: "Feedback-guided reminder title synthesis"
status: "Proposed (1-INBOX — not yet active)"
created: 2026-11-09
updated: 2026-11-09
owner: Maintainer
goal: Improve real-time reminder title fidelity with reviewed synthetic examples and bounded evaluation.
doc_type: feedback
effort: 2
complexity: 2
risk: 2
phases: 2
ratings_provisional: true
---

# Feedback-guided reminder title synthesis

Canonical discussion and acceptance criteria: [GH-316](https://github.com/HiQS-Labs/AEGIS-Sleuth-Slackbot/issues/316).
Related: GH-250/GH-79 extraction convergence, GH-260 earlier benchmark, GH-107 shadow proposal.
This intake records a proposed project; no runtime prompt, model or production change is included.

## Proposed sequence

1. Curate a private correction set with causal source context, generated/preferred wording,
   provenance and error categories. Keep real records and source transcripts private.
2. Preview two concise synthetic examples in the existing first-pass and bounded-repair
   instruction assets. The maintainer reviews the complete instruction files before any
   public prompt change. Preserve admission, ownership, date extraction, title contract and fallback.
3. Freeze unseen cases by source thread/family. Compare current/candidate instructions on the
   incumbent through existing local replay and selector paths; distinguish raw titles from
   final output, missing context from model failure, and title style from admission/ownership.
4. Record an explicit keep/change/inconclusive decision, existing relevant check results and
   limitations. A prompt edit alone is not a live update because assets are process-cached.
5. Only if separately authorized, compare three pinned candidate models plus incumbent control
   using the frozen prompt and held-out cases. Verify actual reasoning settings, bound calls
   and spend, repeat finalists and report failures, variability, latency and usage/cost.

## Acceptance and boundaries

- The full example-bearing instruction preview requires maintainer review before publication.
- Public prompts/fixtures/issues contain synthetic examples or generic aggregates only.
- No invented facts, lost actions/conditions, or ownership/admission regressions can be traded
  for prettier wording. Equivalent correct titles are acceptable.
- Prompt-only delivery does not depend on provider wiring or a model comparison.
- Reuse existing schema/title/selector/replay checks with local isolated data and mock Slack;
  no server harnesses, production test posts or reminder writes.
- No fine-tuning, self-editing prompts, runtime feedback ingestion, example retrieval service,
  ensemble/router, permanent shadow traffic or new CI benchmark service in the first iteration.
- No persistence/FSM/snooze/CRUD-authority changes. Deployment/model configuration needs
  separate authorization; keep existing rollback behavior and deferred integration scope.

## Next action

Maintainer reviews the complete instruction preview through the private review process.
After that review, scope the prompt-only implementation and its incumbent comparison from GH-316.
The model comparison remains an optional later iteration.
