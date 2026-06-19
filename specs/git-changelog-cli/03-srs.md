# SRS: Git Changelog CLI

Date: 2026-06-18

This SRS translates `01-prd.md` into testable requirements. No
`02-ai-requirements.md` exists for this project (no AI/ML component), so all
requirements below derive solely from the PRD.

## 1. Functional requirements

### Repo and range targeting (PRD: "Repo and range targeting")

- **FR-1**: The system shall accept a path to a local git repository as
  input. If no path is given, it shall default to the current working
  directory.
- **FR-2**: The system shall accept a commit range argument (e.g.
  `v1.2.0..v1.3.0` or `v1.2.0..HEAD`) identifying which commits to include.
- **FR-3**: The system shall resolve the given range against the target
  repository using standard git range syntax and operate only on commits
  within that range.
- **FR-4**: If the target path is not a valid git repository, the system
  shall fail with a non-zero exit code and a clear error message rather than
  producing partial or malformed output.
- **FR-5**: If the given commit range is invalid or does not resolve to any
  ref recognized by the repository (e.g. a typo'd tag name), the system
  shall fail with a non-zero exit code and a clear error message.
- **FR-6**: If the given commit range resolves but contains zero commits,
  the system shall exit successfully (exit code 0) and produce a valid,
  empty-of-entries changelog output (e.g. section headers with no commits,
  or an explicit "no changes" notice) rather than erroring.

### Conventional-commit prefix detection (PRD: "Conventional-commit prefix
detection")

- **FR-7**: For each commit in the resolved range, the system shall parse
  the commit's subject line (first line of the commit message) for a
  conventional-commit type prefix matching the pattern `type(scope)?: ` or
  `type(scope)?!: ` (breaking-change marker), where `type` is one of the
  recognized types defined in FR-8.
- **FR-8**: The system shall recognize at minimum the following
  conventional-commit types: `feat`, `fix`, `chore`, `docs`, `refactor`,
  `perf`, `test`, `style`, `build`, `ci`.
- **FR-9**: When a commit subject includes an optional scope (e.g.
  `feat(parser):`), the system shall extract both the type and the scope,
  and shall make the scope available for display alongside the commit
  entry.
- **FR-10**: Type matching shall be case-sensitive and shall only match
  recognized type keywords at the start of the subject line (a word that
  merely contains a type name elsewhere in the subject, e.g. "Fixture
  update", shall not be misclassified as `fix`).

### Grouping by type (PRD: "Grouping by type")

- **FR-11**: The system shall group all commits sharing the same detected
  type into a single named section (e.g. all `feat` commits under
  "Features").
- **FR-12**: The system shall render sections in a fixed, consistent order
  on every run, with `feat` ("Features") and `fix` ("Fixes") appearing
  before lower-priority types such as `chore`, `docs`, `refactor`, `perf`,
  `test`, `style`, `build`, `ci`.
- **FR-13**: A section for a given type shall be omitted from the output
  entirely when no commits of that type are present in the range (no empty
  section headers for absent types).

### Catch-all handling (PRD: "Catch-all handling for unrecognized commits")

- **FR-14**: Any commit whose subject line does not match a recognized
  conventional-commit prefix (per FR-7/FR-8) shall be placed into a single,
  distinctly labeled catch-all section (e.g. "Other") rather than being
  dropped from the output.
- **FR-15**: The catch-all section shall be omitted when every commit in the
  range matches a recognized prefix.
- **FR-16**: The total number of commit entries appearing across all
  sections (typed sections plus catch-all) in the output shall equal the
  total number of commits in the resolved range (one-to-one accounting,
  with merge-commit handling per FR-22).

### Markdown output (PRD: "Human-readable Markdown output")

- **FR-17**: The system shall render the changelog section as Markdown,
  using a heading per type section (e.g. `### Features`) followed by a
  bulleted list of commit entries.
- **FR-18**: The Markdown output shall be syntactically valid (parses as
  Markdown without manual correction) such that it can be pasted directly
  into a `CHANGELOG.md` file or a release description with zero or minimal
  manual edits, satisfying the PRD's "common case" success metric.
- **FR-19**: The system shall write its output to stdout by default, and
  shall support writing to a specified output file path when given a
  file-destination argument or option.

### Per-commit detail (PRD: "Per-commit detail")

- **FR-20**: Each rendered commit entry shall include, at minimum, the
  commit's subject line (with the conventional-commit prefix stripped for
  typed entries, since the section heading already conveys the type).
- **FR-21**: Each rendered commit entry shall include the commit's short
  SHA (abbreviated hash) so a reader can trace the entry back to the
  underlying commit.
- **FR-22**: Merge commits shall be included in the output following the
  same classification and one-entry-per-commit accounting as any other
  commit; the system shall not silently exclude merge commits from the
  range.

### Command-line interface (PRD: "Command-line interface")

- **FR-23**: The system shall be invocable as a standalone CLI command
  accepting a repo path argument/option and a commit range argument, per
  FR-1 and FR-2.
- **FR-24**: The CLI shall support a `--help` flag that prints usage
  information, including the accepted arguments/options and a usage
  example, and exits with code 0.
- **FR-25**: The CLI shall return exit code 0 on success and a non-zero
  exit code on any failure condition (invalid repo, invalid range, internal
  error), so it can be used reliably in a scripted release checklist or CI
  step.

## 2. Non-functional requirements

- **NFR-1 (Performance)**: Running the tool against a commit range of up to
  1,000 commits on a local machine shall complete in under 2 seconds of
  wall-clock time (excluding one-time process startup/interpreter init
  overhead), satisfying the PRD's "well under a few seconds" goal for
  typical release ranges of "hundreds of commits."
- **NFR-2 (Correctness/determinism)**: Given the same repository state and
  the same commit range, the tool shall produce byte-identical output across
  repeated runs (no non-deterministic ordering within a section).
- **NFR-3 (Classification accuracy)**: For a fixture commit history covering
  all recognized types (FR-8) with and without scopes, the tool shall
  classify 100% of commits into the correct section, verified by automated
  unit tests against fixture data (per PRD success metric 2).
- **NFR-4 (No data loss)**: For any resolved commit range, the count of
  commit entries in the rendered output shall equal the count of commits in
  the range, with zero commits silently dropped (per PRD success metric 3
  and FR-16).
- **NFR-5 (Portability)**: The tool shall run on macOS and Linux using a
  locally installed `git` binary accessible on `PATH`, without requiring
  network access (it operates entirely on local repository data).
- **NFR-6 (Usability)**: A user with no prior exposure to the tool shall be
  able to produce valid output by running it with only a repo path
  (defaulted) and a range argument — no required configuration file or
  setup step — consistent with the PRD's single-command goal.
- **NFR-7 (Security)**: The tool shall not execute, evaluate, or shell out
  using any content drawn from commit messages (subjects/bodies/author
  names) as part of constructing shell commands; all git invocations shall
  pass user-controlled values (repo path, range) as discrete arguments, not
  as interpolated shell strings, to avoid shell-injection via a maliciously
  crafted commit message or branch/tag name.
- **NFR-8 (Reliability/error handling)**: All failure conditions identified
  in the functional requirements (invalid repo, invalid range, I/O failure
  writing output file) shall produce a human-readable error message on
  stderr and a non-zero exit code, never an unhandled stack trace as the
  sole output.

## 3. Constraints & assumptions

- **C-1**: The tool depends on a working local `git` installation; it does
  not bundle or reimplement git internals. Behavior is constrained by
  whatever `git` version is installed in the user's environment.
- **C-2**: The target repository must be a valid local git repository
  accessible via the filesystem; the tool does not support remote-only
  repositories (e.g. fetching a range from a remote URL without a local
  clone).
- **C-3**: The tool's primary value (automatic grouping) assumes commit
  authors have at least partially followed the Conventional Commits
  message convention. Per the PRD's target-user section, this is explicitly
  not aimed at teams with no commit conventions at all — for such teams,
  output will be dominated by the catch-all section, which is an accepted,
  documented degradation rather than a defect.
- **C-4**: No AI/ML component exists in this project (confirmed: no
  `02-ai-requirements.md`); classification is rule-based pattern matching
  against a fixed prefix grammar, not inference or NLP, per the PRD's
  explicit non-goal ("Non-conventional-commit NLP/summarization").
- **C-5**: The set of recognized conventional-commit types and the section
  display order are fixed in this version (PRD non-goal: "Configurable type
  taxonomies"). Requirements FR-8 and FR-12 reflect that fixed set; this SRS
  does not assume any future configuration mechanism.
- **C-6**: The tool does not determine or apply semantic version numbers
  (PRD non-goal), does not write to `CHANGELOG.md` itself (PRD non-goal),
  and does not integrate with any hosted git platform's release/tagging API
  (PRD non-goal). These are out-of-scope boundaries, not deferred
  requirements, and are intentionally excluded from section 1.
- **C-7**: Users are assumed to be command-line-comfortable developers or
  maintainers running the tool locally or from a CI/release script — not
  end users of a hosted product. No GUI or web interface is assumed or
  required.
- **C-8**: Multi-repo and monorepo path-scoped filtering are out of scope
  (PRD non-goal); the tool assumes a single repository and operates over
  the full commit range without path filtering.
- **C-9**: Output format is constrained to Markdown only in this version
  (PRD non-goal: other output formats); no requirement in section 1 assumes
  JSON, HTML, or plain-text output modes.

## 4. Acceptance criteria

**AC for FR-1 through FR-6 (repo and range targeting)**
- Running the tool with no repo path inside a valid git repository succeeds
  and operates on that repository.
- Running the tool against a non-repository directory fails with exit code
  != 0 and a message naming the problem (not a stack trace).
- Running the tool with a range referencing a nonexistent tag/ref fails with
  exit code != 0 and a clear message.
- Running the tool with a valid range and a valid tag-to-tag span returns
  exactly the commits git itself reports for `git log <range>`.
- Running the tool against a valid, empty range exits 0 and produces a
  well-formed (if entry-less) changelog document.

**AC for FR-7 through FR-16 (parsing, grouping, catch-all)**
- A fixture history containing every recognized type (with and without
  scope) produces one section per represented type, each containing exactly
  the commits of that type, with zero cross-contamination between sections
  — verified by automated test asserting expected commit-to-section mapping.
- A fixture history containing commits with no recognizable prefix produces
  a single catch-all section containing exactly those commits.
- A fixture history mixing typed and untyped commits produces output where
  `sum(len(section) for section in all_sections) == total_commits_in_range`
  — verified by an automated test (PRD success metric 3).
- A commit subject like "Fixture update for tests" (containing "fix" as a
  substring but not as a true prefix) is classified into the catch-all
  group, not `fix`.
- Section order is identical across multiple runs and matches the
  documented fixed order (Features, Fixes, then other recognized types,
  then catch-all last or per documented placement).

**AC for FR-17 through FR-22 (Markdown output and per-commit detail)**
- Output produced against a fixture history with only conventional-commit
  prefixed messages can be pasted into a Markdown renderer and displays
  correctly formed headings and bullet lists with no leftover prefix
  syntax (e.g. no literal `feat:` remaining in the rendered bullet text).
- Each bullet contains the commit's short SHA and de-prefixed subject text.
- A fixture history containing at least one merge commit shows that merge
  commit represented exactly once in the output, classified per its own
  subject line.
- Running with an output-file option writes the same content to the
  specified file that would otherwise go to stdout, and stdout is not
  additionally polluted with that content when a file destination is given.

**AC for FR-23 through FR-25 (CLI behavior)**
- `--help` exits 0 and prints usage text covering the repo-path and range
  arguments.
- A successful run (valid repo, valid non-empty range) exits 0.
- Each documented failure mode (invalid repo, invalid range) exits non-zero
  and is distinguishable from a successful run purely by exit code, suitable
  for use in a CI script's conditional logic.

**AC for non-functional requirements**
- A benchmark fixture repository with 1,000 synthetic commits processes in
  under 2 seconds wall-clock on a representative local machine, measured by
  an automated or documented manual benchmark (NFR-1).
- Two consecutive runs against an unchanged repository and range produce
  byte-identical stdout output (NFR-2).
- The full fixture-based type-classification test suite passes with 100% of
  fixture commits landing in their expected section (NFR-3).
- A fuzz/property-style test asserting "entries out == commits in" passes
  across multiple randomly generated fixture histories (NFR-4).
- A code-level check (manual review or static test) confirms no commit
  message content is passed through a shell-interpreting call path (NFR-7).

## 5. Self-check notes

Every functional requirement above traces to one of the PRD's seven
in-scope features (repo/range targeting, prefix detection, grouping,
catch-all handling, Markdown output, per-commit detail, CLI). Every PRD
feature has at least one FR. Two items required interpretation beyond the
PRD's literal text, both flagged in the report below rather than treated as
silently-resolved facts.
