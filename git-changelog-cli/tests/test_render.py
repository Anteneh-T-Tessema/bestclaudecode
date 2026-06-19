"""Unit tests for the Markdown renderer (render.py).

Covers SRS FR-17, FR-18, FR-20, FR-21, and FR-6's "valid empty changelog"
case.
"""

from __future__ import annotations

import unittest

from changelog_cli.classify import ParsedCommit
from changelog_cli.render import render_markdown
from changelog_cli.sections import build_sections


def _commit(type_, subject, sha="abc1234", scope=None, breaking=False) -> ParsedCommit:
    return ParsedCommit(
        type=type_,
        scope=scope,
        breaking=breaking,
        display_subject=subject,
        short_sha=sha,
        full_sha=sha + "0" * 33,
        is_merge=False,
    )


class TestRenderBasic(unittest.TestCase):
    def test_heading_and_bullet_for_single_section(self) -> None:
        sections = build_sections([_commit("feat", "add widget", sha="1111111")])
        md = render_markdown(sections)
        self.assertIn("### Features", md)
        self.assertIn("- add widget (1111111)", md)

    def test_no_leftover_prefix_syntax_in_bullet(self) -> None:
        sections = build_sections([_commit("feat", "add widget", sha="1111111")])
        md = render_markdown(sections)
        self.assertNotIn("feat:", md)
        self.assertNotIn("feat(", md)

    def test_scope_rendered_alongside_entry(self) -> None:
        sections = build_sections(
            [_commit("feat", "add widget", sha="2222222", scope="parser")]
        )
        md = render_markdown(sections)
        self.assertIn("parser", md)
        self.assertIn("2222222", md)

    def test_breaking_marker_rendered(self) -> None:
        sections = build_sections([_commit("feat", "drop py2", sha="3333333", breaking=True)])
        md = render_markdown(sections)
        self.assertIn("BREAKING", md)


class TestRenderMultipleSections(unittest.TestCase):
    def test_sections_rendered_in_order_with_headings(self) -> None:
        sections = build_sections(
            [
                _commit("fix", "fix bug", sha="4444444"),
                _commit("feat", "add feature", sha="5555555"),
                _commit(None, "misc update", sha="6666666"),
            ]
        )
        md = render_markdown(sections)
        feat_idx = md.index("### Features")
        fix_idx = md.index("### Fixes")
        other_idx = md.index("### Other")
        self.assertLess(feat_idx, fix_idx)
        self.assertLess(fix_idx, other_idx)


class TestRenderEmpty(unittest.TestCase):
    def test_empty_section_list_produces_well_formed_notice(self) -> None:
        md = render_markdown([])
        self.assertTrue(md.strip())
        self.assertNotIn("###", md)


if __name__ == "__main__":
    unittest.main()
