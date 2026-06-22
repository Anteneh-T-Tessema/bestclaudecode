"""Live web search results fetcher for @web context injection.

Provides a minimal, zero-extra-dependency web search backed by DuckDuckGo HTML
(keyless, scrapes the lite endpoint) with an optional Brave Search API layer
when a key is available.

CLI
---
    python -m src.web_fetcher <query> [--json] [--brave-key KEY]

Without --json: human-readable list of results.
With --json:    JSON array [{title, url, snippet}, ...] on stdout, for IPC.

The IPC handler in search.handlers.ts calls with --json and optionally passes
the Brave API key stored in settings so the user can opt into richer results.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser

_UA = "Mozilla/5.0 (compatible; Lakoora/1.0; +https://lakoora.dev)"
_MAX_RESULTS = 5
_TIMEOUT = 8


# ── DuckDuckGo lite scraper ──────────────────────────────────────────────────

class _DDGParser(HTMLParser):
    """Extract (title, url, snippet) triples from DuckDuckGo lite HTML."""

    def __init__(self) -> None:
        super().__init__()
        self.results: list[dict[str, str]] = []
        self._in_result = False
        self._in_link = False
        self._in_snip = False
        self._cur: dict[str, str] = {}
        self._depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        cls = attr.get("class", "") or ""
        if tag == "div" and "results_links_deep" in cls:
            self._in_result = True
            self._cur = {}
            return
        if self._in_result:
            if tag == "a" and "result-link" in cls:
                self._in_link = True
                href = attr.get("href", "")
                if href and not href.startswith("//duckduckgo"):
                    self._cur["url"] = href
            if tag == "td" and "result-snippet" in cls:
                self._in_snip = True
                self._cur.setdefault("snippet", "")

    def handle_endtag(self, tag: str) -> None:
        if tag == "a":
            self._in_link = False
        if tag == "td" and self._in_snip:
            self._in_snip = False
        if tag == "div" and self._in_result:
            if self._cur.get("title") and self._cur.get("url"):
                self.results.append({
                    "title": self._cur.get("title", "").strip(),
                    "url": self._cur.get("url", ""),
                    "snippet": self._cur.get("snippet", "").strip(),
                })
            self._in_result = False

    def handle_data(self, data: str) -> None:
        if self._in_link and "title" not in self._cur:
            self._cur["title"] = data
        elif self._in_snip:
            self._cur["snippet"] = self._cur.get("snippet", "") + data


def _fetch_duckduckgo(query: str) -> list[dict[str, str]]:
    """Scrape DuckDuckGo lite for query, return [{title, url, snippet}]."""
    url = "https://lite.duckduckgo.com/lite/?q=" + urllib.parse.quote_plus(query)
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return []

    parser = _DDGParser()
    parser.feed(html)
    return parser.results[:_MAX_RESULTS]


# ── Brave Search API ──────────────────────────────────────────────────────────

def _fetch_brave(query: str, api_key: str) -> list[dict[str, str]]:
    """Call Brave Search API, return [{title, url, snippet}]."""
    url = (
        "https://api.search.brave.com/res/v1/web/search?"
        + urllib.parse.urlencode({"q": query, "count": _MAX_RESULTS})
    )
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Subscription-Token": api_key},
    )
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read().decode())
    except Exception:
        return []

    results = []
    for hit in data.get("web", {}).get("results", [])[:_MAX_RESULTS]:
        results.append({
            "title": hit.get("title", ""),
            "url": hit.get("url", ""),
            "snippet": hit.get("description", ""),
        })
    return results


# ── Public entry point ────────────────────────────────────────────────────────

def fetch_web_results(query: str, *, brave_key: str = "") -> list[dict[str, str]]:
    """Return up to 5 search results for query as a list of dicts.

    Uses Brave Search if brave_key is non-empty, otherwise falls back to
    DuckDuckGo HTML scraping (no key required).

    Args:
        query: the search query.
        brave_key: optional Brave Search API key for higher-quality results.

    Returns:
        list of {title, url, snippet} dicts, empty on total failure.
    """
    key = brave_key or os.environ.get("BRAVE_API_KEY", "")
    if key:
        results = _fetch_brave(query, key)
        if results:
            return results
    return _fetch_duckduckgo(query)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    """CLI: python -m src.web_fetcher <query> [--json] [--brave-key KEY]"""
    args = list(sys.argv[1:])
    as_json = "--json" in args
    if as_json:
        args.remove("--json")

    brave_key = ""
    if "--brave-key" in args:
        idx = args.index("--brave-key")
        if idx + 1 < len(args):
            brave_key = args[idx + 1]
            args[idx : idx + 2] = []

    query = " ".join(args).strip()
    if not query:
        print("Usage: python -m src.web_fetcher <query> [--json]", file=sys.stderr)
        sys.exit(1)

    results = fetch_web_results(query, brave_key=brave_key)

    if as_json:
        print(json.dumps(results))
    else:
        if not results:
            print(f"No results for: {query}")
            return
        for r in results:
            print(f"[{r['title']}]\n{r['url']}\n{r['snippet']}\n")


if __name__ == "__main__":
    main()
