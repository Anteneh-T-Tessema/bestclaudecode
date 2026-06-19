# Step 24: TF-IDF semantic search index

## What was built

**`src/embedding_index.py`** — a zero-dependency (pure stdlib: `math`,
`collections`) TF-IDF indexer over repo map symbol lines.

Key API:
- `TFIDFIndex.from_repo_map(repo_map_str)` — parses a repo map string into a
  corpus of `_Doc` records, one per indented symbol line, and computes IDF
  weights with +1 smoothing.
- `TFIDFIndex.search(query, top_k=5)` — returns `(score, file, line)` triples
  sorted by score descending. Uses the same `_tokenise()` stemmer as
  `filter_map()` so stems are consistent across both layers.
- `semantic_fallback(repo_map, task, top_k=10)` — rebuilds a minimal map
  string from the top-ranked symbols, grouped under their file headers.

**`src/symbol_filter.py`** — `filter_map()` now imports and calls
`semantic_fallback()` when its token-intersection result is empty. Previously
it returned the full unfiltered map; now it returns a TF-IDF-ranked subset.

**`src/tests/test_embedding_index.py`** — 10 tests covering: index build, search
relevance, empty/stopword queries, `top_k` cap, score ordering, empty map edge
case, `semantic_fallback` subset/passthrough, and the integration path through
`filter_map`.

## Why

The token-intersection filter fails when the task uses terminology that doesn't
share a stem with any symbol name — e.g. "orchestrate pipeline" against a map
that has `run_pipeline()`. A TF-IDF fallback handles these cases without
requiring a cloud embedding call or any install.

The design choice to keep TF-IDF as a *fallback* (not a replacement) is
intentional: token intersection is faster and more precise for exact-match
cases; TF-IDF adds recall when precision fails.

## What was verified

- 10 new tests pass
- Integration test: `filter_map(_SAMPLE_MAP, "orchestrate pipeline")` returns a
  non-empty string via the TF-IDF path
- Full suite: 94 tests, 0 failures
- `ruff check src` clean

## Deliberately left undone

- No persistence: the index is rebuilt from the repo map string on every call.
  For repos with thousands of symbols this adds a few milliseconds; caching the
  index to disk is a future optimisation.
- TF-IDF does not capture semantic similarity ("evict" ≠ "remove" to TF-IDF).
  True embedding-based search (e.g. sentence-transformers) would improve recall
  further but requires a dependency and a local model download.
