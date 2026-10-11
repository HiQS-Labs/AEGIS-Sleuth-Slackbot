
# Recon Map — Product Compass document analysis and context reuse

Date: 2026-10-07 PDT. Sleuth commit: `72d60c98e042ed75f7868712c3eeaf27604643dd`.
Product Compass (PC) source snapshot: `aa7ac66062621ce50ce6daccd6610cd56f497cf9`.
Mode: stale graph leads plus current direct source reads. Three read-only Luna lanes, reconciled by the parent.

## Subject and change class

Audit GH-215 for a new parallel ingestion, document-analysis, summarization, context-memory or AI-provider system. Cross-module/cross-service reconnaissance only: no production edits, new tests, live API calls, deployment, or architecture-change plan.

**Verdict:** GH-215 adds a scoped MCP query workflow, not a second RAG or memory system. It reuses the existing uploaded-file/thread assembly, context-size constant and AI dispatch. PC's web and MCP document queries share retrieval. There are two concrete local redundancies worth small fixes: duplicated passage payloads and repeated pagination on oversized hands-free threads. Neither calls for a new abstraction or replacement pipeline.

`PC/` below denotes the separate Product Compass repository, not a directory in Sleuth.

## The seams — where a change here escapes this file

| Seam | Location | Crosses | Breaks if |
|---|---|---|---|
| Slack ingress to Compass | `src/chat-module.js:1272`, `:1323`, `:2081`, `:3016` | Explicit/mapped mentions and hands-free replies to one workflow | A second handler bypasses shared context or workspace ownership |
| Upload to thread context | `src/chat-module.js:2905`, `:2975`, `:3036` | Slack file download, shared Map, workspace JSON, model input | Writer/reader thread keys diverge or a separate memory store is added |
| Bounded thread read | `src/slack-app.js:851`; `src/chat-module.js:2718`, `:3020` | Slack paging, reaction gating, prompt completeness | Partial history is treated as complete, or failure triggers duplicate work |
| AI decision/provider dispatch | `src/product-compass.js:169`; `src/ai-decision.js:191`; `src/workspace-ai.js:494` | Existing prompt/schema handling and workspace-selected provider | Feature instantiates its own AI provider or loses request cancellation |
| PC document authority to derived index | `PC/src/lib/documents.server.ts:66`; `PC/drizzle/migrations/0012_rag_document_index.sql:54` | Stored document/version/SHA to job/chunk/embedding records | A second importer owns raw documents or stale chunks become authoritative |
| PC retrieval shared by UI/MCP | `PC/src/lib/rag/retrieve.server.ts:55`, `:117`; `PC/src/lib/mcp/tools/search-documents.ts:18` | User-scoped query, RLS, evidence passages, optional answer synthesis | Each surface implements separate retrieval or bypasses team scope |
| Existing unrelated memory/RAG features | `src/thread-memory.js:297`; `src/rag/ingest.mjs:338`; `src/chat-commands/ask-woo-command.js:62` | Explicit thread capture, code corpus, external Woo corpus | Different sources/permissions are merged merely because each uses embeddings |

## Call paths in

### Sleuth shared context

1. Mention or hands-free handler stores eligible uploads using `#TryStoreThreadMemoryFileAsync` (`src/chat-module.js:1219`, `:2049`, `:2905`).
2. Existing classifier admits text files; the upload limit now uses exported `MaxContextBytes` (`src/context-file-classifier.js:265`; `src/chat-module.js:2931`).
3. Existing writer stores `{filename, content}` at `channel:root-ts`, then durably saves workspace JSON (`src/chat-module.js:2975`, `:2802`).
4. Compass ingress calls `#RunCompassAsync`; it obtains bounded history, includes the current event and calls the existing `#GatherThreadContextAsync` (`src/chat-module.js:3016-3024`).
5. That same formatter includes sender/role/time/text and prepends the same uploaded-file memory (`src/chat-module.js:3036-3065`). Generic chat also consumes it (`:1328`, `:2086`).
6. `HandleAskCompassCommandAsync` passes the assembled context and selected workspace AI/model to `AskAsync` (`src/chat-commands/ask-compass-command.js:11`).

Normal hands-free reads reuse the fetched array through `CompleteThread`; explicit Compass mentions also have the five-page cap. An initial lane suggestion that mentions lacked this cap was rejected against `#RunCompassAsync` source.

### PC documents and retrieval

Upload server function calls `commitDocument` (`PC/src/lib/documents.functions.ts:17-42`). That writer stores raw bytes, decoded text, SHA and revision metadata once (`PC/src/lib/documents.server.ts:66-155`). The RAG SQL trigger consumes those same current rows, enqueues changed SHA/team content and removes obsolete derived work (`PC/drizzle/migrations/0012_rag_document_index.sql:54-83`). The indexer rereads and verifies current/SHA state before conditional publication (`PC/src/lib/rag/indexer.server.ts:36-71`).

