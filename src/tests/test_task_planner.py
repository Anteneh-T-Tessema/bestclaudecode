"""Tests for src/task_planner.py."""
import json

from src.task_planner import (
    Subtask,
    TaskPlan,
    format_plan_block,
    format_subtask_prompt,
    list_plans,
    load_plan,
    revise_remaining,
    save_plan,
    skeleton_plan,
    _slugify,
)


# --- _slugify ---------------------------------------------------------------

def test_slugify_basic():
    assert _slugify("Add BM25 search") == "add-bm25-search"


def test_slugify_max_len():
    assert len(_slugify("x" * 100, max_len=10)) <= 10


def test_slugify_special_chars():
    assert _slugify("fix auth/login bug") == "fix-auth-login-bug"


# --- Subtask ----------------------------------------------------------------

def test_subtask_roundtrip():
    s = Subtask(id="01", description="Do thing", depends_on=["00"], done=False)
    s2 = Subtask.from_dict(s.to_dict())
    assert s2.id == s.id
    assert s2.description == s.description
    assert s2.depends_on == s.depends_on
    assert s2.done == s.done


def test_subtask_defaults():
    s = Subtask.from_dict({"id": "01", "description": "task"})
    assert s.depends_on == []
    assert s.done is False


# --- TaskPlan ---------------------------------------------------------------

def _plan(*descs: str) -> TaskPlan:
    subs = [Subtask(id=f"{i+1:02d}", description=d) for i, d in enumerate(descs)]
    return TaskPlan(goal="Test goal", subtasks=subs)


def test_taskplan_roundtrip():
    plan = _plan("step one", "step two")
    plan2 = TaskPlan.from_dict(plan.to_dict())
    assert plan2.goal == plan.goal
    assert len(plan2.subtasks) == 2


def test_mark_done_found():
    plan = _plan("a", "b")
    assert plan.mark_done("01")
    assert plan.subtasks[0].done


def test_mark_done_not_found():
    plan = _plan("a")
    assert not plan.mark_done("99")


def test_is_complete_false():
    assert not _plan("a", "b").is_complete()


def test_is_complete_true():
    plan = _plan("a", "b")
    plan.subtasks[0].done = True
    plan.subtasks[1].done = True
    assert plan.is_complete()


def test_progress_counts():
    plan = _plan("a", "b", "c")
    plan.subtasks[0].done = True
    assert plan.progress() == (1, 3)


def test_next_subtask_no_deps():
    plan = _plan("a", "b")
    nxt = plan.next_subtask()
    assert nxt is not None
    assert nxt.id == "01"


def test_next_subtask_respects_deps():
    s1 = Subtask(id="01", description="first", done=False)
    s2 = Subtask(id="02", description="second", depends_on=["01"], done=False)
    plan = TaskPlan(goal="g", subtasks=[s1, s2])
    # s2 depends on s1 which is not done; next should be s1
    assert plan.next_subtask().id == "01"
    plan.mark_done("01")
    assert plan.next_subtask().id == "02"


def test_next_subtask_all_done():
    plan = _plan("a")
    plan.subtasks[0].done = True
    assert plan.next_subtask() is None


# --- format_plan_block ------------------------------------------------------

def test_format_plan_block_header():
    plan = _plan("Do BM25")
    block = format_plan_block(plan)
    assert "## Task plan: Test goal" in block


def test_format_plan_block_progress():
    plan = _plan("a", "b")
    plan.subtasks[0].done = True
    block = format_plan_block(plan)
    assert "1/2" in block


def test_format_plan_block_checkmark_done():
    plan = _plan("a")
    plan.subtasks[0].done = True
    block = format_plan_block(plan)
    assert "✓" in block


def test_format_plan_block_circle_pending():
    plan = _plan("a")
    block = format_plan_block(plan)
    assert "○" in block


def test_format_plan_block_deps_shown():
    s1 = Subtask(id="01", description="base")
    s2 = Subtask(id="02", description="build", depends_on=["01"])
    plan = TaskPlan(goal="g", subtasks=[s1, s2])
    block = format_plan_block(plan)
    assert "after: 01" in block


# --- format_subtask_prompt --------------------------------------------------

def test_format_subtask_prompt_contains_plan():
    plan = _plan("a", "b")
    block = format_subtask_prompt(plan, plan.subtasks[0])
    assert "Test goal" in block
    assert "## Current subtask" in block


