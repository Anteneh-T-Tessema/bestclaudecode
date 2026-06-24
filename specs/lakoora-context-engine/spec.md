# Spec: Wire the Context Engine into Lakoora's chat and agent runtime

## 1. Current state (verified against the code, 2026-06-23)

Lakoora already has a Cursor-grade retrieval stack in `src/`:

- `src/bm25_index.py` — lexical BM25 over `repo_map` symbol lines.
- `src/embedding_index.py` — TF-IDF/local-hash fallback embeddings.
- `src/vector_index.py` — **hybrid search**: BM25 pre-filter + vector
  re-rank (Voyage Code-3 if `VOYAGE_API_KEY` set, else a deterministic
  hashing embedder), AST-level chunking (`--chunks`), and a persistent
  Qdrant-backed store (`--build-index` / `--persistent`).
- `src/repo_map.py` / `src/symbol_filter.py` / `src/ts_map.py` — AST-based
  file/symbol indexer for Python and TS/JS, with task-token relevance
  filtering.
- `src/context.py::format_context()` — assembles a "repo orientation"
  block (trimmed repo map, optionally task-filtered) for agent prompts.
  Docstring: *"Used by the /context-implement orchestration command."*
- `src/arch_doc.py` — per-module architecture summaries (functions,
  classes, imports) — IPC: `archDoc:generate` ([archDoc.handlers.ts](../../desktop/src/main/ipc/archDoc.handlers.ts)).
- `src/agent_memory.py` — persisted decision/preference memory — IPC:
  `memory:list` / `memory:query` ([memory.handlers.ts](../../desktop/src/main/ipc/memory.handlers.ts)).

All of this is already exposed over IPC in [search.handlers.ts](../../desktop/src/main/ipc/search.handlers.ts):
`search:bm25`, `search:tfidf`, `search:vector` (accepts a `hybrid` flag),
`search:browse`. The plumbing is not the gap — **wiring it into the two
LLM-facing call sites is.**

### Where retrieval is and isn't used today

