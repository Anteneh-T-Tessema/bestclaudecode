"""Analytics over the decision log — retry rates, failure patterns.

The decision log (docs/decisions/*.md) contains a per-cycle record of every
agent implement run. This module aggregates those records to answer questions
that neither Cursor nor Devin can answer:

  - "Which files keep getting flagged by the reviewer?"
  - "What fraction of tasks needed a retry?"
  - "Which verdict category dominates?"

These analytics are useful for:
  - Spotting systemic code quality problems (e.g. a module that consistently
    gets Blocking findings)
  - Calibrating trust in the agent (low retry rate → agent is reliable)
  - Identifying tasks where the agent consistently struggles

Output
------
``DecisionStats`` is a plain dataclass — easy to serialise to JSON or render
as a Markdown report via ``format_analytics_report()``.

CLI
---
    python -m src.decision_analytics [--json] [docs/decisions/]

Without ``--json`` prints a human-readable Markdown report; with ``--json``
prints the raw stats as JSON.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from dataclasses import dataclass, field, asdict
from pathlib import Path

_DECISIONS_DIR = Path("docs") / "decisions"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

@dataclass
class ParsedDecision:
    """One parsed decision log entry."""

    filename: str
    task: str
    agent: str
    verdict: str
    retries: int
    outcome: str
    findings: list[str] = field(default_factory=list)


def parse_decision_file(path: Path) -> ParsedDecision | None:
    """Parse one decision Markdown file. Returns None on parse error."""
    try:
        content = path.read_text(encoding="utf-8")
    except OSError:
        return None

    task_m = re.search(r"^# Decision: (.+)$", content, re.MULTILINE)
    agent_m = re.search(r"\*\*Agent\*\*:\s*(.+?)(?:\s*\\\\)?\s*$", content, re.MULTILINE)
    retries_m = re.search(r"\*\*Retries\*\*:\s*(\d+)", content)
    verdict_m = re.search(r"\*\*Verdict\*\*:\s*(.+?)(?:\s*\\\\)?\s*$", content, re.MULTILINE)
    outcome_m = re.search(r"\*\*Outcome\*\*:\s*(.+?)(?:\s*\\\\)?\s*$", content, re.MULTILINE)

    findings: list[str] = []
    if "## Reviewer findings" in content:
        findings_section = content.split("## Reviewer findings", 1)[1]
        findings = [
            line[2:].strip()
            for line in findings_section.splitlines()
            if line.startswith("- ")
        ]

    return ParsedDecision(
        filename=path.name,
        task=task_m.group(1).strip() if task_m else path.stem,
        agent=agent_m.group(1).strip() if agent_m else "unknown",
        verdict=verdict_m.group(1).strip() if verdict_m else "unknown",
        retries=int(retries_m.group(1)) if retries_m else 0,
        outcome=outcome_m.group(1).strip() if outcome_m else "",
        findings=findings,
    )


def load_decisions(docs_dir: Path | None = None) -> list[ParsedDecision]:
    """Load and parse all decision log files, newest first."""
    target = docs_dir or _DECISIONS_DIR
    if not target.exists():
        return []
    paths = sorted(target.glob("*.md"), reverse=True)
    results: list[ParsedDecision] = []
    for p in paths:
        parsed = parse_decision_file(p)
        if parsed:
            results.append(parsed)
    return results


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------

@dataclass
class DecisionStats:
    """Aggregated analytics over a set of decision log entries."""

    total: int
    with_retry: int
    retry_rate_pct: float
    verdict_counts: dict[str, int]
    top_findings: list[tuple[str, int]]
    top_files: list[tuple[str, int]]
    agents: dict[str, int]


def compute_stats(decisions: list[ParsedDecision]) -> DecisionStats:
    """Compute aggregated statistics over a list of parsed decisions."""
    if not decisions:
        return DecisionStats(
            total=0, with_retry=0, retry_rate_pct=0.0,
            verdict_counts={}, top_findings=[], top_files={}, agents={},
        )

    total = len(decisions)
    with_retry = sum(1 for d in decisions if d.retries > 0)
    retry_rate = (with_retry / total) * 100.0

    verdict_counter: Counter[str] = Counter()
    for d in decisions:
        # Normalise "LGTM" vs "Blocking: 2 issues" → "Blocking"
        verdict_key = d.verdict.split(":")[0].strip()
        verdict_counter[verdict_key] += 1

    finding_counter: Counter[str] = Counter()
    file_counter: Counter[str] = Counter()
    for d in decisions:
        for f in d.findings:
            finding_counter[f[:80]] += 1
            # Extract file paths like src/foo.py
            for fpath in re.findall(r"(src/[\w/._-]+\.py)", f):
                file_counter[fpath] += 1

    return DecisionStats(
        total=total,
        with_retry=with_retry,
        retry_rate_pct=round(retry_rate, 1),
        verdict_counts=dict(verdict_counter.most_common()),
        top_findings=finding_counter.most_common(5),
        top_files=file_counter.most_common(5),
        agents=dict(Counter(d.agent for d in decisions).most_common()),
    )


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def format_analytics_report(stats: DecisionStats) -> str:
    """Return a human-readable Markdown analytics report."""
    if stats.total == 0:
        return "## Decision log analytics\n\n(no entries found)\n"

    lines: list[str] = [
        "## Decision log analytics\n",
        f"**Total cycles**: {stats.total}",
        f"**Cycles with retry**: {stats.with_retry} ({stats.retry_rate_pct}%)",
        "",
        "**Verdicts**",
    ]
    for verdict, count in stats.verdict_counts.items():
        lines.append(f"  - {verdict}: {count}")

    if stats.agents:
        lines.append("\n**Agents**")
        for agent, count in stats.agents.items():
            lines.append(f"  - {agent}: {count}")

    if stats.top_findings:
        lines.append("\n**Most frequent findings**")
        for finding, count in stats.top_findings:
            lines.append(f"  - ({count}×) {finding}")

    if stats.top_files:
        lines.append("\n**Most flagged files**")
        for fpath, count in stats.top_files:
            lines.append(f"  - ({count}×) {fpath}")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    """CLI: python -m src.decision_analytics [--json] [docs/decisions/]"""
    args = sys.argv[1:]
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]

    docs_dir = Path(args[0]) if args else None
    decisions = load_decisions(docs_dir)
    stats = compute_stats(decisions)

    if as_json:
        print(json.dumps(asdict(stats), indent=2))
    else:
        print(format_analytics_report(stats))


if __name__ == "__main__":
    main()
