"""Shadow workspace — git worktree preview before applying changes.

Cursor's "shadow workspace" lets the agent implement in an isolated copy of the
repo, shows the developer the diff, and only promotes changes to the main
working tree after approval. This module provides the same capability via
git worktrees, which are native to git and require no extra tooling.

Workflow
--------
1. Create a shadow worktree on a fresh branch:
       ws = ShadowWorkspace.create(base_ref="HEAD")

2. Tell the agent to implement *inside* ws.path — the main worktree is
   untouched while the agent works.

3. Call ws.diff() to get the unified diff of changes inside the shadow vs
   the base commit.

4. Either ws.promote() (cherry-picks the shadow commit back to main) or
   ws.discard() (removes the worktree without touching main).

5. The context manager form always discards on exit unless promote() was
   called first, so clean-up is automatic even if the agent errors.

Why worktrees over temp directories
------------------------------------
A git worktree shares the object store with the main repo — no data is
duplicated. The shadow branch is real git history, so the diff is clean and
`git log` inside the shadow is meaningful. A plain temp directory copy would
need a separate git init and loses history.

CLI
---
    python -m src.shadow_workspace [base-ref]

Creates a shadow worktree, prints its path and branch name, then waits for
Enter before discarding. Useful for manual inspection.
"""
from __future__ import annotations

import subprocess
import sys
import uuid
from pathlib import Path


def _git(*args: str, cwd: Path | None = None) -> str:
    """Run a git command and return stdout, raising on non-zero exit."""
    result = subprocess.run(
        ["git", *args],
        capture_output=True,
        text=True,
        cwd=cwd,
    )
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed:\n{result.stderr.strip()}")
    return result.stdout.strip()


def _repo_root(start: Path | None = None) -> Path:
    """Return the root of the git repo containing start (or cwd)."""
    cwd = start or Path.cwd()
    return Path(_git("rev-parse", "--show-toplevel", cwd=cwd))


class ShadowWorkspace:
    """An isolated git worktree for previewing agent changes before apply.

    Use ShadowWorkspace.create() to build one, then use it as a context
    manager for automatic cleanup:

        with ShadowWorkspace.create() as ws:
            # implement inside ws.path ...
            print(ws.diff())
            ws.promote()   # optional: cherry-pick changes to main tree
    """

    def __init__(self, path: Path, branch: str, base_ref: str, repo_root: Path) -> None:
        self.path = path
        self.branch = branch
        self.base_ref = base_ref
        self._repo_root = repo_root
        self._promoted = False
        self._removed = False

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    @classmethod
    def create(
        cls,
        base_ref: str = "HEAD",
        *,
        prefix: str = "shadow",
        repo_root: Path | None = None,
    ) -> "ShadowWorkspace":
        """Create a shadow worktree on a new branch from base_ref.

        Args:
            base_ref: git ref the shadow branch starts from (default HEAD).
            prefix: prefix for the worktree directory name and branch name.
            repo_root: repo root; defaults to the git root of cwd.
        """
        root = repo_root or _repo_root()
        uid = uuid.uuid4().hex[:8]
        branch = f"{prefix}/{uid}"
        worktree_path = root / ".shadow-workspaces" / uid

        _git("worktree", "add", "-b", branch, str(worktree_path), base_ref, cwd=root)
        return cls(worktree_path, branch, base_ref, root)

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    def diff(self, context_lines: int = 3) -> str:
        """Return unified diff of uncommitted changes inside the shadow worktree.

        Returns empty string if no changes exist.
        """
        result = subprocess.run(
            ["git", "diff", f"--unified={context_lines}"],
            capture_output=True,
            text=True,
            cwd=self.path,
        )
        return result.stdout

    def diff_vs_base(self) -> str:
        """Return diff of all committed+uncommitted changes vs base_ref.

        Useful after the agent has committed inside the shadow to see the
        full picture relative to where the main tree started.
        """
        result = subprocess.run(
            ["git", "diff", self.base_ref, "HEAD"],
            capture_output=True,
            text=True,
            cwd=self.path,
        )
        staged = subprocess.run(
            ["git", "diff", "--cached"],
            capture_output=True,
            text=True,
            cwd=self.path,
        )
        return result.stdout + staged.stdout

    def promote(self) -> None:
        """Cherry-pick the shadow's top commit onto the main working tree.

        Only works if the agent committed inside the shadow. If the shadow
        has no commits beyond base_ref, this is a no-op (nothing to promote).
        """
        shadow_head = _git("rev-parse", "HEAD", cwd=self.path)
        base_sha = _git("rev-parse", self.base_ref, cwd=self._repo_root)
        if shadow_head == base_sha:
            return
        _git("cherry-pick", shadow_head, cwd=self._repo_root)
        self._promoted = True

    def discard(self) -> None:
        """Remove the shadow worktree and delete its branch."""
        if self._removed:
            return
        try:
            _git("worktree", "remove", "--force", str(self.path), cwd=self._repo_root)
        except RuntimeError:
            pass
        try:
            _git("branch", "-D", self.branch, cwd=self._repo_root)
        except RuntimeError:
            pass
        self._removed = True

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    def __enter__(self) -> "ShadowWorkspace":
        return self

    def __exit__(self, *_: object) -> None:
        if not self._promoted:
            self.discard()

    # ------------------------------------------------------------------
    # Representation
    # ------------------------------------------------------------------

    def __repr__(self) -> str:
        return f"ShadowWorkspace(branch={self.branch!r}, path={self.path})"


