# SDD: Git Changelog CLI

Date: 2026-06-18

This SDD translates `03-srs.md` into a concrete build design. There is no
`02-ai-requirements.md` for this project (no AI/ML component, confirmed in
the SRS at C-4), so no model/RAG/agent approach constrains this design.

## 1. Architecture overview

This is a single-process, synchronous command-line tool — not a client-server
system, not a service, and not a long-running process. There is no database,
no network call, and no background job. The entire system runs to completion
within one invocation of the CLI binary and exits.

The system has four logical layers, executed in a straight pipeline with no
branching architecture beneath it:

1. **CLI layer** — parses argv (repo path, commit range, output destination,
   `--help`), validates argument shape, and dispatches to the core pipeline.
   It is the only layer aware of process exit codes and stderr/stdout
   formatting for errors.
2. **Git access layer** — the sole component that shells out to the local
   `git` binary. It resolves the target repository, validates the commit
   range, and retrieves the raw commit list (hash, subject, merge-commit
   flag) for that range. All invocations use argument-vector subprocess
   calls (never a shell-interpreted command string), which is what makes
   NFR-7's injection guarantee structural rather than incidental.
3. **Classification & grouping layer** — pure, side-effect-free logic that
   takes the raw commit list and produces an in-memory ordered structure of
   sections (type -> list of parsed commit entries), with a fixed section
   order and a catch-all bucket for unmatched commits. This layer has no
   knowledge of git, the filesystem, or output formatting — it is the most
   heavily unit-tested part of the system because it carries NFR-2, NFR-3,
   and NFR-4.
4. **Rendering & output layer** — takes the ordered section structure and
   renders it to a Markdown string, then writes that string to stdout or to
   a file path, per FR-19.

Data flows strictly one way: CLI args -> git layer -> classification layer ->
rendering layer -> stdout/file. There is no feedback loop, no shared mutable
state across layers, and no concurrency — commits are processed in the
single order git returns them, which is also what gives NFR-2 (determinism)
its foundation: same input, same single-threaded pass, same output.

This shape is intentionally minimal. The SRS's non-functional requirements
(sub-2-second runs over at most ~1,000 commits, no network, single local
repo, fixed taxonomy, Markdown-only output) do not justify a database, a
plugin system, a message queue, or multiple processes. Introducing any of
those would add operational surface area the SRS gives no reason to pay for.

## 2. Component breakdown

### 2.1 CLI entry point / argument parser
- Owns the executable's `main`. Parses: repo path (optional positional or
  flag, defaulting to cwd), commit range (required), output file
  destination (optional flag), `--help` flag.
- Maps internal error types to the documented exit-code contract and writes
  human-readable error text to stderr (never lets an internal exception
  surface as the sole output).
- Satisfies: FR-1, FR-2, FR-19, FR-23, FR-24, FR-25, NFR-6, NFR-8.

### 2.2 Repository resolver
- Confirms the target path exists and is a valid git repository (or a
  subdirectory of one) before any range resolution is attempted.
- Produces the validated repository handle/working directory used by every
  subsequent git invocation.
- Satisfies: FR-1, FR-4.

### 2.3 Range resolver
- Validates the supplied range string against the resolved repository using
  git's own range-resolution semantics (delegated to git itself, not
  reimplemented) so behavior matches `git log <range>` exactly, per the
  SRS's acceptance criteria.
- Distinguishes "range syntax/ref does not resolve" (failure, FR-5) from
  "range resolves but is empty" (success with empty output, FR-6) — these
  are different outcomes from git and must not be collapsed into one error
  path.
- Satisfies: FR-2, FR-3, FR-5, FR-6.

### 2.4 Commit log fetcher
- Invokes `git log` against the resolved range using an argument vector
  (e.g. `["git", "-C", repo_path, "log", range, "--format=..."]`), never a
  shell string built by concatenating user input.
- Requests a machine-parseable, delimiter-based format from git itself
  (full hash, abbreviated hash, subject line, parent count for merge
  detection) rather than parsing human-oriented `git log` prose output.
- Satisfies: FR-3, FR-21, FR-22, NFR-1, NFR-7.

### 2.5 Conventional-commit parser
- For each fetched commit, applies a fixed-grammar match against the
  subject line: `^type(\(scope\))?(!)?: ` against the recognized type list.
- Case-sensitive, anchored-at-start matching only — never a substring scan
  — which is what keeps "Fixture update" out of `fix` (FR-10).
- On match: extracts type, optional scope, breaking-change marker, and the
  de-prefixed remainder of the subject for display.
- On no match: tags the commit for catch-all placement, passing the
  original subject through unmodified.
