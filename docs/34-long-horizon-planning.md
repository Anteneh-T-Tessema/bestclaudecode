# Step 34 — Long-horizon planning (closes Devin planning gap)

## What was built

**`src/task_planner.py`** — task decomposition data structures and orchestration
layer for multi-step long-horizon implementation.

Devin executes multi-hour tasks by decomposing them into subtasks that each
fit within one bounded cycle. This module provides the same structure: a
`TaskPlan` with dependency-aware `Subtask` objects, JSON persistence, and
prompt formatting for each subtask.

Key API:
- `Subtask(id, description, depends_on, done)` — one bounded unit of work
- `TaskPlan(goal, subtasks, slug)`:
  - `.mark_done(id)` — mark a subtask complete
  - `.next_subtask()` — first subtask whose dependencies are all done and which is pending
  - `.is_complete()` / `.progress()` → `(done, total)`
- `save_plan(plan, plans_dir)` → path / `load_plan(path)` → plan — JSON roundtrip
- `format_plan_block(plan)` — Markdown overview with ✓/○ progress indicators
- `format_subtask_prompt(plan, subtask)` — full prompt block for one subtask
  (includes the full plan so the agent understands scope)
- `skeleton_plan(goal, n)` — n-subtask template for the planning agent

**`.claude/commands/plan-implement.md`** — slash command that orchestrates:
plan → for each subtask in dependency order: `/implement` → `mark_done` → loop.

**`src/tests/test_task_planner.py`** — 29 tests covering data model roundtrip,
dependency ordering, progress tracking, persistence, formatting, and skeleton
generation.

## Why

Without decomposition, every task the agent receives is bounded by one context
window. With a `TaskPlan`, large goals become a series of reviewable, auditable
subtasks — each with its own decision log entry. The plan JSON file also serves
as a resumable checkpoint: if a subtask fails the plan retains state.

## Test count after this step: 257
