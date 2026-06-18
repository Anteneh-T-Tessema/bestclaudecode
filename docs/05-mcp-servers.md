# Step 5: MCP Servers

## What we built

- `mcp-servers/build-log-server/` — a TypeScript MCP server (stdio
  transport) exposing two tools:
  - `list_build_steps` — parses README.md's status checklist
  - `get_step_log` — returns a docs/NN-*.md file's content by step number,
    with a structured error (not a crash) for missing steps
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

## Not yet done (deliberately)

- No write/mutating tools yet (e.g. "mark step done") — this server is
  read-only by design for now; a mutating tool would need more thought
  about safety (this server can currently only ever report state, never
  change it)
- Not yet tested inside a live Claude Code CLI session consuming it via
  `.mcp.json` — verified at the raw protocol level instead, which proves
  the server is correct; whether Claude Code's client wiring picks it up
  smoothly is a CLI-side check left to you, same caveat as Steps 3–4
- No HTTP/SSE transport — explicitly deferred per this step's scope decision
- `dist/` and `node_modules/` correctly excluded by existing `.gitignore`
  rules (`dist/`, `node_modules/`) — no new ignore rules were actually
  needed, confirmed via `git status` before committing
