---
description: Report build-log progress using the build-log-server MCP tools; pass a step number to see that step's full log.
argument-hint: [step-number]
---
Answer using the `build-log-server` MCP tools — do not read README.md or
docs/ directly, the point of this command is to exercise those tools.

1. Call `list_build_steps` and summarize which steps are done and which
   aren't.
2. If `$ARGUMENTS` is a step number, call `get_step_log` for that step and
   show its content.
3. If `$ARGUMENTS` is empty, call `get_step_log` for the first not-done
   step from step 1's result (if any exist) so the user sees what's next;
   if every step is done, say so instead.

Keep the report concise.
