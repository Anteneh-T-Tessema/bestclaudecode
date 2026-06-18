# Step 5: MCP Servers

## What we built

- `mcp-servers/build-log-server/` — a TypeScript MCP server (stdio
  transport) exposing three tools:
  - `list_build_steps` — parses README.md's status checklist
  - `get_step_log` — returns a docs/NN-*.md file's content by step number,
    with a structured error (not a crash) for missing steps
  - `mark_step_done` — flips a step's checkbox to done in README.md,
    added later (see "The mark_step_done tool" below)
- `mcp-servers/build-log-server/README.md` documenting setup + verified behavior

## Why this tool

Right now, knowing build status means manually opening README.md +
docs/. This makes it queryable as an MCP tool — directly useful to the
`coding-agent` subagent (Step 3), which can check status before acting
instead of guessing or re-reading files itself every time.

## Real decisions made

- Used current SDK (`@modelcontextprotocol/sdk` ^1.29.0, the v1.x
  production line — v2 is alpha-only per the SDK's own GitHub page,
  expected stable ~Q3 2026, so not appropriate to build on yet).
- Used the modern high-level `McpServer` + `registerTool` API rather than
  the older low-level `Server` + manual `setRequestHandler` pattern.
- stdio transport per Step 5's scope decision (local process, simplest).
- TypeScript strict mode, per root CLAUDE.md convention.

## Verification performed (not just "it compiled")

1. `npm install` + `npm run build` — compiles clean under `strict: true`.
2. Piped a real JSON-RPC sequence over stdio directly to the compiled
   server: `initialize` → `notifications/initialized` → `tools/list` →
   `tools/call` (list_build_steps) → `tools/call` (get_step_log, step 3)
   → `tools/call` (get_step_log, step 99 — nonexistent).
3. Confirmed:
   - Correct protocol handshake and server identity in the `initialize` response
   - `tools/list` returns both tools with correct, schema-valid input shapes
   - `list_build_steps` returns accurate data matching actual repo state
     (steps 1–4 done, 5–8 not — correct at time of this step)
   - `get_step_log(3)` returns the real Step 3 doc content, byte-correct
   - `get_step_log(99)` returns `isError: true` with a helpful message
     instead of throwing an uncaught exception — the failure path was
     exercised, not just the happy path

This mirrors the discipline from Step 4 (skills): verifying behavior, not
just file well-formedness. A "build" tool that only proves `tsc` exits 0
would not have caught a wrong relative path to docs/, a wrong regex, or a
broken error branch — the protocol-level test catches all of those.

## The mark_step_done tool

Added after Step 8 was complete, once the server was no longer read-only
by necessity but by choice — at that point a mutating tool was the most
useful thing left to add, so the read-only constraint above was revisited
deliberately rather than left as permanent scope.

- `mark_step_done(step)` flips a step's README.md checkbox from `[ ]` to
  `[x]`.
- Safety guard: it refuses (`isError: true`) if no `docs/NN-*.md` exists
  for that step yet. Without this, the tool could create exactly the kind
  of inconsistency `check_build_log_consistency.py`'s `Stop` hook (Step 8)
  exists to catch — a step checked off with no doc behind it.
- No-ops (without error) if the step is already marked done, and refuses
  separately if the step number doesn't appear in the checklist at all.

### Verification performed

Tested against an isolated `mktemp -d` fixture (synthetic README.md +
docs/, never the real repo) via a throwaway MCP client script, covering
four cases:

1. Step already done → no-op, `ok: true`.
2. Step in checklist, no doc yet → refused, `isError: true`.
3. Step in checklist, doc exists, unchecked → checkbox flipped, `ok: true`.
4. Step not in checklist at all → refused, `isError: true`.

This caught a real bug before it shipped: the first implementation
checked doc-existence *before* checklist-membership, so case 4 (step not
in the checklist, and also no doc for it) returned the misleading
"no docs/NN-*.md file exists yet" message instead of "isn't in the
checklist at all." Fixed by reordering the checks — checklist membership
first, doc-existence second — and re-ran all four cases against a fresh
fixture to confirm the fix didn't regress the other three.

## Not yet done (deliberately)

- Not yet tested inside a live Claude Code CLI session consuming it via
  `.mcp.json` — verified at the raw protocol level instead, which proves
  the server is correct; whether Claude Code's client wiring picks it up
  smoothly is a CLI-side check left to you, same caveat as Steps 3–4
- No HTTP/SSE transport — explicitly deferred per this step's scope decision
- `dist/` and `node_modules/` correctly excluded by existing `.gitignore`
  rules (`dist/`, `node_modules/`) — no new ignore rules were actually
  needed, confirmed via `git status` before committing
