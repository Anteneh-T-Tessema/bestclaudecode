"""TF-IDF semantic search index over repo map symbols.

Provides a zero-dependency (pure stdlib) semantic search layer on top of the
token-matching filter in symbol_filter.py. Where token matching requires an
exact stem intersection, TF-IDF ranks by term frequency weighted by how rare
each term is across all documents — so a query like "context injection prompt"
can surface "format_context" even when none of those words appear verbatim in
the symbol name.

Architecture
------------
Each *document* is one symbol line from the repo map (e.g.
"  def get_cached_context() -- line 63"). The corpus is built lazily and held
in a TFIDFIndex object. At search time the query is tokenised the same way as
symbol_filter._tokenise (shared stemmer, same stopwords) so stems match
across the two layers.

Integration
-----------
filter_map() in symbol_filter.py calls semantic_fallback() when its own
token-intersection returns nothing, so the agent always receives *something*
relevant rather than the full unfiltered map. Callers who want to bypass
token matching entirely can call TFIDFIndex.search() directly.

Standalone CLI
--------------
    python -m src.embedding_index [query] [repo-root]

Returns the top-5 ranked symbol lines for the query.
"""
from __future__ import annotations

import math
import sys
from collections import Counter
from pathlib import Path
from typing import NamedTuple

from src.symbol_filter import _tokenise


class _Doc(NamedTuple):
    text: str       # original symbol line
    file: str       # file header this symbol belongs to
    tf: dict[str, float]


class TFIDFIndex:
    """In-memory TF-IDF index over repo map symbol lines.

    Build with TFIDFIndex.from_repo_map(repo_map_string), then call
    .search(query, top_k) to get ranked (score, file, text) triples.
    """

    def __init__(self, docs: list[_Doc], idf: dict[str, float]) -> None:
        self._docs = docs
        self._idf = idf

    @classmethod
    def from_repo_map(cls, repo_map: str) -> "TFIDFIndex":
        """Parse a repo map string into a searchable TF-IDF index.

        File header lines (no leading whitespace) are tracked so every symbol
        line can be annotated with its source file. Only non-empty symbol lines
        (indented lines) are indexed as documents; file headers are not indexed
        themselves — the search result already carries the file name.
        """
        docs: list[_Doc] = []
        current_file = ""
        for line in repo_map.splitlines():
            if not line:
                continue
            if not line[0].isspace():
                current_file = line.rstrip()
            else:
                tokens = _tokenise(line)
                if not tokens:
                    continue
                total = len(tokens)
                tf = {t: 1.0 / total for t in tokens}  # uniform TF within symbol line
                docs.append(_Doc(text=line, file=current_file, tf=tf))

        # IDF: log((N+1) / (df+1)) + 1  — smoothed to avoid zero division.
        n = len(docs)
        df: Counter[str] = Counter()
        for doc in docs:
            df.update(doc.tf.keys())
        idf = {term: math.log((n + 1) / (count + 1)) + 1.0 for term, count in df.items()}

        return cls(docs, idf)

    def search(self, query: str, top_k: int = 5) -> list[tuple[float, str, str]]:
        """Return up to top_k (score, file, symbol_line) triples, highest score first.

        Returns an empty list if the index has no documents or the query
        produces no stems after stopword removal.
        """
        q_tokens = _tokenise(query)
        if not q_tokens or not self._docs:
            return []

        scores: list[tuple[float, str, str]] = []
        for doc in self._docs:
            score = sum(
                doc.tf.get(t, 0.0) * self._idf.get(t, 0.0)
                for t in q_tokens
            )
            if score > 0:
                scores.append((score, doc.file, doc.text))

        scores.sort(key=lambda x: x[0], reverse=True)
        return scores[:top_k]

    def __len__(self) -> int:
        return len(self._docs)


def semantic_fallback(repo_map: str, task: str, top_k: int = 10) -> str:
    """Return a filtered repo map using TF-IDF when token matching yields nothing.

    Builds a TFIDFIndex from repo_map, runs a search for task, then
    reconstructs a minimal repo map string containing only the top-ranked
    symbol lines (grouped under their file headers). If the index is empty
    or the search finds nothing, returns the original repo_map unchanged.

    This is the semantic complement to filter_map(): call it as a fallback
    when filter_map returns the full map (i.e. when token intersection failed).
    """
    index = TFIDFIndex.from_repo_map(repo_map)
    results = index.search(task, top_k=top_k)
    if not results:
        return repo_map

    # Group results by file, preserving score-rank order of files.
    seen_files: list[str] = []
    by_file: dict[str, list[str]] = {}
    for _score, file, line in results:
        if file not in by_file:
            seen_files.append(file)
            by_file[file] = []
        by_file[file].append(line)

    parts: list[str] = []
    for file in seen_files:
        parts.append(file)
        parts.extend(by_file[file])
        parts.append("")
    return "\n".join(parts).rstrip() + "\n"


def main() -> None:
    """CLI: python -m src.embedding_index [query] [repo-root]

    Prints the top-5 ranked symbol lines for the query against a live repo map.
    Defaults to the current directory and an empty query (prints index size).
    """
    from src.repo_map import build_repo_map

    args = sys.argv[1:]
    query = args[0] if args else ""
    root = Path(args[1]) if len(args) > 1 else Path(".")

    repo_map = build_repo_map(root)
    index = TFIDFIndex.from_repo_map(repo_map)
    print(f"Index: {len(index)} symbol documents")

    if not query:
        return

    results = index.search(query, top_k=5)
    if not results:
        print("No results.")
        return
    for score, file, line in results:
        print(f"  [{score:.4f}] {file.strip()} → {line.strip()}")


if __name__ == "__main__":
    main()
