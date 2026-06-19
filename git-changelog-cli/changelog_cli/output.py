"""Output writer.

Writes rendered Markdown to stdout by default, or to a single file path if
one was supplied -- exactly one destination ever receives the content,
never both (FR-19). I/O failures are surfaced as a handled OutputError, not
an unhandled exception (NFR-8).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import TextIO

from changelog_cli.errors import OutputError


def write_output(
    content: str,
    destination: str | None,
    stdout: TextIO | None = None,
) -> None:
    """Write ``content`` to ``destination`` (a file path) or to stdout.

    If ``destination`` is None, writes to ``stdout`` (defaulting to
    ``sys.stdout``). If a destination path is given, stdout is left
    untouched.
    """
    if destination is None:
        target = stdout if stdout is not None else sys.stdout
        target.write(content)
        return

    try:
        Path(destination).write_text(content, encoding="utf-8")
    except OSError as exc:
        raise OutputError(f"failed to write output file '{destination}': {exc}") from exc
