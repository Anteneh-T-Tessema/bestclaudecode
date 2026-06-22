"""Semantic vector search over repo map symbols.

This is the Phase 1 ("codebase understanding") layer on top of the existing
lexical search stack (symbol_filter → bm25_index → embedding_index/TF-IDF):
those three are all token-overlap based and miss queries phrased with
different words than the code uses ("auth check" won't match
`verify_credentials` by tokens alone, but a real embedding model places them
close together in vector space).

Embedding backend
------------------
Two interchangeable backends, selected automatically:

  1. **Voyage Code-3** (https://docs.voyageai.com) when ``VOYAGE_API_KEY`` is
     set and reachable — purpose-built code-retrieval embeddings, the best
     publicly available option per the project's cost/quality research.
     Called via stdlib ``urllib`` (no new dependency), matching this
     package's existing pure-stdlib convention.

  2. **Local hashing-trick embedder** otherwise — a deterministic,
     dependency-free fallback (feature hashing: tokens hash into fixed
     vector buckets). This is NOT a trained model and does not capture real
     semantics the way Voyage Code-3 or a local model like Nomic Embed Code
     would — it exists so the rest of this module (indexing, hybrid search,
     CLI, JSON schema) is fully testable and usable with zero cost and zero
     network access. Swapping in a real local model later is a drop-in
     change to ``embed_texts()`` only; nothing else in this module needs to
     change since both backends implement the same signature.

AST-level chunking
-------------------
``VectorIndex.from_chunks()`` embeds each symbol's *entire* body
(src.repo_map.extract_chunks — real AST line ranges, not regex) rather than
just its one-line signature. A full function body carries far more semantic
signal than `"def evict_lru() -- line 31"` alone, so chunk-based indexing is
the higher-quality path; ``from_repo_map()`` (signature-line only) remains
for cheap/quick indexing and exact parity with bm25_index/embedding_index.

Hybrid search
-------------
``hybrid_search()`` runs bm25_index's BM25Index as a cheap lexical
pre-filter, then re-ranks that shortlist by vector cosine similarity. This
is the standard two-stage production RAG pattern: BM25 is fast and precise
for exact-term queries, vector search captures synonyms/intent but costs an
embedding call per document, so it only runs over BM25's shortlist rather
than the whole corpus. Falls back to a full vector search when BM25 finds
no lexical overlap at all (a purely semantic query with no shared terms).

Persistence
-----------
``build_persistent_index()`` / ``persistent_search()`` use
src.vector_store's Qdrant-backed storage (optional dependency — see
pyproject.toml's ``vector-store`` extra) so repeated searches don't re-embed
the whole repo on every call. Without qdrant-client installed, everything
else in this module still works — only these two functions raise ImportError
if called.

Beyond Cursor
-------------
``related_decisions()`` cross-references search hits against the decision
log (decision_analytics.py) — surfacing "this file was last touched in
decision X, verdict Y" alongside search results. Neither Cursor nor Devin
have an audit trail to draw this from.

CLI
---
    python -m src.vector_index <query> [repo-root] [--json] [--hybrid] [--chunks]
    python -m src.vector_index --build-index [repo-root] [--json]
    python -m src.vector_index <query> --persistent [--json]
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import NamedTuple

from src.symbol_filter import _tokenise

_VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings"
_VOYAGE_MODEL = "voyage-code-3"
_VOYAGE_TIMEOUT_S = 15
_HASH_DIMENSIONS = 256


class _Doc(NamedTuple):
    embed_text: str   # what gets embedded — a signature line or a full chunk body
    file: str
    display: str      # what search() returns — always a single descriptive line


# ---------------------------------------------------------------------------
# Embedding backends
# ---------------------------------------------------------------------------

def _voyage_embed(texts: list[str], api_key: str) -> list[list[float]]:
    """Call the Voyage Code-3 embeddings API for a batch of texts.

    Raises on any network/parse failure — callers fall back to the local
    embedder rather than handling errors here, so this stays a thin,
    honest wrapper around the API rather than a partial-failure handler.
    """
    payload = json.dumps({"input": texts, "model": _VOYAGE_MODEL}).encode("utf-8")
    request = urllib.request.Request(
        _VOYAGE_API_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=_VOYAGE_TIMEOUT_S) as response:
        body = json.loads(response.read().decode("utf-8"))
    return [item["embedding"] for item in body["data"]]


def _hash_embed(text: str, dimensions: int = _HASH_DIMENSIONS) -> list[float]:
    """Deterministic, dependency-free embedding via the hashing trick.

    Each stemmed token (symbol_filter._tokenise — same stemmer/stopwords as
    the rest of the lexical search stack) hashes into one of `dimensions`
    buckets with a deterministic +1/-1 sign, and the result is L2-normalised.
    This captures token presence/frequency, not real semantic relationships.
    """
    vector = [0.0] * dimensions
    tokens = _tokenise(text)
    if not tokens:
        return vector
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        bucket = int.from_bytes(digest[:4], "big") % dimensions
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[bucket] += sign
    norm = math.sqrt(sum(v * v for v in vector))
    if norm > 0:
        vector = [v / norm for v in vector]
    return vector


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts, Voyage Code-3 if available, local fallback otherwise.

    Returns an empty list for an empty input (no API call, no wasted work).
    """
    if not texts:
        return []
    api_key = os.environ.get("VOYAGE_API_KEY")
    if api_key:
        try:
            return _voyage_embed(texts, api_key)
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError, OSError):
            pass  # fall through to the local embedder
    return [_hash_embed(t) for t in texts]


