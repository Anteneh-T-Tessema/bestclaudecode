# Claude Code: Skills, Agents, and MCP

A from-scratch, step-by-step build covering Claude Code's full feature surface:
CLAUDE.md, custom tools, subagents, skills, MCP servers, hooks, slash commands,
and how they compose into a real agentic system.

Stack: Python (backend/tool logic) + TypeScript (MCP servers).

## Build log

Each step has a doc in `docs/` covering what was built, why, the real
decisions made, what was actually verified (not just "it compiled"), and
what was deliberately left undone:

1. [Project setup](docs/01-project-setup.md)
2. [CLAUDE.md](docs/02-claude-md.md)
3. [Subagents](docs/03-subagents.md) — `coding-agent`, mutation-capable
4. [Skills](docs/04-skills.md)
5. [MCP servers](docs/05-mcp-servers.md) — `build-log-server`
6. [Hooks](docs/06-hooks.md) — `PreToolUse`/`PostToolUse`/`Stop`
7. [Slash commands](docs/07-slash-commands.md) — `/validate`, `/build-status`
8. [Full integration](docs/08-full-integration.md) — how 1–7 compose
9. [Code reviewer subagent](docs/09-code-reviewer-agent.md) — `code-reviewer`,
   read-only by construction, plus `/review`
10. [SDLC document pipeline](docs/10-sdlc-pipeline.md) — `prd-writer`,
    `ai-requirements-writer`, `srs-writer`, `sdd-writer`, plus
    `/blueprint` and `/blueprint-build`

## How to use this

One-time setup:

```bash
cd mcp-servers/build-log-server && npm install && npm run build
```

Check the Python side:

```bash
.venv/bin/pytest src/tests/ -q
.venv/bin/ruff check src
```

Open this repo in Claude Code (`build-log-server` is already registered
in `.mcp.json`) and try:

- `/validate` — delegates to `coding-agent` to lint, test, and fix failures
- `/build-status` — asks `build-log-server`'s MCP tools what's done and what's next
- `/review [path or ref-range]` — delegates to `code-reviewer` for a
  read-only critique; it cannot edit anything, by construction
- `/blueprint <idea>` — generates a PRD, (if applicable) an AI
  requirements doc, an SRS, and an SDD for a new project idea under
  `specs/<slug>/`, pausing for confirmation after the PRD
- `/blueprint-build <slug> [target dir]` — hands a `/blueprint`-generated
  spec to `coding-agent` for implementation, then points at `/review`
- Editing anything under `src/` — the hooks fire automatically (missing
  docstring blocks the write; a successful edit reruns the test suite)

MCP server connections and the subagent registry are both fixed at
session start, so anything added to `.claude/agents/`, `.mcp.json`, or
the MCP server's tools won't be live until you restart the CLI in this
directory.

## Status

- [x] Step 1: Project setup
- [x] Step 2: CLAUDE.md
- [x] Step 3: Subagents
- [x] Step 4: Skills
- [x] Step 5: MCP servers
- [x] Step 6: Hooks
- [x] Step 7: Slash commands
- [x] Step 8: Full integration
- [x] Step 9: Code reviewer subagent
- [x] Step 10: SDLC document pipeline
