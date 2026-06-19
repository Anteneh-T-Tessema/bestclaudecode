"""Markdown renderer.

Converts the ordered section structure into a Markdown string: one ``###``
heading per non-empty section, followed by one bullet per commit entry
containing the de-prefixed subject and the short SHA (FR-17, FR-18, FR-20,
FR-21). Produces a well-formed document even when there are no sections at
all (FR-6's "valid empty changelog" case).
"""

from __future__ import annotations

from changelog_cli.sections import Section

_EMPTY_NOTICE = "_No changes in this range._"


def _render_entry(commit) -> str:
    scope_part = f"**{commit.scope}:** " if commit.scope else ""
    breaking_part = "**BREAKING** " if commit.breaking else ""
    subject = commit.display_subject.strip()
    return f"- {breaking_part}{scope_part}{subject} ({commit.short_sha})"


def render_markdown(sections: list[Section]) -> str:
    """Render ``sections`` to a single Markdown string.

    Satisfies FR-17, FR-18, FR-20, FR-21, and FR-6's empty-range case.
    """
    if not sections:
        return _EMPTY_NOTICE + "\n"

    lines: list[str] = []
    for section in sections:
        lines.append(f"### {section.title}")
        lines.append("")
        for commit in section.commits:
            lines.append(_render_entry(commit))
        lines.append("")

    # Single trailing newline, no trailing blank-line buildup.
    return "\n".join(lines).rstrip("\n") + "\n"
