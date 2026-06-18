# Step 1: Project Setup

## What we built
- Root repo `claude-code-mastery/`
- `.claude/` — Claude Code's project config home
  - `agents/` — will hold subagent definitions (.md with YAML frontmatter)
  - `commands/` — will hold custom slash commands (.md files)
  - `hooks/` — will hold lifecycle hook scripts
  - `settings.json` — project-level config, currently minimal
- `skills/` — will hold SKILL.md packages
- `mcp-servers/` — will hold TypeScript MCP server implementations
- `tools/` — Python tool logic / shared utilities
- `src/` — core project code
- `docs/` — this build log
- `.gitignore` — Python + Node + Claude Code local-state ignores

## Why this structure
Claude Code looks for `.claude/` at the project root for agents, commands,
hooks, and settings — scaffolding it now avoids restructuring later. Skills
and MCP servers are top-level since they're substantial subsystems, not
just config blobs.

## Not yet done (deliberately)
- No CLAUDE.md yet (Step 2)
- `.claude/settings.json` has no permissions/hooks config yet — added
  incrementally as each feature needs it
- No package.json / pyproject.toml yet — added when we have actual code
  that needs dependencies
