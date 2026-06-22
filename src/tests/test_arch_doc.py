"""Tests for src/arch_doc.py."""
from pathlib import Path

from src.arch_doc import (
    ModuleInfo,
    analyze_module,
    analyze_package,
    format_arch_doc,
    generate_arch_doc,
    _first_line,
    _first_paragraph,
)


# --- helpers ----------------------------------------------------------------

def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


SIMPLE_MODULE = '''\
"""Module that does things.

Extended description paragraph.
"""
from src.bm25_index import BM25Index

def public_func():
    """Do the thing."""
    pass

def _private_func():
    pass

class MyClass:
    """A useful class."""

    def public_method(self):
        """Run the method."""
        pass

    def _private_method(self):
        pass
'''


# --- _first_line / _first_paragraph ----------------------------------------

def test_first_line_none():
    assert _first_line(None) == ""


def test_first_line_single():
    assert _first_line("Do the thing.") == "Do the thing."


def test_first_line_multiline():
    assert _first_line("First line.\nSecond line.") == "First line."


def test_first_paragraph_none():
    assert _first_paragraph(None) == ""


def test_first_paragraph_single():
    assert _first_paragraph("Summary.") == "Summary."


def test_first_paragraph_multi():
    result = _first_paragraph("Summary.\n\nDetail paragraph.")
    assert result == "Summary."


def test_first_paragraph_collapses_newlines():
    result = _first_paragraph("Line one.\nLine two.\n\nParagraph 2.")
    assert result == "Line one. Line two."


# --- analyze_module ---------------------------------------------------------

def test_analyze_module_summary(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    assert info is not None
    assert "Module that does things" in info.summary


def test_analyze_module_public_function(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    names = [f.name for f in info.functions]
    assert "public_func" in names


def test_analyze_module_excludes_private_function(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    names = [f.name for f in info.functions]
    assert "_private_func" not in names


def test_analyze_module_public_class(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    names = [c.name for c in info.classes]
    assert "MyClass" in names


def test_analyze_module_class_summary(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    cls = next(c for c in info.classes if c.name == "MyClass")
    assert "useful class" in cls.summary


def test_analyze_module_public_method(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    cls = next(c for c in info.classes if c.name == "MyClass")
    method_names = [m.name for m in cls.methods]
    assert "public_method" in method_names
    assert "_private_method" not in method_names


def test_analyze_module_imports(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    assert "src.bm25_index" in info.imports


def test_analyze_module_lineno(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    fn = next(f for f in info.functions if f.name == "public_func")
    assert fn.lineno > 0


def test_analyze_module_missing_file():
    assert analyze_module(Path("/nonexistent/module.py")) is None


def test_analyze_module_syntax_error(tmp_path):
    p = _write(tmp_path, "bad.py", "def (:")
    assert analyze_module(p) is None


def test_analyze_module_no_docstring(tmp_path):
    p = _write(tmp_path, "nodoc.py", "def foo(): pass\n")
    info = analyze_module(p)
    assert info is not None
    assert info.summary == ""


# --- analyze_package --------------------------------------------------------

def test_analyze_package_finds_modules(tmp_path):
    _write(tmp_path, "mod_a.py", '"""A."""\ndef fn(): pass\n')
    _write(tmp_path, "mod_b.py", '"""B."""\n')
    modules = analyze_package(tmp_path)
    names = [m.path.name for m in modules]
    assert "mod_a.py" in names
    assert "mod_b.py" in names


def test_analyze_package_excludes_init(tmp_path):
    _write(tmp_path, "__init__.py", "")
    _write(tmp_path, "real.py", "")
    modules = analyze_package(tmp_path)
    names = [m.path.name for m in modules]
    assert "__init__.py" not in names


def test_analyze_package_empty_dir(tmp_path):
    assert analyze_package(tmp_path) == []


# --- format_arch_doc --------------------------------------------------------

def test_format_arch_doc_empty():
    doc = format_arch_doc([])
    assert "no modules" in doc


def test_format_arch_doc_header():
    m = ModuleInfo(path=Path("src/foo.py"), module_name="src.foo", summary="Does foo.", functions=[], classes=[], imports=[])
    doc = format_arch_doc([m])
    assert "## Architecture overview" in doc


def test_format_arch_doc_module_path(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    info = analyze_module(p)
    doc = format_arch_doc([info])
    assert "mod.py" in doc


def test_format_arch_doc_function_listed(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    doc = format_arch_doc([analyze_module(p)])
    assert "public_func" in doc


def test_format_arch_doc_class_listed(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    doc = format_arch_doc([analyze_module(p)])
    assert "MyClass" in doc


def test_format_arch_doc_imports_shown(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    doc = format_arch_doc([analyze_module(p)], include_imports=True)
    assert "src.bm25_index" in doc


def test_format_arch_doc_imports_hidden(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    doc = format_arch_doc([analyze_module(p)], include_imports=False)
    assert "src.bm25_index" not in doc


# --- generate_arch_doc ------------------------------------------------------

def test_generate_arch_doc_specific_paths(tmp_path):
    p = _write(tmp_path, "mod.py", SIMPLE_MODULE)
    doc = generate_arch_doc([p])
    assert "public_func" in doc


def test_generate_arch_doc_all_modules(tmp_path):
    _write(tmp_path, "a.py", '"""A."""\ndef alpha(): pass\n')
    _write(tmp_path, "b.py", '"""B."""\ndef beta(): pass\n')
    doc = generate_arch_doc(src_dir=tmp_path)
    assert "alpha" in doc and "beta" in doc
