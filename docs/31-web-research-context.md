# Step 31 — Web research context (closes Cursor @web gap)

## What was built

**`src/web_context.py`** — web research context injection with an injectable
fetcher backend, matching Cursor's `@web` feature.

Key API:
- `WebResult(title, url, snippet)` — one search result
- `format_web_block(results, query)` — fenced Markdown block (capped at 5
  results, 8 lines per snippet)
- `fetch_web_context(query, fetcher, max_results)` — fetch + format, returns
  a placeholder block when no fetcher is wired in
- `parse_research_flag(args)` → `(query, remaining_args)` — extracts
  `--research <query>` from the command args list

The fetcher is an injectable `Callable[[str], list[WebResult]]` — completely
backend-agnostic. Any search API (Brave Search, Tavily, DuckDuckGo) works
without changing this module.

**`src/tests/test_web_context.py`** — 17 tests covering formatting, result
capping, snippet truncation, the no-fetcher placeholder, and flag parsing
including multi-token queries and `--flag` stoppers.

## Why

Cursor's `@web` lets the agent pull live documentation before starting a task.
The key design insight: the fetcher is injectable so the module is testable
without network access and backend-agnostic by design, whereas Cursor's web
integration is hardwired to their proprietary retrieval stack.

## Test count after this step: 175
