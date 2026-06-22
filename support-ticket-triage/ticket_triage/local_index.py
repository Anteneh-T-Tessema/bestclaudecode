"""Local, zero-dependency vector index (SDD Section 5: "Vector index").

The SDD calls for embeddings over two logically separate partitions --
ticket history (FR-9) and knowledge-base articles (FR-12) -- and says the
vector index "does not need to be a separate deployed service if a
vector-capable extension of the primary datastore... meets the
retrieval-latency budget", preferring the simplest option that satisfies
the NFR over standing up a dedicated vector database.

Local-equivalent infrastructure note: this is a local study repo with no
real embedding-API budget or cloud vector DB, so semantic similarity is
approximated with a pure-stdlib TF-IDF index, following the prior art in
this repo's own ``src/embedding_index.py`` (same algorithm: per-document
term frequency, corpus-wide IDF, cosine-free dot-product ranking). This is
named ``local_index`` rather than ``embedding_index`` to avoid colliding
with the unrelated repo-map tool of the same name in ``src/``, and it is a
fresh implementation scoped to ticket/KB documents rather than a reused
import, since the data shape (ticket text vs. repo-map symbol lines) is
different enough to not share code cleanly.

Two ``TFIDFCorpus`` instances are kept distinct ("ticket history" and "KB
articles") rather than one shared index with a type filter, mirroring the
SDD's explicit "two logically separate partitions/collections" language.
"""
from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "is", "are", "was", "were", "be",
    "been", "to", "of", "in", "on", "for", "with", "this", "that", "it",
    "i", "you", "we", "my", "your", "our", "as", "at", "by", "from", "have",
    "has", "had", "do", "does", "did", "not", "can", "will", "would", "could",
}

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    """Lowercase, split on non-alphanumeric runs, drop stopwords."""
    tokens = _TOKEN_RE.findall(text.lower())
    return [t for t in tokens if t not in _STOPWORDS]


@dataclass
class _Doc:
    doc_id: str
    text: str
    tf: dict[str, float]


class TFIDFCorpus:
    """In-memory TF-IDF index over a set of (doc_id, text) documents.

    One instance represents one partition (e.g. ticket history, or KB
    articles) -- the partition boundary the SDD requires is just "use two
    separate ``TFIDFCorpus`` instances," not a column/filter on one index.
    """

    def __init__(self) -> None:
        self._docs: dict[str, _Doc] = {}
        self._idf: dict[str, float] = {}
        self._dirty = True

    def add(self, doc_id: str, text: str) -> None:
        """Add or replace a document. Index is rebuilt lazily on next search."""
        tokens = tokenize(text)
        total = len(tokens) or 1
        counts = Counter(tokens)
        tf = {term: count / total for term, count in counts.items()}
        self._docs[doc_id] = _Doc(doc_id=doc_id, text=text, tf=tf)
        self._dirty = True

    def remove(self, doc_id: str) -> None:
        self._docs.pop(doc_id, None)
        self._dirty = True

    def __len__(self) -> int:
        return len(self._docs)

    def _rebuild_idf(self) -> None:
        n = len(self._docs)
        df: Counter[str] = Counter()
        for doc in self._docs.values():
            df.update(doc.tf.keys())
        self._idf = {term: math.log((n + 1) / (count + 1)) + 1.0 for term, count in df.items()}
        self._dirty = False

    def search(self, query: str, top_k: int = 5) -> list[tuple[str, float]]:
        """Return up to top_k (doc_id, score) pairs, highest score first.

        Empty list if the corpus is empty or the query has no scorable
        tokens after stopword removal.
        """
        if self._dirty:
            self._rebuild_idf()

        q_tokens = tokenize(query)
        if not q_tokens or not self._docs:
            return []

        results: list[tuple[str, float]] = []
        for doc in self._docs.values():
            score = sum(doc.tf.get(t, 0.0) * self._idf.get(t, 0.0) for t in q_tokens)
            if score > 0:
                results.append((doc.doc_id, score))

        results.sort(key=lambda pair: pair[1], reverse=True)
        return results[:top_k]

    def get_text(self, doc_id: str) -> str | None:
        doc = self._docs.get(doc_id)
        return doc.text if doc else None


class VectorIndex:
    """Holds the two retrieval partitions the SDD describes (Section 5).

    ``tickets`` -- ticket-history partition, for similar-ticket retrieval
    (FR-9). ``kb`` -- knowledge-base partition, for KB retrieval (FR-12).
    Source-of-truth text is also kept here (``get_text``) as a stand-in for
    "fetch full content from the primary store or KB system at retrieval
    time" (SDD Section 5) -- in a real deployment the index would hold only
    embeddings + a reference id, and a separate fetch would resolve the
    full text from the primary datastore/KB system.
    """

    def __init__(self) -> None:
        self.tickets = TFIDFCorpus()
        self.kb = TFIDFCorpus()

    def index_ticket(self, ticket_id: str, text: str) -> None:
        self.tickets.add(ticket_id, text)

    def index_kb_article(self, article_id: str, text: str) -> None:
        self.kb.add(article_id, text)

    def search_tickets(self, query: str, top_k: int = 5, *, exclude_id: str | None = None) -> list[tuple[str, float]]:
        results = self.tickets.search(query, top_k=top_k + (1 if exclude_id else 0))
        if exclude_id is not None:
            results = [r for r in results if r[0] != exclude_id]
        return results[:top_k]

    def search_kb(self, query: str, top_k: int = 5) -> list[tuple[str, float]]:
        return self.kb.search(query, top_k=top_k)
