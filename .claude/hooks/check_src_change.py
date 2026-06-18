#!/usr/bin/env python3
"""PostToolUse hook: after Edit/Write touches a file under src/, run ruff
and pytest. Failures are written to stderr with exit code 2, which Claude
Code feeds back to the agent so it iterates instead of declaring the
change done. See src/CLAUDE.md and skills/test-writing/SKILL.md for the
rule this enforces.
"""
import json
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RUFF = PROJECT_ROOT / ".venv" / "bin" / "ruff"
PYTHON = PROJECT_ROOT / ".venv" / "bin" / "python"


def main() -> int:
    payload = json.load(sys.stdin)
    file_path = payload.get("tool_input", {}).get("file_path")
    if not file_path:
        return 0

    path = Path(file_path)
    try:
        rel = path.resolve().relative_to(PROJECT_ROOT)
    except ValueError:
        return 0

    if rel.parts[0] != "src" or path.suffix != ".py":
        return 0

    failures = []

    ruff_run = subprocess.run(
        [str(RUFF), "check", "src"],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    if ruff_run.returncode != 0:
        failures.append(f"ruff check failed:\n{ruff_run.stdout}{ruff_run.stderr}")

    pytest_run = subprocess.run(
        [str(PYTHON), "-m", "pytest", "src/tests/", "-q"],
        capture_output=True, text=True, cwd=PROJECT_ROOT,
    )
    if pytest_run.returncode != 0:
        failures.append(f"pytest failed:\n{pytest_run.stdout}{pytest_run.stderr}")

    if failures:
        print(f"src/ change to {rel} broke verification:\n\n" + "\n\n".join(failures), file=sys.stderr)
        return 2

    return 0


if __name__ == "__main__":
    sys.exit(main())
