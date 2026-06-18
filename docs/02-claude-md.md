# Step 2: CLAUDE.md

## What we built
- `CLAUDE.md` at project root — project-wide context: what the project is,
  stack, directory structure, conventions (commit format, build-log
  practice, naming, no-speculative-scaffolding rule), and a working
  agreement for how steps proceed.
- `src/CLAUDE.md` — a nested CLAUDE.md scoped to `src/` only, demonstrating
  hierarchical CLAUDE.md behavior.

## Why a nested CLAUDE.md in src/
Claude Code reads CLAUDE.md files hierarchically: the root file plus any
CLAUDE.md in the current working directory (and intermediate directories)
are all loaded together, with nested files adding/overriding
directory-specific context on top of root. This matters in real projects
where, e.g., a `frontend/` and `backend/` directory have different lint
rules, test requirements, or conventions that don't belong in the
project-wide file.

We used it here to add a stricter rule (tests required) that only applies
to `src/`, not to the rest of the repo (e.g. `.claude/agents/` definitions
or early `tools/` scripts, which are config/scaffolding, not "real code").

## Key conventions now locked in by CLAUDE.md itself
- One commit per step, message format `Step N: <name>`
- Build log written before each commit
- No speculative scaffolding — structure reflects what's built, not planned
- src/ requires tests + docstrings once it has real code; rest of repo does not yet

## Not yet done (deliberately)
- No CLAUDE.md yet in `.claude/agents/`, `mcp-servers/`, or `skills/` —
  those will get their own nested files only once there's enough
  subsystem-specific convention to justify it (per the root file's own rule)
- No actual src/ code yet, so the "tests required" rule isn't exercised yet
