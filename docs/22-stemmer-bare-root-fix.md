# Step 22: Stemmer bare-root-form fix

## What was built

Added `("e", 3)` to `_SUFFIXES` in `src/symbol_filter.py` so `"cache"` strips
its trailing `e` and produces the stem `"cach"`, matching the existing stem for
`"caching"` (which already stripped `"ing"` → `"cach"`). Two new tests were
added: `test_stem_strips_bare_e` and `test_tokenise_cache_caching_intersect`.
The existing `test_tokenise_drops_stopwords` was updated to assert `"cach" in
tokens` instead of `"cache" in tokens`, which is now correct.

## Why

The documented gap from Step 20 was that `filter_map("add caching to context",
...)` would miss a symbol file named `cache.py` because the task stem `"cach"`
(from `"caching"`) did not match the repo token `"cache"` (unstemmed bare
noun). The fix closes this without any new dependency — it is a one-line change
to the suffix table.

The choice of `("e", 3)` is safe because: (a) all short `e`-ending words that
matter ("use", "make", "have", "be") are already in `_STOPWORDS` and never
reach the stemmer; (b) the minimum-stem-length guard (`>= 3`) prevents
collapsing two-character remnants.

## What was verified

- `_stem("cache")` → `"cach"` (new test)
- `_tokenise("caching") & _tokenise("cache")` is non-empty (new test)
- All 71 pre-existing tests still pass
- `ruff check src` clean

## Deliberately left undone

Other bare-root mismatches (e.g. `"type"` vs `"typing"`, `"scope"` vs
`"scoping"`) are handled identically by the new rule — no special-casing
needed.
