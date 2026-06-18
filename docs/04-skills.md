# Step 4: Skills

## What we built
- `skills/test-writing/SKILL.md` — a skill defining exactly what "a
  corresponding test" means for `src/` code, per the requirement already
  stated (but left undefined) in `src/CLAUDE.md` since Step 2.
- A tiny real module, `src/build_log_utils.py` (`normalize_step_name`),
  created specifically to exercise the skill end-to-end rather than
  leaving it unverified.
- `src/tests/test_build_log_utils.py` — a test written by following the
  skill's own stated bar.

## Why skills vs. CLAUDE.md for this
CLAUDE.md loads every session regardless of relevance; skills load only
when the `description` field matches the task at hand. Test-writing
conventions are exactly the kind of procedural-but-occasional knowledge
skills are for — needed only when touching `src/`, not needed for, say,
writing a hook script or editing this doc.

The `description` field explicitly states both trigger conditions (writing
src/ code) and a negative case (tools/, .claude/*, skills/mcp-servers
config don't need this rigor) — mirroring how Anthropic's own bundled
skills (docx, pptx, etc.) state "do NOT use for X" to avoid over-triggering.

## Verification performed (this is the real point of this step)
1. Wrote `normalize_step_name()` in `src/build_log_utils.py` with a
   docstring (per src/CLAUDE.md).
2. Followed the skill's stated bar to write
   `src/tests/test_build_log_utils.py`: one test for primary behavior, one
   for the stated realistic edge case (empty-after-cleaning input raising
   `ValueError`), one for whitespace/case handling.
3. Ran `pytest src/tests/ -v` — all 3 passed.
4. **Mutation check**: deliberately broke the implementation (removed
   `.lower()`), reran tests — 2 of 3 failed correctly. Reverted, reran —
   all 3 passed again.

Step 4 of the skill's own checklist ("fails if wrong, passes if right") is
the actual standard for whether the skill is good, not just whether the
file is well-formed YAML. This is the same discipline `coding-agent`
(Step 3) is supposed to apply to its own work — eating our own dog food.

## Not yet done (deliberately)
- No second skill yet — single example first, more added when a step
  needs distinct procedural knowledge (e.g. a future "mcp-server-scaffolding"
  skill once Step 5 produces enough repeated pattern to be worth extracting)
- `pyproject.toml` still not created — pytest was installed ad hoc via pip
  for this verification; a real dependency file is deferred until enough
  real dependencies exist to justify one (per root CLAUDE.md's
  no-speculative-scaffolding rule), which is likely the very next thing
  needed once src/ has more than one module
- Haven't verified this skill auto-triggers inside a live Claude Code CLI
  session (same caveat as Step 3 — this was built/verified via the
  assistant's own file tools)
