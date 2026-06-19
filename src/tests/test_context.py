from src.context import format_context


def test_format_context_contains_orientation_header(tmp_path):
    (tmp_path / "a.py").write_text("def foo():\n    pass\n")

    result = format_context(tmp_path, "do the thing")

    assert "## Repo orientation" in result
    assert "## Task" in result
    assert "do the thing" in result


def test_format_context_includes_repo_map_symbols(tmp_path):
    (tmp_path / "a.py").write_text("def my_func():\n    pass\n")

    result = format_context(tmp_path, "fix it")

    assert "def my_func()" in result


def test_format_context_task_appears_after_separator(tmp_path):
    (tmp_path / "a.py").write_text("def foo():\n    pass\n")

    result = format_context(tmp_path, "unique-task-marker")

    orientation_pos = result.index("## Repo orientation")
    task_pos = result.index("unique-task-marker")
    assert task_pos > orientation_pos


def test_format_context_truncates_at_max_map_lines(tmp_path):
    # Create enough symbols to exceed a small cap.
    body = "\n".join(f"def fn_{i}():\n    pass" for i in range(20))
    (tmp_path / "big.py").write_text(body)

    result = format_context(tmp_path, "task", max_map_lines=5)

    assert "truncated" in result


def test_format_context_no_truncation_when_map_fits(tmp_path):
    (tmp_path / "a.py").write_text("def foo():\n    pass\n")

    result = format_context(tmp_path, "task", max_map_lines=200)

    assert "truncated" not in result


def test_format_context_include_deps_adds_imports_line(tmp_path):
    (tmp_path / "b.py").write_text("def helper():\n    pass\n")
    (tmp_path / "a.py").write_text("from b import helper\n")

    result = format_context(tmp_path, "task", include_deps=True)

    assert "imports:" in result


def test_format_context_wraps_map_in_code_fence(tmp_path):
    (tmp_path / "a.py").write_text("def foo():\n    pass\n")

    result = format_context(tmp_path, "task")

    assert "```\n" in result


def test_format_context_empty_repo_still_returns_valid_prompt(tmp_path):
    result = format_context(tmp_path, "my task")

    assert "## Task" in result
    assert "my task" in result
