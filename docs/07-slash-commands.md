# Step 7: Slash Commands

## What we built

- `.claude/commands/build-status.md` → `/build-status [step-number]` —
  reports build-log progress by calling the `build-log-server` MCP tools
  (Step 5) instead of reading `README.md`/`docs/` directly.
- `.claude/commands/validate.md` → `/validate [focus]` — delegates to the
  `coding-agent` subagent (Step 3) to run `.venv/bin/ruff check .` and
  `.venv/bin/pytest src/tests/ -q`, plus `npm test` in
  `mcp-servers/build-log-server/` once that server had a real test suite
  (Step 5, later), and fix any failures, rather than running the checks
  inline itself.

## Why these two, this way

Generic placeholder commands (`/check`, `/deploy`, `/test`) wouldn't prove
anything about this repo specifically. Both commands were chosen because
each one's entire purpose is to exercise an artifact from an earlier
step — `/build-status` for the Step 5 MCP server, `/validate` for the
Step 3 subagent — so building them also re-verifies that earlier work
still works, not just that two new files parse.

`$ARGUMENTS` is used meaningfully in both rather than decoratively:
`/build-status 3` calls `get_step_log` for step 3 specifically;
`/build-status` with no args asks for the first not-done step instead, so
the command answers "what's done" and "what's next" with the same tool.

## Real decisions made

- `validate.md`'s prompt explicitly says "don't run the checks
  yourself... delegate this to the coding-agent subagent" — without that
  instruction the main agent could just run `ruff`/`pytest` inline via
  Bash and never actually invoke the subagent, which would defeat the
  point of this command.
- Both commands have `description` + `argument-hint` frontmatter so they
  show up correctly in the command picker.

## Verification performed (not just "the files parse")

1. Confirmed both commands hot-reload mid-session: immediately after
   writing each file, it appeared as an invokable skill (`build-status`,
   `validate`) with no session restart needed — unlike Step 5's MCP
   server, see below.
2. Actually invoked `/build-status` live. This surfaced a real, honest
   limitation rather than a fake pass: the `build-log-server` MCP tools
   (`list_build_steps`, `get_step_log`) aren't reachable in this running
   session, because `.mcp.json` was added mid-session and MCP server
   connections are only established at session start — confirmed by
   searching for those tools and finding no match. The command's prompt
   structure is correct (verified by inspection and by cross-checking the
   tool names against `mcp-servers/build-log-server/src/index.ts`'s
   actual `registerTool()` calls), but the live tool-calling steps remain
   unverified until run in a fresh session.
3. Actually invoked `/validate` live by delegating to the `coding-agent`
   subagent — twice, to see real iteration-on-failure, not just a single
   pass:
   - First run: the subagent correctly reported `ruff` as **not found**
     (no binary, no pip package) rather than silently skipping it or
     fabricating a pass. `pytest` passed (4/4).
   - Told it the project's local venv has `ruff` at `.venv/bin/ruff` (root
     `CLAUDE.md` says "use ruff for linting" but doesn't say where it
     lives, which is exactly why a fresh subagent missed it — worth
     tightening `CLAUDE.md` later, out of scope for this step).
   - Second run: `ruff check .` → "All checks passed!". Confirmed pass.

## Not yet done (deliberately)

- `/build-status`'s actual MCP tool calls are structurally verified but
  not behaviorally verified end-to-end in a live session — needs a
  session restart (or a real `claude` CLI run) to connect
  `build-log-server` and confirm the tool calls return real data when
  invoked through the command.
- No Stop hook exists yet, so `/validate` can't be chained into an
  automatic post-session check — that, plus wiring these commands into
  the full hook chain, is explicitly Step 8's job.
- `root CLAUDE.md`'s "use ruff for linting" doesn't mention the project
  venv path — noted as a real gap found via live testing, not fixed here
  since it's outside this step's stated scope. **Update**: closed later
  (root `CLAUDE.md` now states the `.venv/bin` paths explicitly, and
  `validate.md`'s own prompt text was updated to match) — found again
  independently while auditing the repo after Step 8.
