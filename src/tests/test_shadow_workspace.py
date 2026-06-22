"""Tests for src/shadow_workspace.py."""
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

from src.shadow_workspace import (
    ShadowWorkspace,
    format_shadow_header,
    _repo_root,
    _git,
)


# ---------------------------------------------------------------------------
# _git helper
# ---------------------------------------------------------------------------

def test_git_returns_stdout(tmp_path):
    out = _git("rev-parse", "--show-toplevel")
    assert isinstance(out, str)
    assert len(out) > 0


def test_git_raises_on_failure():
    with pytest.raises(RuntimeError, match="failed"):
        _git("not-a-real-command-xyzzy")


# ---------------------------------------------------------------------------
# _repo_root
# ---------------------------------------------------------------------------

def test_repo_root_returns_path():
    root = _repo_root()
    assert isinstance(root, Path)
    assert (root / ".git").exists()


# ---------------------------------------------------------------------------
# ShadowWorkspace.create / context manager — mocked git calls
# ---------------------------------------------------------------------------

def _make_ws(tmp_path: Path) -> ShadowWorkspace:
    """Return a ShadowWorkspace pointing at tmp_path without touching git."""
    return ShadowWorkspace(
        path=tmp_path / "shadow",
        branch="shadow/abc12345",
        base_ref="HEAD",
        repo_root=tmp_path,
    )


def test_repr_contains_branch(tmp_path):
    ws = _make_ws(tmp_path)
    assert "shadow/abc12345" in repr(ws)


def test_discard_is_idempotent(tmp_path):
    ws = _make_ws(tmp_path)
    with patch("src.shadow_workspace._git"):
        ws.discard()
        ws.discard()  # second call must not raise
    assert ws._removed


def test_context_manager_discards_on_exit(tmp_path):
    ws = _make_ws(tmp_path)
    with patch.object(ws, "discard") as mock_discard:
        with ws:
            pass
        mock_discard.assert_called_once()


def test_context_manager_skips_discard_after_promote(tmp_path):
    ws = _make_ws(tmp_path)
    ws._promoted = True
    with patch.object(ws, "discard") as mock_discard:
        with ws:
            pass
        mock_discard.assert_not_called()


def test_context_manager_discards_on_exception(tmp_path):
    ws = _make_ws(tmp_path)
    with patch.object(ws, "discard") as mock_discard:
        try:
            with ws:
                raise ValueError("agent error")
        except ValueError:
            pass
        mock_discard.assert_called_once()


# ---------------------------------------------------------------------------
# diff() — uses subprocess directly
# ---------------------------------------------------------------------------

def test_diff_returns_string(tmp_path):
    ws = _make_ws(tmp_path)
    (tmp_path / "shadow").mkdir()
    mock_result = MagicMock()
    mock_result.stdout = "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n+x\n"
    with patch("subprocess.run", return_value=mock_result):
        d = ws.diff()
    assert "foo.py" in d


def test_diff_empty_when_no_changes(tmp_path):
    ws = _make_ws(tmp_path)
    mock_result = MagicMock()
    mock_result.stdout = ""
    with patch("subprocess.run", return_value=mock_result):
        d = ws.diff()
    assert d == ""


# ---------------------------------------------------------------------------
# promote() — mocked
# ---------------------------------------------------------------------------

def test_promote_noop_when_no_new_commits(tmp_path):
    ws = _make_ws(tmp_path)
    same_sha = "abc123"
    with patch("src.shadow_workspace._git", return_value=same_sha):
        ws.promote()
    assert not ws._promoted  # sha == base_sha → no cherry-pick


def test_promote_sets_flag_when_commit_differs(tmp_path):
    ws = _make_ws(tmp_path)
    call_count = [0]

    def fake_git(*args, **kwargs):
        call_count[0] += 1
        # First call (rev-parse HEAD) → new sha; second (rev-parse base) → old sha
        return "new_sha" if call_count[0] == 1 else "old_sha"

    with patch("src.shadow_workspace._git", side_effect=fake_git):
        ws.promote()
    assert ws._promoted


# ---------------------------------------------------------------------------
# format_shadow_header
# ---------------------------------------------------------------------------

def test_format_shadow_header_contains_path(tmp_path):
    ws = _make_ws(tmp_path)
    header = format_shadow_header(ws)
    assert str(ws.path) in header
    assert ws.branch in header
    assert ws.base_ref in header


def test_format_shadow_header_is_markdown(tmp_path):
    ws = _make_ws(tmp_path)
    header = format_shadow_header(ws)
    assert header.startswith("## Shadow workspace")


# ---------------------------------------------------------------------------
# ShadowWorkspace.create — integration (skipped if not in git repo)
# ---------------------------------------------------------------------------

@pytest.mark.integration
def test_create_makes_worktree():
    """Full integration test: creates and discards a real git worktree."""
    try:
        ws = ShadowWorkspace.create(base_ref="HEAD", prefix="test-shadow")
    except RuntimeError as e:
        pytest.skip(f"git worktree not available: {e}")

    assert ws.path.exists()
    assert (ws.path / ".git").exists()
    ws.discard()
    assert not ws.path.exists()
