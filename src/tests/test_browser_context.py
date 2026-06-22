"""Tests for src/browser_context.py."""
from __future__ import annotations

import json
import sys
from unittest.mock import MagicMock, patch

from src.browser_context import browse, main, search


# ---------------------------------------------------------------------------
# browse() — graceful degradation when browser-use is not installed
# ---------------------------------------------------------------------------

def test_browse_missing_import_returns_failure():
    with patch.dict(sys.modules, {"browser_use": None, "langchain_anthropic": None}):
        result = browse("https://example.com", "do something")
    assert result["success"] is False
    assert result["url"] == "https://example.com"
    assert result["task"] == "do something"
    assert isinstance(result["result"], str)


def test_browse_exception_returns_failure():
    mock_agent = MagicMock()
    mock_agent.run.side_effect = RuntimeError("network error")
    mock_browser_use = MagicMock()
    mock_browser_use.Agent.return_value = mock_agent
    mock_langchain = MagicMock()
    mock_langchain.ChatAnthropic.return_value = MagicMock()

    with patch.dict(sys.modules, {"browser_use": mock_browser_use, "langchain_anthropic": mock_langchain}):
        result = browse("https://example.com", "task")
    assert result["success"] is False
    assert "network error" in result["result"]


def test_browse_success():
    mock_agent = MagicMock()
    mock_agent.run.return_value = "found it"
    mock_browser_use = MagicMock()
    mock_browser_use.Agent.return_value = mock_agent
    mock_langchain = MagicMock()
    mock_langchain.ChatAnthropic.return_value = MagicMock()

    with patch("asyncio.run", return_value="found it"), \
         patch.dict(sys.modules, {"browser_use": mock_browser_use, "langchain_anthropic": mock_langchain}):
        result = browse("https://example.com", "find the title")

    assert result["success"] is True
    assert result["result"] == "found it"


# ---------------------------------------------------------------------------
# search() delegates to browse()
# ---------------------------------------------------------------------------

def test_search_delegates_to_browse():
    with patch("src.browser_context.browse") as mock_browse:
        mock_browse.return_value = {"url": "x", "task": "y", "result": "ok", "success": True}
        search("python BM25")
    mock_browse.assert_called_once()
    call_url = mock_browse.call_args[0][0]
    assert "python" in call_url or "BM25" in call_url


# ---------------------------------------------------------------------------
# CLI — main()
# ---------------------------------------------------------------------------

def test_cli_url_task_json(capsys):
    with patch("src.browser_context.browse", return_value={
        "url": "https://x.com", "task": "do it", "result": "done", "success": True,
    }):
        sys.argv = ["prog", "--url", "https://x.com", "--task", "do it", "--json"]
        main()
    out = capsys.readouterr().out
    data = json.loads(out.strip())
    assert data["success"] is True


def test_cli_search_json(capsys):
    with patch("src.browser_context.search", return_value={
        "url": "https://google.com", "task": "search", "result": "results", "success": True,
    }):
        sys.argv = ["prog", "--search", "python asyncio", "--json"]
        main()
    out = capsys.readouterr().out
    data = json.loads(out.strip())
    assert data["success"] is True


def test_cli_no_args_prints_usage(capsys):
    sys.argv = ["prog"]
    main()
    out = capsys.readouterr().out
    assert "Usage" in out


def test_cli_plain_output(capsys):
    with patch("src.browser_context.browse", return_value={
        "url": "https://x.com", "task": "t", "result": "plain result", "success": True,
    }):
        sys.argv = ["prog", "--url", "https://x.com", "--task", "t"]
        main()
    out = capsys.readouterr().out
    assert "plain result" in out
