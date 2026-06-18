# Step 6: Hooks

## What we built

- `.claude/hooks/check_docstrings.py` — `PreToolUse` hook (matcher
  `Write|Edit|MultiEdit`) that blocks a tool call which would leave a
  top-level function/class under `src/*.py` without a docstring.
- `.claude/hooks/check_src_change.py` — `PostToolUse` hook (matcher
  `Edit|Write|MultiEdit`) that runs `ruff check src` and
  `pytest src/tests/` after any `src/*.py` change, failing the tool call
  if either breaks.
- Both wired into `.claude/settings.json`.

## Why these hooks

`src/CLAUDE.md` has stated since Step 2 that public functions/classes
need docstrings, and the test-writing skill has stated the
verify-before-done discipline — but neither was actually enforced
deterministically. An agent (or a human) can forget to apply a stated
rule; a hook can't.

## Real decisions made

- Split enforcement across `PreToolUse` (block before the bad state ever
  lands on disk) and `PostToolUse` (verify after, since ruff/pytest need
  real files to run against, not a tool-call payload).
- `check_docstrings.py` only inspects the Edit's `new_string` snippet, not
  the full reconstructed file — for `Write` the full content is already
  available, but `Edit` only gives Claude Code the changed snippet. This
  catches the common case (adding a new undocumented def) without needing
  to read the pre-edit file from inside the hook.
- Private/dunder names (leading `_`) and anything under `src/tests/` are
  exempt, matching the test-writing skill's existing scope decisions.
- Both hooks fail open on their own errors (malformed JSON, unparseable
  snippet) — they only ever block on a *confirmed* violation, never on
  their own inability to check.

## Verification performed (not just "it compiled")

1. Found and fixed a real bug in `check_docstrings.py` before it ever ran:
   it used `str | None` (PEP 604 union syntax), which raises
   `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`
   at import time on this project's pinned `>=3.9` / actual 3.9.6
   interpreter — PEP 604 only evaluates at runtime on 3.10+. Fixed with
   `from __future__ import annotations`. Reproduced the crash with
   `echo '{}' | python3 check_docstrings.py` before the fix, confirmed
   clean exit after.
2. Live-tested the wired `PreToolUse` hook through Claude Code itself
   (not just by piping JSON to the script by hand): edited
   `src/build_log_utils.py`'s pre-existing undocumented `double(n)` to add
   a type hint only — the hook fired and blocked the edit with the exact
   expected message. Then added a docstring in a second edit — allowed.
3. Confirmed the `PostToolUse` gate ran clean after: `ruff check src` →
   "All checks passed!"; `pytest src/tests/` → 4 passed (added
   `test_double_returns_twice_the_input` per `double()`'s own
   docstring-and-test requirement).
4. Closed a gap found on review: the `PreToolUse` matcher originally
   omitted `MultiEdit` (unlike `PostToolUse`'s `Edit|Write|MultiEdit`).
   Fixing the matcher alone wasn't sufficient — `get_post_edit_content`
   only handled `Write`/`Edit` shapes and `main`'s own `tool_name` gate
   independently filtered to the same two, so a `MultiEdit` payload would
   have silently passed through *even with* the matcher fixed, returning
   `None`/falsy content and exiting 0 before ever reaching the docstring
   check. Both call sites needed the fix. Caught by actually running
   constructed `MultiEdit` JSON fixtures through the script rather than
   assuming the matcher change was enough — confirmed exit 2 with one
   undocumented def in a batch, exit 0 when all are documented.

## Not yet done (deliberately)

- `check_docstrings.py` can't detect an `Edit` that *removes* an existing
  docstring, since it only inspects `new_string`, not a real diff against
  the pre-edit file.
- No hook yet enforces the slash-command or subagent conventions from
  Steps 3–4 — scoped to `src/*.py` only, per this step's stated focus.
