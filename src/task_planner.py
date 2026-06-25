"""Long-horizon task planner — decompose large tasks into bounded subtasks.

Devin's key capability is executing multi-hour tasks without intervention.
The mechanism is task decomposition: a large goal is broken into subtasks that
each fit within one bounded implement cycle (plan → code → review → retry≤1).

This module provides the data structures and formatting layer for that
decomposition. The actual decomposition is done by a planning agent invoked by
the ``/plan-implement`` command; this module handles:

  - ``TaskPlan`` and ``Subtask`` data classes
  - Plan serialisation to/from JSON (``plan.json`` in the work directory)
  - Prompt block formatting for injecting the plan into agent prompts
  - Progress tracking (marking subtasks complete)
  - CLI for inspecting and manually managing plans

Plan lifecycle
--------------
1. User runs ``/plan-implement <goal>``.
2. A planning agent receives the goal + repo map and returns a structured plan
   (JSON matching the ``TaskPlan`` schema).
3. The orchestrator saves the plan to ``plans/<slug>.json``.
4. For each subtask, the orchestrator runs the normal ``/implement`` loop and
   calls ``mark_done(subtask_id)`` on success.
5. If any subtask fails after one retry, the orchestrator stops and reports the
   blocking subtask; the plan file retains full state for resumption.

Subtask schema
--------------
    {
      "id": "01",
      "description": "Add BM25Index class to src/bm25_index.py",
      "depends_on": [],          # ids of subtasks that must complete first
      "done": false
    }

CLI
---
    python -m src.task_planner --show <plan-file> [--json]
    python -m src.task_planner --done <plan-file> <subtask-id> [--json]
    python -m src.task_planner --new <goal> [--save]   (--save persists to plans/)
    python -m src.task_planner --list [dir] [--json]
"""
from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

_PLANS_DIR = Path("plans")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Subtask:
    """One bounded unit of work within a larger plan."""

    id: str
    description: str
    depends_on: list[str] = field(default_factory=list)
    done: bool = False
    role: str = ""

    def to_dict(self) -> dict:
        d: dict = {
            "id": self.id,
            "description": self.description,
            "depends_on": self.depends_on,
            "done": self.done,
        }
        if self.role:
            d["role"] = self.role
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Subtask":
        return cls(
            id=d["id"],
            description=d["description"],
            depends_on=d.get("depends_on", []),
            done=d.get("done", False),
            role=d.get("role", ""),
        )


