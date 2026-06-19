"""Typed error classes used across the pipeline.

Each error carries a human-readable message intended to be printed to
stderr as-is by the CLI layer. Keeping these as distinct exception types
(rather than bare ``Exception``/``RuntimeError``) lets each layer raise a
specific, catchable failure instead of letting an unhandled stack trace
become the sole output (NFR-8).
"""

from __future__ import annotations


class ChangelogError(Exception):
    """Base class for all expected/handled failures in the pipeline."""


class RepositoryError(ChangelogError):
    """The given path is not a valid local git repository (FR-4)."""


class RangeError(ChangelogError):
    """The given commit range does not resolve against the repository (FR-5)."""


class OutputError(ChangelogError):
    """Writing rendered output to the requested destination failed (NFR-8)."""
