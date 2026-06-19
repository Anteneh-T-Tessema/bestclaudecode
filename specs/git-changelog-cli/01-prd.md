# PRD: Git Changelog CLI

Date: 2026-06-18

## 1. Business problem / opportunity

Writing release notes by hand is slow and inconsistent: someone has to scroll
through `git log`, manually decide what's a feature versus a fix versus
noise, and reformat it into prose. Teams that already write conventional-commit
style messages (`feat:`, `fix:`, `chore:`, etc.) are doing that classification
work twice — once at commit time, and again by hand at release time. The
result is changelogs that are either skipped entirely, inconsistent in
format from release to release, or delegated to whoever has time, not
whoever has context.

The opportunity is to mechanically reuse the structure already present in
commit messages (and to apply sensible defaults when it's absent) so that
producing a changelog section for a release becomes a single command instead
of a manual writing task.

## 2. Goals & success metrics

1. **Eliminate manual changelog drafting for a release.** Measured by:
   running the tool against a commit range produces a changelog section that
   a maintainer can paste into `CHANGELOG.md` with zero or minimal manual
   edits for at least the common case (a range with conventional-commit
   prefixes).
2. **Correctly classify conventional-commit prefixes.** Measured by: given a
   commit range containing `feat`, `fix`, `chore`, `docs`, and other standard
   prefixes, every commit is grouped under the matching section with no
   misclassification, verified by unit tests against fixture commit
   histories.
3. **Degrade gracefully on non-conventional history.** Measured by: commits
   without a recognizable prefix are still included in the output (grouped
   under a clearly labeled catch-all section) rather than silently dropped —
   verified by a test asserting commit count in equals commit count out.
4. **Fast enough for interactive, pre-release use.** Measured by: running
   against a typical release range (order of hundreds of commits) completes
   in well under a few seconds on a local machine, so it fits naturally into
   a release checklist rather than being a background job.

## 3. Target users

- **Maintainers of small-to-mid-size software projects** (open source or
  internal) who cut releases themselves and currently write or assemble
  release notes by hand.
- **Developers who already follow or loosely follow the Conventional
  Commits convention** in their commit messages — the tool's primary value
  (automatic grouping by type) depends on at least some commits having
  recognizable prefixes.
- These are command-line-comfortable users running the tool locally or in a
  CI/release script, not end users consuming a hosted web product. This is
  explicitly not aimed at non-technical release managers or teams with no
  commit message conventions at all (for whom the catch-all grouping is a
  fallback, not the primary experience).

## 4. Features (in scope)

- **Repo and range targeting.** Point the tool at a local git repository and
  specify a commit range (e.g., a tag-to-tag range like `v1.2.0..v1.3.0`, or
  a tag-to-HEAD range) to scope which commits are included.
- **Conventional-commit prefix detection.** Parse each commit's subject line
  for a recognized type prefix (`feat`, `fix`, `chore`, `docs`, `refactor`,
  `perf`, `test`, etc., including optional scope like `feat(parser):`).
- **Grouping by type.** Group parsed commits into sections by type (e.g.,
  "Features", "Fixes", "Chores") in a sensible, consistent display order.
- **Catch-all handling for unrecognized commits.** Commits with no
  recognizable conventional prefix are still surfaced, under a distinct
  section, rather than dropped — so the changelog reflects the full commit
  range.
- **Human-readable Markdown output.** Generate a changelog section formatted
  as Markdown, suitable for pasting directly into a `CHANGELOG.md` file or a
  release description.
- **Per-commit detail.** Each entry includes at minimum the commit's subject
  line; the entry format should be clean enough to use without further
  editing in the common case.
- **Command-line interface.** Invocable as a standalone CLI command with
  arguments for repo path (defaulting to the current directory) and commit
  range.

## 5. Out of scope / non-goals

- **Automatic version number / semver determination.** This version
  generates the changelog text only; it does not decide or apply the next
  version number, even though commit types conventionally map to semver
  bumps.
- **Writing/merging into `CHANGELOG.md` automatically.** The tool produces
  output (e.g., to stdout or a file); it does not itself edit, insert into,
  or commit changes to an existing changelog file in this version.
- **Publishing or release automation.** No integration with GitHub/GitLab
  releases, tagging, or CI triggering — this is a local generation tool, not
  a release-orchestration tool.
- **Non-conventional-commit NLP/summarization.** The tool does not use
  language models or heuristics to infer intent from free-form commit
  messages beyond detecting the conventional-commit prefix pattern; messages
  without a prefix are passed through as-is in the catch-all group, not
  rewritten or summarized.
- **Configurable type taxonomies / custom grouping rules.** This version
  ships with a fixed, sensible set of recognized types and section order; a
  user-defined config for custom commit types or section naming is not
  included.
- **Multi-repo or monorepo-aware scoping** (e.g., filtering by changed path
  within a monorepo) is not included in this version.
- **Output formats other than Markdown** (e.g., JSON, HTML, plain text) are
  not included in this version.
