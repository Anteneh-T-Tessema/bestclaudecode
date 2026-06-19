from src.repo_map import build_repo_map, main


def test_lists_top_level_function_and_class_with_method(tmp_path):
    (tmp_path / "sample.py").write_text(
        "def foo():\n    pass\n\n\nclass Bar:\n    def baz(self):\n        pass\n"
    )

    output = build_repo_map(tmp_path)

    assert "def foo() -- line 1" in output
    assert "class Bar: -- line 5" in output
    assert "def baz() -- line 6" in output


def test_skips_unparseable_file_instead_of_raising(tmp_path):
    (tmp_path / "broken.py").write_text("def foo(:\n    pass\n")

    output = build_repo_map(tmp_path)

    assert "SKIPPED" in output
    assert "syntax error" in output


def test_skips_dependency_and_hidden_directories(tmp_path):
    (tmp_path / "real.py").write_text("def kept():\n    pass\n")
    venv_dir = tmp_path / ".venv"
    venv_dir.mkdir()
    (venv_dir / "ignored.py").write_text("def ignored():\n    pass\n")

    output = build_repo_map(tmp_path)

    assert "kept" in output
    assert "ignored" not in output


def test_no_python_files_returns_placeholder(tmp_path):
    assert build_repo_map(tmp_path) == "(no Python files found)"


def test_accepts_a_single_file_path(tmp_path):
    file_path = tmp_path / "solo.py"
    file_path.write_text("def solo_func():\n    pass\n")

    output = build_repo_map(file_path)

    assert "def solo_func() -- line 1" in output


def test_include_methods_false_omits_methods_but_keeps_classes_and_functions(
    tmp_path,
):
    (tmp_path / "sample.py").write_text(
        "def foo():\n    pass\n\n\nclass Bar:\n    def baz(self):\n        pass\n"
    )

    output = build_repo_map(tmp_path, include_methods=False)

    assert "def foo() -- line 1" in output
    assert "class Bar: -- line 5" in output
    assert "def baz()" not in output


def test_include_methods_true_is_the_default(tmp_path):
    (tmp_path / "sample.py").write_text(
        "class Bar:\n    def baz(self):\n        pass\n"
    )

    assert build_repo_map(tmp_path) == build_repo_map(tmp_path, include_methods=True)


def test_main_no_methods_flag_omits_methods_from_printed_output(tmp_path, capsys):
    (tmp_path / "sample.py").write_text(
        "class Bar:\n    def baz(self):\n        pass\n"
    )

    main(["--no-methods", str(tmp_path)])

    output = capsys.readouterr().out
    assert "class Bar:" in output
    assert "def baz()" not in output


def test_main_no_methods_flag_works_after_path_argument(tmp_path, capsys):
    (tmp_path / "sample.py").write_text(
        "class Bar:\n    def baz(self):\n        pass\n"
    )

    main([str(tmp_path), "--no-methods"])

    output = capsys.readouterr().out
    assert "class Bar:" in output
    assert "def baz()" not in output


def test_main_without_no_methods_flag_still_includes_methods(tmp_path, capsys):
    (tmp_path / "sample.py").write_text(
        "class Bar:\n    def baz(self):\n        pass\n"
    )

    main([str(tmp_path)])

    output = capsys.readouterr().out
    assert "def baz()" in output


def test_deps_shows_local_import(tmp_path):
    (tmp_path / "b.py").write_text("def foo():\n    pass\n")
    (tmp_path / "a.py").write_text("from b import foo\n")

    output = build_repo_map(tmp_path, show_deps=True)

    # a.py imports b.py — the full path must appear on the imports line
    assert "imports:" in output
    assert str(tmp_path / "b.py") in output


def test_deps_omits_stdlib_and_third_party_imports(tmp_path):
    (tmp_path / "a.py").write_text("import os\nimport sys\n")

    output = build_repo_map(tmp_path, show_deps=True)

    assert "imports: (none)" in output
    assert "os" not in output
    assert "sys" not in output


def test_deps_off_by_default(tmp_path):
    (tmp_path / "b.py").write_text("def foo():\n    pass\n")
    (tmp_path / "a.py").write_text("from b import foo\n")

    output = build_repo_map(tmp_path)

    assert "imports:" not in output


def test_deps_no_local_imports_shows_none(tmp_path):
    (tmp_path / "a.py").write_text("def standalone():\n    pass\n")

    output = build_repo_map(tmp_path, show_deps=True)

    assert "imports: (none)" in output


def test_deps_detects_relative_import_without_module_qualifier(tmp_path):
    pkg = tmp_path / "pkg"
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    (pkg / "utils.py").write_text("def helper():\n    pass\n")
    (pkg / "main.py").write_text("from . import utils\n")

    output = build_repo_map(tmp_path, show_deps=True)

    # pkg/main.py's imports line should reference pkg/utils.py
    assert str(pkg / "utils.py") in output


def test_deps_main_flag_adds_imports_line(tmp_path, capsys):
    (tmp_path / "b.py").write_text("def foo():\n    pass\n")
    (tmp_path / "a.py").write_text("from b import foo\n")

    main(["--deps", str(tmp_path)])

    output = capsys.readouterr().out
    assert "imports:" in output
