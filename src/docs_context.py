"""Package documentation context fetcher for @docs context injection.

Looks up a package name against the PyPI JSON API (Python packages) and the
npm registry (JavaScript packages) and returns structured metadata that the
chat frontend injects as context before the user's message.

CLI
---
    python -m src.docs_context <package-name> [--json]

Without --json: human-readable summary.
With --json:    JSON object {name, version, summary, description, source, url}.

The IPC handler in search.handlers.ts calls with --json so it gets structured
data back via runPythonJson.

Design
------
PyPI is tried first (Python ecosystem is more common in this repo). If PyPI
returns a 404, the npm registry is tried as a fallback. Callers may also
pass --npm or --pypi to force a specific registry.

Both APIs are public and require no authentication.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.parse
import urllib.request

_TIMEOUT = 8
_UA = "Meshflow/1.0 (docs context)"


# ── Fetchers ──────────────────────────────────────────────────────────────────

def fetch_pypi_docs(package: str) -> dict | None:
    """Fetch package metadata from PyPI JSON API.

    Returns a dict {name, version, summary, description, source, url} or None
    if the package is not found.
    """
    url = f"https://pypi.org/pypi/{urllib.parse.quote(package)}/json"
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        return None
    except Exception:
        return None

    info = data.get("info", {})
    return {
        "name": info.get("name", package),
        "version": info.get("version", ""),
        "summary": info.get("summary", ""),
        "description": (info.get("description", "") or "")[:2000],
        "source": "pypi",
        "url": info.get("package_url", f"https://pypi.org/project/{package}/"),
    }


def fetch_npm_docs(package: str) -> dict | None:
    """Fetch package metadata from the npm registry.

    Returns a dict {name, version, summary, description, source, url} or None
    if the package is not found.
    """
    url = f"https://registry.npmjs.org/{urllib.parse.quote(package)}"
    req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        return None
    except Exception:
        return None

    latest_version = data.get("dist-tags", {}).get("latest", "")
    version_data = data.get("versions", {}).get(latest_version, {})
    description = version_data.get("readme", data.get("readme", ""))[:2000]
    return {
        "name": data.get("name", package),
        "version": latest_version,
        "summary": data.get("description", ""),
        "description": description,
        "source": "npm",
        "url": f"https://www.npmjs.com/package/{package}",
    }


# ── Public entry point ────────────────────────────────────────────────────────

def fetch_docs(package: str, *, prefer: str = "auto") -> dict | None:
    """Fetch documentation metadata for a package name.

    Tries PyPI first (or npm first if prefer='npm'), falls back to the other
    registry. Returns None if neither registry has the package.

    Args:
        package: the package name (e.g. 'requests', 'react', 'numpy').
        prefer: 'auto' | 'pypi' | 'npm'. 'auto' tries PyPI first.
    """
    if prefer == "npm":
        return fetch_npm_docs(package) or fetch_pypi_docs(package)
    result = fetch_pypi_docs(package)
    if result is not None:
        return result
    return fetch_npm_docs(package)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main() -> None:
    """CLI: python -m src.docs_context <package> [--json] [--pypi | --npm]"""
    args = list(sys.argv[1:])
    as_json = "--json" in args
    if as_json:
        args.remove("--json")

    prefer = "auto"
    if "--pypi" in args:
        args.remove("--pypi")
        prefer = "pypi"
    elif "--npm" in args:
        args.remove("--npm")
        prefer = "npm"

    package = " ".join(args).strip()
    if not package:
        print("Usage: python -m src.docs_context <package> [--json]", file=sys.stderr)
        sys.exit(1)

    result = fetch_docs(package, prefer=prefer)
    if result is None:
        if as_json:
            print("null")
        else:
            print(f"No documentation found for: {package}", file=sys.stderr)
        sys.exit(0)

    if as_json:
        print(json.dumps(result))
    else:
        print(f"[{result['source']}] {result['name']} {result['version']}")
        print(f"  {result['summary']}")
        print(f"  {result['url']}")


if __name__ == "__main__":
    main()
