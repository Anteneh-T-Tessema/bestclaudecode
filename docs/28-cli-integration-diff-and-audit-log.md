# Step 28 — CLI Integration: `--diff` flag and audit log wired into commands

## What changed

Two command files and two source modules were updated to close the loop between
the diff-context and decision-log modules and the slash commands that exercise
them.

### `src/diff_context.py` — `_format_diff_block` ref label fix

`_format_diff_block` previously used the hardcoded label `git diff HEAD` in the
fenced block header regardless of the actual ref passed. Fixed by adding a
`ref: str = "HEAD"` parameter and interpolating it into the header:

```python
return f"## Recent changes (git diff {ref})\n\n```diff\n{trimmed}\n```"
```

All call sites updated to pass `ref=ref` through.

### `src/decision_log.py` — `--log` CLI mode

`main()` previously only supported `--list`. A new `--log` branch was added:

```
python -m src.decision_log --log \
  --task "<task>" \
  --verdict "<verdict>" \
  --retries <n> \
  --outcome "<summary>" \
  --agent "<agent>" \
  [--finding "<f>" ...]
```

Required flags: `--task`, `--verdict`, `--outcome`. Optional: `--retries`
(default 0), `--agent` (default `"coding-agent"`), `--finding` (repeatable).
The command writes the entry via `log_decision()` and exits 0 on success, 1 on
missing required flags.

### `.claude/commands/context-implement.md` — `--diff` flag and audit log

- Documented `--diff [ref]` in the **Flags** section: strips `--diff` and an
  optional following ref token from `$ARGUMENTS`, runs
  `python -m src.diff_context [ref]`, and injects the output between the
  orientation block and the task separator.
- Added audit log shell commands to steps 7 (zero Blocking findings) and 9
  (one or more Blocking findings), using `python -m src.decision_log --log`.

### `.claude/commands/implement.md` — audit log

Added `python -m src.decision_log --log` calls to steps 5 (LGTM path) and 8
(retry path), matching the structure in `/context-implement`.

## Why these changes matter

Before this step the diff-context and decision-log modules existed as libraries
and had `__main__` entry points, but neither was wired into the commands that
agents actually run. The commands would build context and review code, but never
record what happened or surface recent changes to the agent at task-start.

After this step:
- Every `/implement` and `/context-implement` run writes a timestamped audit
  entry (task, verdict, retry count, outcome) to `decision_log.jsonl`.
- `/context-implement --diff` injects a correctly-labelled diff block so the
  agent sees recent working-tree changes before touching any file.
- The label in the diff block reflects the actual ref (`HEAD`, `HEAD~1`, or a
  named ref) rather than always saying `HEAD`.

## Tests added

`test_diff_context.py` — 4 new cases covering the ref label in
`_format_diff_block` when ref is non-default.

`test_decision_log.py` — 46 lines of new tests covering the `--log` CLI path:
required-flag validation, all optional flags, `--finding` repetition, and
exit-code behaviour on success and failure.

## Counts after this step

- Tests: 127 passing
- Lint: clean (`ruff check src` — all checks passed)