def active_backend() -> str:
    """Return which embedding backend embed_texts() will use right now."""
    return "voyage-code-3" if os.environ.get("VOYAGE_API_KEY") else "local-hash"


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two equal-length vectors. 0.0 if either is zero."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

class VectorIndex:
    """Semantic search index over repo map symbols.

    Build with VectorIndex.from_repo_map(repo_map_string) for cheap
    signature-line embedding, or .from_chunks(chunks) for higher-quality
    full-body embedding (src.repo_map.extract_chunks). Search with
    .search(query, top_k) either way — mirrors BM25Index/TFIDFIndex's
    interface so callers (and the CLI) can treat all search layers uniformly.
    """

    def __init__(self, docs: list[_Doc], vectors: list[list[float]]) -> None:
        self._docs = docs
        self._vectors = vectors

    @classmethod
    def from_repo_map(cls, repo_map: str) -> "VectorIndex":
        """Parse a repo map string and embed every indented symbol line.

        File header lines (no leading whitespace) are tracked for
        annotation but not embedded themselves, matching bm25_index.py and
        embedding_index.py's parsing convention exactly.
        """
        docs: list[_Doc] = []
        current_file = ""
        for line in repo_map.splitlines():
            if not line:
                continue
            if not line[0].isspace():
                current_file = line.rstrip()
            else:
                if not _tokenise(line):
                    continue
                docs.append(_Doc(embed_text=line, file=current_file, display=line))

        vectors = embed_texts([d.embed_text for d in docs]) if docs else []
        return cls(docs, vectors)

    @classmethod
    def from_chunks(cls, chunks: list) -> "VectorIndex":
        """Build an index where each document is embedded from its FULL
        function/class/method body (src.repo_map.extract_chunks), not just
        a one-line signature — captures far more semantic meaning per
        document than from_repo_map(), at the cost of embedding more text.
        """
        docs = [
            _Doc(
                embed_text=chunk.source,
                file=chunk.file,
                display=f"{chunk.kind} {chunk.name}() -- line {chunk.start_line}",
            )
            for chunk in chunks
            if chunk.source
        ]
        vectors = embed_texts([d.embed_text for d in docs]) if docs else []
        return cls(docs, vectors)

    def search(self, query: str, top_k: int = 5) -> list[tuple[float, str, str]]:
        """Return up to top_k (score, file, display_line) triples, highest score first.

        Empty list when the index has no documents or the query embeds to
        an all-zero vector (e.g. empty string).
        """
        if not self._docs:
            return []
        query_vector = embed_texts([query])[0]
        if not any(query_vector):
            return []

        scored = [
            (_cosine(query_vector, vector), doc.file, doc.display)
            for doc, vector in zip(self._docs, self._vectors)
        ]
        scored = [s for s in scored if s[0] > 0]
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored[:top_k]

    def __len__(self) -> int:
        return len(self._docs)


def semantic_vector_search(repo_map: str, task: str, top_k: int = 10) -> str:
    """Return a repo map filtered to the top vector-ranked symbols for task.

    Same reconstruction pattern as bm25_search()/semantic_fallback(): groups
    results under their file headers and falls back to the original
    repo_map unchanged if the index or search produces nothing.
    """
    index = VectorIndex.from_repo_map(repo_map)
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


