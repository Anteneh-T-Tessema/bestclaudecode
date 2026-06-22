"""Cross-session agent memory — persistent knowledge that survives restarts.

Devin's primary moat is that it accumulates codebase knowledge across sessions:
after working on the auth module three times, it remembers that "adding a field
requires a migration" without being told. This module provides the same
capability as an explicit, auditable, user-readable store.

Design
------
Each memory entry is a JSON file under ``.agent-memory/``:

    .agent-memory/<key>.json

The key is a filesystem-safe slug (e.g. ``src-auth-module``, ``retry-pattern``).
Each file contains:

    {
      "key": "src-auth-module",
      "content": "Adding a field to User always requires a migration ...",
      "tags": ["auth", "migration", "database"],
      "created_at": "2026-06-19T12:00:00Z",
      "updated_at": "2026-06-19T14:30:00Z",
      "source_task": "add email field to User model"
    }

Why JSON not Markdown
---------------------
Decision log entries are Markdown for human readability. Memory entries are
JSON because they are queried programmatically (tag filtering, BM25 search)
and written by agents — structured data is easier to parse reliably than
Markdown in both cases.

The content field itself is plain text / Markdown so it renders nicely when
a developer opens the file in a viewer.

Query model
-----------
``MemoryStore.query(text)`` scores entries against the query using BM25 on the
content+tags+key fields. This gives the agent the *most relevant* past
learnings rather than a flat dump of everything.

Automatic population
--------------------
``auto_record_from_decision(task, outcome, findings, docs_dir)`` is called at
the end of each ``log_decision()`` cycle and writes one memory entry per
distinct file mentioned in the findings list. This means the store fills up
naturally without any extra agent work.

CLI
---
    python -m src.agent_memory --list [dir] [--json]
    python -m src.agent_memory --query <text> [dir] [--json]
    python -m src.agent_memory --write <key> <content> [dir] [--json]
"""
from __future__ import annotations

