---
name: test-writing
description: Skill for writing tests. Use when the user asks to write tests for a piece of code, a function, or a feature. Focus on writing clear, concise, and effective tests that cover the relevant cases. Follow the project's testing conventions and use the appropriate testing framework.
---

Use this skill whenever writing, adding, or updating Python code under src/ in this repo, since src/CLAUDE.md requires a corresponding test before that code is considered done. Covers test framework choice, file naming/location, what counts as a sufficient test, and how to run them. Do NOT use for tools/ scripts, .claude/agents or .claude/hooks definitions, or skills/mcp-servers config — those are scaffolding/config and are not held to src/'s test requirement per root CLAUDE.md.

# Test Writing (src/)

This skill exists because src/CLAUDE.md requires "at least one corresponding test before being considered done" for every module in src/. This file defines what that actually means in practice.

## Framework

Use pytest. No other test framework in this repo. If pytest isn't yet a declared dependency, add it via a pyproject.toml at the relevant level (per root CLAUDE.md: don't create dependency files speculatively — add this one the first time a real test is written, not before).

## File layout

Tests live in src/tests/, mirroring the module path of what they test.

- src/foo.py → src/tests/test_foo.py
- src/bar/baz.py → src/tests/bar/test_baz.py

One test file per module minimum. Don't bundle unrelated modules' tests into one file just to save a file.

Test function names describe behavior, not implementation: `test_returns_empty_list_when_input_is_none`, not `test_case_1`.

## What counts as "a corresponding test" (the src/CLAUDE.md bar)

The minimum bar is: the test fails if the code is wrong, and passes if it's right — not a test that merely imports the module or asserts `True == True`. Concretely, for any public function/class added to src/:

- At least one test exercising its primary, intended behavior with real (not trivially empty) input.
- At least one test for the most likely failure/edge case — empty input, None, a boundary value, or an expected exception — if such a case plausibly exists for that function. Not every function has one; don't manufacture a fake edge case just to pad coverage.
- If the function/class has side effects (file I/O, network, state mutation), the test verifies the effect actually happened, not just that the call didn't raise.

A docstring example is not a substitute for a test. A test that asserts nothing meaningful (e.g. only `assert result is not None`) does not satisfy the requirement.

## What does NOT need this level of rigor

Per root CLAUDE.md, this bar is specific to src/. Do not apply it to:

- tools/ scripts (early-stage, lower ceremony)
- .claude/agents/, .claude/hooks/, .claude/commands/ definitions (config artifacts — validated by structural checks, not pytest)
- skills/*/SKILL.md files (same — config, not code)

## Running tests

```bash
# from repo root
pytest src/tests/ -v
```

Run this before considering any src/ change complete. A change is not "done" on the basis of the code looking correct — it's done when this command passes against a real test for the new/changed behavior.

## Anti-patterns to avoid

- Writing the test after being told it failed review, rather than as part of the same change.
- Testing private/internal helpers directly when testing the public function that uses them would cover the same ground more durably.
- One giant test function covering five behaviors — split per behavior so failures are diagnosable from the test name alone.