Web Q&A calls shared `askDocuments`; MCP `ask_documents` calls that same function. MCP `search_documents` calls shared `searchDocuments`, which embeds the question and invokes the membership/RLS-scoped matching RPC (`PC/src/lib/rag.functions.ts:7-17`; `PC/src/lib/mcp/tools/ask-documents.ts:17`; `PC/src/lib/mcp/tools/search-documents.ts:18`; `PC/src/lib/rag/retrieve.server.ts:55-108`, `:117-138`).

Sleuth calls **search_documents**, briefs and arcs, then synthesizes through WorkspaceAI. It does not call PC's `ask_documents` and then summarize that generated answer again (`src/product-compass.js:156-172`, `:200-224`). The independent Slack reasoning step implements the requested channel model and conversation context; it is not duplicated ingestion.

## State and existing analysis systems

| State / representation | Owner and write/read sites | Assessment |
|---|---|---|
| Uploaded-file thread context | ChatModule Map plus workspace `context-memory` JSON; load `:2777`, save `:2798`, upload write `:2975`, read `:3060` | Reused; no new Compass writer. Last file replaces that thread's entry. Full text, not generated summary. |
| Explicit searchable thread capture | `src/thread-memory.js:20`, `:59`, `:227`, `:297`; remember-above handler `src/chat-commands/remember-above-command.js:32` | Pre-existing separate SQLite store. Explicit capture/search purpose, not implicit uploaded-file context. `SummaryText` is a 500-character prefix (`:283`), not an LLM summarizer. |
| Sleuth code/doc/PR vector corpus | `src/rag/ingest.mjs:54-79`, `:145-188`, `:338-420`; `src/rag/index.js:142-230` | Existing source-code corpus, not PC customer documents. No GH-215 changes to `src/rag`. |
| PC raw/current documents | `PC/src/lib/documents.server.ts:66-155` | One shared document/version/SHA authority used by both old analysis and new RAG. |
| PC digests and workshop analysis | `PC/src/lib/analysis.runner.server.ts:52-96`, `:404-433`, `:500-534` | Existing SHA-sensitive summaries and task-specific brief/workshop workflows. Workshop selects related docs using digests and then reads full text. Adjacent Q&A capability, but not the same output as cited passage retrieval. |
| PC chunks, embeddings, jobs | `PC/drizzle/migrations/0012_rag_document_index.sql:5-26`, `:54-146`; `PC/src/lib/rag/indexer.server.ts:18-86` | New derived search representation of the same documents, not duplicate raw ingestion. Digests are not substitutes for source passages with line citations. |
| Compass evidence/catalog | `src/product-compass.js:112-115`, `:138-224` | Request-local objects only. No new persisted corpus, thread memory, embedding store or summarizer. |

Both Sleuth memory systems existed at baseline `cd7b46f`; `src/thread-memory.js` history reaches the initial public release. The baseline ChatModule already contained its Map, JSON load/save, upload writer, formatter and inline 200 KiB upload cap. GH-215 exports/reuses that cap rather than creating a separate upload-limit policy.

## Confirmed redundancies and smallest possible next steps

### 1. Repeated passage payloads — worthwhile small cleanup

`src/product-compass.js:218` puts the full passage into `Sources[].Passage`, while `:224` also retains it in `Result.passages`. The entire evidence object is serialized on every later model turn (`:166-172`). Citation rendering reads only Id, Title, Link and Excerpt (`:176-193`); bounded source/prompt/schema/test search found no consumer of `Sources[].Passage`.

**Consequence:** duplicate passage text and metadata consume model input and the 200 KiB budget, plus the intentional short citation excerpt. The waste can cause earlier size refusal; no live token-cost measurement was made.

**Smallest candidate:** remove the unused `Passage` property, retaining the raw result once and the checked citation fields. No new subsystem or generic helper is needed. Verify the existing evidence/citation canary and prompt shape if implemented.

Root cause: the same search evidence is stored in both the raw result and a citation presentation object; fix site: source-object construction; why not elsewhere: the shared context builder and provider correctly consume the payload they are given.

### 2. Oversized hands-free thread is fetched again — bounded but avoidable

For a stable thread exceeding five pages, `#ShouldRespondToMessageAsync` first attempts five pages (`src/chat-module.js:2718-2723`), fetches the first page again after `context-incomplete` (`:2724-2729`), and returns `ThreadMessages: CompleteThread`, still undefined (`:2755`). `#RunCompassAsync` consequently attempts another five-page read (`:3020-3021`). By source trace this permits **5 + 1 + 5 = 11 Slack page requests** before the handler refuses. This count was not measured against live Slack. Normal complete threads reuse their first read.

The first-page fallback also cannot honor a bell/stop reaction outside that page. For an unchanged oversized thread, the later read still refuses rather than synthesizing an answer, but the refusal itself can be posted despite a later stop. This fallback was added in the merged revision and is not proof of a second context system.

**Smallest candidate:** carry the already-known incomplete-context outcome to the existing handler instead of re-fetching, and deliberately preserve stop semantics when full history is unavailable. No new pagination subsystem. Confirm behavior with the existing long-thread canary if implemented.