import json
import math
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_MEMORY_DIR = Path(".agent-memory")
_DATE_FMT = "%Y-%m-%dT%H:%M:%SZ"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class MemoryEntry:
    """One persisted agent memory."""

    def __init__(
        self,
        key: str,
        content: str,
        tags: list[str],
        created_at: str,
        updated_at: str,
        source_task: str = "",
    ) -> None:
        self.key = key
        self.content = content
        self.tags = tags
        self.created_at = created_at
        self.updated_at = updated_at
        self.source_task = source_task

    def to_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "content": self.content,
            "tags": self.tags,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "source_task": self.source_task,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MemoryEntry":
        return cls(
            key=d["key"],
            content=d["content"],
            tags=d.get("tags", []),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
            source_task=d.get("source_task", ""),
        )

    def __repr__(self) -> str:
        return f"MemoryEntry(key={self.key!r})"


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class MemoryStore:
    """Read/write agent memory entries from a directory of JSON files.

    Args:
        memory_dir: directory to store ``.json`` files. Created if missing.
    """

    def __init__(self, memory_dir: Path | None = None) -> None:
        self._dir = memory_dir or _MEMORY_DIR

    def _path(self, key: str) -> Path:
        return self._dir / f"{_slugify(key)}.json"

    # ------------------------------------------------------------------
    # Write
    # ------------------------------------------------------------------

    def write(
        self,
        key: str,
        content: str,
        *,
        tags: list[str] | None = None,
        source_task: str = "",
    ) -> Path:
        """Write or update a memory entry. Returns the file path."""
        self._dir.mkdir(parents=True, exist_ok=True)
        path = self._path(key)
        now = _utcnow()

        if path.exists():
            existing = MemoryEntry.from_dict(json.loads(path.read_text(encoding="utf-8")))
            entry = MemoryEntry(
                key=_slugify(key),
                content=content,
                tags=tags if tags is not None else existing.tags,
                created_at=existing.created_at,
                updated_at=now,
                source_task=source_task or existing.source_task,
            )
        else:
            entry = MemoryEntry(
                key=_slugify(key),
                content=content,
                tags=tags or [],
                created_at=now,
                updated_at=now,
                source_task=source_task,
            )

        path.write_text(
            json.dumps(entry.to_dict(), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        return path

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    def list_all(self) -> list[MemoryEntry]:
        """Return all memory entries, newest-updated first."""
        if not self._dir.exists():
            return []
        entries: list[MemoryEntry] = []
        for p in sorted(self._dir.glob("*.json")):
            try:
                entries.append(MemoryEntry.from_dict(json.loads(p.read_text(encoding="utf-8"))))
            except (json.JSONDecodeError, KeyError):
                continue
        entries.sort(key=lambda e: e.updated_at, reverse=True)
        return entries

    def get(self, key: str) -> MemoryEntry | None:
        """Return a single entry by key, or None if not found."""
        path = self._path(key)
        if not path.exists():
            return None
        try:
            return MemoryEntry.from_dict(json.loads(path.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, KeyError):
            return None

    def delete(self, key: str) -> bool:
        """Delete a memory entry. Returns True if it existed."""
        path = self._path(key)
        if path.exists():
            path.unlink()
            return True
        return False

    # ------------------------------------------------------------------
    # BM25 query
    # ------------------------------------------------------------------

    def query(self, text: str, top_k: int = 5) -> list[MemoryEntry]:
        """Return up to top_k entries most relevant to text, using BM25.

        Indexes key + content + space-joined tags as the document corpus.
        Returns all entries (sorted by recency) if text produces no stems.
        """
        entries = self.list_all()
        if not entries:
            return []

        tokens = _tokenise(text)
        if not tokens:
            return entries[:top_k]

        # Build corpus: one doc per entry = key + content + tags
        docs: list[tuple[MemoryEntry, list[str]]] = []
        for e in entries:
            doc_tokens = _tokenise(f"{e.key} {e.content} {' '.join(e.tags)}")
            docs.append((e, doc_tokens))

        avg_dl = sum(len(d) for _, d in docs) / len(docs)
        df: Counter[str] = Counter()
        for _, dtokens in docs:
            df.update(set(dtokens))

        scores: list[tuple[float, MemoryEntry]] = []
        n = len(docs)
        k1, b = 1.5, 0.75
        for entry, dtokens in docs:
            tf = Counter(dtokens)
            dl = len(dtokens)
            norm = k1 * (1 - b + b * dl / avg_dl) if avg_dl else 1.0
            score = 0.0
            for term in tokens:
                f = tf.get(term, 0)
                if f == 0:
                    continue
                idf = math.log((n - df.get(term, 0) + 0.5) / (df.get(term, 0) + 0.5) + 1.0)
                score += idf * (f * (k1 + 1)) / (f + norm)
            if score > 0:
                scores.append((score, entry))

        if not scores:
            return entries[:top_k]

        scores.sort(key=lambda x: x[0], reverse=True)
        return [e for _, e in scores[:top_k]]

    # ------------------------------------------------------------------
    # Context block for prompt injection
    # ------------------------------------------------------------------

    def format_memory_block(self, entries: list[MemoryEntry]) -> str:
        """Return a Markdown block suitable for injecting into an agent prompt."""
        if not entries:
            return ""
        parts: list[str] = ["## Agent memory (past learnings)\n"]
        for e in entries:
            tag_str = f" [{', '.join(e.tags)}]" if e.tags else ""
            parts.append(f"**{e.key}**{tag_str}")
            parts.append(e.content.strip())
            parts.append("")
        return "\n".join(parts)


# ---------------------------------------------------------------------------
# Auto-population from decision log
# ---------------------------------------------------------------------------

def auto_record_from_decision(
    task: str,
    outcome: str,
    findings: list[str] | None = None,
    *,
    memory_dir: Path | None = None,
) -> list[Path]:
    """Write memory entries derived from a completed implement cycle.

    Extracts file paths mentioned in findings and writes one entry per unique
    file, recording the outcome and any reviewer notes. Also writes a
    task-level summary entry.

    Returns the list of paths written.
    """
    store = MemoryStore(memory_dir)
    written: list[Path] = []

    # Task-level summary
    summary_key = f"task:{_slugify(task, max_len=50)}"
    written.append(store.write(
        summary_key,
        f"Outcome: {outcome}",
        tags=["task-summary"],
        source_task=task,
    ))

    # Per-file entries from findings
    for finding in (findings or []):
        file_match = re.search(r"(src/[\w/._-]+\.py)", finding)
        if file_match:
            file_key = file_match.group(1).replace("/", "-").replace(".", "-")
            written.append(store.write(
                f"file:{file_key}",
                finding.strip(),
                tags=["reviewer-finding", "auto"],
                source_task=task,
            ))

    return written


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _slugify(text: str, max_len: int = 60) -> str:
    s = text.lower()
    s = re.sub(r"[^a-z0-9:_.-]", "-", s)  # / → - so keys are single-level filenames
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:max_len]


def _utcnow() -> str:
    return datetime.now(tz=timezone.utc).strftime(_DATE_FMT)


def _tokenise(text: str) -> list[str]:
    """Simple whitespace+punctuation tokeniser, no external deps."""
    tokens = re.findall(r"[a-z]+", text.lower())
    stopwords = {"the", "a", "an", "in", "of", "to", "and", "or", "for", "is", "it"}
    return [t for t in tokens if t not in stopwords and len(t) > 1]


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    """CLI: python -m src.agent_memory [--list|--query <text>|--write <key> <content>] [dir] [--json]"""
    args = sys.argv[1:]
    json_out = "--json" in args
    args = [a for a in args if a != "--json"]

    memory_dir: Path | None = None
    if args and not args[-1].startswith("--") and Path(args[-1]).suffix == "":
        maybe_dir = Path(args[-1])
        if maybe_dir.is_dir() or not args[-1].startswith("-"):
            memory_dir = maybe_dir
            args = args[:-1]

    store = MemoryStore(memory_dir)

    if "--list" in args:
        entries = store.list_all()
        if json_out:
            print(json.dumps([e.to_dict() for e in entries]))
            return
        if not entries:
            print("(no memories)")
            return
        for e in entries:
            print(f"  [{e.updated_at}] {e.key}")
            print(f"    {e.content[:80]}")
        return

    if "--query" in args:
        idx = args.index("--query")
        query = " ".join(args[idx + 1:])
        entries = store.query(query)
        if json_out:
            print(json.dumps([e.to_dict() for e in entries]))
            return
        if not entries:
            print("(no matching memories)")
            return
        print(store.format_memory_block(entries))
        return

    if "--write" in args:
        idx = args.index("--write")
        key = args[idx + 1] if idx + 1 < len(args) else ""
        content = " ".join(args[idx + 2:]) if idx + 2 < len(args) else ""
        if not key or not content:
            print("Usage: --write <key> <content>", file=sys.stderr)
            sys.exit(1)
        path = store.write(key, content)
        if json_out:
            print(json.dumps({"path": str(path)}))
            return
        print(f"Written: {path}")
        return

    print("Usage: python -m src.agent_memory [--list|--query <text>|--write <key> <content>] [--json]")


if __name__ == "__main__":
    main()