def hybrid_search(repo_map: str, query: str, top_k: int = 10, prefilter_k: int = 50) -> list[tuple[float, str, str]]:
    """BM25 lexical pre-filter, re-ranked by vector cosine similarity.

    Two-stage retrieval: BM25Index narrows the whole corpus down to
    `prefilter_k` lexically-relevant candidates (cheap), then only those
    candidates get embedded and re-ranked by semantic similarity (the
    expensive step). Falls back to a full vector search over the entire
    corpus when BM25 finds zero lexical overlap, so a purely semantic query
    phrased with no shared terms still returns results.
    """
    from src.bm25_index import BM25Index

    bm25 = BM25Index.from_repo_map(repo_map)
    candidates = bm25.search(query, top_k=prefilter_k)
    if not candidates:
        return VectorIndex.from_repo_map(repo_map).search(query, top_k=top_k)

    docs = [_Doc(embed_text=line, file=file, display=line) for _, file, line in candidates]
    vectors = embed_texts([d.embed_text for d in docs])
    query_vector = embed_texts([query])[0]
    if not any(query_vector):
        return []

    scored = [(_cosine(query_vector, vector), doc.file, doc.display) for doc, vector in zip(docs, vectors)]
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[:top_k]


# ---------------------------------------------------------------------------
# Persistence (src.vector_store — optional Qdrant dependency)
# ---------------------------------------------------------------------------

def build_persistent_index(root: Path, local_path: Path | None = None, use_chunks: bool = True) -> int:
    """Embed every chunk (or repo-map symbol line) under root and persist
    into a Qdrant-backed VectorStore. Returns the number of points indexed.

    Call this once (e.g. on file save, or periodically) — persistent_search()
    then reuses the stored vectors instead of re-embedding the whole corpus
    on every query. Requires the optional qdrant-client dependency (raises
    ImportError otherwise — see pyproject.toml's vector-store extra).
    """
    from src.vector_store import VectorStore

    if use_chunks:
        from src.repo_map import extract_chunks

        chunks = extract_chunks(root)
        entries = [
            (chunk.source, chunk.file, f"{chunk.kind} {chunk.name}() -- line {chunk.start_line}")
            for chunk in chunks
            if chunk.source
        ]
    else:
        from src.repo_map import build_repo_map

        repo_map = build_repo_map(root)
        entries = []
        current_file = ""
        for line in repo_map.splitlines():
            if not line:
                continue
            if not line[0].isspace():
                current_file = line.rstrip()
            elif _tokenise(line):
                entries.append((line, current_file, line))

    if not entries:
        return 0

    vectors = embed_texts([e[0] for e in entries])
    store = VectorStore.open(vector_size=len(vectors[0]), local_path=local_path)
    store.clear()
    points = [
        (i, vector, {"file": file, "display": display})
        for i, (vector, (_text, file, display)) in enumerate(zip(vectors, entries))
    ]
    store.upsert(points)
    return len(points)


def persistent_search(query: str, top_k: int = 5, local_path: Path | None = None) -> tuple[int, list[tuple[float, str, str]]]:
    """Search a previously-built persistent index (build_persistent_index()).

    Does NOT re-embed the corpus — only the query string is embedded.
    Returns (total points in the store, search results). Requires the
    optional qdrant-client dependency (raises ImportError otherwise).
    """
    from src.vector_store import VectorStore

    query_vector = embed_texts([query])[0]
    dimensions = len(query_vector) if query_vector else _HASH_DIMENSIONS
    store = VectorStore.open(vector_size=dimensions, local_path=local_path)
    doc_count = store.count()

    if not any(query_vector):
        return doc_count, []

    hits = store.search(query_vector, top_k=top_k)
    results = [(score, payload.get("file", ""), payload.get("display", "")) for score, payload in hits]
    return doc_count, results


# ---------------------------------------------------------------------------
# Decision log cross-reference (Phase 1's "beyond Cursor" differentiator)
# ---------------------------------------------------------------------------

