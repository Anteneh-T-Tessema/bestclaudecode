# Step 5: MCP Servers

## What we built

- `mcp-servers/build-log-server/` — a TypeScript MCP server (stdio
  transport) exposing four tools:
  - `list_build_steps` — parses README.md's status checklist
  - `get_step_log` — returns a docs/NN-*.md file's content by step number,
    with a structured error (not a crash) for missing steps
  - `mark_step_done` — flips a step's checkbox to done in README.md,
    added later (see "The mark_step_done tool" below)
  - `validate_build_log` — checks README.md against docs/NN-*.md for
    consistency, added later (see "The validate_build_log tool" below)
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

## The validate_build_log tool

Added after `mark_step_done`, once the obvious next gap was the
`check_build_log_consistency.py` Stop hook's biggest limitation: it only
runs at turn-end, so there was no way to ask "is the build log
consistent?" mid-session without waiting for the session to end. This
tool exposes the identical check on demand.

- `validate_build_log()` parses README.md's checklist and lists
  `docs/NN-*.md` files (reusing the same `parseReadmeStatus`/
  `listDocFiles` helpers `mark_step_done` already uses — no duplicated
  parsing logic), then checks both directions for every step in the
  checklist: checked off with no doc, or a doc exists but it's not
  checked off.
- Message text deliberately matches `check_build_log_consistency.py`'s
  `find_inconsistencies` wording exactly, so the Python hook and this
  tool read as the same check expressed twice, not two checks that might
  drift apart.
- `isError: true` if any inconsistency is found — the tool call itself
  succeeds either way; `isError` reports the *finding*, mirroring how the
  Stop hook's exit code signals "blocked" vs. "clean" rather than
  treating "found a problem" as a tool malfunction.

### Verification performed for validate_build_log

Extended the existing `test/build-log-server.test.mjs` fixture rather
than building a new one — the fixture already contains a planted
inconsistency by construction (`README_FIXTURE`'s step 10 starts
unchecked but `docs/10-has-doc-ready.md` exists, originally added to
test `mark_step_done`'s flip behavior), so it doubles as the
"inconsistent" case for free:

1. Called early (before `mark_step_done` mutates anything) — confirms
   `isError: true` with the step 10 "has a doc but is not checked off"
   message.
2. Called again as the suite's last test, after the existing
   `mark_step_done` test has flipped step 10's checkbox — confirms
   `isError: false` with "Build log is consistent," now that README and
   docs/ agree on every step.

Also verified directly against this repo's real README.md/docs/ (not
just the fixture) by piping raw JSON-RPC over stdio to the built server:
returned `isError: false`, "Build log is consistent" — correct, since
Step 9 deliberately has no README checklist line yet, so there's nothing
yet to compare against (same reason the Stop hook doesn't flag it
either).

## Automated test suite (added later)

Every verification above — the raw JSON-RPC piping, the `mark_step_done`
fixture cases — was run through throwaway scripts that got deleted
afterward. That's the opposite of this repo's own standard for `src/`
Python code (`skills/test-writing`, the Step 6 hooks): real tests,
committed, that fail if the code regresses. The MCP server had grown to
three tools with real logic (parsing, a mutation with a safety guard) and
no committed tests at all, so that gap was closed.

- `mcp-servers/build-log-server/test/build-log-server.test.mjs` — uses
  Node's built-in `node:test` + `node:assert/strict` (no new dependency).
  Builds an isolated `mkdtemp` fixture per run (synthetic README.md +
  docs/, `dist/` copied in, `node_modules` symlinked in since the spawned
  server resolves imports relative to its own location), connects a real
  MCP `Client` over stdio, and exercises all four tools: `list_build_steps`
  parsing, `get_step_log` (existing step + nonexistent step), all four
  `mark_step_done` cases from above, and `validate_build_log`'s two cases
  (inconsistent, then consistent after the mutation above).
- `npm test` runs `npm run build && node --test` — always tests the
  freshly compiled output, never stale `dist/`.
- **Mutation check**: deliberately broke the already-done check in
  `markStepDone` (`m[1] === "x"` → `m[1] === "z"`), reran — 2 of 7 tests
  failed correctly. Reverted, reran — 7/7 passed again. Confirms the suite
  actually fails when the code is wrong, not just when it doesn't compile.
- Fixture cleanup verified: `after()` hook removes the tmp directory; no
  leftover `build-log-server-test-*` directories in `$TMPDIR` after a run.

## Not yet done (deliberately)

- Not yet tested inside a live Claude Code CLI session consuming it via
  `.mcp.json` — verified at the raw protocol level instead, which proves
  the server is correct; whether Claude Code's client wiring picks it up
  smoothly is a CLI-side check left to you, same caveat as Steps 3–4
- No HTTP/SSE transport — explicitly deferred per this step's scope decision
- `dist/` and `node_modules/` correctly excluded by existing `.gitignore`
  rules (`dist/`, `node_modules/`) — no new ignore rules were actually
  needed, confirmed via `git status` before committing
