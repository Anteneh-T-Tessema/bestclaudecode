"""Multi-modal screenshot context injection for agent prompts.

Devin can look at screenshots — UI mockups, error dialogs, test failure
outputs rendered as images — and use them to inform implementation. This
module provides the same capability: encode an image as base64, call the
Claude vision API to get a text description, and inject that description as
a context block in the agent's prompt.

The vision call is injectable (``describer`` parameter) so tests work without
a real API key. The CLI falls back to a placeholder description when no API
key is found.

Output block format:

    ## Screenshot context: <filename>

    <description from vision model>

CLI
---
    python -m src.screenshot_context <image-path> [--model claude-haiku-4-5-20251001]

Requires ANTHROPIC_API_KEY in the environment for live calls.
"""
from __future__ import annotations

import base64
import mimetypes
import os
import sys
from pathlib import Path
from typing import Callable


# ---------------------------------------------------------------------------
# Core functions
# ---------------------------------------------------------------------------

def encode_image(path: Path) -> tuple[str, str]:
    """Return (base64_data, media_type) for the image at path.

    Supports JPEG, PNG, GIF, and WebP (the types Claude vision accepts).
    Raises ValueError for unsupported types; FileNotFoundError if missing.
    """
    if not path.exists():
        raise FileNotFoundError(f"Image not found: {path}")

    mime, _ = mimetypes.guess_type(str(path))
    supported = {"image/jpeg", "image/png", "image/gif", "image/webp"}
    if mime not in supported:
        raise ValueError(
            f"Unsupported image type {mime!r} for {path.name}. "
            f"Supported: jpeg, png, gif, webp."
        )

    data = base64.standard_b64encode(path.read_bytes()).decode("ascii")
    return data, mime or "image/png"


def describe_screenshot(
    path: Path,
    *,
    model: str = "claude-haiku-4-5-20251001",
    api_key: str = "",
    describer: Callable[[Path, str, str, str], str] | None = None,
) -> str:
    """Return a text description of the screenshot at path.

    Args:
        path: path to the image file.
        model: Claude model ID to use for vision.
        api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var).
        describer: injectable callable for testing. Signature:
            ``describer(path, b64_data, media_type, model) -> str``.
            When None the real Anthropic API is called.
    """
    b64, media_type = encode_image(path)

    if describer is not None:
        return describer(path, b64, media_type, model)

    return _call_anthropic(b64, media_type, model, api_key or os.environ.get("ANTHROPIC_API_KEY", ""))


def _call_anthropic(b64: str, media_type: str, model: str, api_key: str) -> str:
    """Call the Anthropic Messages API with a vision request."""
    if not api_key:
        return "(vision description unavailable: ANTHROPIC_API_KEY not set)"

    try:
        import urllib.request
        import json as _json

        payload = {
            "model": model,
            "max_tokens": 1024,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64,
                            },
                        },
                        {
                            "type": "text",
                            "text": (
                                "Analyze this screenshot for a software engineer who may want "
                                "to build or recreate it as code. Provide a structured description "
                                "covering:\n"
                                "1. Layout: overall structure (grid, flex, sidebar+main, etc.), "
                                "approximate proportions, spacing between elements.\n"
                                "2. Components: every visible UI element (buttons, inputs, cards, "
                                "tables, nav bars, modals, icons), their labels/text, and their "
                                "visual relationships.\n"
                                "3. Colors & typography: background color, primary/accent colors "
                                "(use hex if determinable), font sizes and weights, border styles.\n"
                                "4. State & content: visible data, error messages, loading states, "
                                "selected/active items, any test output or terminal content.\n"
                                "5. Interaction hints: which elements appear interactive (hover "
                                "states, focus rings, cursor changes).\n"
                                "Be specific and exhaustive — this description will be used to "
                                "generate matching component code."
                            ),
                        },
                    ],
                }
            ],
        }
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=_json.dumps(payload).encode(),
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = _json.loads(resp.read())
            return body["content"][0]["text"]
    except Exception as exc:  # noqa: BLE001
        return f"(vision call failed: {exc})"


def format_screenshot_block(description: str, filename: str) -> str:
    """Return a Markdown block suitable for context injection.

    Args:
        description: text description from the vision model.
        filename: the image filename (shown in the block header).
    """
    return f"## Screenshot context: {filename}\n\n{description.strip()}\n"


def parse_screenshot_flag(args: list[str]) -> tuple[Path | None, list[str]]:
    """Extract --screenshot <path> from args.

    Returns (image_path, remaining_args). Path is None if flag absent.
    """
    if "--screenshot" not in args:
        return None, list(args)

    idx = args.index("--screenshot")
    if idx + 1 >= len(args):
        return None, list(args)

    img_path = Path(args[idx + 1])
    remaining = args[:idx] + args[idx + 2:]
    return img_path, remaining


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    """CLI: python -m src.screenshot_context <image-path> [--model <model>]"""
    args = sys.argv[1:]
    model = "claude-haiku-4-5-20251001"

    if "--model" in args:
        idx = args.index("--model")
        model = args[idx + 1] if idx + 1 < len(args) else model
        args = [a for a in args if a != "--model" and a != model]

    if not args:
        print("Usage: python -m src.screenshot_context <image-path> [--model <id>]", file=sys.stderr)
        sys.exit(1)

    img = Path(args[0])
    try:
        description = describe_screenshot(img, model=model)
        print(format_screenshot_block(description, img.name))
    except (FileNotFoundError, ValueError) as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
