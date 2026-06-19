# Step 10: End-to-End SDLC Document Pipeline

## What we built

- Four new subagents, `.claude/agents/{prd-writer,ai-requirements-writer,srs-writer,sdd-writer}.md`
  — each authors exactly one professional pre-development document and
  reads only the upstream docs in its chain. None has `Edit`.
- `.claude/commands/blueprint.md` → `/blueprint <idea>` — orchestrates
  all four stages against a new `specs/<slug>/` directory, with one
  user-confirmation checkpoint after the PRD.
- `.claude/commands/blueprint-build.md` → `/blueprint-build <slug>
  [target dir]` — hands the generated spec off to the existing
  `coding-agent` (Step 3) for implementation, then points at `/review`
  (Step 9) for critique. This is the "requirement to writing" closing
  link the user asked for, built entirely on machinery this repo already
  has rather than new implementation/review subagents.
- A new top-level `specs/<project-slug>/` directory convention, kept
  separate from `docs/` (this repo's own meta build-log).

## Why this pipeline, this way

The user wanted this repo extended into a general-purpose, end-to-end
SDLC system — taking an arbitrary project idea through the professional
document stages (PRD, AI Requirements, SRS, SDD) they specified, then
into development — not a capability scoped only to this repo's own
9-step build log. The design mirrors every prior step's conventions
(subagent shape, slash-command delegation framing, harness-engineering
tool omission) applied to a new domain: authoring a document chain
instead of reviewing or writing this repo's own code.

A Plan-agent design review was run before implementation specifically to
pressure-test five open design questions (TRD placement, the Write-vs-
Edit tool grant, the `specs/`-vs-`docs/` split, command count/naming, and
whether the pipeline should pause between stages). Its critique changed
the final design in one material way — see Decision 5.

## Real decisions made

1. **TRD folded into SDD, not a 5th stage.** The user's own reference
   table lists TRD (technical constraints, integrations, security,
   performance, deployment) as a separate document type, but their own
   stated "most professional sequence" diagram omits it. Rather than
   silently dropping it or arbitrarily picking a side, `sdd-writer`'s
   prompt requires a mandatory "Technical constraints & operations
   (TRD-equivalent)" section — TRD's concerns are preserved as a forced
   heading inside the SDD, not lost, and not a separate subagent/stage
   the user's own sequence didn't call for.

2. **`specs/<slug>/`, not `docs/`, and this is a correctness requirement,
   not a style choice.** `.claude/hooks/check_build_log_consistency.py`'s
   `DOC_FILE_RE = ^(\d+)-.+\.md$` is applied via a non-recursive
   `Path("docs").iterdir()` — confirmed by reading the source before
   deciding. A generated project doc using the same `NN-name.md` pattern
   placed under `docs/` would be silently swept into this repo's own
   step-consistency check and corrupt it. `specs/` is a different
   top-level directory, so it's structurally invisible to that hook.
   Also confirmed by reading both tool-use hooks
   (`check_docstrings.py` line 85-86, `check_src_change.py` line
   24-25): both are strictly scoped to paths under `src/`, so nothing
   written under `specs/` (or a future `/blueprint-build` target
   directory) triggers either one. Empirically reconfirmed: ran
   `check_build_log_consistency.py` directly while a real `specs/`
   directory existed mid-build → exit 0.

3. **Four writer subagents, `Read, Grep, Glob, Write` (+ `WebSearch`/
   `WebFetch` for `prd-writer`/`sdd-writer`, which benefit from external
   research; `srs-writer` has neither, since it derives purely from
   upstream docs) — no `Edit` on any of them.** Mirrors `code-reviewer`'s
   harness-engineering precedent (omit the tool, don't just instruct
   against it), repurposed: each subagent authors exactly one new file
   and must never modify an existing one.
   - **Named, honest gap**: `Write` doesn't structurally stop a writer
     subagent from overwriting a *different* stage's file — the tool
     itself doesn't distinguish "create new" from "overwrite an
     arbitrary path," only `Edit`'s absence is a structural guarantee.
     Each subagent's prompt states its one designated output path and is
     told never to write anywhere else, but that's a prompt-level
     mitigation, not a harness one — same class of honest limitation as
     `code-reviewer`'s "Bash can still technically mutate" gap in
     `docs/09-code-reviewer-agent.md`. If a live run ever shows this
     failing, that's the trigger for a scoped hook, not built
     preemptively.
   - Each subagent is also explicitly told to never silently revise an
     *upstream* doc on finding a problem with it — it reports the
     concern back instead, the same flag-don't-fix failure mode already
     established for `code-reviewer`.

4. **Two slash commands, not one with a mode flag, not folded into
   `/advance`.** `/advance` is scoped to this repo's own numbered build
   steps via `list_build_steps` MCP state; a user's arbitrary project
   idea has no such state, so reusing it would conflate this repo's own
   meta build-log with arbitrary generated project specs. Two files also
   means no hand-rolled mode-argument parsing — the frontmatter already
   gives that for free.

5. **One checkpoint after the PRD — added after the Plan-agent review,
   not in the original draft.** The first draft ran all four stages
   unattended. The review flagged this as the weakest part: unlike
   `/advance` (one MCP-verified step), a bad PRD here would silently
   cascade into three more LLM-authored documents with no checkpoint —
   compounding error across a chain is a different risk than a single
   step, so citing `/advance`'s no-gating precedent didn't actually
   apply. Fix adopted: `/blueprint` pauses after `01-prd.md`, summarizes
   it, and asks the user to confirm before continuing — one checkpoint
   at the highest-leverage point, not per-stage gating or a full
   approval state machine.

## Verification performed

1. **Config-validity check** (same level as Steps 3/9's subagent
   checks): parsed all four new subagents' frontmatter — required
   fields present, `name` matches the filename slug, none contain
   `Edit`, all contain `Write`. Passed for all four. Also eyeballed the
   four `description` fields plus `coding-agent`'s/`code-reviewer`'s for
   router-disambiguation overlap — none collide.
2. **Slash-command naming collision check**: listed every directory
   under the global `~/.claude/skills/` (the same class of collision
   that hit this repo's own `/review` once already) — no `blueprint` or
   `blueprint-build` present. Confirmed both new commands hot-reloaded
   immediately as invokable skills after being written, same as every
   prior slash-command step.
3. **Ran a live end-to-end `/blueprint` chain test, in two attempts —
   the first hit a real, predicted limitation; the second, later in the
   same session after the registry refreshed, passed cleanly.**
   - Predicted, before testing, that the four new subagents would hit
     the same mid-session registration-lag limitation Step 9 already
     documented for `code-reviewer` (a subagent defined after session
     start isn't available to the `Agent` tool until a fresh session).
   - **Attempt 1**: created `specs/git-changelog-cli/00-idea.md` (idea:
     "a CLI tool that turns git commit history into changelog entries"
     — chosen specifically because it's cheap to run and has no AI/ML
     component, so it would also exercise the AI-stage-skip logic) and
     attempted to delegate to `prd-writer` via the `Agent` tool,
     manually following `blueprint.md`'s own instructions (the same
     workaround used to test `/validate`/`/review` previously, since
     slash commands can't be typed by the assistant itself mid-session).
     First call: `Agent type 'prd-writer' not found`. Retried once
     immediately (no session boundary crossed) to rule out a transient
     issue: same error. Confirmed the prediction. Did not fabricate a
     workaround (e.g. having a general-purpose agent impersonate
     `prd-writer`'s prompt) — that would test the prompt text's
     reasonableness, not whether the real subagent registers and
     delegates correctly. Deleted the partial directory afterward.
   - **Attempt 2**: later in the same session, the subagent registry
     refreshed unpredictably (confirmed via a system-reminder listing
     all four new agent types as available) — itself a useful data
     point: the registration lag is not a fixed full-session-boundary
     rule, it can clear mid-session without warning. Recreated
     `00-idea.md` and ran the chain for real:
     - `prd-writer` → `01-prd.md`: business problem (manual changelog
       drafting duplicates work already done via conventional-commit
       prefixes), 4 measurable goals, target users, in-scope features,
       explicit non-goals. No internal inconsistency found in the idea.
     - **PRD checkpoint actually paused**: used `AskUserQuestion` to
       present the PRD summary and waited for a real user response
       ("Looks good, continue") before proceeding — not a simulated or
       skipped pause.
     - AI-applicability decision stated explicitly: no meaningful
       AI/ML component (deterministic prefix parsing, not a model/RAG/
       agent) → `ai-requirements-writer` skipped, reasoning stated
       before skipping.
     - `srs-writer` → `03-srs.md`: 25 functional requirements + 8
       non-functional requirements, every PRD feature traced to at
       least one FR, PRD non-goals explicitly carried over as
       constraints rather than silently dropped. Flagged two judgment
       calls that went slightly beyond the PRD's literal text (a
       concrete performance number, an extended type list) instead of
       silently asserting them as PRD fact — exactly the
       flag-don't-fix behavior the subagent prompts require.
     - `sdd-writer` → `04-sdd.md`: single-process synchronous CLI
       pipeline (no DB, no network, no concurrency — justified by the
       SRS having no requirement calling for more), every FR/NFR
       mapped to a component, and the mandatory "Technical constraints
       & operations" section's standout item was a shell-injection
       constraint (NFR-7: git subprocess calls must use argument
       vectors, never shell string-concatenation of user-controlled
       values) — a real, specific finding, not a "TBD" placeholder.
     - Verified (d) two ways: structurally (none of the four subagents
       have `Edit`) and empirically — `ls -la specs/git-changelog-cli/`
       showed strictly increasing file mtimes (00 → 01 → 03 → 04, no
       file's timestamp moved after a later stage ran), confirming no
       stage overwrote an earlier one.
     - Re-ran `check_build_log_consistency.py` with the real, complete
       `specs/git-changelog-cli/` directory present → exit 0.
   - All four originally-deferred verification questions are now
     answered: (a) content threads through upstream docs rather than
     being generic boilerplate (SRS cites PRD features, SDD maps every
     SRS requirement to a component); (b) the AI stage was correctly
     skipped with stated reasoning; (c) the PRD checkpoint genuinely
     paused on a real tool call, not a simulated wait; (d) no stage
     wrote to another stage's file, confirmed both structurally and via
     mtimes.
   - **Decision: kept `specs/git-changelog-cli/` in the repo** as a real
     worked example of the pipeline's output, rather than deleting it —
     unlike Attempt 1's partial artifact, this one is complete and
     correct, and a worked example is more useful evidence than an
     empty directory.
4. **Hook-safety check, done both by reading source and empirically**:
   confirmed via source (see Decision 2) that neither tool-use hook can
   fire for `specs/` writes; then ran
   `check_build_log_consistency.py` directly while `specs/
   git-changelog-cli/` existed → exit 0, confirming the new directory
   doesn't disturb the Stop hook's README/docs consistency check.
5. **`build-log-server` MCP tools** (`list_build_steps`,
   `mark_step_done`, `validate_build_log`) were still unreachable
   through Claude Code's own tool-calling this session (checked via
   `ToolSearch` before assuming otherwise) — same standing limitation
   noted since Step 5. `mark_step_done(10)` was called via the same raw
   JSON-RPC-over-stdio workaround used for Step 9, against the real
   `README.md`.

## `/blueprint-build` verification

Ran `/blueprint-build git-changelog-cli` (no target dir given, so the
default top-level `git-changelog-cli/` directory applied) by delegating
to `coding-agent` with the spec files as input, manually following
`blueprint-build.md`'s own instructions (same mid-session workaround as
every other slash-command test in this build log).

- `coding-agent` read all four spec files (00/01/03/04 — correctly
  noted `02-ai-requirements.md` doesn't exist and why) and implemented a
  stdlib-only Python CLI into the new `git-changelog-cli/` directory:
  an isolated subprocess layer (NFR-7's argument-vector requirement
  enforced, including an AST-level test asserting no shell-interpreted
  call path exists), a pure classification module, grouping with an
  entries-in/entries-out invariant, Markdown rendering, and a packaged
  `changelog` console-script entry point.
- Verified independently, not just by trusting the subagent's report:
  confirmed the directory and file structure exist as described; ran
  this repo's own `.venv/bin/ruff check src` and
  `.venv/bin/pytest src/tests/ -q` and got the same clean results as
  before (all passed) — confirming the new top-level directory doesn't
  interfere with this repo's own Python package; re-ran
  `check_build_log_consistency.py` → still exit 0.
- The subagent's own reported verification (47 tests passing via both
  `unittest` and `.venv/bin/pytest`, `ruff check .` clean inside the new
  directory, a real performance benchmark — 0.116s for 1000 commits
  against NFR-1's 2s budget, and a manual `pip install .` + run against
  this repo's own real commit history to confirm graceful catch-all
  behavior) was not independently re-run line-by-line, but the
  structural checks above corroborate it didn't silently break anything
  outside its own directory.
- This closes the last "Not yet done" item from the original plan:
  `/blueprint-build` is now confirmed working end-to-end against a real
  `/blueprint`-generated spec, not just designed.

## Second `/blueprint` test: an AI-component example

The first test (`git-changelog-cli`) deliberately had no AI/ML
component, so it never exercised `ai-requirements-writer`. Ran a second
test against `support-ticket-triage` — an LLM classifier (ticket
category/urgency) plus a RAG pipeline (similar-ticket + KB retrieval
feeding a drafted first response), with a hard product requirement that
no reply ever sends without human review. (The user's original
healthcare-AI example wasn't available to reconstruct accurately this
session, so this stand-in idea was used instead, with the user's
explicit go-ahead to pick one.)

- All five files were produced (`00-idea.md` through `04-sdd.md`,
  including `02-ai-requirements.md` this time), with strictly
  increasing mtimes confirming no cross-stage overwrite.
- `ai-requirements-writer` ran for the first time and correctly
  surfaced AI-specific risk the non-AI test could never have exercised:
  it flagged that the no-autonomous-send requirement needs
  *architectural* enforcement (the AI service should hold no
  credentials/network route to the send gateway), not just a prompt
  instruction, plus cross-ticket PII leakage via retrieval and prompt
  injection from untrusted ticket content.
- That flagged requirement propagated correctly through the rest of the
  chain instead of being lost: `srs-writer` turned it into a numbered
  NFR, and `sdd-writer` built it as a real component boundary (a
  separately-credentialed AI Worker with no network route to the
  outbound send gateway) — confirming the chain composes findings
  across stages, not just text.
- Every stage also correctly preserved upstream uncertainty rather than
  papering over it: unconfirmed SLA/latency/cost numbers and an
  unresolved regulatory-scope question were carried forward as explicit
  open constraints in the SRS and SDD, not silently resolved or quietly
  dropped.
- PRD checkpoint paused for real again (`AskUserQuestion`, explicit
  "Looks good, continue" before proceeding to the AI-applicability
  decision).

## Not yet done (deliberately)

- The `Write`-can-still-overwrite-another-stage's-file gap (Decision 3)
  has no enforcement beyond the prompt instruction — intentionally
  deferred until a live run surfaces a real incident, same reasoning
  already established for `code-reviewer`'s Bash gap in Step 9.
- `support-ticket-triage`'s spec was not run through `/blueprint-build`
  (no implementation attempted) — it's a documentation-chain example
  only; `git-changelog-cli` already covers the `/blueprint-build`
  verification.
