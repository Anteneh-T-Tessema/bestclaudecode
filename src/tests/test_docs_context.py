"""Tests for src/docs_context.py."""
from __future__ import annotations

import json
import subprocess
import sys
import unittest.mock as mock

from src.docs_context import fetch_docs, fetch_npm_docs, fetch_pypi_docs


# ── Helpers ───────────────────────────────────────────────────────────────────

PYPI_RESPONSE = json.dumps({
    "info": {
        "name": "requests",
        "version": "2.31.0",
        "summary": "Python HTTP for Humans.",
        "description": "Requests is an elegant...",
        "package_url": "https://pypi.org/project/requests/",
    }
}).encode()

NPM_RESPONSE = json.dumps({
    "name": "react",
    "description": "React is a JavaScript library for building UIs.",
    "dist-tags": {"latest": "18.2.0"},
    "versions": {
        "18.2.0": {"readme": "React docs..."},
    },
    "readme": "React docs...",
}).encode()


def _mock_urlopen(body: bytes):
    cm = mock.MagicMock()
    cm.__enter__ = mock.Mock(return_value=cm)
    cm.__exit__ = mock.Mock(return_value=False)
    cm.read.return_value = body
    return cm


def _raise_http_404(*a, **k):
    import urllib.error
    raise urllib.error.HTTPError(url="", code=404, msg="Not Found", hdrs=None, fp=None)  # type: ignore


# ── fetch_pypi_docs ───────────────────────────────────────────────────────────

def test_pypi_returns_dict(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(PYPI_RESPONSE))
    result = fetch_pypi_docs("requests")
    assert result is not None
    assert isinstance(result, dict)


def test_pypi_extracts_fields(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(PYPI_RESPONSE))
    result = fetch_pypi_docs("requests")
    assert result["name"] == "requests"
    assert result["version"] == "2.31.0"
    assert result["source"] == "pypi"
    assert "Human" in result["summary"]


def test_pypi_returns_none_on_404(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", _raise_http_404)
    assert fetch_pypi_docs("nonexistent-pkg-xyz") is None


def test_pypi_returns_none_on_network_error(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: (_ for _ in ()).throw(OSError("timeout")))
    assert fetch_pypi_docs("requests") is None


# ── fetch_npm_docs ────────────────────────────────────────────────────────────

def test_npm_returns_dict(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(NPM_RESPONSE))
    result = fetch_npm_docs("react")
    assert result is not None
    assert isinstance(result, dict)


def test_npm_extracts_fields(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(NPM_RESPONSE))
    result = fetch_npm_docs("react")
    assert result["name"] == "react"
    assert result["version"] == "18.2.0"
    assert result["source"] == "npm"


def test_npm_returns_none_on_404(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", _raise_http_404)
    assert fetch_npm_docs("@nonexistent/pkg") is None


# ── fetch_docs (orchestration) ────────────────────────────────────────────────

def test_fetch_docs_tries_pypi_first(monkeypatch):
    calls = []
    def mock_open(req, **k):
        calls.append(str(req.full_url) if hasattr(req, "full_url") else str(req))
        return _mock_urlopen(PYPI_RESPONSE)
    monkeypatch.setattr("urllib.request.urlopen", mock_open)
    fetch_docs("requests")
    assert any("pypi.org" in c for c in calls)


def test_fetch_docs_falls_back_to_npm_when_pypi_404(monkeypatch):
    call_count = {"n": 0}
    def mock_open(req, **k):
        call_count["n"] += 1
        if call_count["n"] == 1:
            _raise_http_404()
        return _mock_urlopen(NPM_RESPONSE)
    monkeypatch.setattr("urllib.request.urlopen", mock_open)
    result = fetch_docs("react")
    assert result is not None
    assert result["source"] == "npm"


def test_fetch_docs_prefer_npm(monkeypatch):
    calls = []
    def mock_open(req, **k):
        calls.append(str(req.full_url) if hasattr(req, "full_url") else str(req))
        return _mock_urlopen(NPM_RESPONSE)
    monkeypatch.setattr("urllib.request.urlopen", mock_open)
    fetch_docs("react", prefer="npm")
    assert any("npmjs.org" in c or "npmjs.com" in c or "npm" in c for c in calls)


def test_fetch_docs_returns_none_when_both_fail(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", _raise_http_404)
    assert fetch_docs("absolutely-nonexistent-pkg-123456") is None


# ── CLI ───────────────────────────────────────────────────────────────────────

def test_cli_json_output(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(PYPI_RESPONSE))
    result = subprocess.run(
        [sys.executable, "-m", "src.docs_context", "requests", "--json"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    data = json.loads(result.stdout)
    assert data["name"] == "requests"
    assert data["source"] == "pypi"


def test_cli_no_args_exits_nonzero():
    result = subprocess.run(
        [sys.executable, "-m", "src.docs_context"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
