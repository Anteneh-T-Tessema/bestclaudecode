"""Tests for src/ts_map.py — TypeScript/JavaScript repo map."""
from pathlib import Path

from src.ts_map import _outline_ts_file, _iter_ts_files, build_ts_map


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