def related_decisions(file_path: str, top_k: int = 3, docs_dir: Path | None = None) -> list[dict[str, object]]:
    """Return decision log entries that mention file_path, newest first.

    Matches against each ParsedDecision's task, outcome, and findings text
    (substring match on the file's basename, since findings often reference
    files by relative path with varying prefixes). Neither Cursor nor Devin
    expose anything equivalent — this lets search results say "this file
    was last touched in decision X, verdict Y."
    """
    from src.decision_analytics import load_decisions

    basename = Path(file_path).name
    matches: list[dict[str, object]] = []
    for decision in load_decisions(docs_dir):
        haystack = f"{decision.task} {decision.outcome} {' '.join(decision.findings)}"
        if basename in haystack or file_path in haystack:
            matches.append({
                "filename": decision.filename,
                "task": decision.task,
                "verdict": decision.verdict,
                "outcome": decision.outcome,
            })
        if len(matches) >= top_k:
            break
    return matches


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> None:
    """CLI: python -m src.vector_index <query> [repo-root] [--json] [--hybrid] [--chunks]
            python -m src.vector_index --build-index [repo-root] [--json]
            python -m src.vector_index <query> --persistent [--json]

    Without --json: prints the top-5 ranked symbol lines for the query.
    With --json: same schema as bm25_index/embedding_index --json, plus a
    "backend" field naming which embedder produced the results:
        {docCount, avgDl, results: [{score, file, line}], backend}
    --hybrid uses hybrid_search() (BM25 pre-filter + vector re-rank).
    --chunks embeds full function/class bodies (extract_chunks) instead of
    single signature lines.
    --build-index / --persistent use the Qdrant-backed persistent store
    (src.vector_store) instead of recomputing embeddings in memory.
    """
    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args
    if as_json:
        args.remove("--json")
    use_hybrid = "--hybrid" in args
    if use_hybrid:
        args.remove("--hybrid")
    use_chunks = "--chunks" in args
    if use_chunks:
        args.remove("--chunks")
    build_index = "--build-index" in args
    if build_index:
        args.remove("--build-index")
    use_persistent = "--persistent" in args
    if use_persistent:
        args.remove("--persistent")

    query = args[0] if args else ""
    root = Path(args[1]) if len(args) > 1 else Path(".")

    if build_index:
        # Persistent indexing always uses full chunk bodies (quality matters
        # more here since it's a one-time cost, not per-query) — --chunks is
        # only meaningful for the in-memory search path below.
        count = build_persistent_index(root, use_chunks=True)
        if as_json:
            print(json.dumps({"indexed": count, "backend": active_backend()}))
        else:
            print(f"Indexed {count} chunks into the persistent vector store (backend: {active_backend()}).")
        return

    if use_persistent:
        if not query:
            print("error: --persistent requires a query", file=sys.stderr)
            sys.exit(1)
        doc_count, results = persistent_search(query, top_k=10)
        if as_json:
            print(json.dumps({
                "docCount": doc_count,
                "avgDl": 0,
                "results": [
                    {"score": round(score, 6), "file": file.strip(), "line": line.strip()}
                    for score, file, line in results
                ],
                "backend": active_backend(),
            }))
            return
        print(f"Persistent vector index: {doc_count} stored points (backend: {active_backend()})")
        if not results:
            print("No results.")
            return
        for score, file, line in results:
            print(f"  [{score:.4f}] {file.strip()} → {line.strip()}")
        return

    from src.repo_map import build_repo_map, extract_chunks

    if use_chunks:
        index = VectorIndex.from_chunks(extract_chunks(root))
    else:
        repo_map = build_repo_map(root)
        index = VectorIndex.from_repo_map(repo_map)

    if not query:
        if as_json:
            print(json.dumps({"docCount": len(index), "avgDl": 0, "results": [], "backend": active_backend()}))
            return
        print(f"Vector index: {len(index)} symbol documents (backend: {active_backend()})")
        return

    if use_hybrid:
        repo_map = build_repo_map(root)
        results = hybrid_search(repo_map, query, top_k=10)
    else:
        results = index.search(query, top_k=10)

    if as_json:
        print(json.dumps({
            "docCount": len(index),
            "avgDl": 0,
            "results": [
                {"score": round(score, 6), "file": file.strip(), "line": line.strip()}
                for score, file, line in results
            ],
            "backend": active_backend(),
        }))
        return

    print(f"Vector index: {len(index)} symbol documents (backend: {active_backend()})")
    if not results:
        print("No results.")
        return
    for score, file, line in results:
        print(f"  [{score:.4f}] {file.strip()} → {line.strip()}")


if __name__ == "__main__":
    main()
