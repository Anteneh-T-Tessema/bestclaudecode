"""Task-aware symbol filtering for repo map orientation blocks.

Given a raw repo map (the multi-line string produced by build_repo_map) and a
task description, returns a filtered version that keeps only the file/symbol
entries whose names share at least one meaningful token with the task.

The goal is to reduce the orientation block size for targeted tasks, so the
agent receives a denser, more relevant context rather than a full symbol dump
of the entire codebase. On a 50-file repo the unfiltered map might be 300
lines; filtering it to the 5 files relevant to "add caching to context.py"
makes the injection more useful without losing anything the agent needs.

Token matching is intentionally simple (no embedding, no BM25): split on
word boundaries, lowercase, drop stopwords, stem, intersect. This is O(n)
and has no dependencies beyond stdlib. Callers who need semantic ranking
should implement a separate retrieval layer on top.

Used by format_context() when task_filter=True.
"""
from __future__ import annotations

import re

_STOPWORDS = frozenset(
    {
        "a", "an", "the", "to", "in", "of", "for", "on", "at", "by",
        "with", "and", "or", "is", "it", "be", "as", "do", "add", "fix",
        "use", "get", "set", "run", "new", "old", "all", "any", "some",
        "from", "into", "this", "that", "was", "are", "will", "can", "not",
        "make", "have", "its", "my", "we", "up", "out",
    }
)

# Minimum token length after stemming (avoids noise from residuals).
_MIN_TOKEN_LEN = 3

# Suffix strips applied in order — longest first to avoid partial matches.
# Each entry is (suffix_to_strip, minimum_stem_length_after_strip).
_SUFFIXES: list[tuple[str, int]] = [
    ("ations", 4),
    ("ation", 4),
    ("ings", 3),
    ("ing", 3),
    ("tion", 3),
    ("ers", 3),
    ("ies", 3),
    ("ed", 3),
    ("er", 3),
    ("es", 3),
    ("s",  3),
]


def _stem(token: str) -> str:
    """Return a stem by stripping the longest matching suffix.

    Only strips if the resulting stem is at least min_len characters so we
    don't collapse short words into noise ("be" → "b" is not useful).
    This is not a full Porter stemmer — it handles the common English
    inflectional suffixes that appear in identifier names.
    """
    for suffix, min_len in _SUFFIXES:
        if token.endswith(suffix) and len(token) - len(suffix) >= min_len:
            return token[: len(token) - len(suffix)]
    return token


def _tokenise(text: str) -> frozenset[str]:
    """Return stemmed, lower-cased word tokens from text, minus stopwords."""
    raw = re.findall(r"[A-Za-z][a-z0-9]*", text.lower())
    stems: set[str] = set()
    for t in raw:
        if len(t) < _MIN_TOKEN_LEN or t in _STOPWORDS:
            continue
        stemmed = _stem(t)
        if len(stemmed) >= _MIN_TOKEN_LEN:
            stems.add(stemmed)
    return frozenset(stems)


def filter_map(repo_map: str, task: str) -> str:
    """Return a filtered repo map keeping only symbol entries relevant to the task.

    Filtering is at the *symbol level*, not the file level: within each file
    block, only the symbol lines whose names share a token with the task are
    kept.  The file header is always included when at least one of its symbols
    matches.  If the filename itself matches, all symbols in that file are kept
    (the filename match signals the whole file is relevant).

    If nothing matches at all, the original map is returned unchanged so the
    agent always receives some orientation.

    Args:
        repo_map: raw output of build_repo_map() — one file block per file.
        task: the task description to match against.
    """
    task_tokens = _tokenise(task)
    if not task_tokens:
        return repo_map

    lines = repo_map.splitlines(keepends=True)

    # First pass: collect file blocks.
    blocks: list[tuple[str, list[str]]] = []  # (header_line, symbol_lines)
    current_header: str | None = None
    current_symbols: list[str] = []

    for line in lines:
        if line and not line[0].isspace():
            if current_header is not None:
                blocks.append((current_header, current_symbols))
            current_header = line
            current_symbols = []
        else:
            current_symbols.append(line)

    if current_header is not None:
        blocks.append((current_header, current_symbols))

    # Second pass: filter each block.
    kept: list[str] = []
    for header, symbols in blocks:
        header_match = bool(_tokenise(header) & task_tokens)
        if header_match:
            # Filename match → keep all symbols so the agent sees the full API.
            kept.append(header)
            kept.extend(symbols)
        else:
            # Symbol-level match → keep only matching symbol lines.
            matching = [s for s in symbols if s.strip() and bool(_tokenise(s) & task_tokens)]
            if matching:
                kept.append(header)
                kept.extend(matching)
                # Re-add any blank separator lines that follow the last match.
                if symbols and not symbols[-1].strip():
                    kept.append(symbols[-1])

    if not kept:
        return repo_map

    return "".join(kept)
