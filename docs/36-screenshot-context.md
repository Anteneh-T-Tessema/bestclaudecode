# Step 36 — Multi-modal screenshot context (closes Devin visual gap)

## What was built

**`src/screenshot_context.py`** — encode a screenshot and inject a vision
description into the agent's orientation block, matching Devin's ability to
look at UI mockups, error dialogs, and test output screenshots.

Key API:
- `encode_image(path)` → `(base64_data, media_type)` — validates the image
  type (JPEG, PNG, GIF, WebP — Claude-supported types), raises `ValueError`
  for unsupported types, `FileNotFoundError` for missing files
- `describe_screenshot(path, model, api_key, describer)` — calls the Anthropic
  Messages API with the base64 image; uses a concise two-to-four sentence
  prompt focused on what a software engineer needs to know
- `format_screenshot_block(description, filename)` → Markdown block with
  `## Screenshot context: <filename>` header
- `parse_screenshot_flag(args)` → `(image_path, remaining_args)` — extracts
  `--screenshot <path>` from command args

The `describer` parameter is injectable — tests pass a fake describer that
returns a fixed string without an API call. When no API key is found the real
path returns a readable placeholder rather than crashing.

**`src/tests/test_screenshot_context.py`** — 16 tests covering base64
encoding, MIME type detection, unsupported type rejection, injected describer
behaviour, no-API-key placeholder, block formatting, and flag parsing edge cases.

## Why

Devin's multi-modal capability lets it work from design screenshots or failing
CI test screenshots without the developer translating the visual into text. The
injectable `describer` pattern means this works in CI and tests without a
live API key.

## Test count after this step: 273
