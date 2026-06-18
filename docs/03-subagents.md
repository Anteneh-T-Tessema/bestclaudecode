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
