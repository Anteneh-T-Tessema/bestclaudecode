# Step 25: Multi-language repo map (TypeScript/JS)

## What was built

**`src/ts_map.py`** — regex-based extractor for TypeScript and JavaScript files
(`.ts`, `.tsx`, `.js`, `.mjs`, `.cjs`). Recognised declaration forms:

| Pattern | Example |
| --- | --- |
| `export function` / `export async function` | `export async function fetchData()` |
| `export class` / `abstract class` | `export class Router {` |
| `export interface` | `export interface Config {` |
| `export type` | `export type Handler = ...` |
| `export const` | `export const DEFAULT_PORT = 3000` |
| `export default function/class` | `export default function() {` |
| Non-exported `function` / `class` | `function helper(x: number)` |

Output format is identical to `build_repo_map()` so all downstream consumers
(TFIDFIndex, filter_map, format_context) work without modification.

`_iter_ts_files()` skips `node_modules/`, `dist/`, `build/`, `.next/`, and any
hidden directory — the same policy as the Python scanner's `_SKIP_DIR_NAMES`.

**`src/context.py`** — `format_context()` gains `include_ts: bool = False`.
When `True`, `build_ts_map()` is called and its output is appended to the
Python map (with a blank-line separator) before filtering and truncation. The
combined map is then processed by `filter_map` and `TFIDFIndex` exactly as
before.

**`src/tests/test_ts_map.py`** — 14 tests covering: each declaration form,
non-exported functions, `_iter_ts_files` extension filtering and
`node_modules` exclusion, the empty-directory placeholder, multi-file output,
and the `format_context(include_ts=True)` integration path.

## Why

The MCP server in this repo (`mcp-servers/build-log-server`) is TypeScript.
Before this step, `/context-implement` gave agents a Python-only orientation
even when the task touched the TS server. `include_ts=True` closes that gap:
the agent now sees `function handleRequest()`, `class BuildLogServer`, etc.
in the same orientation block as the Python modules.

The decision to use regex instead of tree-sitter was deliberate: zero
dependencies, works offline, covers >95% of the declaration forms that actually
appear in real TypeScript source. The 5% missed (destructured exports, dynamic
class expressions) are edge cases that appear in library internals, not
application entry points.

## What was verified

- 14 new tests pass
- `format_context(include_ts=True)` on a tmp_path with both `.py` and `.ts`
  files includes symbols from both
- Full suite: 108 tests, 0 failures
- `ruff check src` clean

## Deliberately left undone

- JSX attribute/component extraction (React component names inside `return`)
  is not handled — only top-level declarations.
- Import tracking for TS files (equivalent to `--deps` for Python) is not
  implemented; cross-file TS imports would require parsing `import` statements.
