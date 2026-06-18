# build-log-server

MCP server (stdio transport) exposing three tools over this repo's build log:

- `list_build_steps` — parses `README.md`'s status checklist, returns
  step number / name / done-or-not for every step.
- `get_step_log` — returns the full content of `docs/NN-*.md` for a given
  step number; returns a structured error (not a crash) if that step has
  no log file yet.
- `mark_step_done` — flips a step's checkbox to done in `README.md`.
  Refuses (`isError: true`) if no `docs/NN-*.md` exists for that step yet,
  and no-ops if it's already marked done. See `docs/05-mcp-servers.md` for
  the safety rationale and verification performed.

## Setup

```bash
cd mcp-servers/build-log-server
npm install
npm run build      # compiles src/ -> dist/, required before running
```

Registered at the repo root in `.mcp.json` so Claude Code picks it up
automatically for this project. `dist/` is gitignored (build output);
run `npm run build` after a fresh clone before the server will start.

## Testing

```bash
npm test    # builds, then runs the committed suite (node:test)
```

`test/build-log-server.test.mjs` spins up an isolated tmp fixture per
run and drives all three tools through a real MCP client over stdio —
never touches this repo's actual README.md/docs/.

## Verified behavior

Tested with a raw JSON-RPC exchange piped over stdio (`initialize` →
`notifications/initialized` → `tools/list` → `tools/call` x3), not just
compiled and assumed correct:

- Handshake returns correct protocol version + server info
- `tools/list` returns both read-only tools with correct, schema-valid
  input shapes (this test predates `mark_step_done`)
- `list_build_steps` returns real, accurate data matching repo state
- `get_step_log(3)` returns the actual Step 3 doc content verbatim
- `get_step_log(99)` (nonexistent step) returns `isError: true` with a
  helpful message rather than throwing

`mark_step_done` was added later and verified separately against an
isolated fixture — see `docs/05-mcp-servers.md` for that test's cases and
the message-precision bug it caught.