- Satisfies: FR-7, FR-8, FR-9, FR-10, FR-20, NFR-3.

### 2.6 Grouping / section builder
- Buckets parsed commits into sections keyed by type, preserving per-section
  commit order as received from git (oldest/newest ordering follows
  whatever the range resolver requested from git, applied consistently).
- Applies the fixed section display order (`feat`/Features and
  `fix`/Fixes first, then the remaining recognized types, catch-all last)
  and omits any section — typed or catch-all — with zero commits.
- Performs the accounting check implied by FR-16/NFR-4: total entries
  across all emitted sections must equal total commits in range; this is
  enforced as an internal invariant check, not just a test-suite assertion.
- Satisfies: FR-11, FR-12, FR-13, FR-14, FR-15, FR-16, NFR-2, NFR-4.

### 2.7 Markdown renderer
- Converts the ordered section structure into a Markdown string: one `###`
  heading per non-empty section, followed by one bullet per commit entry
  containing the de-prefixed subject and the short SHA.
- Produces a well-formed (if entry-less) document even when every section
  is empty, per FR-6's "valid empty changelog" requirement.
- Satisfies: FR-17, FR-18, FR-20, FR-21, NFR-2.

### 2.8 Output writer
- Writes the rendered Markdown to stdout by default; if a file destination
  was supplied, writes there instead and suppresses stdout output (per the
  SRS acceptance criterion that stdout is not also polluted when a file
  destination is given).
- Surfaces I/O failures (e.g. unwritable path) as a handled error with a
  clear message and non-zero exit, not an unhandled exception.
- Satisfies: FR-19, NFR-8.

## 3. Data flow

### 3.1 Primary use case: generate a changelog for a tag-to-tag range

1. User runs the CLI with a repo path (or omits it, defaulting to cwd) and a
   range such as `v1.2.0..v1.3.0`.
2. The CLI layer parses argv into a small in-memory options struct (repo
   path, range string, optional output path) and hands control to the
   pipeline.
3. The repository resolver checks the path is a valid git repository. If
   not, the pipeline short-circuits straight to the CLI layer's error
   handler, which prints a message to stderr and exits non-zero (FR-4)
   without touching the classification or rendering layers at all.
4. The range resolver asks git to validate the range against the resolved
   repository. If git reports the range as unresolvable, the pipeline
   short-circuits the same way (FR-5). If the range resolves to zero
   commits, the pipeline continues forward with an empty commit list rather
   than erroring (FR-6).
5. The commit log fetcher issues one `git log` subprocess call (argument
   vector, not shell string) requesting a delimited format with hash,
   abbreviated hash, subject, and parent count, and reads the result from
   the subprocess's stdout into an in-memory list of raw commit records.
   This is the only point in the whole flow where a subprocess is invoked.
6. Each raw commit record passes through the conventional-commit parser,
   producing a parsed record: `{type | None, scope | None, breaking: bool,
   display_subject, short_sha}`.
7. The grouping/section builder consumes the full list of parsed records in
   one pass, bucketing each into its type section or the catch-all bucket,
   then orders the non-empty sections per the fixed display order.
8. The Markdown renderer walks the ordered sections and produces a single
   Markdown string in memory.
9. The output writer sends that string to stdout, or to the specified file
   if `--output <path>` (or equivalent) was given — exactly one destination
   receives the content, never both.
10. The CLI layer exits 0.

Every step from 5 onward operates on data already pulled into memory from a
single git invocation; there is no re-querying git mid-pipeline and no
per-commit subprocess call, which is what keeps the design within NFR-1's
2-second budget for up to 1,000 commits.

### 3.2 Secondary use case: invalid range typo'd by the user (error path)

1. User runs the CLI with a misspelled tag, e.g. `v1.2.0..v1.3.O` (letter O
   instead of zero).
2. Steps 2-3 above proceed normally (repo path is valid).
3. The range resolver delegates resolution to git itself; git reports the
   ref/range as unrecognized.
4. The range resolver surfaces this as a typed "invalid range" error rather
   than letting a raw subprocess stderr blob leak through unprocessed.
5. The CLI layer catches the typed error, writes a clear, human-readable
   message naming the problem to stderr, and exits with a non-zero code.
6. No commit fetching, classification, or rendering occurs — the pipeline
   never reaches those layers, which keeps the error path fast and free of
   partial/malformed output (FR-4, FR-5, NFR-8).

## 4. APIs / interfaces

This system exposes no network API. Its interfaces are a command-line
surface and a small set of internal function boundaries between the
components in section 2.

### 4.1 External interface: the CLI command