@dataclass
class TaskPlan:
    """A decomposed goal with an ordered list of subtasks."""

    goal: str
    subtasks: list[Subtask]
    slug: str = ""

    def to_dict(self) -> dict:
        return {
            "goal": self.goal,
            "slug": self.slug,
            "subtasks": [s.to_dict() for s in self.subtasks],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TaskPlan":
        return cls(
            goal=d["goal"],
            subtasks=[Subtask.from_dict(s) for s in d.get("subtasks", [])],
            slug=d.get("slug", ""),
        )

    # ------------------------------------------------------------------
    # Progress helpers
    # ------------------------------------------------------------------

    def mark_done(self, subtask_id: str) -> bool:
        """Mark subtask id as done. Returns True if found, False otherwise."""
        for s in self.subtasks:
            if s.id == subtask_id:
                s.done = True
                return True
        return False

    def next_subtask(self) -> Subtask | None:
        """Return the first subtask whose dependencies are all done and which is not done."""
        done_ids = {s.id for s in self.subtasks if s.done}
        for s in self.subtasks:
            if not s.done and all(dep in done_ids for dep in s.depends_on):
                return s
        return None

    def is_complete(self) -> bool:
        """True when all subtasks are done."""
        return all(s.done for s in self.subtasks)

    def progress(self) -> tuple[int, int]:
        """Return (done_count, total_count)."""
        done = sum(1 for s in self.subtasks if s.done)
        return done, len(self.subtasks)


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

def save_plan(plan: TaskPlan, plans_dir: Path | None = None) -> Path:
    """Serialise plan to JSON and return the file path."""
    target = (plans_dir or _PLANS_DIR)
    target.mkdir(parents=True, exist_ok=True)
    slug = plan.slug or _slugify(plan.goal)
    plan.slug = slug
    path = target / f"{slug}.json"
    path.write_text(json.dumps(plan.to_dict(), indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def load_plan(path: Path) -> TaskPlan:
    """Deserialise a plan from a JSON file."""
    return TaskPlan.from_dict(json.loads(path.read_text(encoding="utf-8")))


def list_plans(plans_dir: Path | None = None) -> list[dict]:
    """Return a summary dict per plan file in plans_dir, skipping unreadable files.

    Each summary has: slug, goal, done, total, path. Used by the --list CLI
    mode and by the desktop app's Task Planner panel.
    """
    target = plans_dir or _PLANS_DIR
    if not target.exists():
        return []
    summaries: list[dict] = []
    for p in sorted(target.glob("*.json")):
        try:
            plan = load_plan(p)
        except (json.JSONDecodeError, KeyError):
            continue
        done, total = plan.progress()
        summaries.append({
            "slug": plan.slug,
            "goal": plan.goal,
            "done": done,
            "total": total,
            "path": str(p),
        })
    return summaries


# ---------------------------------------------------------------------------
# Prompt formatting
# ---------------------------------------------------------------------------

def format_plan_block(plan: TaskPlan) -> str:
    """Return a Markdown block describing the plan for context injection.

    Injected into the planning agent's prompt so it understands the full
    goal before receiving its specific subtask.
    """
    done, total = plan.progress()
    lines: list[str] = [
        f"## Task plan: {plan.goal}",
        f"Progress: {done}/{total} subtasks complete",
        "",
    ]
    for s in plan.subtasks:
        status = "✓" if s.done else "○"
        dep_str = f" (after: {', '.join(s.depends_on)})" if s.depends_on else ""
        lines.append(f"  {status} [{s.id}] {s.description}{dep_str}")
    lines.append("")
    return "\n".join(lines)


def format_subtask_prompt(plan: TaskPlan, subtask: Subtask) -> str:
    """Return the prompt block for one subtask within a plan.

    Includes the full plan context so the agent understands how its work
    fits into the larger goal.
    """
    plan_block = format_plan_block(plan)
    return (
        f"{plan_block}\n"
        f"## Current subtask [{subtask.id}]\n\n"
        f"{subtask.description}\n\n"
        f"Implement only this subtask. The plan context above shows what "
        f"other subtasks exist; do not implement them now.\n"
    )


def revise_remaining(plan: TaskPlan, revised_subtasks: list[dict]) -> None:
    """Replace the pending (undone) subtasks with a revised list.

    Called by the orchestrator after AI-driven replanning: the model returns a
    new subtask list to replace the failed subtask and any subsequent work.
    Done subtasks are preserved. The plan is mutated in place; callers must
    call ``save_plan`` to persist the change.

    **Why:** retry-once→block is too brittle for multi-hour runs. Replanning
    lets the agent recover from structural failures (wrong approach, missing
    dependency) without losing progress on completed subtasks.
    """
    new_pending = [Subtask.from_dict(s) for s in revised_subtasks]
    done = [s for s in plan.subtasks if s.done]
    plan.subtasks = done + new_pending


def skeleton_plan(goal: str, n: int = 3) -> TaskPlan:
    """Return a skeleton plan with n placeholder subtasks for a goal.

    Used by the CLI ``--new`` flag to give the planning agent a template
    to fill in rather than generating JSON from scratch.
    """
    subtasks = [
        Subtask(id=f"{i+1:02d}", description=f"Subtask {i+1} for: {goal}")
        for i in range(n)
    ]
    return TaskPlan(goal=goal, subtasks=subtasks, slug=_slugify(goal))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(text: str, max_len: int = 50) -> str:
    s = text.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    """CLI: python -m src.task_planner [--show <file>] [--done <file> <id>] [--new <goal>] [--list [dir]] [--json]"""
    args = sys.argv[1:]
    json_out = "--json" in args
    save_new = "--save" in args
    args = [a for a in args if a not in ("--json", "--save")]

    if "--show" in args:
        idx = args.index("--show")
        path = Path(args[idx + 1]) if idx + 1 < len(args) else None
        if not path or not path.exists():
            print("Error: plan file not found", file=sys.stderr)
            sys.exit(1)
        plan = load_plan(path)
        if json_out:
            print(json.dumps(plan.to_dict()))
            return
        print(format_plan_block(plan))
        nxt = plan.next_subtask()
        if nxt:
            print(f"Next: [{nxt.id}] {nxt.description}")
        return

    if "--done" in args:
        idx = args.index("--done")
        path = Path(args[idx + 1]) if idx + 1 < len(args) else None
        sid = args[idx + 2] if idx + 2 < len(args) else None
        if not path or not sid:
            print("Usage: --done <plan-file> <subtask-id>", file=sys.stderr)
            sys.exit(1)
        plan = load_plan(path)
        if plan.mark_done(sid):
            save_plan(plan, path.parent)
            done, total = plan.progress()
            if json_out:
                print(json.dumps({"id": sid, "done": done, "total": total}))
                return
            print(f"Marked [{sid}] done. Progress: {done}/{total}")
        else:
            print(f"Subtask [{sid}] not found", file=sys.stderr)
            sys.exit(1)
        return

    if "--new" in args:
        idx = args.index("--new")
        goal = " ".join(args[idx + 1:]) if idx + 1 < len(args) else ""
        if not goal:
            print("Usage: --new <goal>", file=sys.stderr)
            sys.exit(1)
        plan = skeleton_plan(goal)
        if save_new:
            save_plan(plan)
        print(json.dumps(plan.to_dict(), indent=2))
        return

    if "--revise" in args:
        idx = args.index("--revise")
        path = Path(args[idx + 1]) if idx + 1 < len(args) else None
        raw_json = args[idx + 2] if idx + 2 < len(args) else None
        if not path or not raw_json:
            print("Usage: --revise <plan-file> <json-array>", file=sys.stderr)
            sys.exit(1)
        plan = load_plan(path)
        revised = json.loads(raw_json)
        revise_remaining(plan, revised)
        save_plan(plan, path.parent)
        done, total = plan.progress()
        if json_out:
            print(json.dumps({"done": done, "total": total}))
            return
        print(f"Plan revised. Progress: {done}/{total}")
        return

    if "--list" in args:
        idx = args.index("--list")
        dir_arg = args[idx + 1] if idx + 1 < len(args) and not args[idx + 1].startswith("--") else None
        plans = list_plans(Path(dir_arg) if dir_arg else None)
        if json_out:
            print(json.dumps(plans))
            return
        if not plans:
            print("(no plans)")
            return
        for p in plans:
            print(f"  [{p['done']}/{p['total']}] {p['slug']}: {p['goal']}")
        return

    print("Usage: python -m src.task_planner [--show <file>] [--done <file> <id>] [--new <goal>] [--list [dir]] [--json]")


if __name__ == "__main__":
    main()
