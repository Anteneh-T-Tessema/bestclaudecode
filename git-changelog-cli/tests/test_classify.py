"""Unit tests for the conventional-commit parser (classify.py).

Covers SRS FR-7 through FR-10, FR-20, NFR-3 and the corresponding
acceptance criteria: every recognized type with and without scope
classifies correctly, breaking-change markers are detected, and a subject
that merely contains a type name as a substring (not a true prefix) is
*not* misclassified.
"""

from __future__ import annotations

import unittest

from changelog_cli.classify import RECOGNIZED_TYPES, parse_commit
from changelog_cli.git_access import RawCommit


def _raw(subject: str, short_sha: str = "abc123", parent_count: int = 1) -> RawCommit:
    return RawCommit(
        full_sha=short_sha + "0" * 34,
        short_sha=short_sha,
        subject=subject,
        parent_count=parent_count,
    )


class TestRecognizedTypesWithoutScope(unittest.TestCase):
    def test_every_recognized_type_classifies_correctly(self) -> None:
        for type_name in RECOGNIZED_TYPES:
            with self.subTest(type=type_name):
                raw = _raw(f"{type_name}: do the thing")
                parsed = parse_commit(raw)
                self.assertEqual(parsed.type, type_name)
                self.assertIsNone(parsed.scope)
                self.assertFalse(parsed.breaking)
                self.assertEqual(parsed.display_subject, "do the thing")


class TestRecognizedTypesWithScope(unittest.TestCase):
    def test_every_recognized_type_with_scope_classifies_correctly(self) -> None:
        for type_name in RECOGNIZED_TYPES:
            with self.subTest(type=type_name):
                raw = _raw(f"{type_name}(parser): do the scoped thing")
                parsed = parse_commit(raw)
                self.assertEqual(parsed.type, type_name)
                self.assertEqual(parsed.scope, "parser")
                self.assertFalse(parsed.breaking)
                self.assertEqual(parsed.display_subject, "do the scoped thing")


class TestBreakingChangeMarker(unittest.TestCase):
    def test_breaking_marker_without_scope(self) -> None:
        parsed = parse_commit(_raw("feat!: drop python 2 support"))
        self.assertEqual(parsed.type, "feat")
        self.assertIsNone(parsed.scope)
        self.assertTrue(parsed.breaking)
        self.assertEqual(parsed.display_subject, "drop python 2 support")

    def test_breaking_marker_with_scope(self) -> None:
        parsed = parse_commit(_raw("fix(api)!: change response shape"))
        self.assertEqual(parsed.type, "fix")
        self.assertEqual(parsed.scope, "api")
        self.assertTrue(parsed.breaking)
        self.assertEqual(parsed.display_subject, "change response shape")


class TestNonConventionalSubjectsFallToCatchAll(unittest.TestCase):
    def test_substring_match_is_not_misclassified(self) -> None:
        # "Fixture update for tests" contains "fix" as a substring but does
        # not start with the true `fix:` prefix -- must not classify as fix.
        parsed = parse_commit(_raw("Fixture update for tests"))
        self.assertIsNone(parsed.type)
        self.assertEqual(parsed.display_subject, "Fixture update for tests")

    def test_plain_subject_with_no_prefix(self) -> None:
        parsed = parse_commit(_raw("update dependencies"))
        self.assertIsNone(parsed.type)
        self.assertEqual(parsed.display_subject, "update dependencies")

    def test_case_sensitivity_uppercase_type_not_matched(self) -> None:
        # FR-10: matching is case-sensitive.
        parsed = parse_commit(_raw("Feat: add new widget"))
        self.assertIsNone(parsed.type)
        self.assertEqual(parsed.display_subject, "Feat: add new widget")

    def test_unrecognized_type_keyword_not_matched(self) -> None:
        parsed = parse_commit(_raw("wip: half-finished thing"))
        self.assertIsNone(parsed.type)
        self.assertEqual(parsed.display_subject, "wip: half-finished thing")

    def test_missing_space_after_colon_not_matched(self) -> None:
        # Grammar requires "type: " (colon + single space) per SDD 2.5.
        parsed = parse_commit(_raw("feat:no space after colon"))
        self.assertIsNone(parsed.type)

    def test_type_prefix_with_no_colon_not_matched(self) -> None:
        parsed = parse_commit(_raw("feat add new widget"))
        self.assertIsNone(parsed.type)


class TestShaAndMergePassthrough(unittest.TestCase):
    def test_short_sha_and_merge_flag_preserved(self) -> None:
        raw = _raw("feat: add thing", short_sha="d34db33f", parent_count=2)
        parsed = parse_commit(raw)
        self.assertEqual(parsed.short_sha, "d34db33f")
        self.assertTrue(parsed.is_merge)

    def test_non_merge_commit_flagged_correctly(self) -> None:
        raw = _raw("fix: thing", parent_count=1)
        parsed = parse_commit(raw)
        self.assertFalse(parsed.is_merge)

    def test_root_commit_zero_parents_not_merge(self) -> None:
        raw = _raw("chore: initial commit", parent_count=0)
        parsed = parse_commit(raw)
        self.assertFalse(parsed.is_merge)


if __name__ == "__main__":
    unittest.main()
