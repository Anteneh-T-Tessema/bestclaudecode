# git-changelog-cli

Generate a Markdown changelog section from a local git repository's commit
history, grouped by [Conventional Commits](https://www.conventionalcommits.org/)
type (`feat`, `fix`, `chore`, `docs`, `refactor`, `perf`, `test`, `style`,
`build`, `ci`). Commits without a recognizable prefix are not dropped --
they're placed in a clearly labeled "Other" section.

This is a local, offline, single-shot CLI tool. It does not infer version
numbers, write into an existing `CHANGELOG.md`, talk to GitHub/GitLab, or
support output formats other than Markdown. It depends only on a local
`git` binary on `PATH` and the Python standard library.

## Requirements

- Python 3.9+
- `git` installed and on `PATH`

No other dependencies. No network access required.

## Installation

From this directory:

```sh
pip install .
```

This installs a `changelog` console command. Alternatively, run it
without installing, from this directory:

```sh
python3 -m changelog_cli <repo-path> <range>
```

## Usage

```
changelog [<repo-path>] <range> [--output FILE]
```

- `<repo-path>` -- path to a local git repository. Optional; defaults to
  the current directory.
- `<range>` -- a git commit range, e.g. `v1.2.0..v1.3.0` or `v1.2.0..HEAD`.
  Required. Any range syntax `git log` accepts is supported, since
  resolution is delegated to git itself.
- `--output FILE` / `-o FILE` -- write the changelog to `FILE` instead of
  stdout. When given, stdout is left untouched.

### Examples

Generate a changelog for a tag-to-tag range and print it to stdout:

```sh
changelog /path/to/repo v1.2.0..v1.3.0
```

Generate a changelog from the last tag up to `HEAD`, using the current
directory as the repo:

```sh
cd /path/to/repo
changelog v1.2.0..HEAD
```

Write the result to a file instead of stdout:

```sh
changelog /path/to/repo v1.2.0..v1.3.0 --output release-notes.md
```

Show usage help:

```sh
changelog --help
```

### Sample output

Given commits like `feat(parser): support nested scopes`,
`fix: handle empty input`, and `Update README` (no recognizable prefix):

```markdown
### Features

- **parser:** support nested scopes (a1b2c3d)

### Fixes

- handle empty input (e4f5a6b)

### Other

- Update README (9c0d1e2)
```

The output is plain Markdown, suitable for pasting directly into a
`CHANGELOG.md` file or a release description.

## Exit codes

- `0` -- success, including a valid range that resolves to zero commits
  (the output will say so rather than erroring).
- non-zero -- the repo path is not a valid git repository, the range does
  not resolve, or writing the output file failed. In every case a
  human-readable message is printed to stderr -- never a raw stack trace
  as the sole output -- so the exit code is safe to branch on in a CI or
  release script.

## What this tool does not do

- It does not determine or apply a semantic version number.
- It does not write into an existing `CHANGELOG.md` automatically.
- It does not integrate with GitHub/GitLab releases or tagging.
- It does not summarize or rewrite commit messages with AI/NLP -- a
  commit either matches the fixed conventional-commit grammar or it goes
  into the catch-all "Other" section, verbatim.
- It does not support a configurable type taxonomy or custom section
  names in this version.
- It does not produce JSON, HTML, or plain-text output -- Markdown only.

See `specs/git-changelog-cli/` in the parent repository for the full
product/requirements/design spec this tool was built from.

## Development

Run the test suite (uses the standard library `unittest`, runnable either
directly or via `pytest` if you have it installed):

```sh
python3 -m unittest discover -s tests -v
```

or

```sh
pytest tests/ -q
```

Tests include:

- `tests/test_classify.py` -- conventional-commit prefix parsing, scopes,
  breaking-change markers, and the "substring is not a prefix" rule (e.g.
  `Fixture update` must not classify as `fix`).
- `tests/test_sections.py` -- grouping/ordering rules, catch-all handling,
  the empty-section-omitted rule, and a property-style fuzz test asserting
  total output entries always equal total input commits.
- `tests/test_render.py` -- Markdown rendering shape and content.
- `tests/test_cli_integration.py` -- end-to-end runs against throwaway git
  fixture repositories (created and destroyed per test), covering repo/
  range validation, merge commits, `--output`, `--help`, exit codes, and a
  behavioral + AST-level check that no shell-interpreted subprocess call
  is ever used (no command injection via a malicious commit message,
  branch name, or range string).
- `tests/test_performance.py` -- a benchmark confirming a 1,000-commit
  range processes well under the 2-second budget.

No lint/test tooling from this tool's own development is required at
runtime by end users -- it is only needed if you're modifying this
project's source.
