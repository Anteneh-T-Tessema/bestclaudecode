"""Conventional-commit parser.

Pure, side-effect-free logic with no knowledge of git or the filesystem
(SDD 2.5). Applies a fixed-grammar, anchored-at-start regex match against
each commit subject line -- never a substring scan -- which is what keeps
a subject like "Fixture update" out of the `fix` type (FR-10).
"""

from __future__ import annotations

import dataclasses
import re

from changelog_cli.git_access import RawCommit

# Recognized conventional-commit types (FR-8), fixed in this version (C-5).
RECOGNIZED_TYPES = (
    "feat",
    "fix",
    "chore",
    "docs",
    "refactor",
    "perf",
    "test",
    "style",
    "build",
    "ci",
)

# `type(scope)?(!)?: subject` -- anchored at the start of the string,
# case-sensitive, requiring the literal recognized type keyword followed
# by an optional parenthesized scope, an optional breaking-change `!`,
# then a colon and a single space before the remainder of the subject.
_PREFIX_RE = re.compile(
    r"^(?P<type>" + "|".join(re.escape(t) for t in RECOGNIZED_TYPES) + r")"
    r"(?:\((?P<scope>[^()]+)\))?"
    r"(?P<breaking>!)?"
    r": (?P<rest>.*)$"
)


@dataclasses.dataclass(frozen=True)
class ParsedCommit:
    """A commit after conventional-commit classification."""

    type: str | None
    scope: str | None
    breaking: bool
    display_subject: str
    short_sha: str
    full_sha: str
    is_merge: bool


def parse_commit(raw: RawCommit) -> ParsedCommit:
    """Classify a single raw commit per FR-7 through FR-10, FR-20."""
    match = _PREFIX_RE.match(raw.subject)
    if match is None:
        return ParsedCommit(
            type=None,
            scope=None,
            breaking=False,
            display_subject=raw.subject,
            short_sha=raw.short_sha,
            full_sha=raw.full_sha,
            is_merge=raw.is_merge,
        )

    return ParsedCommit(
        type=match.group("type"),
        scope=match.group("scope"),
        breaking=match.group("breaking") == "!",
        display_subject=match.group("rest"),
        short_sha=raw.short_sha,
        full_sha=raw.full_sha,
        is_merge=raw.is_merge,
    )
