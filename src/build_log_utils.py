"""Minimal example module used to verify the test-writing skill works
end-to-end. Per src/CLAUDE.md, public functions here require docstrings
and a corresponding test.
"""


def normalize_step_name(name: str) -> str:
    """Convert a build-log step name into its kebab-case file-slug form.

    E.g. "CLAUDE.md" -> "claude-md", "  Subagents  " -> "subagents".
    Raises ValueError if the result would be empty.
    """
    cleaned = name.strip().lower().replace(".", "-")
    slug = "-".join(part for part in cleaned.split() if part)
    slug = slug.strip("-")
    if not slug:
        raise ValueError("name produces an empty slug")
    return slug