def format_shadow_header(ws: ShadowWorkspace) -> str:
    """Return a context block describing an active shadow workspace.

    Injected into the agent's prompt so it knows where to write files.
    """
    return (
        f"## Shadow workspace (isolated preview)\n\n"
        f"Implement inside: `{ws.path}`\n"
        f"Branch: `{ws.branch}` (based on `{ws.base_ref}`)\n\n"
        f"After implementing, call `ws.diff()` to preview, then "
        f"`ws.promote()` to apply or `ws.discard()` to abort.\n"
    )


def main() -> None:  # noqa: C901
    """CLI: python -m src.shadow_workspace [subcommand] [--json]

    Subcommands (all output JSON when --json is passed):
      create [base-ref]         Create a shadow worktree; prints {id,path,branch,base_ref}
      diff <path>               Uncommitted diff inside the worktree at <path>
      diff-vs-base <path>       Full diff (committed + uncommitted) vs base_ref
      promote <path> <root>     Cherry-pick shadow HEAD onto main tree
      discard <path> <root>     Remove worktree and delete branch

    Without a subcommand: interactive demo mode (waits for Enter, then discards).
    """
    import json as _json

    args = list(sys.argv[1:])
    as_json = "--json" in args
    if as_json:
        args.remove("--json")

    if not args or args[0] not in ("create", "diff", "diff-vs-base", "promote", "discard"):
        # Interactive demo
        base_ref = args[0] if args else "HEAD"
        print(f"Creating shadow worktree from {base_ref} …")
        try:
            with ShadowWorkspace.create(base_ref=base_ref) as ws:
                print(f"  Branch : {ws.branch}")
                print(f"  Path   : {ws.path}")
                print("  Diff vs base:")
                d = ws.diff()
                print(d if d else "  (no changes yet)")
                input("\nPress Enter to discard and exit…")
        except RuntimeError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
        return

    cmd, rest = args[0], args[1:]

    try:
        if cmd == "create":
            base_ref = rest[0] if rest else "HEAD"
            ws = ShadowWorkspace.create(base_ref=base_ref)
            result = {
                "id": str(ws.path.name),
                "path": str(ws.path),
                "branch": ws.branch,
                "base_ref": ws.base_ref,
                "repo_root": str(ws._repo_root),
            }
            if as_json:
                print(_json.dumps(result))
            else:
                print(f"branch={ws.branch} path={ws.path}")

        elif cmd == "diff":
            if not rest:
                print("Usage: shadow_workspace diff <path>", file=sys.stderr)
                sys.exit(1)
            path = Path(rest[0])
            ws = ShadowWorkspace(path, branch="", base_ref="HEAD", repo_root=path.parent)
            diff = ws.diff()
            if as_json:
                print(_json.dumps({"diff": diff}))
            else:
                print(diff)

        elif cmd == "diff-vs-base":
            if not rest:
                print("Usage: shadow_workspace diff-vs-base <path>", file=sys.stderr)
                sys.exit(1)
            path = Path(rest[0])
            ws = ShadowWorkspace(path, branch="", base_ref="HEAD", repo_root=path.parent)
            diff = ws.diff_vs_base()
            if as_json:
                print(_json.dumps({"diff": diff}))
            else:
                print(diff)

        elif cmd == "promote":
            if len(rest) < 2:
                print("Usage: shadow_workspace promote <path> <repo_root>", file=sys.stderr)
                sys.exit(1)
            path, root = Path(rest[0]), Path(rest[1])
            branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=path)
            ws = ShadowWorkspace(path, branch=branch, base_ref="HEAD", repo_root=root)
            ws.promote()
            if as_json:
                print(_json.dumps({"ok": True}))
            else:
                print("promoted")

        elif cmd == "discard":
            if len(rest) < 2:
                print("Usage: shadow_workspace discard <path> <repo_root>", file=sys.stderr)
                sys.exit(1)
            path, root = Path(rest[0]), Path(rest[1])
            branch = _git("rev-parse", "--abbrev-ref", "HEAD", cwd=path)
            ws = ShadowWorkspace(path, branch=branch, base_ref="HEAD", repo_root=root)
            ws.discard()
            if as_json:
                print(_json.dumps({"ok": True}))
            else:
                print("discarded")

    except Exception as e:
        if as_json:
            print(_json.dumps({"error": str(e)}))
        else:
            print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