Root cause: completeness failure is dropped between the hands-free gate and context consumer; fix site: that existing result handoff; why not elsewhere: another reader, cache or summarizer would hide the lost state instead of fixing it.

### 3. Tiny duplicate instruction read — low priority

Compass reads its instruction file to account for prompt bytes (`src/product-compass.js:164`); DecideAsync separately owns cached asset loading (`src/ai-decision.js:74-92`). This is repeated file access, not a parallel prompt engine. Reuse the shared asset path only if a small existing-contract extension proves useful; do not invent a caching framework for one small read.

The question can also appear both as explicit `Question` and inside the current-event transcript. These have different roles (current task versus attributed conversation), so this audit does not recommend deleting one indiscriminately.

## Contracts, failure and rollback today

- Same 200 KiB constant for upload admission and Compass assembled prompt; it is a byte limit, not automatic summarization or a model-specific token-budget manager (`src/context-file-classifier.js:265`; `src/product-compass.js:106`, `:168`).
- PC catalog/evidence scope and citation checks are domain boundaries, not duplicate generic JSON validation. AI calls stay in DecideAsync/WorkspaceAI (`src/product-compass.js:169`, `:198-218`).
- Credential/MCP/model deadlines belong to the bounded Compass workflow because MCP work is outside WorkspaceAI; provider options extend existing APIs. Four evidence calls, shared cancellation and client cleanup are visible at `src/product-compass.js:110-128`, `:165`, `:195`, `:230-233`.
- PC jobs distinguish pending/indexing/done/failed/blocked and publish against the expected current SHA; retrieval returns incomplete-index status (`PC/src/lib/rag/indexer.server.ts:18-86`; `PC/src/lib/rag/retrieve.server.ts:107-108`).
- Disable Compass using the existing workspace save-and-restart lifecycle. Raw PC documents and existing Sleuth memory stores remain owned by their original systems; no reverse synchronization or migration was introduced.
- Reviewed existing canary assertions, not a fresh test run. No additional CI, tests or live claims are part of this recon.

## Debug-mantra evidence ledger

| Hypothesis | Disproof attempted | Result |
|---|---|---|
| GH-215 builds a second local RAG | Compare merge delta, inspect new module imports/calls/writes, compare existing src/rag ownership | Rejected within the reviewed feature scope: new workflow calls remote search; no local ingest/index writer added. |
| Compass bypasses the old context memory | Trace all new mention/hands-free entries through RunCompass and GatherThreadContext; compare baseline writer | Rejected: same Map/JSON writer and formatter; new complete-history options, not another store. |
| An existing automatic thread summarizer was duplicated | Read both memory implementations and PC digest/workshop consumers | Rejected for Sleuth: raw upload context plus a fixed-prefix capture preview. PC digests are real summaries but serve different analysis jobs. |
| Reuse means no repeated work at all | Inspect serialized evidence and incomplete-history return value | Rejected: duplicate passage payload and exceptional repeated paging are concrete counterexamples. |

## Coverage and unknowns

The graph catalog was fully paginated (82 projects). Only the older task-clone graph was available for Sleuth; generation `2026-10-08T02:29:43Z` preceded the feature. Search returned 22 memory/summary/retrieval matches without pagination remainder. GatherThreadContext trace reported the two old handler callers, but no current Compass edge. Coverage checks marked changed core/provider files metadata_changed and new Compass files not_tracked. Older memory/code-RAG files had metadata_match in that other checkout, not proof about the primary. All material findings therefore use current direct source reads. Empty scope-gap lists were not treated as exhaustive coverage. PC had no listed graph project.

The repository ask-self orientation query failed because Cloudflare provider credentials were unavailable; no secrets were requested or printed. Source inspection supplied the fallback. Lane contradiction over whether the incomplete path returned a partial array was resolved by reading the actual `ThreadMessages: CompleteThread` return at `src/chat-module.js:2755`.

| Unknown | Why it matters | What would settle it |
|---|---|---|
| Actual request token/latency and Slack paging costs | Sizes and repeated-read bounds are source-proven, not production measurements | Sanitized request metrics or a focused mocked prompt/pagination probe, if implementing the small fixes |
| Live PC deployment/index/schema/permission state | This audit compares checked-out source, not the running SaaS | Securely provisioned, scoped live MCP acceptance; no token in chat |
| PC changes beyond aa7ac660 | No remote refresh performed in this read-only audit | Refresh/compare PC origin before changing its analysis or ingestion code |

No whole-repository absence claim is made. The three lanes covered feature ingress/context/state, PC document/RAG consumers, and AI/tool/failure contracts; unrelated application workflows and infrastructure were outside scope.

## Current-state radius

Mapped Slack channels, ChatModule upload/thread memory and paging, workspace AI providers, PC current document records/digests/index jobs/retrieval, plus existing code-RAG and explicit thread capture as comparison systems. Recommended next work is the two small redundancies above, not an architecture rewrite. Production code was left unchanged.

