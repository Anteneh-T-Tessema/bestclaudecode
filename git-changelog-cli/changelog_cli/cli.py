"""CLI entry point / argument parser.

Owns ``main()``. Parses argv (repo path, commit range, output destination,
``--help``), validates argument shape, and dispatches to the pipeline. The
only layer aware of process exit codes and stderr/stdout formatting for
errors (FR-1, FR-2, FR-19, FR-23, FR-24, FR-25, NFR-6, NFR-8).
"""

from __future__ import annotations

import argparse
import sys
from typing import Sequence

from changelog_cli.classify import parse_commit
from changelog_cli.errors import ChangelogError
from changelog_cli.git_access import fetch_commits, resolve_range, resolve_repository
from changelog_cli.output import write_output
from changelog_cli.render import render_markdown
from changelog_cli.sections import build_sections

EXIT_OK = 0
EXIT_FAILURE = 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="changelog",
        description=(
            "Generate a Markdown changelog section from a local git "
            "repository's commit range, grouped by conventional-commit type."
        ),
        epilog="Example: changelog /path/to/repo v1.2.0..v1.3.0 --output CHANGELOG-section.md",
    )
    parser.add_argument(
        "repo_path",
        nargs="?",
        default=".",
        help="path to the local git repository (default: current directory)",
    )
    parser.add_argument(
        "range",
        help="commit range to include, e.g. v1.2.0..v1.3.0 or v1.2.0..HEAD",
    )
    parser.add_argument(
        "--output",
        "-o",
        metavar="FILE",
        default=None,
        help="write the changelog to FILE instead of stdout",
    )
    return parser


def run(argv: Sequence[str] | None = None, stdout=None, stderr=None) -> int:
    """Run the CLI pipeline; return a process exit code.

    ``stdout``/``stderr`` are injectable for testing; default to
    ``sys.stdout``/``sys.stderr`` when not provided.
    """
    out = stdout if stdout is not None else sys.stdout
    err = stderr if stderr is not None else sys.stderr

    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        repo = resolve_repository(args.repo_path)
        resolve_range(repo, args.range)
        raw_commits = fetch_commits(repo, args.range)
        parsed_commits = [parse_commit(c) for c in raw_commits]
        sections = build_sections(parsed_commits)
        markdown = render_markdown(sections)
        write_output(markdown, args.output, stdout=out)
    except ChangelogError as exc:
        err.write(f"error: {exc}\n")
        return EXIT_FAILURE

    return EXIT_OK


def main() -> None:
    sys.exit(run(sys.argv[1:]))


if __name__ == "__main__":
    main()
