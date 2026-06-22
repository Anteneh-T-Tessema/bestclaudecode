# Step 32 — Cross-session agent memory (closes Devin memory gap)

## What was built

**`src/agent_memory.py`** — persistent, BM25-queryable agent memory that
survives across sessions — the primary capability gap vs. Devin.

Devin accumulates codebase knowledge over time (e.g. "adding a field to User
always requires a migration") without being told. This module provides the same
capability as an explicit, auditable, developer-inspectable store.

Key API:
- `MemoryEntry` — key, content, tags, created_at, updated_at, source_task
- `MemoryStore(memory_dir)`:
  - `.write(key, content, tags, source_task)` — upsert (preserves created_at)
  - `.get(key)` / `.list_all()` / `.delete(key)`
  - `.query(text, top_k)` — BM25 ranking over key+content+tags
  - `.format_memory_block(entries)` — Markdown block for prompt injection
- `auto_record_from_decision(task, outcome, findings)` — called at end of each
  implement cycle; writes task summary + per-file entries from findings

Storage: `.agent-memory/<slug>.json`, one file per entry, human-readable JSON.

**`src/tests/test_agent_memory.py`** — 28 tests covering write/update/delete,
BM25 query relevance, tag filtering, automatic population from decisions,
and timestamp ordering (mocked via `patch("src.agent_memory._utcnow")`).

## Why

Devin's competitive advantage is memory that builds automatically. This module
closes that gap with a key architectural advantage: every memory entry is a
readable JSON file the developer can inspect, edit, or delete. Devin's memory
is a black box.

## Test count after this step: 203
