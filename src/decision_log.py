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


def _pop_arg(args: list[str], flag: str, default: str = "") -> str:
    """Extract --flag VALUE from args in-place, return VALUE or default."""
    try:
        idx = args.index(flag)
        value = args[idx + 1]
        args[idx : idx + 2] = []
        return value
    except (ValueError, IndexError):
        return default


def _pop_all(args: list[str], flag: str) -> list[str]:
    """Extract all --flag VALUE pairs from args in-place, return list of VALUEs."""
    results: list[str] = []
    while flag in args:
        try:
            idx = args.index(flag)
            results.append(args[idx + 1])
            args[idx : idx + 2] = []
        except IndexError:
            break
    return results


def main() -> None:
    """CLI: python -m src.decision_log [--list|--log] [options]

    --list [dir]          Print the 10 most recent decision log file names.
    --log                 Write a decision log entry from explicit flags:
        --task TEXT         Task description (required)
        --verdict TEXT      Reviewer verdict (required)
        --outcome TEXT      One-line outcome summary (required)
        --retries N         Number of retries (default 0)
        --agent TEXT        Agent name (default coding-agent)
        --finding TEXT      Reviewer finding (repeatable)
        --dir PATH          Override docs/decisions/ directory
    (no flags)            Write a sample smoke-test entry.
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

    if "--log" in args:
        args = [a for a in args if a != "--log"]
        task = _pop_arg(args, "--task")
        verdict = _pop_arg(args, "--verdict")
        outcome = _pop_arg(args, "--outcome")
        agent = _pop_arg(args, "--agent", "coding-agent")
        retries_str = _pop_arg(args, "--retries", "0")
        findings = _pop_all(args, "--finding")
        docs_dir_str = _pop_arg(args, "--dir")
        docs_dir = Path(docs_dir_str) if docs_dir_str else None

        if not task or not verdict or not outcome:
            print(
                "error: --log requires --task, --verdict, and --outcome",
                file=sys.stderr,
            )
            sys.exit(1)

        path = log_decision(
            task,
            agent=agent,
            verdict=verdict,
            retries=int(retries_str),
            outcome=outcome,
            findings=findings or None,
            docs_dir=docs_dir,
        )
        print(f"Wrote: {path}")
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