- `changelog [<repo-path>] <range> [--output <file>]` — primary invocation:
  generate a changelog for `<range>` against `<repo-path>` (default: cwd),
  writing to stdout or to `<file>` if `--output` is given.
- `changelog --help` — prints usage text (accepted arguments/options, one
  usage example) and exits 0, independent of any repo/range validity.
- Exit codes: `0` on success (including the "valid range, zero commits"
  case); non-zero on any documented failure (invalid repo, invalid range,
  output I/O failure, unexpected internal error). Exit code values are
  distinguishable from success but the SRS does not require distinct
  non-zero codes per failure type, so a single non-zero convention (e.g.
  `1`) for all failure modes satisfies FR-25 without overspecifying.
- Stdout: reserved exclusively for the rendered Markdown changelog (only
  when no `--output` file is given). Stderr: reserved for error messages
  and (for `--help`) is not used — help text goes to stdout per common CLI
  convention.

### 4.2 Internal interfaces (function/module boundaries)

These are not network or IPC boundaries — they are in-process function
calls between the components described in section 2, kept distinct so each
can be unit-tested independently of the others (notably so the
classification/grouping layer, which carries the bulk of the NFR-2/NFR-3/
NFR-4 correctness burden, can be tested with zero git dependency via
in-memory fixture commit lists):

- `resolve_repository(path) -> RepoHandle | RepoError`
- `resolve_range(repo: RepoHandle, range_str) -> RangeError | None`
  (validation only; raises/returns a typed error on unresolvable range)
- `fetch_commits(repo: RepoHandle, range_str) -> list[RawCommit]`
- `parse_commit(raw: RawCommit) -> ParsedCommit` (type, scope, breaking
  flag, display subject, short SHA)
- `build_sections(commits: list[ParsedCommit]) -> list[Section]` (ordered,
  empty sections already dropped)
- `render_markdown(sections: list[Section]) -> str`
- `write_output(content: str, destination: Stdout | FilePath) -> None |
  IOError`

Each boundary takes and returns plain in-memory data (no shared global
state), which is what makes the classification layer's fixture-based unit
tests (NFR-3's acceptance criterion) possible without invoking git or the
filesystem at all.

## 5. Data storage

This system persists nothing of its own. There is no database, cache, or
configuration store, for the following SRS-driven reasons:

- **Input data** (commit history) is read fresh from the local git
  repository on every invocation via the git access layer; the tool treats
  the repository itself as the system of record and never duplicates or
  caches commit data between runs (consistent with NFR-2's determinism
  requirement — caching would risk staleness against a repository that has
  moved since a prior run).
- **Output data** (the rendered changelog) is either streamed to stdout for
  the caller to redirect/pipe, or written to a single file path the caller
  specifies (FR-19). The tool does not maintain or append to a persistent
  `CHANGELOG.md` itself (PRD/SRS non-goal, C-6) — it has no notion of "the"
  changelog file and treats every output destination as a one-shot write.
- **No configuration file** is read or written (C-5: fixed type taxonomy
  and section order in this version), which matches NFR-6's zero-setup
  usability requirement.

The only "storage" in play is the git object database already maintained by
the user's local git installation (C-1), which this tool reads via the git
CLI and never writes to.

## 6. Infrastructure & deployment

This tool runs entirely on the end user's or CI runner's local machine —
there is no server-side component, no hosting environment, and no
infrastructure to provision or operate.

- **Runtime target**: a single self-contained CLI executable (or a thin
  script plus an interpreter, depending on implementation language) that
  runs on macOS and Linux (NFR-5), invoked directly from a terminal or from
  a CI job step.
- **Distribution**: packaged and published through whatever the
  implementation language's standard package distribution channel is (e.g.
  a language package registry, or a downloadable single binary attached to
  release artifacts), so a user can install it once and invoke it as an
  ordinary CLI command thereafter. No installer, daemon, or system service
  is required.
- **Dependencies at runtime**: a locally installed `git` binary reachable
  on `PATH` (C-1) and, for portability, an implementation that does not
  require network access at runtime (NFR-5) — the tool must function fully
  offline since it only reads local repository data.
- **CI/release usage**: because the tool is a synchronous process with a
  documented exit-code contract (FR-25), it is designed to be dropped into
  a CI pipeline or release script step directly (e.g. "generate changelog
  -> fail the job if exit code is non-zero -> otherwise attach the output
  to a release"). No additional infrastructure (queues, webhooks, hosted
  endpoints) is implied or needed for that usage pattern.
- **Build/test pipeline** (for the project's own development, not for
  end users): standard local toolchain only — unit tests run against
  fixture commit histories (in-memory, no real git repo required for the
  classification layer; small throwaway git fixture repos for integration
  tests of the git access layer) and a linter, both runnable without
  network access, mirroring the tool's own offline operating constraint.

