"""Unit tests for the grouping / section builder (sections.py).

Covers SRS FR-11 through FR-16, NFR-2 (determinism), NFR-4 (no data loss),
including a property-style fuzz test across randomly generated fixture
histories per the SRS acceptance criteria.
"""

from __future__ import annotations

import random
import unittest

from changelog_cli.classify import RECOGNIZED_TYPES, ParsedCommit
from changelog_cli.sections import CATCH_ALL_LABEL, build_sections


def _commit(
    type_: str | None,
    subject: str = "do something",
    sha: str = "abc1234",
    scope: str | None = None,
    breaking: bool = False,
    is_merge: bool = False,
) -> ParsedCommit:
    return ParsedCommit(
        type=type_,
        scope=scope,
        breaking=breaking,
        display_subject=subject,
        short_sha=sha,
        full_sha=sha + "0" * 33,
        is_merge=is_merge,
    )


class TestSectionsPerType(unittest.TestCase):
    def test_one_section_per_represented_type_no_cross_contamination(self) -> None:
        commits = [_commit(t, subject=f"{t} thing", sha=f"{i:07x}") for i, t in enumerate(RECOGNIZED_TYPES)]
        sections = build_sections(commits)

        self.assertEqual(len(sections), len(RECOGNIZED_TYPES))
        for section in sections:
            self.assertEqual(len(section.commits), 1)
            self.assertEqual(section.commits[0].type, section.key)

    def test_section_order_matches_fixed_order(self) -> None:
        # Build commits in reverse-of-canonical order to prove output order
        # is determined by the fixed taxonomy, not input order.
        commits = [_commit(t) for t in reversed(RECOGNIZED_TYPES)]
        sections = build_sections(commits)
        observed_order = [s.key for s in sections]
        self.assertEqual(observed_order, list(RECOGNIZED_TYPES))

    def test_feat_and_fix_come_before_lower_priority_types(self) -> None:
        commits = [_commit("chore"), _commit("feat"), _commit("docs"), _commit("fix")]
        sections = build_sections(commits)
        keys = [s.key for s in sections]
        self.assertEqual(keys.index("feat"), 0)
        self.assertEqual(keys.index("fix"), 1)
        self.assertLess(keys.index("feat"), keys.index("chore"))
        self.assertLess(keys.index("fix"), keys.index("docs"))


class TestCatchAll(unittest.TestCase):
    def test_unrecognized_commits_land_in_single_catch_all_section(self) -> None:
        commits = [_commit(None, subject="random thing one"), _commit(None, subject="random thing two")]
        sections = build_sections(commits)
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0].title, CATCH_ALL_LABEL)
        self.assertEqual(len(sections[0].commits), 2)

    def test_catch_all_omitted_when_everything_recognized(self) -> None:
        commits = [_commit("feat"), _commit("fix")]
        sections = build_sections(commits)
        self.assertNotIn(CATCH_ALL_LABEL, [s.title for s in sections])

    def test_catch_all_is_always_last(self) -> None:
        commits = [_commit(None), _commit("feat"), _commit("chore")]
        sections = build_sections(commits)
        self.assertEqual(sections[-1].title, CATCH_ALL_LABEL)


class TestEmptySectionsOmitted(unittest.TestCase):
    def test_no_section_headers_for_absent_types(self) -> None:
        commits = [_commit("feat")]
        sections = build_sections(commits)
        self.assertEqual(len(sections), 1)
        self.assertEqual(sections[0].key, "feat")

    def test_no_commits_at_all_yields_no_sections(self) -> None:
        sections = build_sections([])
        self.assertEqual(sections, [])


class TestAccountingInvariant(unittest.TestCase):
    def test_mixed_typed_and_untyped_total_matches_input(self) -> None:
        commits = [
            _commit("feat"),
            _commit("fix"),
            _commit(None),
            _commit("chore"),
            _commit(None),
            _commit("feat"),
        ]
        sections = build_sections(commits)
        total_out = sum(len(s.commits) for s in sections)
        self.assertEqual(total_out, len(commits))

    def test_fuzz_random_histories_preserve_entry_count(self) -> None:
        rng = random.Random(1234)
        possible_types = list(RECOGNIZED_TYPES) + [None] * 3  # weight catch-all in too
        for trial in range(50):
            with self.subTest(trial=trial):
                n = rng.randint(0, 200)
                commits = [
                    _commit(rng.choice(possible_types), sha=f"{trial:02x}{i:05x}")
                    for i in range(n)
                ]
                sections = build_sections(commits)
                total_out = sum(len(s.commits) for s in sections)
                self.assertEqual(total_out, n)


class TestDeterminism(unittest.TestCase):
    def test_repeated_calls_produce_identical_section_structure(self) -> None:
        commits = [_commit("feat"), _commit(None), _commit("fix"), _commit("feat")]
        first = build_sections(commits)
        second = build_sections(commits)
        self.assertEqual(
            [(s.key, [c.short_sha for c in s.commits]) for s in first],
            [(s.key, [c.short_sha for c in s.commits]) for s in second],
        )


if __name__ == "__main__":
    unittest.main()
