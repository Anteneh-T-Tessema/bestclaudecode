"""Grouping / section builder.

Buckets parsed commits into fixed-order, named sections, omitting any
section (typed or catch-all) with zero commits (FR-11 through FR-16).
Preserves per-section commit order exactly as received (no sorting, no
set/dict iteration order dependency) which underlies determinism (NFR-2).
"""

from __future__ import annotations

import dataclasses

from changelog_cli.classify import ParsedCommit

CATCH_ALL_LABEL = "Other"

# Fixed display order and section titles (FR-12, C-5). feat/fix lead;
# remaining recognized types follow; catch-all is always last.
_SECTION_TITLES: dict[str, str] = {
    "feat": "Features",
    "fix": "Fixes",
    "chore": "Chores",
    "docs": "Documentation",
    "refactor": "Refactors",
    "perf": "Performance",
    "test": "Tests",
    "style": "Style",
    "build": "Build",
    "ci": "CI",
}

_SECTION_ORDER: tuple[str, ...] = (
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


@dataclasses.dataclass(frozen=True)
class Section:
    """One non-empty changelog section."""

    key: str  # conventional-commit type, or "other" for the catch-all
    title: str  # display heading, e.g. "Features" or "Other"
    commits: tuple[ParsedCommit, ...]


def build_sections(commits: list[ParsedCommit]) -> list[Section]:
    """Group commits into ordered, non-empty sections (FR-11..FR-16).

    Internally enforces the FR-16/NFR-4 accounting invariant: the total
    number of entries across all returned sections must equal
    ``len(commits)``. This is a hard internal check, not just a test
    assertion -- a violation indicates a bug in this function itself.
    """
    by_type: dict[str, list[ParsedCommit]] = {t: [] for t in _SECTION_ORDER}
    catch_all: list[ParsedCommit] = []

    for commit in commits:
        if commit.type is not None and commit.type in by_type:
            by_type[commit.type].append(commit)
        else:
            catch_all.append(commit)

    sections: list[Section] = []
    for type_key in _SECTION_ORDER:
        bucket = by_type[type_key]
        if bucket:
            sections.append(
                Section(
                    key=type_key,
                    title=_SECTION_TITLES[type_key],
                    commits=tuple(bucket),
                )
            )

    if catch_all:
        sections.append(
            Section(key="other", title=CATCH_ALL_LABEL, commits=tuple(catch_all))
        )

    total_in = len(commits)
    total_out = sum(len(section.commits) for section in sections)
    if total_out != total_in:
        raise AssertionError(
            f"section accounting invariant violated: {total_out} entries "
            f"emitted for {total_in} input commits"
        )

    return sections
