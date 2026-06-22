# Step 35 — MCP decision log tool (new capability beyond Cursor and Devin)

## What was built

Extended **`mcp-servers/build-log-server/src/index.ts`** with three new MCP
tools that expose the decision log (Step 27) as a queryable interface:

### `list_decisions`
Returns the N most recent decision log entries from `docs/decisions/`, parsed
into structured JSON (task, agent, verdict, retries, outcome, findings).
Supports a `limit` parameter (default 10).

### `search_decisions`
Keyword search over all decision entries — matches entries where task, outcome,
or findings contain all given keywords (case-insensitive, space-separated).
Returns matching entries newest-first.

### `get_decision_stats`
Aggregates all entries and returns:
- Total cycles, cycles with retry, retry rate %
- Verdict distribution (`verdictCounts`)
- Top 5 recurring findings (`topFindings`)

Also added `parseDecisionFile()` and `loadDecisions()` private helpers that
parse the Markdown format written by `src/decision_log.py`.

**`mcp-servers/build-log-server/test/build-log-server.test.mjs`** — 8 new
tests added to the existing 9, covering all three tools: newest-first ordering,
limit parameter, retry count parsing, findings extraction, keyword search
matches and misses, stats total/retry rate, and verdict counts.

## Why

Neither Cursor nor Devin exposes their internal decision history as a queryable
tool. Agents in this repo can now ask "what happened last time I worked on auth"
before starting a new task — the MCP tool makes the audit trail *interactive*,
not just archival.

## Test count after this step: 17 MCP tests (257 Python tests unchanged)
