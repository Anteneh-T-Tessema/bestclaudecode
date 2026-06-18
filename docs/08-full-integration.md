# Step 8: Full Integration

## What we built

- `.claude/hooks/check_build_log_consistency.py` — a new `Stop` hook,
  wired in `.claude/settings.json`, that blocks Claude from finishing a
  turn if README.md's status checklist and `docs/NN-*.md` disagree about
  which steps are done. Mirrors `build-log-server`'s
  `parseReadmeStatus`/`listDocFiles` parsing rules (Step 5) in Python,
  since a Stop hook can't call out to that TypeScript MCP server
  directly.
- `.claude/commands/advance.md` → `/advance [step-number]` — the
  capstone command. One flow that touches every layer:

  ```text
  User runs /advance
    -> slash command prompt fires                      (Step 7)
    -> Claude calls list_build_steps / get_step_log     (Step 5, MCP)
    -> Claude delegates the target step to coding-agent  (Step 3)
    -> coding-agent writes/edits files under src/
         -> PreToolUse hook gates the write              (Step 6)
         -> PostToolUse hook reacts (ruff + pytest)       (Step 6)
    -> Claude calls mark_step_done once a doc exists      (Step 5, MCP, new)
    -> Claude reports back and the turn ends
    -> Stop hook validates README/docs consistency        (Step 6, new)
  ```

  `mark_step_done` was added to `build-log-server` after this step was
  originally written (see `docs/05-mcp-servers.md`); `/advance`'s own
  instructions were updated to call it as step 4, closing a real gap —
  the command's stated purpose is to "advance the build by one step," but
  before this it never actually marked anything done.

## Why this flow, this command

Every other step built one artifact and verified it in isolation. The
point of Step 8 is specifically to prove those artifacts compose — that
an MCP tool call, a subagent delegation, and three different hook
lifecycles (`PreToolUse`, `PostToolUse`, `Stop`) can all fire within a
single user-facing action without manual wiring. `/advance` was chosen
over a throwaway demo command because it's also genuinely useful for
this exact repo: it's "continue the tutorial," which is the natural
action to want at any point in this build log's life.

## Real decisions made

- The `Stop` hook checks build-log consistency rather than re-running
  `ruff`/`pytest` (Step 6's `PostToolUse` hook already does that on every
  `src/` change — a `Stop`-time rerun would be redundant). It instead
  catches a different, real mistake class: checking a step's box without
  writing its doc, or vice versa — exactly the kind of error that's easy
  for an agent (or a human) to make and that this repo is built to catch
  in itself.
- `/advance`'s prompt explicitly tells Claude not to shortcut delegation
  ("don't write the implementation yourself") — same reasoning as
  `/validate` in Step 7: without that instruction the main agent could
  just do the work inline and never actually exercise the subagent.
- The `Stop` hook has no `matcher` field, unlike the tool-use hooks —
  there's no tool name to match against for a `Stop` event.

## Verification performed (not just "it compiled")

1. `check_build_log_consistency.py`: ran directly against the real repo
   (currently consistent) → exit 0. Then ran against a deliberately
   broken fixture in an isolated temp directory (one step checked with
   no doc, one step with a doc but unchecked) → exit 2, correctly named
   both directions of the mismatch. Never touched the real repo to
   produce the failing case.
2. Confirmed `/advance` hot-reloads mid-session the same way `/build-status`
   and `/validate` did in Step 7 — appeared as an invokable skill
   immediately after the file was written, no restart needed.
3. Cross-checked every name `/advance`'s prompt references against the
   real artifacts: `list_build_steps`/`get_step_log` against
   `mcp-servers/build-log-server/src/index.ts`'s actual `registerTool()`
   calls; `coding-agent` against `.claude/agents/coding-agent.md`.
4. **Did not** invoke `/advance` live end-to-end with its default
   (no-argument) behavior. Calling `list_build_steps` right now would
   correctly report Step 8 itself as the first not-done step, and
   delegating "implement the next step" to a subagent while this exact
   step is being implemented by the orchestrating session would be a
   genuinely confusing recursive scenario, not a clean test. Instead,
   every piece `/advance` chains together was already independently
   verified live earlier in this build:
   - `coding-agent` delegation: proven live in Step 7's `/validate` test
     (two real runs, including iterating on a real failure).
   - `PreToolUse`/`PostToolUse` gating: proven live in Step 6's `double()`
     test (real block, real fix, real pass).
   - The `Stop` hook: proven live in this step (#1 above).
   - The MCP tool call itself: the one piece that genuinely needs a fresh
     session — `.mcp.json` connections aren't picked up mid-session (the
     same limitation noted for `/build-status` in Step 7). Worth a real
     end-to-end `/advance` run after a restart to close this last gap.

## Not yet done (deliberately)

- No literal single live run of `/advance` end-to-end exists yet, for the
  reasons above — the next genuinely valuable verification step for this
  whole build is running `/advance` for real in a fresh `claude` CLI
  session once this work is committed.
- The `Stop` hook only checks README/docs consistency. It doesn't, for
  example, re-verify that every `.claude/commands/*.md` or
  `.claude/agents/*.md` file referenced in a doc still exists — scoped
  narrowly to the one inconsistency class this step's testing actually
  surfaced a need for.
