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
word boundaries, lowercase, drop stopwords, intersect. This is O(n) and has
no dependencies beyond stdlib. Callers who need semantic ranking should
implement a separate retrieval layer on top.

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

# Minimum token length to consider (avoids noise from 1-2 char fragments).
_MIN_TOKEN_LEN = 3


def _tokenise(text: str) -> frozenset[str]:
    """Return lower-cased word tokens from text, minus stopwords."""
    raw = re.findall(r"[A-Za-z][a-z0-9]*", text.lower())
    return frozenset(t for t in raw if len(t) >= _MIN_TOKEN_LEN and t not in _STOPWORDS)


def filter_map(repo_map: str, task: str) -> str:
    """Return a filtered repo map keeping only entries relevant to the task.

    Each "entry" is the block of lines for a single file — the filename line
    plus all indented symbol lines that follow it. An entry is kept if its
    filename or any of its symbol names shares at least one non-stopword token
    with the task description.

    If no entry matches, the original map is returned unchanged so the agent
    always receives some orientation (an empty map is worse than a full one).

    Args:
        repo_map: raw output of build_repo_map() — one file block per file.
        task: the task description to match against.
    """
    task_tokens = _tokenise(task)
    if not task_tokens:
        return repo_map

    lines = repo_map.splitlines(keepends=True)
    kept: list[str] = []
    current_block: list[str] = []
    current_relevant = False

    def _flush() -> None:
        if current_relevant and current_block:
            kept.extend(current_block)

    for line in lines:
        if line and not line[0].isspace():
            # New file header — flush the previous block first.
            _flush()
            current_block = [line]
            current_relevant = bool(_tokenise(line) & task_tokens)
        else:
            current_block.append(line)
            if not current_relevant and line.strip():
                current_relevant = bool(_tokenise(line) & task_tokens)

    _flush()

    if not kept:
        return repo_map

    return "".join(kept)
