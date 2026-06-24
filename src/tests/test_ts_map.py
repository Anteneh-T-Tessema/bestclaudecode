"""Tests for src/ts_map.py — TypeScript/JavaScript repo map."""
from pathlib import Path

from src.ts_map import _outline_ts_file, _iter_ts_files, build_ts_map, build_ts_import_graph, find_ts_callers


# ── find_ts_callers ────────────────────────────────────────────────────────────


def test_find_ts_callers_finds_direct_call(tmp_path):
    _write(tmp_path, "a.ts", "function greet(name: string) { return name }\n")
    _write(tmp_path, "b.ts", "import { greet } from './a'\nconst msg = greet('world')\n")
    results = find_ts_callers("greet", tmp_path)
    files = [r["file"] for r in results]
    assert str(tmp_path / "b.ts") in files


def test_find_ts_callers_finds_generic_call(tmp_path):
    _write(tmp_path, "a.ts", "export function createStore<T>() {}\n")
    _write(tmp_path, "b.ts", "const s = createStore<MyState>()\n")
    results = find_ts_callers("createStore", tmp_path)
    assert any(r["file"].endswith("b.ts") for r in results)


def test_find_ts_callers_returns_line_numbers(tmp_path):
    _write(tmp_path, "a.ts", "// line 1\nconst x = myFunc(42)\n// line 3\n")
    results = find_ts_callers("myFunc", tmp_path)
    assert results
    assert results[0]["line"] == 2


def test_find_ts_callers_returns_empty_when_no_match(tmp_path):
    _write(tmp_path, "a.ts", "export function foo() {}\n")
    results = find_ts_callers("bar", tmp_path)
    assert results == []


def test_find_ts_callers_skips_node_modules(tmp_path):
    nm = tmp_path / "node_modules" / "lib"
    nm.mkdir(parents=True)
    _write(nm.parent, "index.ts", "const x = myFunc()\n")
    _write(tmp_path, "src.ts", "// no call here\n")
    results = find_ts_callers("myFunc", tmp_path)
    assert all("node_modules" not in r["file"] for r in results)


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content)
    return p


def test_outline_exported_function(tmp_path):
    p = _write(tmp_path, "a.ts", "export function handleRequest(req: Request) {\n}\n")
    result = _outline_ts_file(p)
    assert "function handleRequest()" in result
    assert "line 1" in result


def test_outline_async_function(tmp_path):
    p = _write(tmp_path, "b.ts", "export async function fetchData() {\n}\n")
    result = _outline_ts_file(p)
    assert "function fetchData()" in result


def test_outline_exported_class(tmp_path):
    p = _write(tmp_path, "c.ts", "export class Router {\n  get() {}\n}\n")
    result = _outline_ts_file(p)
    assert "class Router()" in result


def test_outline_interface(tmp_path):
    p = _write(tmp_path, "d.ts", "export interface Config {\n  port: number;\n}\n")
    result = _outline_ts_file(p)
    assert "interface Config" in result


def test_outline_type_alias(tmp_path):
    p = _write(tmp_path, "e.ts", "export type Handler = (req: Request) => void;\n")
    result = _outline_ts_file(p)
    assert "type Handler" in result


def test_outline_const(tmp_path):
    p = _write(tmp_path, "f.ts", "export const DEFAULT_PORT = 3000;\n")
    result = _outline_ts_file(p)
    assert "const DEFAULT_PORT" in result


def test_outline_default_export(tmp_path):
    p = _write(tmp_path, "g.ts", "export default function() {\n  return 42;\n}\n")
    result = _outline_ts_file(p)
    assert "export default" in result


def test_outline_no_declarations(tmp_path):
    p = _write(tmp_path, "h.ts", "// just a comment\nconst x = 1;\n")
    result = _outline_ts_file(p)
    # const without export is still matched
    assert "const x" in result or "(no top-level declarations)" in result


def test_outline_non_exported_function(tmp_path):
    p = _write(tmp_path, "i.ts", "function helper(x: number) {\n  return x + 1;\n}\n")
    result = _outline_ts_file(p)
    assert "function helper()" in result


