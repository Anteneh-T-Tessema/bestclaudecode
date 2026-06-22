"""Browser context tool — agent-controlled web browsing via Browser Use.

The autonomous agent emits ``<<<BROWSE url="..." task="...">>>`` blocks;
this module executes them using Browser Use
(https://github.com/browser-use/browser-use), which drives a headless
Chromium browser via Playwright with DOM + vision understanding.

Browser Use is an optional dependency. When not installed the module returns
a graceful error JSON rather than crashing, so the agent loop can continue.

CLI
---
    python -m src.browser_context --url <url> --task <task> [--json]
    python -m src.browser_context --search <query> [--json]

Output (--json)
---------------
    {"url": "...", "task": "...", "result": "...", "success": true}
    {"url": "...", "task": "...", "result": "<error text>", "success": false}
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any


def browse(url: str, task: str) -> dict[str, Any]:
    """Navigate to *url* and perform *task* using Browser Use.

    Returns a dict with keys: url, task, result (str), success (bool).
    Degrades gracefully when ``browser-use`` or ``playwright`` is absent.
    """
    try:
        import asyncio

        from browser_use import Agent as BrowserAgent  # type: ignore[import]
        from langchain_anthropic import ChatAnthropic  # type: ignore[import]

        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        llm = ChatAnthropic(model="claude-sonnet-4-6", api_key=api_key)
        agent = BrowserAgent(task=f"Visit {url}. {task}", llm=llm)
        result = asyncio.run(agent.run())
        return {"url": url, "task": task, "result": str(result), "success": True}
    except ImportError as exc:
        return {
            "url": url,
            "task": task,
            "result": f"browser-use not installed ({exc}). pip install browser-use playwright",
            "success": False,
        }
    except Exception as exc:
        return {"url": url, "task": task, "result": str(exc), "success": False}


def search(query: str) -> dict[str, Any]:
    """Search the web for *query* and return a summary via Browser Use."""
    url = f"https://www.google.com/search?q={query.replace(' ', '+')}"
    return browse(url, f"Search for '{query}' and summarise the top results.")


def main() -> None:
    """CLI entry point."""
    args = sys.argv[1:]
    json_out = "--json" in args
    args = [a for a in args if a != "--json"]

    if "--search" in args:
        idx = args.index("--search")
        query = " ".join(args[idx + 1 :])
        result = search(query)
        print(json.dumps(result) if json_out else result["result"])
        return

    if "--url" in args and "--task" in args:
        url_idx = args.index("--url")
        task_idx = args.index("--task")
        url = args[url_idx + 1] if url_idx + 1 < len(args) else ""
        # task may be multiple words — take everything after --task that isn't another flag
        task_parts: list[str] = []
        for part in args[task_idx + 1 :]:
            if part.startswith("--"):
                break
            task_parts.append(part)
        task = " ".join(task_parts)
        result = browse(url, task)
        print(json.dumps(result) if json_out else result["result"])
        return

    print(
        "Usage: python -m src.browser_context --url <url> --task <task> [--json]\n"
        "       python -m src.browser_context --search <query> [--json]"
    )


if __name__ == "__main__":
    main()
