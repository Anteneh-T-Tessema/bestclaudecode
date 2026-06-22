"""Tests for src/web_fetcher.py."""
from __future__ import annotations

import json
import subprocess
import sys
import unittest.mock as mock

from src.web_fetcher import _fetch_brave, _fetch_duckduckgo, fetch_web_results


# ── _fetch_duckduckgo ─────────────────────────────────────────────────────────

DDG_LITE_HTML = """<html><body>
<div class="results_links_deep">
  <a class="result-link" href="https://example.com/1">Python Docs</a>
  <td class="result-snippet">The official Python documentation.</td>
</div>
<div class="results_links_deep">
  <a class="result-link" href="https://example.com/2">Real Python</a>
  <td class="result-snippet">Tutorials and references.</td>
</div>
</body></html>"""


def _mock_urlopen(html: str):
    """Return a context manager that yields a mock HTTP response."""
    cm = mock.MagicMock()
    cm.__enter__ = mock.Mock(return_value=cm)
    cm.__exit__ = mock.Mock(return_value=False)
    cm.read.return_value = html.encode()
    return cm


def test_duckduckgo_returns_list(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(DDG_LITE_HTML))
    results = _fetch_duckduckgo("python")
    assert isinstance(results, list)


def test_duckduckgo_extracts_title(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(DDG_LITE_HTML))
    results = _fetch_duckduckgo("python")
    titles = [r["title"] for r in results]
    assert any("Python" in t for t in titles)


def test_duckduckgo_extracts_url(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: _mock_urlopen(DDG_LITE_HTML))
    results = _fetch_duckduckgo("python")
    urls = [r["url"] for r in results]
    assert any("example.com" in u for u in urls)


def test_duckduckgo_network_error_returns_empty(monkeypatch):
    def raise_error(*a, **k):
        raise OSError("network error")
    monkeypatch.setattr("urllib.request.urlopen", raise_error)
    assert _fetch_duckduckgo("query") == []


# ── _fetch_brave ──────────────────────────────────────────────────────────────

BRAVE_JSON = json.dumps({
    "web": {
        "results": [
            {"title": "Brave Result", "url": "https://brave.com/1", "description": "A brave result."},
        ]
    }
}).encode()


def test_brave_returns_list(monkeypatch):
    resp = _mock_urlopen(BRAVE_JSON.decode())
    resp.read.return_value = BRAVE_JSON
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: resp)
    results = _fetch_brave("python", "test-key")
    assert isinstance(results, list)
    assert len(results) == 1


def test_brave_extracts_fields(monkeypatch):
    resp = _mock_urlopen(BRAVE_JSON.decode())
    resp.read.return_value = BRAVE_JSON
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: resp)
    results = _fetch_brave("python", "test-key")
    assert results[0]["title"] == "Brave Result"
    assert results[0]["url"] == "https://brave.com/1"
    assert results[0]["snippet"] == "A brave result."


def test_brave_network_error_returns_empty(monkeypatch):
    def raise_error(*a, **k):
        raise OSError("network error")
    monkeypatch.setattr("urllib.request.urlopen", raise_error)
    assert _fetch_brave("query", "key") == []


# ── fetch_web_results (integration) ──────────────────────────────────────────

def test_fetch_web_results_uses_brave_when_key_given(monkeypatch):
    brave_resp = _mock_urlopen(BRAVE_JSON.decode())
    brave_resp.read.return_value = BRAVE_JSON

    calls = []
    def mock_open(req, **k):
        calls.append(str(req.full_url))
        return brave_resp

    monkeypatch.setattr("urllib.request.urlopen", mock_open)
    results = fetch_web_results("python", brave_key="test-key")
    assert any("brave.com" in c for c in calls)
    assert results[0]["title"] == "Brave Result"


def test_fetch_web_results_falls_back_to_ddg_when_no_key(monkeypatch):
    ddg_resp = _mock_urlopen(DDG_LITE_HTML)
    calls = []
    def mock_open(req, **k):
        calls.append(str(req.full_url) if hasattr(req, "full_url") else str(req))
        return ddg_resp

    monkeypatch.setattr("urllib.request.urlopen", mock_open)
    fetch_web_results("python")
    assert any("duckduckgo" in c for c in calls)


def test_fetch_web_results_falls_back_to_ddg_when_brave_fails(monkeypatch):
    call_count = {"n": 0}
    ddg_resp = _mock_urlopen(DDG_LITE_HTML)

    def mock_open(req, **k):
        call_count["n"] += 1
        if call_count["n"] == 1:
            raise OSError("brave down")
        return ddg_resp

    monkeypatch.setattr("urllib.request.urlopen", mock_open)
    results = fetch_web_results("python", brave_key="key")
    assert isinstance(results, list)


def test_fetch_web_results_env_key(monkeypatch):
    monkeypatch.setenv("BRAVE_API_KEY", "env-key")
    brave_resp = _mock_urlopen(BRAVE_JSON.decode())
    brave_resp.read.return_value = BRAVE_JSON
    calls = []
    def mock_open(req, **k):
        calls.append(str(req.full_url) if hasattr(req, "full_url") else str(req))
        return brave_resp
    monkeypatch.setattr("urllib.request.urlopen", mock_open)
    fetch_web_results("python")
    assert any("brave.com" in c for c in calls)


# ── CLI ───────────────────────────────────────────────────────────────────────

def test_cli_json_output(monkeypatch):
    ddg_resp = _mock_urlopen(DDG_LITE_HTML)
    monkeypatch.setattr("urllib.request.urlopen", lambda *a, **k: ddg_resp)

    result = subprocess.run(
        [sys.executable, "-m", "src.web_fetcher", "python", "--json"],
        capture_output=True, text=True,
    )
    assert result.returncode == 0
    data = json.loads(result.stdout)
    assert isinstance(data, list)


def test_cli_no_query_exits_nonzero():
    result = subprocess.run(
        [sys.executable, "-m", "src.web_fetcher"],
        capture_output=True, text=True,
    )
    assert result.returncode != 0
