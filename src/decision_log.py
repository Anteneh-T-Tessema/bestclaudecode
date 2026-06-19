"""Audit log for agent implement cycles.

After each /implement (or /blueprint-build) run, the orchestrator records what
was attempted, what the reviewer found, how many retries were used, and what
the final outcome was. This creates a machine-readable audit trail that:

  - Lets developers see *why* a change was made, not just *what* changed
  - Surfaces patterns in reviewer findings across cycles (which symbols keep
    getting flagged, which tasks need multiple retries)
  - Provides a lightweight alternative to PR descriptions for internal tools
    that don't use GitHub

Log format
----------
Each cycle produces one Markdown file under docs/decisions/ named:

    YYYY-MM-DD_HHMMSS_<slug>.md

The slug is the first 40 chars of the task (lowercased, spaces→hyphens,
non-alphanumeric stripped). Markdown is used so the files are human-readable
without tooling and can be rendered by any docs viewer.

Called by /implement and /blueprint-build after the review-fix loop completes.
Also exposed as a library function for testing and future MCP integration.
"""
from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path

_DECISIONS_DIR = Path("docs") / "decisions"


def _slugify(text: str, max_len: int = 40) -> str:
    """Return a filesystem-safe slug from text."""
    slug = text.lower()
    slug = re.sub(r"[^a-z0-9\s-]", "", slug)
    slug = re.sub(r"\s+", "-", slug.strip())
    slug = re.sub(r"-+", "-", slug)
    return slug[:max_len].rstrip("-")


def _timestamp() -> str:
    """Return a UTC timestamp string suitable for filenames: YYYY-MM-DD_HHMMSS."""
    return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d_%H%M%S")


def log_decision(
    task: str,
    *,
    agent: str = "coding-agent",
    verdict: str,
    retries: int = 0,
    outcome: str,
    findings: list[str] | None = None,
    docs_dir: Path | None = None,
) -> Path:
    """Write one decision log entry and return the path of the created file.

    Args:
        task: the original task description passed to /implement.
        agent: name of the agent that performed the implementation.
        verdict: final reviewer verdict (e.g. "LGTM", "Blocking: 2 issues fixed").
        retries: number of fix-retry cycles consumed (0 = reviewer approved immediately).
        outcome: one-line human summary of what was accomplished.
        findings: list of reviewer finding strings (Blocking/Should-fix/etc.).
        docs_dir: override the docs/decisions/ directory (useful in tests).
    """
    target = (docs_dir or _DECISIONS_DIR)
    target.mkdir(parents=True, exist_ok=True)

    slug = _slugify(task)
    filename = f"{_timestamp()}_{slug}.md"
    path = target / filename

    findings_block = ""
    if findings:
        items = "\n".join(f"- {f}" for f in findings)
        findings_block = f"\n## Reviewer findings\n\n{items}\n"

    content = (
        f"# Decision: {task}\n\n"
        f"**Agent**: {agent}  \n"
        f"**Retries**: {retries}  \n"
        f"**Verdict**: {verdict}  \n"
        f"**Outcome**: {outcome}\n"
        f"{findings_block}"
    )
    path.write_text(content, encoding="utf-8")
    return path


def list_decisions(docs_dir: Path | None = None) -> list[Path]:
    """Return all decision log files sorted newest-first."""
    target = docs_dir or _DECISIONS_DIR
    if not target.exists():
        return []
    return sorted(target.glob("*.md"), reverse=True)


def main() -> None:
    """CLI: python -m src.decision_log [--list] [docs_dir]

    With --list: print the 10 most recent decision log file names.
    Without --list: write a sample entry (useful for smoke-testing the format).
    """
    args = sys.argv[1:]
    if "--list" in args:
        args = [a for a in args if a != "--list"]
        docs_dir = Path(args[0]) if args else None
        entries = list_decisions(docs_dir)
        if not entries:
            print("No decision logs found.")
        for p in entries[:10]:
            print(p)
        return

    docs_dir = Path(args[0]) if args else None
    path = log_decision(
        "example task from CLI smoke test",
        verdict="LGTM",
        retries=0,
        outcome="Wrote a sample decision log entry.",
        docs_dir=docs_dir,
    )
    print(f"Wrote: {path}")


if __name__ == "__main__":
    main()
