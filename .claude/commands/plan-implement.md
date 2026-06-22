---
description: Decompose a large goal into subtasks, then run the bounded implement-review loop on each one in dependency order. Closes the long-horizon planning gap with Devin.
argument-hint: <goal description>
---
This command demonstrates **long-horizon planning** — the same decompose-then-execute
loop Devin uses to tackle multi-hour tasks without losing coherence.

## Flow

1. If `$ARGUMENTS` is empty, ask the user to describe the goal.

2. Build the repo map (same as `/context-implement`, no `--cached`):
   ```
   python -m src.repo_map
   ```
   Cap at 200 lines.

3. Delegate to a **planning agent** (use `coding-agent` in planning mode):
   - Prompt: repo orientation block + the goal + this instruction:
     "Return a JSON `TaskPlan` matching this schema:
     ```json
     {
       \"goal\": \"<goal>\",
       \"slug\": \"<filesystem-safe-slug>\",
       \"subtasks\": [
         {\"id\": \"01\", \"description\": \"...\", \"depends_on\": [], \"done\": false}
       ]
     }
     ```
     Each subtask must fit within one bounded implement cycle (plan + code + review ≤1 retry).
     List dependencies by id. Return only the JSON, no prose."

4. Save the plan:
   ```
   python -m src.task_planner --new "<goal>"
   ```
   Then write the agent's JSON into `plans/<slug>.json`.

5. For each subtask in dependency order (use `python -m src.task_planner --show plans/<slug>.json`
   to find the next ready subtask):

   a. Build the subtask prompt:
      ```
      python -m src.task_planner --show plans/<slug>.json
      ```
      Inject the full plan block + `## Current subtask [id]\n<description>`.

   b. Delegate to `coding-agent` with that prompt. It implements, runs
      lint + tests, and reports back.

   c. Delegate the diff to `code-reviewer`. If zero Blocking findings:
      - Mark done: `python -m src.task_planner --done plans/<slug>.json <id>`
      - Write audit log: `python -m src.decision_log --log --task "<subtask description>" --verdict "LGTM" --retries 0 --outcome "<summary>" --agent "coding-agent"`

   d. If Blocking findings: give `coding-agent` the findings exactly once.
      Re-run `code-reviewer`. Write audit log with `--retries 1`.
      - If still Blocking: stop, report failure, leave subtask unmarked. Do not continue to the next subtask.
      - If clean: mark done and continue.

6. After all subtasks are done, report: goal achieved, N subtasks completed,
   link to `plans/<slug>.json` for the full record.

## Why this differs from /implement

`/implement` handles one task. `/plan-implement` handles a goal that is too
large for one task by decomposing it and running the implement-review loop N
times, with full dependency tracking and per-subtask audit log entries.

The plan JSON file is a resumable checkpoint: if a subtask fails the plan
retains state and the user can restart from the last successful subtask.
