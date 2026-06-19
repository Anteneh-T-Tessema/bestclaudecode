# Step 3: Subagents

## What we built
`.claude/agents/coding-agent.md` — a subagent that behaves like an
autonomous coding agent (Cursor agent mode / Devin / Manus style): given a
task, it plans, edits, runs verification (tests/build/lint), and iterates
on failures — without needing the user to manually shuttle command output
back to it.

## Why this subagent, this way
Subagents are separate Claude instances with their own context window and
their own tool permissions, invoked by the main agent via delegation. The
`description` field is what the main agent's router matches against to
decide *when* to delegate — so it was written to be specific about trigger
conditions ("implement a feature, fix a bug... not just answering a
question about code") rather than vague ("helps with code"), since a vague
description causes either over-triggering or never triggering.

Tool access: `Read, Edit, Write, Bash, Grep, Glob` — deliberately not
`model: opus` or a restricted tool list, because a coding agent that can't
edit or run things isn't one. `model: inherit` means it uses whatever model
the main session is running, rather than hardcoding a specific one.

The system prompt encodes an explicit operating loop (Understand → Plan →
Act → Verify → Iterate) rather than just "write good code," because the
entire point of a Cursor/Devin/Manus-style agent — versus a plain chat
assistant — is that it closes the loop on its own work instead of asserting
correctness without running anything.

## Verification performed
Wrote a small Python check (not committed as project code — it was a
one-off validation, run via bash_tool) confirming:
- YAML frontmatter parses without error
- Required fields (`name`, `description`) are present
- `name` is a valid slug (`coding-agent`)
- `description` is long/specific enough to be useful for routing

This is the right level of verification for this step: a subagent
definition is a config artifact (per root CLAUDE.md's distinction between
src/ code needing tests and config/scaffolding needing the build log +
basic validity check instead).

## Update: strengthened toward Devin/Cursor parity

Originally `coding-agent` had `Read, Edit, Write, Bash, Grep, Glob` — the
minimum to edit and verify code, but missing two things real Cursor
agent-mode/Devin-style tools have: looking things up online, and visibly
tracking a multi-step plan as it works. Added once that gap was concrete,
not speculative: a coding agent with no way to check an unfamiliar
library's API or a version-specific error message will guess instead,
and a multi-file task with no visible plan is harder to follow than
Devin's/Cursor's checklist-style progress view.

- **Tools**: added `WebFetch`, `WebSearch`, `TodoWrite` to the existing
  list. Prompt addition: WebFetch/WebSearch are for what the repo itself
  can't answer (unfamiliar API, exact error meaning, version-specific
  behavior) — not a substitute for reading the actual code/CLAUDE.md
  first. TodoWrite is for non-trivial tasks (more than ~3 distinct
  changes, or spanning multiple files) — explicitly *not* for a one-line
  fix, so it doesn't become noise.
- **Stuck-loop guard**: added to the Iterate step — if the same fix
  attempt fails twice in a row, stop repeating it and gather more
  information instead of trying a near-identical third attempt. This
  targets a known autonomous-agent failure mode (retrying the same wrong
  fix) that the original loop didn't explicitly guard against.
- **Self-check before reporting done**: added a standard to look at its
  own `git diff` against the original task scope before declaring
  done — catches debug prints, leftover commented-out code, or
  unintended scope creep that "verification passed" alone wouldn't catch.

### Verification performed for the strengthening update

1. **Config-validity check**: re-parsed the frontmatter, confirmed
   `tools` now contains `WebFetch`, `WebSearch`, `TodoWrite` alongside
   the original five, with `name`/`description`/`model` unchanged.
2. **Hook-safety check, done before granting `TodoWrite`**: `TodoWrite`
   contains "Write" as a substring, and both existing hooks' matchers
   (`Write|Edit|MultiEdit` for `PreToolUse`, `Edit|Write|MultiEdit` for
   `PostToolUse`) are regexes — read both hook scripts
   (`check_docstrings.py`, `check_src_change.py`) to confirm they
   wouldn't misfire even in the worst case. Both independently no-op
   safely for a `TodoWrite` call regardless of whether the matcher fires:
   `check_docstrings.py` does an exact `tool_name not in ("Write",
   "Edit", "MultiEdit")` check (line 81) and exits 0 for the literal
   string `"TodoWrite"`; `check_src_change.py` exits 0 whenever
   `tool_input` has no `file_path` key (line 20-22), which `TodoWrite`'s
   input never has. Confirmed by reading the source, not by assumption.
3. **Live test, two real delegations via the `Agent` tool** (disposable
   scratch files at the repo root, deleted afterward, never touching
   `src/`):
   - Task 1: three small pure functions (`flatten`, `unique_in_order`,
     `chunk`) plus inline self-tests in one file. Completed correctly,
     verified by actually running the file (`All assertions passed.`).
     Did not use `TodoWrite` — a reasonable judgment call per the new
     guidance (3 changes in one file, right at the stated threshold).
   - Task 2: four separate files (three simple area functions plus a
     runner importing and checking all three) — deliberately multi-file
     to test the "spanning multiple files" trigger. Completed correctly,
     verified by running the runner (`All shape checks passed.`). Still
     did not use `TodoWrite` — judged the work as too mechanically simple
     to need a tracked plan despite the file count.
   - **Honest result**: both runs correctly exercised Understand → Plan →
     Act → Verify → Report with the new tools available and granted, and
     neither produced output suggesting the new tools caused any
     regression. But `TodoWrite` was not actually observed firing in
     either run — the two tasks given were judged not complex enough to
     warrant it. The capability is granted, structurally available, and
     was exercised with reasonable restraint (no overuse), but a positive
     "yes, it tracks a real multi-step plan with TodoWrite" demonstration
     is still open — left for a task with real sequential complexity
     (not just file count) to trigger it, rather than continuing to spend
     live-agent calls chasing a contrived positive result.
   - `WebFetch`/`WebSearch` usage was not exercised by either test task
     (neither needed an external lookup) — granted and config-verified,
     but not yet behaviorally tested; same honesty standard applies.

## Not yet done (deliberately)
- No second subagent yet (e.g. a reviewer or test-writer) — single example
  first, more added only if/when a step calls for multi-agent delegation
- Not yet wired into a hook or slash command that auto-invokes it — that's
  later steps (hooks, commands)
- Haven't yet run this subagent against a real task inside an actual
  Claude Code session (this build happened via the assistant's own file
  tools, not a live Claude Code CLI session) — worth doing once you're
  running this repo through the actual `claude` CLI, since that's the only
  way to confirm real delegation/routing behavior end-to-end
