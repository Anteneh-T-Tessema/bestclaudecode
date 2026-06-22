# Step 37 — Decision log analytics (new capability beyond Cursor and Devin)

## What was built

**`src/decision_analytics.py`** — aggregate analytics over the decision log
that neither Cursor nor Devin can produce: retry rates, verdict distributions,
most-flagged files, and recurring reviewer findings.

Key API:
- `ParsedDecision` — structured parse of one `docs/decisions/*.md` file
- `parse_decision_file(path)` → `ParsedDecision | None` — regex-based parser
  for the Markdown format written by `log_decision()`
- `load_decisions(docs_dir)` → `list[ParsedDecision]` — all entries, newest first
- `DecisionStats` — aggregated result dataclass: `total`, `with_retry`,
  `retry_rate_pct`, `verdict_counts`, `top_findings`, `top_files`, `agents`
- `compute_stats(decisions)` → `DecisionStats` — Counter-based aggregation;
  file paths extracted from findings via regex
- `format_analytics_report(stats)` → Markdown report
- CLI: `python -m src.decision_analytics [--json] [dir]`

**`src/tests/test_decision_analytics.py`** — 24 tests covering the parser (all
fields, null body, missing file, no findings), load ordering, stats computation
(retry rate, verdict distribution, top files, agents), and report formatting.

## Why

This answers a question no commercial AI coding tool can: "which files keep
getting reviewer Blocking findings across all agent runs?" That signal is more
actionable than any single PR review — it points at systemic quality problems.

## Test count after this step: 297
