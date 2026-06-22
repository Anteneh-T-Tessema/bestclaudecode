"""Read-only knowledge-base access (SDD Section 5: "Knowledge base").

Per C-1, this system consumes an *existing* knowledge base read-only and
never writes back to it (NFR-8). Local-equivalent infrastructure note: in
place of a real external KB system/API, this is a simple in-memory/JSON-
file-backed article store -- read-only from every other module's
perspective (no module outside this one ever calls a write method on it),
which is the property the SDD actually requires; the storage technology
behind that read-only boundary is an implementation detail.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class KBArticle:
    """One knowledge-base article: an id, title, and body text."""

    id: str
    title: str
    body: str

    @property
    def text(self) -> str:
        return f"{self.title}\n{self.body}"


class KnowledgeBase:
    """In-memory KB article store, optionally seeded from a JSON file.

    No method here mutates an article once loaded -- intentionally, since
    "building or modifying KB content-management tooling is out of scope"
    (PRD Section 5) and the SDD treats this system's relationship to the
    KB as read-only (NFR-8).
    """

    def __init__(self, articles: list[KBArticle] | None = None) -> None:
        self._articles: dict[str, KBArticle] = {a.id: a for a in (articles or [])}

    @classmethod
    def from_json_file(cls, path: str | Path) -> "KnowledgeBase":
        """Load articles from a JSON file: a list of {id, title, body} objects."""
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        articles = [KBArticle(id=item["id"], title=item["title"], body=item["body"]) for item in data]
        return cls(articles)

    def get(self, article_id: str) -> KBArticle | None:
        return self._articles.get(article_id)

    def all(self) -> list[KBArticle]:
        return list(self._articles.values())

    def __len__(self) -> int:
        return len(self._articles)