def test_iter_ts_files_finds_ts_and_js(tmp_path):
    _write(tmp_path, "a.ts", "")
    _write(tmp_path, "b.js", "")
    _write(tmp_path, "c.tsx", "")
    _write(tmp_path, "d.py", "")  # should be excluded
    files = _iter_ts_files(tmp_path)
    names = {f.name for f in files}
    assert {"a.ts", "b.js", "c.tsx"} == names


def test_iter_ts_files_skips_node_modules(tmp_path):
    nm = tmp_path / "node_modules"
    nm.mkdir()
    _write(nm, "index.ts", "export function a() {}")
    _write(tmp_path, "src.ts", "export function b() {}")
    files = _iter_ts_files(tmp_path)
    assert all("node_modules" not in str(f) for f in files)


def test_build_ts_map_no_ts_files(tmp_path):
    _write(tmp_path, "only.py", "def foo(): pass")
    result = build_ts_map(tmp_path)
    assert result.startswith("(no TypeScript/JavaScript files found)")


def test_build_ts_map_combines_multiple_files(tmp_path):
    _write(tmp_path, "a.ts", "export function alpha() {}\n")
    _write(tmp_path, "b.ts", "export class Beta {}\n")
    result = build_ts_map(tmp_path)
    assert "function alpha()" in result
    assert "class Beta()" in result


def test_format_context_include_ts(tmp_path):
    """include_ts=True merges TS map into the orientation block."""
    from src.context import format_context

    (tmp_path / "main.py").write_text("def run(): pass\n")
    (tmp_path / "server.ts").write_text("export function serve() {}\n")

    result = format_context(tmp_path, "add a route", include_ts=True)
    assert "serve()" in result
    assert "run()" in result


# ---------------------------------------------------------------------------
# build_ts_import_graph
# ---------------------------------------------------------------------------

def test_build_ts_import_graph_resolves_relative_import(tmp_path):
    _write(tmp_path, "b.ts", "export function foo() {}\n")
    _write(tmp_path, "a.ts", "import { foo } from './b'\n")

    graph = build_ts_import_graph(tmp_path)

    a_path = str(tmp_path / "a.ts")
    b_path = str(tmp_path / "b.ts")
    assert graph[a_path] == [b_path]
    assert graph[b_path] == []


def test_build_ts_import_graph_omits_bare_package_imports(tmp_path):
    _write(tmp_path, "a.ts", "import React from 'react'\nimport { useState } from 'react'\n")
    graph = build_ts_import_graph(tmp_path)
    assert graph[str(tmp_path / "a.ts")] == []


def test_build_ts_import_graph_resolves_directory_index(tmp_path):
    sub = tmp_path / "lib"
    sub.mkdir()
    _write(sub, "index.ts", "export function helper() {}\n")
    _write(tmp_path, "a.ts", "import { helper } from './lib'\n")

    graph = build_ts_import_graph(tmp_path)

    assert graph[str(tmp_path / "a.ts")] == [str(sub / "index.ts")]


def test_build_ts_import_graph_resolves_dynamic_import_and_require(tmp_path):
    _write(tmp_path, "b.ts", "export function foo() {}\n")
    _write(tmp_path, "c.ts", "export function bar() {}\n")
    _write(
        tmp_path,
        "a.ts",
        "const x = require('./b')\nasync function load() { return import('./c') }\n",
    )

    graph = build_ts_import_graph(tmp_path)

    a_path = str(tmp_path / "a.ts")
    assert sorted(graph[a_path]) == sorted([str(tmp_path / "b.ts"), str(tmp_path / "c.ts")])


def test_build_ts_import_graph_can_be_inverted_to_find_dependents(tmp_path):
    _write(tmp_path, "b.ts", "export function foo() {}\n")
    _write(tmp_path, "a.ts", "import { foo } from './b'\n")
    _write(tmp_path, "c.ts", "import { foo } from './b'\n")

    graph = build_ts_import_graph(tmp_path)
    b_path = str(tmp_path / "b.ts")

    dependents = [f for f, deps in graph.items() if b_path in deps]
    assert sorted(dependents) == sorted([str(tmp_path / "a.ts"), str(tmp_path / "c.ts")])
