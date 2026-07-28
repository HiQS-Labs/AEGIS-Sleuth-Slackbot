# Review: P3 — Event-Sourced Core

**Date:** 2026-06-12
**Reviewer:** Gemini CLI
**Status:** Approved for Phase 0 (Decision Gate & Seam Map)

## Overall Assessment
This is a highly mature, architecturally sound proposal. It directly addresses the structural durability flaws identified in the recent `summarize-week` completion review while laying the groundwork for significant future flexibility (P1-SPLIT, P2-TASK-BUCKETING). The use of the "strangler migration" pattern drastically de-risks the adoption of event sourcing.

## Strengths
- **Leverages Existing Chokepoints:** The fact that state transitions are already strictly funneled through `#TransitionReminderState` and governed by the FSM makes the actual implementation of event emission relatively trivial.
- **De-risks Rollout:** The phased strangler approach (dual-write -> shadow reads -> boot-time rebuild -> retire mutable state) provides clear abort paths at every stage prior to Phase 5.
- **Fundamental Durability Fix:** Removing "flush on shutdown" semantics and relying strictly on an append-only log is the correct long-term fix for the `CompletionStore` issues.

## Constructive Feedback & Risk Areas

1. **Dual-Write Partial Failures (Phase 1-4):**
   - *Risk:* During the dual-write phase, what happens if the append to the event log succeeds but the JSON flush fails, or vice versa?
   - *Recommendation:* Ensure the event log append is the primary, blocking operation within the FSM transition. If the log append fails, the transition must fail. If the JSON cache write fails asynchronously, the system state remains valid in the log.

2. **Boot-Time Startup Latency (Phase 3):**
   - *Risk:* Rebuilding state from the log at boot time could increase startup latency, especially for older/active workspaces.
   - *Recommendation:* Phase 5 (Snapshotting) might need to be partially pulled forward if startup times exceed acceptable thresholds during Phase 3 testing.

3. **Event Schema Rigidity:**
   - *Risk:* As noted in the proposal, event schemas are forever.
   - *Recommendation:* Ensure `validate-fsm-invariants.js` is augmented to not just police state transitions, but optionally validate the emitted event payloads against a JSON schema to prevent poison pills from entering the log.

## Responses to Open Questions
1. **Log granularity:** **Per-workspace** is the correct choice. It preserves tenant isolation, makes GDPR/data-deletion requests trivial (delete the file), and bounds the log size naturally.
2. **Event vs. command:** Start with **Events only** (facts). Storing commands (intents) couples the log heavily to the incoming transport layer (e.g., Slack structure) which defeats the "transport-agnostic kernel" fork later.
3. **Snapshot cadence:** **Event-count-based** (e.g., snapshot every 100 events) is more predictable for controlling boot-time latency than time-based.
4. **CompletionStore:** Yes, this should entirely supersede `CompletionStore`. The custom durable queue for completions should be collapsed into a standard projection over the event log.
5. **Git-as-log fork:** The JSON cache should sit beside it. Git serves as the durable remote log, but local projections (JSON caches or in-memory) remain necessary for fast, synchronous reads.

## Conclusion & Next Steps
**Approve for Phase 0.** The proposed architecture is solid and the phased rollout is safe. Proceed with cutting the `feat/event-sourced-core` branch and mapping the event schema and read inventory.