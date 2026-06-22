# Step 29 — BM25 semantic search (closes Cursor ranking gap)

## What was built

**`src/bm25_index.py`** — Okapi BM25 ranking index over repo map symbol lines.

BM25 replaces the TF-IDF index from Step 24 as the primary ranking function.
Two algorithmic improvements over TF-IDF:

1. **Term saturation** (`k1=1.5`): repeated occurrences of a term give
   diminishing extra score. A symbol mentioning "cache" four times isn't four
   times as relevant.
2. **Document-length normalisation** (`b=0.75`): longer symbol lines are
   penalised so a verbose comment can't crowd out a short, highly-relevant
   function name.

Key API:
- `BM25Index.from_repo_map(repo_map)` — build from a repo map string
- `.search(query, top_k)` → `list[(score, file, symbol_line)]`
- `.save(path)` / `BM25Index.load(path)` — JSON persistence
- `bm25_search(repo_map, task, top_k)` — drop-in for `semantic_fallback()`

**`src/tests/test_bm25_index.py`** — 16 tests covering construction, search,
term saturation (confirms BM25 doesn't score repeated terms linearly), save/load
roundtrip, and the `bm25_search` helper.

## Why

Cursor uses BM25 as its lexical code-search layer. TF-IDF (Step 24) gives
equal weight to each additional term occurrence; BM25 caps the gain from
repetition and normalises for document length. On real symbol corpora this
produces significantly better ranking, particularly for short queries against
mixed-length symbol lines.

## Test count after this step: 143