def test_format_subtask_prompt_contains_desc():
    plan = _plan("implement cache", "write tests")
    block = format_subtask_prompt(plan, plan.subtasks[0])
    assert "implement cache" in block


# --- persistence ------------------------------------------------------------

def test_save_and_load(tmp_path):
    plan = _plan("step one", "step two")
    path = save_plan(plan, tmp_path)
    assert path.exists()
    plan2 = load_plan(path)
    assert plan2.goal == plan.goal
    assert len(plan2.subtasks) == 2


def test_save_creates_dir(tmp_path):
    plan = _plan("x")
    save_plan(plan, tmp_path / "deep" / "plans")
    assert (tmp_path / "deep" / "plans").exists()


def test_save_sets_slug(tmp_path):
    plan = TaskPlan(goal="Add BM25 search", subtasks=[])
    save_plan(plan, tmp_path)
    assert plan.slug == "add-bm25-search"


def test_save_uses_existing_slug(tmp_path):
    plan = TaskPlan(goal="Something", subtasks=[], slug="custom-slug")
    path = save_plan(plan, tmp_path)
    assert path.name == "custom-slug.json"


def test_load_roundtrip_json(tmp_path):
    plan = _plan("a", "b")
    path = save_plan(plan, tmp_path)
    raw = json.loads(path.read_text())
    assert "goal" in raw and "subtasks" in raw


# --- skeleton_plan ----------------------------------------------------------

def test_skeleton_plan_count():
    plan = skeleton_plan("Add BM25", n=4)
    assert len(plan.subtasks) == 4


def test_skeleton_plan_slug():
    plan = skeleton_plan("Fix auth bug")
    assert plan.slug == "fix-auth-bug"


def test_skeleton_plan_ids_sequential():
    plan = skeleton_plan("x", n=3)
    assert [s.id for s in plan.subtasks] == ["01", "02", "03"]


# --- revise_remaining -------------------------------------------------------

def test_revise_remaining_replaces_pending():
    plan = _plan("a", "b", "c")
    plan.subtasks[0].done = True
    revise_remaining(plan, [
        {"id": "02", "description": "revised b", "depends_on": [], "done": False},
        {"id": "03", "description": "revised c", "depends_on": ["02"], "done": False},
    ])
    assert len(plan.subtasks) == 3
    assert plan.subtasks[0].done  # preserved
    assert plan.subtasks[1].description == "revised b"
    assert plan.subtasks[2].description == "revised c"


def test_revise_remaining_preserves_all_done():
    plan = _plan("a", "b")
    plan.subtasks[0].done = True
    plan.subtasks[1].done = True
    revise_remaining(plan, [])
    assert len(plan.subtasks) == 2
    assert all(s.done for s in plan.subtasks)


def test_revise_remaining_can_add_subtasks():
    plan = _plan("only one")
    revise_remaining(plan, [
        {"id": "01", "description": "split part 1", "depends_on": [], "done": False},
        {"id": "02", "description": "split part 2", "depends_on": ["01"], "done": False},
    ])
    assert len(plan.subtasks) == 2
    assert plan.subtasks[0].id == "01"
    assert plan.subtasks[1].depends_on == ["01"]


def test_revise_remaining_empty_pending():
    plan = _plan("a")
    revise_remaining(plan, [])
    assert plan.subtasks == []


# --- list_plans ---------------------------------------------------------------

def test_list_plans_empty_dir(tmp_path):
    assert list_plans(tmp_path) == []


def test_list_plans_missing_dir(tmp_path):
    assert list_plans(tmp_path / "does-not-exist") == []


def test_list_plans_returns_summary(tmp_path):
    plan = _plan("step one", "step two")
    plan.mark_done(plan.subtasks[0].id)
    save_plan(plan, tmp_path)
    summaries = list_plans(tmp_path)
    assert len(summaries) == 1
    assert summaries[0]["goal"] == plan.goal
    assert summaries[0]["done"] == 1
    assert summaries[0]["total"] == 2


def test_list_plans_skips_unreadable_json(tmp_path):
    (tmp_path / "broken.json").write_text("not json", encoding="utf-8")
    assert list_plans(tmp_path) == []


def test_list_plans_multiple_sorted_by_filename(tmp_path):
    save_plan(TaskPlan(goal="first", subtasks=[], slug="a-plan"), tmp_path)
    save_plan(TaskPlan(goal="second", subtasks=[], slug="b-plan"), tmp_path)
    summaries = list_plans(tmp_path)
    assert [s["slug"] for s in summaries] == ["a-plan", "b-plan"]
