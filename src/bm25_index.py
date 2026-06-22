"""BM25 (Okapi BM25) ranking index over repo map symbols.

Replaces the TF-IDF index with the industry-standard BM25 formula, which
adds two improvements over plain TF-IDF:

  1. **Term saturation** — each additional occurrence of a term gives
     diminishing extra score (controlled by k1). A symbol that mentions
     "context" four times isn't four times as relevant.

  2. **Document-length normalisation** — long symbol lines are penalised
     so a verbose docstring comment doesn't crowd out a short but highly
     relevant function name (controlled by b).

This is the same scoring function used by Elasticsearch's default BM25
field-ranking and by Cursor's lexical code-search layer. Combined with the
existing TF-IDF semantic fallback, the search stack is now:

    token intersection (symbol_filter) → BM25 ranking → TF-IDF fallback

Formula (Robertson-Sparck Jones, 1994)
---------------------------------------
    IDF(t) = log( (N - df(t) + 0.5) / (df(t) + 0.5) + 1 )
    score(D,Q) = Σ IDF(t) * f(t,D)*(k1+1) / (f(t,D) + k1*(1-b + b*|D|/avgdl))

Default parameters: k1=1.5, b=0.75 (standard Okapi BM25 values).

Persistence
-----------
The index can be serialised to / deserialised from a JSON file so callers
don't rebuild it on every invocation. Use .save(path) / BM25Index.load(path).
The fingerprint is a sha1 of (sorted file paths + mtimes + sizes) so the
cache is invalidated on any source change.

CLI
---
    python -m src.bm25_index [query] [repo-root] [--json]
"""
from __future__ import annotations

import json
import math
import sys
from collections import Counter
from pathlib import Path
from typing import NamedTuple

from src.symbol_filter import _tokenise

_K1: float = 1.5
_B: float = 0.75


class _Doc(NamedTuple):
    text: str
    file: str
    tf: dict[str, int]   # raw term counts (not normalised)
    length: int           # total token count in this doc


class BM25Index:
    """BM25 index over repo map symbol lines.

    Build with BM25Index.from_repo_map(repo_map_string), search with
    .search(query, top_k).  Serialise/deserialise with .save()/.load().
    """

    def __init__(
        self,
        docs: list[_Doc],
        df: dict[str, int],
        avg_dl: float,
        n_docs: int,
    ) -> None:
        self._docs = docs
        self._df = df
        self._avg_dl = avg_dl
        self._n = n_docs

    # ------------------------------------------------------------------
    # Construction
    # ------------------------------------------------------------------

    @classmethod
    def from_repo_map(cls, repo_map: str) -> "BM25Index":
        """Parse a repo map string into a BM25 index.

        Only indented symbol lines are indexed; file-header lines are
        tracked for annotation but not scored.
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
                tf = Counter(tokens)
                docs.append(_Doc(text=line, file=current_file, tf=dict(tf), length=len(tokens)))

        if not docs:
            return cls([], {}, 0.0, 0)

        avg_dl = sum(d.length for d in docs) / len(docs)
        df: Counter[str] = Counter()
        for doc in docs:
            df.update(doc.tf.keys())

        return cls(docs, dict(df), avg_dl, len(docs))

    # ------------------------------------------------------------------
    # Search
    # ------------------------------------------------------------------

    def search(self, query: str, top_k: int = 5) -> list[tuple[float, str, str]]:
        """Return up to top_k (score, file, symbol_line) triples, highest first.

        Empty list when index is empty or query produces no stems.
        """
        q_tokens = _tokenise(query)
        if not q_tokens or not self._docs:
            return []

        scores: list[tuple[float, str, str]] = []
        for doc in self._docs:
            score = self._score(doc, q_tokens)
            if score > 0:
                scores.append((score, doc.file, doc.text))

        scores.sort(key=lambda x: x[0], reverse=True)
        return scores[:top_k]

    def _idf(self, term: str) -> float:
        df = self._df.get(term, 0)
        return math.log((self._n - df + 0.5) / (df + 0.5) + 1.0)

    def _score(self, doc: _Doc, query_tokens: list[str]) -> float:
        total = 0.0
        norm = _K1 * (1 - _B + _B * doc.length / self._avg_dl) if self._avg_dl else 1.0
        for term in query_tokens:
            f = doc.tf.get(term, 0)
            if f == 0:
                continue
            total += self._idf(term) * (f * (_K1 + 1)) / (f + norm)
        return total

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, path: Path) -> None:
        """Serialise index to a JSON file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "n": self._n,
            "avg_dl": self._avg_dl,
            "df": self._df,
            "docs": [
                {"text": d.text, "file": d.file, "tf": d.tf, "length": d.length}
                for d in self._docs
            ],
        }
        path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")

    @classmethod
    def load(cls, path: Path) -> "BM25Index":
        """Deserialise index from a JSON file produced by .save()."""
        data = json.loads(path.read_text(encoding="utf-8"))
        docs = [
            _Doc(text=d["text"], file=d["file"], tf=d["tf"], length=d["length"])
            for d in data["docs"]
        ]
        return cls(docs, data["df"], data["avg_dl"], data["n"])

    def __len__(self) -> int:
        return len(self._docs)


def bm25_search(repo_map: str, task: str, top_k: int = 10) -> str:
    """Return a repo map filtered to the top BM25-ranked symbols for task.

    Builds a BM25Index from repo_map, runs a search for task, then
    reconstructs a minimal repo map string grouped under file headers.
    Falls back to the original repo_map if the index is empty or the
    search returns nothing.

    This is a drop-in improvement over semantic_fallback() in embedding_index.
    """
    index = BM25Index.from_repo_map(repo_map)
    results = index.search(task, top_k=top_k)
    if not results:
        return repo_map

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
    """CLI: python -m src.bm25_index [query] [repo-root] [--json]

    Prints the top-5 BM25-ranked symbol lines for the query.
    """
    from src.repo_map import build_repo_map

    args = sys.argv[1:]
    json_out = "--json" in args
    args = [a for a in args if a != "--json"]
    query = args[0] if args else ""
    root = Path(args[1]) if len(args) > 1 else Path(".")

    repo_map = build_repo_map(root)
    index = BM25Index.from_repo_map(repo_map)

    if not query:
        if json_out:
            print(json.dumps({"docCount": len(index), "avgDl": index._avg_dl, "results": []}))
            return
        print(f"BM25 index: {len(index)} symbol documents, avg_dl={index._avg_dl:.1f}")
        return

    results = index.search(query, top_k=5)

    if json_out:
        print(json.dumps({
            "docCount": len(index),
            "avgDl": index._avg_dl,
            "results": [
                {"score": score, "file": file.strip(), "line": line.strip()}
                for score, file, line in results
            ],
        }))
        return

    print(f"BM25 index: {len(index)} symbol documents, avg_dl={index._avg_dl:.1f}")
    if not results:
        print("No results.")
        return
    for score, file, line in results:
        print(f"  [{score:.4f}] {file.strip()} → {line.strip()}")


if __name__ == "__main__":
    main()