## 7. Technical constraints & operations

### Security
- **Shell-injection avoidance is structural, not advisory** (NFR-7): every
  git invocation must use an argument-vector subprocess call (e.g. passing
  a list of discrete arguments to the process-spawn API) and must never
  build a command by string-concatenating user-controlled values (repo
  path, range string) or commit-message content into a shell-interpreted
  string. This is the single most security-sensitive design constraint in
  the system: a maliciously crafted branch/tag name or commit message must
  never be able to influence what gets executed, only what gets displayed.
  This should be enforced with a code-level check (e.g. a lint rule or
  review checklist item banning `shell=True`-equivalent subprocess calls)
  as called for in the SRS's NFR-7 acceptance criterion.
- The tool never writes to the user's git repository (read-only with
  respect to `.git`), eliminating an entire class of data-loss or
  corruption risk.
- No secrets, credentials, or network calls exist in this system, so there
  is no credential-handling or transport-security surface to design for.

### Third-party integrations
- The only external dependency is the locally installed `git` binary
  (C-1), invoked as a subprocess. The tool depends on git's range-syntax
  semantics and delegates range resolution to git rather than
  reimplementing git internals — this means behavior is bounded by
  whichever git version is installed in the runtime environment, and the
  design should pin a minimum supported git version informally (whatever
  version supports the `--format` placeholders the commit log fetcher
  relies on) rather than assuming a specific exact version.
- No other third-party services, APIs, or libraries beyond the
  implementation language's standard tooling (argument parsing, subprocess
  invocation) are required. There is no package that talks to a hosted git
  platform (GitHub/GitLab/etc.) — this is explicitly out of scope (C-6).

### Performance
- NFR-1 requires sub-2-second wall-clock processing for ranges up to 1,000
  commits, excluding process startup. The design meets this by issuing
  exactly one `git log` subprocess call per invocation (section 3.1, step
  5) rather than one call per commit, and by keeping classification and
  grouping as a single linear in-memory pass with no nested per-commit
  subprocess or filesystem calls.
- Memory usage scales linearly with commit count in the range; at the
  SRS's stated scale (hundreds to ~1,000 commits), the entire commit list
  fits comfortably in memory with no need for streaming/chunked processing.
- Determinism (NFR-2) is achieved by avoiding any data structure with
  non-deterministic iteration order when building sections (e.g. preserving
  list/array order rather than relying on unordered set/map iteration for
  anything that affects output ordering).

### Deployment / operational concerns
- Because the tool is stateless and reads only from the local filesystem
  and a local subprocess, there is no operational monitoring, alerting, or
  uptime concern — "operating" this tool means versioning and distributing
  a CLI artifact, not running a service.
- Error handling must be operationally legible for scripted use: every
  documented failure mode (invalid repo, invalid range, output-file I/O
  failure) must produce a stderr message plus non-zero exit and must never
  surface as an unhandled stack trace as the sole output (NFR-8) — this
  matters operationally because the tool's primary non-interactive
  consumer is a CI/release script branching on exit code (FR-25), and a
  stack trace with exit code 1 versus a clean error message with exit code
  1 are equally "non-zero" to a CI script but very different in
  human-debuggability when a release engineer is staring at failed CI logs.
- Backward compatibility note for future versions: since the type taxonomy
  and section order are fixed in this version by design (C-5), any future
  change to either should be treated as a breaking output-format change
  for downstream scripts that parse or diff this tool's Markdown output,
  even though no such configuration surface exists yet.

## 8. Self-check

- FR-1 through FR-6: section 2.2 (Repository resolver), 2.3 (Range
  resolver), 2.4 (Commit log fetcher).
- FR-7 through FR-10: section 2.5 (Conventional-commit parser).
- FR-11 through FR-16: section 2.6 (Grouping / section builder).
- FR-17 through FR-19: section 2.7 (Markdown renderer), 2.8 (Output
  writer).
- FR-20 through FR-22: section 2.4 (short SHA, merge-commit inclusion via
  parent-count metadata) and 2.5/2.7 (de-prefixed display subject).
- FR-23 through FR-25: section 2.1 (CLI entry point / argument parser).
- NFR-1 (performance), NFR-2 (determinism), NFR-3 (classification
  accuracy), NFR-4 (no data loss), NFR-5 (portability), NFR-6 (usability),
  NFR-7 (security), NFR-8 (error handling): each addressed explicitly in
  section 7, with component-level grounding in sections 2 and 3.

All 25 functional requirements and all 8 non-functional requirements from
`03-srs.md` are addressed by at least one named component or an explicit
statement in section 7.
