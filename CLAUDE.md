# CLAUDE.md

Python project. Dev deps (`pytest`, `ruff`) live in `.venv`, not on PATH —
use `.venv/bin/pytest` and `.venv/bin/ruff`, not bare `pytest`/`ruff`
(a bare `ruff` isn't found at all; a bare `pytest` may silently resolve to
an unrelated global install instead of this project's).

Run tests: `.venv/bin/pytest src/tests/ -q`
Lint: `.venv/bin/ruff check src`