| Call site | Retrieval used | Automatic? |
|---|---|---|
| `ai:complete` (FIM autocomplete) — [ai.handlers.ts:401](../../desktop/src/main/ipc/ai.handlers.ts#L401) | `vector_index.py --hybrid` via `ai:buildContext`, 30s cache (`contextCacheByWindow`) | Yes — on file open |
| `@codebase` mention in Composer — [ChatInput.tsx:50](../../desktop/src/renderer/src/components/chat/ChatInput.tsx#L50) | `search.bm25()` only — **lexical, not hybrid** | No — user must type `@codebase <query>` |
| `ai:streamChat` (main chat/Composer send) — [ai.handlers.ts:136](../../desktop/src/main/ipc/ai.handlers.ts#L136) | None automatic. Only what the renderer inlined via `@file`/`@folder`/`@codebase`, plus MCP tools the model chooses to call | No |
| `autonomousAgent.ts` (background/autonomous agent) — [autonomousAgent.ts:286](../../desktop/src/main/agents/autonomousAgent.ts#L286) | **None at all.** Each subtask prompt is just `{system: AGENT_SYSTEM_PROMPT}` + `{user: subtask.description}` | No |
| `archDoc:generate` | `arch_doc.py`, but only rendered to a standalone panel, never injected into a prompt | Manual, one-shot |

The autonomous agent is the starkest gap: it's the most independent part
of the product and runs with zero codebase awareness per subtask, even
though `format_context()` already does exactly this job for the
`/context-implement` CLI path. The interactive chat's gap is subtler:
retrieval exists but is opt-in (`@codebase`) and downgraded to BM25-only
instead of the hybrid path already used for autocomplete.

## 2. Goal

Every LLM call Lakoora makes (chat, agent subtask) gets relevant repo
context **by default**, without the user typing a magic mention — matching
the framing in the original Cursor-architecture note: *"Cursor does NOT
send entire repo... it retrieves... Prompt → Query Expansion → Hybrid
Search → Reranking → Context Assembly."* We already have hybrid search and
reranking; we're missing the automatic assembly step at the two prompt
call sites.

## 3. Non-goals

- Do not rebuild indexing, embeddings, or the symbol map — they exist and
  work (`vector_index.py`, `repo_map.py`).
- Do not require Qdrant/`--persistent` — the in-memory hybrid path is fast
  enough for this scope; persistent indexing is a separate, optional
  follow-up for large repos.
- Do not change the manual `@file`/`@folder`/`@selection` mention behavior
  — those stay as explicit, full-content overrides. This spec only adds an
  *automatic baseline* layer underneath them.

## 4. Design

### 4.1 Shared assembly helper (new)

Add `src/chat_context.py`:

```text
python -m src.chat_context <query> <repo-root> [--task-filter] [--json] [--max-snippets N]
```

Internally: calls `hybrid_search()` from `vector_index.py` (reuse, don't
reimplement), takes the top `N` (default 5, matches the existing
`ai:buildContext` convention), and reads a small surrounding snippet per
hit the same way `enrichResults()` does in `search.handlers.ts` today —
except do this enrichment in Python so both Electron (TS) and any future
non-Electron caller get the same output shape without duplicating the
file-read logic. Output JSON: `{ query, results: [{file, line, snippet,
score}] }`.

This is a thin composition wrapper, not new retrieval logic — it exists so
TS call sites have one function to call instead of re-deriving the
BM25→vector→snippet pipeline each call site currently does ad hoc.

### 4.2 Dedup against manual mentions

Both integration points must skip any file the user already pulled in
manually (`@file:path`, `@folder:path`) so the same file doesn't appear
twice in the prompt. Pass the set of manually-mentioned relative paths
into the IPC call; filter `chat_context` results against that set on the
TS side (cheap, no need to push this into Python).

### 4.3 Token budget

Cap injected context the same way `ai:buildContext` already does (top 5
snippets, ~4 lines of surrounding context each). This is a budget decision
already validated by the existing autocomplete path — reuse it rather than
inventing a new number.

## 5. Implementation plan (continuing the existing "Gap N" convention)

### Gap 28 — Autonomous agent: repo orientation per subtask

**File:** [autonomousAgent.ts](../../desktop/src/main/agents/autonomousAgent.ts)

This file is main-process code and already imports `runPythonJson`
directly for `loadPlan`/`markDone`/`executeBrowse` — no IPC needed here
(IPC is only for main↔renderer, and there's no renderer involved in this
loop). Before building `userContent` (line ~286), add a helper that calls
`runPythonJson(['-m', 'src.chat_context', subtask.description, projectPath, '--json'])`
and prepend the formatted result to `AGENT_SYSTEM_PROMPT` (not
`userContent`, so it survives the retry path without duplicating on
retries). Concretely:

```ts
const contextBlock = await getSubtaskContext(subtask.description, projectPath)
const systemPrompt = contextBlock
  ? `${AGENT_SYSTEM_PROMPT}\n\n${contextBlock}`
  : AGENT_SYSTEM_PROMPT
```

`streamToString` currently filters out `role: 'system'` messages entirely
for the Claude branch (line 123) — that's a pre-existing bug independent of
this spec but it means the system prompt is silently dropped today for
Claude. Fix it as part of this gap: pass `system: systemPrompt` as a
top-level param to `client.messages.stream()` (matching how `ai:streamChat`
already does it at line 201), since otherwise the new context block would
never reach the model on the Claude path, which is the default model for
this app.

**Acceptance:** running an autonomous session on a multi-file subtask
(e.g. "add a new IPC handler following the existing pattern") produces an
edit that matches existing file conventions on the first attempt more
often than today's zero-context baseline — verify by manual run on 3
sample subtasks before/after.

### Gap 29 — Composer: automatic hybrid retrieval by default

**Files:** [ChatInput.tsx](../../desktop/src/renderer/src/components/chat/ChatInput.tsx), new IPC handler.

Add `context:assemble` IPC (main process, calls `chat_context.py --hybrid`)
exposed as `window.api.context.assemble(query, manualPaths)`.

Call it unconditionally on every send (not gated on `@codebase`), keyed on
the user's latest message text, *after* the existing `@file`/`@folder`/
`@codebase`/`@issue`/`@pr` injectors run (so `manualPaths` reflects what
the user already pulled in and dedup works). Wrap the result in
`<auto_context query="...">...</auto_context>` so it's visually
distinguishable from `<codebase_context>` (manual) in any debug/inspector
view.

Keep `@codebase` working as-is for explicit, larger-N lexical search —
this is the automatic *baseline*, not a replacement for the deliberate
deep-dive mention.

**Acceptance:** sending a chat message with no mentions about a function
that exists elsewhere in the repo results in that function's signature
appearing in the system/user context sent to the model (check via the
existing chat history export, Gap 27, to inspect what was actually sent).

### Gap 30 — Upgrade `@codebase` from BM25-only to hybrid

**File:** [ChatInput.tsx:50-71](../../desktop/src/renderer/src/components/chat/ChatInput.tsx#L50-L71)

Change `window.api.search.bm25(query)` to
`window.api.search.vector(query, true)` (the `hybrid` flag already exists
on `search:vector`, [search.handlers.ts:108](../../desktop/src/main/ipc/search.handlers.ts#L108)).
One-line change once Gap 29 establishes the pattern; do it after, not
before, so both paths can share the same snippet-formatting helper instead
of drifting.

### Gap 31 (stretch) — Expose retrieval as an on-demand MCP tool

Register a `search_codebase` tool in `mcpManager.ts`'s aggregated tool list
(alongside whatever external MCP servers are configured) backed by the
same `chat_context.py` call, so the model can explicitly pull more context
mid-conversation when the automatic top-5 baseline isn't enough — this
mirrors Cursor's actual behavior of mixing push (automatic RAG) and pull
(agent-initiated search) rather than relying on either alone. This is the
"Beyond Cursor" opportunity flagged in `vector_index.py`'s own docstring
(decision-log cross-referencing via `related_decisions()`) — once
`search_codebase` exists as a tool, it's a small extension to also surface
`related_decisions()` results, giving the model *why* a piece of code is
shaped the way it is, not just *what* it is.

## 6. Out of scope follow-ups (don't build now, just noted)

- Persistent Qdrant indexing for large repos (`--build-index`) — current
  in-memory hybrid search is fast enough at this repo's size; revisit if
  latency becomes a problem.
- True cross-file symbol/dependency graph (Layer 2's "Class A → Service B
  → Repository C") — `symbol_filter.py`/`ts_map.py` are token-relevance
  filters, not a real call graph. Worth a separate spec once Gaps 28-30
  are landed and it's clear whether token-level retrieval is the binding
  constraint or whether structural graph traversal is actually needed.
