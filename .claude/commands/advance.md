---
description: Capstone command — advances the build by one step, exercising the MCP server, a subagent, and the full hook chain in one flow.
argument-hint: [step-number to target instead of auto-detecting]
---
This command's whole point is to exercise every layer of this build in
one flow — don't shortcut any step yourself.

1. Call `list_build_steps` (the `build-log-server` MCP tool, Step 5) to
   find the first not-done step. If `$ARGUMENTS` is a step number, target
   that step instead.
2. Delegate implementing that step to the `coding-agent` subagent
   (Step 3) — don't write the implementation yourself. Any file it
   writes/edits under `src/` automatically goes through the
   `PreToolUse` docstring gate and the `PostToolUse` ruff/pytest gate
   (Step 6) without you doing anything extra.
3. Once the subagent reports back, summarize what changed and call
   `get_step_log` for the target step if a doc now exists for it.
4. If a doc exists for the step, call `mark_step_done` (Step 5, MCP) for
   it. It refuses on its own if no doc exists yet, so don't call it
   speculatively — only after confirming the doc is there in step 3.

When this turn ends, the `Stop` hook (Step 6) automatically checks that
README.md's status checklist and docs/ agree about which steps are
done — if you checked a box without writing the doc (or vice versa), it
will block and tell you what to fix. Nothing to do here for that, it
fires regardless of which command ran.
