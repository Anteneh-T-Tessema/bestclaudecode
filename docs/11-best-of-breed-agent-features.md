# Step 11: Best-of-Breed Coding-Agent Features

## What we built

- `src/repo_map.py` — a stdlib-only, `ast`-based repo map. Walks a
  directory (skipping hidden/build/dependency directories), prints each
  Python file's top-level functions/classes with line numbers (plus one
  indent level of class methods), and skips-and-notes any file that
  fails to parse instead of crashing. `coding-agent.md`'s Understand
  step now tells it to run this before exploring an unfamiliar
  directory in full.
- A new "Replan, don't just retry" guard in `coding-agent.md`'s Iterate
  step, distinct from the existing repeated-fix guard — triggers when
  fixing one failure surfaces a new one, or a fix only keeps working via
  escalating workarounds, and tells the agent to go back to Plan with a
  genuinely different approach instead of continuing to patch.
- `.claude/commands/implement.md` → `/implement <task description>` — a
  bounded, single-retry self-review-and-fix loop: delegate to
  `coding-agent`, diff the result, delegate to `code-reviewer`; if
  Blocking findings come back, give `coding-agent` exactly one retry,
  then re-review the cumulative diff and report that verdict verbatim.
- `.claude/commands/blueprint-build.md` step 4 now runs this same loop
  against what `coding-agent` just built, instead of stopping after a
  bare build and pointing at `/review`.

## Why these three, and not others

The user asked to take the best, most valuable features from real
autonomous coding agents (Cursor, Devin, and by extension Aider/
SWE-agent/Codex) and fold them into this repo, which already states
(`coding-agent.md`) that it models itself on "Cursor's agent mode,
Devin, and Manus." Researched via WebSearch (2026-dated results):

- **Devin v3.0** — dynamic re-planning when blocked, a sandboxed
  multi-tool environment, autonomous PR creation, parallel sessions.
- **Cursor** — interactive Agent mode with a tool-call budget; async
  Background Agents that run on a branch and push a PR; a 2026
  "Computer Use" update that browses localhost to visually verify
  changes.
- **Aider** — a tree-sitter repo map: per-file symbol extraction, a
  file-dependency graph, PageRank-style ranking, packed into a token
  budget.
- **SWE-agent** — an Agent-Computer Interface: a deliberately narrow,
  LM-friendly tool surface instead of raw shell access.
- **OpenAI Codex (cloud)** — GitHub-integrated, opens PRs, responds to
  review comments, but is non-interactive — it can't course-correct
  mid-task the way an interactive agent can.

Three of these were both genuinely valuable and buildable inside this
repo's existing architecture without inventing new infrastructure (a
repo map, dynamic re-planning, and a verify-before-done loop). Four were
researched but **explicitly not pursued**, with reasons:

- **Cursor's async/Background Agents** — no infrastructure here for
  branch-per-task cloud execution; this repo's agents all run
  synchronously in the current session.
- **Codex's GitHub PR-comment-driven loop** — no GitHub Actions
  integration in scope.
- **SWE-agent's narrow ACI** — replacing `Read`/`Edit`/`Bash` wholesale
  with a custom tool surface would be a rewrite of this repo's entire
  tool-grant model, not an additive feature.
- **Visual/browser-based verification** (Cursor's Computer Use) — no
  browser tool available in this setup.

## Real decisions made

1. **Subagents can't delegate to other subagents — confirmed by direct
   inspection, and that's why `/implement` is a slash command, not a
   capability built into `coding-agent`'s own prompt.** None of this
   repo's subagent files (`code-reviewer.md`, `coding-agent.md`, the
   four SDLC writers) grant the `Agent` tool. So the self-review loop
   has to be orchestrated by the top-level assistant, the same way
   `/blueprint` orchestrates its 4-stage writer chain.
   - This is a **different constraint** from the registration-lag issue
     `docs/09-code-reviewer-agent.md` documented empirically (`Agent
     type 'X' not found` for a subagent defined after session start).
     Registration-lag only affects subagents *newly created* in the
     current session; it says nothing about whether an *already-loaded*
     subagent can call another one — it can't, ever, because the tool
     isn't granted, regardless of session age. `/implement` calls
     `coding-agent` a second time (the retry step) from the command
     level, re-using an already-loaded subagent — unaffected by either
     constraint, and confirmed working in the live test below.

2. **`repo_map.py` is deliberately flat: Python-only, stdlib `ast`, no
   cross-file dependency graph, no ranking.** Aider's version builds a
   multi-language dependency graph and ranks it with a PageRank-style
   algorithm — real engineering this repo's size doesn't warrant. A
   flat per-file symbol listing gives `coding-agent` the same kind of
   orientation value at a fraction of the complexity.
   - On a file that fails to parse, it's skipped and noted in the
     output (`<path> -- SKIPPED (syntax error: ..., line ...)`) rather
     than crashing the whole map — verified directly (see Verification
     §2).

3. **The new "Replan, don't just retry" guard is worded to be explicitly
   distinct from the existing stuck-loop guard**, since both live in the
   same Iterate step and could otherwise read as duplicates. The
   existing guard ("if the same fix attempt fails twice in a row, stop
   repeating it") triggers on *repetition of one fix*. The new guard
   triggers on a different signal — fixing one failure surfaces a new,
   unrelated one, or a fix only keeps working via escalating
   workarounds — and explicitly says "this is a different case from the
   repeated-fix guard above" in its own text.

4. **`/implement`'s loop is bounded at exactly one retry, with strict
   verbatim-reporting rules for the failure case.** If Blocking findings
   remain after the one retry, the command must report the second
   review's verdict verbatim, state plainly (without softened language
   like "mostly works") that the change is not verified clean, and
   stop — no further automatic retries. The second review is scoped to
   the **cumulative diff since `/implement` started**, not just a
   re-check of the original findings, so a regression introduced by the
   retry itself would also get caught.

5. **`/blueprint-build` reuses the same loop rather than getting its own
   copy**, and adds one extra line on top: if Blocking findings remain
   after the retry, it reminds the user they can run `/review` directly
   or revisit `specs/<slug>/` by hand — so a `/blueprint-build` user
   isn't left with nothing when the bounded loop doesn't fully resolve
   things.

## Verification performed

1. **Config/structure check**: `.venv/bin/ruff check src` and
   `.venv/bin/pytest src/tests/ -q` pass after adding `repo_map.py` and
   its tests (9 passed at that point); `coding-agent.md`'s frontmatter
   is unchanged (no new tool grant needed — it already has `Bash`).
2. **Direct unit verification of `repo_map.py`**, not just trusting a
   subagent: ran `python3 -m src.repo_map src` against this repo's own
   `src/` directory and confirmed the output lists every real function
   correctly (`normalize_step_name`, `double`, all of `repo_map.py`'s
   own functions, every test function) with correct line numbers,
   including the placeholder `(no top-level functions or classes)` for
   both bare `__init__.py` files. A dedicated test
   (`test_skips_unparseable_file_instead_of_raising`) confirms a
   deliberately broken fixture file produces the `SKIPPED` note instead
   of raising.
3. **Naming-collision check**: `find ~/.claude/skills -maxdepth 1 -type
   d` immediately before writing `implement.md` — no `implement`
   present in the global skill list.
4. **Live end-to-end test of `/implement`**, via the established
   manual-delegation workaround (slash commands can't be typed by the
   assistant itself mid-session) — task: add a `--no-methods` flag to
   `repo_map.py` itself, suppressing class methods from its own output.
   - `coding-agent` implemented the flag (threaded `include_methods:
     bool = True` through `main` → `build_repo_map` → `_outline_file`),
     added 5 new tests, and reported `.venv/bin/ruff check src` clean
     and `.venv/bin/pytest src/tests/ -q` at 14 passed.
   - **Discovered a real, unanticipated gap while scoping the diff for
     `code-reviewer`**: `/implement`'s diff-scoping logic was copied
     wholesale from `/review` (`git diff` → `git diff HEAD` → merge-base
     diff), but the entire change was confined to files that were
     *new and untracked* in this session (`src/repo_map.py`,
     `src/tests/test_repo_map.py`). `git diff` and `git diff HEAD` both
     silently show nothing for untracked files — confirmed directly
     (`git diff --stat` and `git diff HEAD --stat` both omitted them).
     None of the three fallback stages in `/review`'s own logic actually
     covers "the whole change is new files" — `/review` would hit the
     identical gap if pointed at this same situation; it isn't a bug
     `/implement` introduced, it's a latent gap in the logic it borrowed.
     Worked around it live the same way `/review`'s own path-argument
     rule already prescribes ("no diff for that path → review the full
     file instead"): pointed `code-reviewer` directly at the two full
     files. Left as a **named, not-yet-fixed gap** (see below) rather
     than patched in this step, since fixing it properly means fixing
     `/review`'s shared logic too, which is out of this step's scope.
   - `code-reviewer`'s verdict: **zero Blocking findings** (1 should-fix
     — CLI arg parsing silently treats an unrecognized flag as the path
     argument; 2 nits; 2 notes). Per `/implement`'s step 5, this means
     the run reported success without a retry.
   - **Honest finding**: this live test only exercised the happy path.
     The corrective-retry path (step 6 onward — re-delegating to
     `coding-agent` with Blocking findings, then re-reviewing the
     cumulative diff) was *not* naturally exercised, since the first
     review came back clean. No failure was fabricated to force the
     retry path to run; this is stated plainly rather than glossed over.
5. **Hook-safety check**: `repo_map.py`'s and `test_repo_map.py`'s
   writes are under `src/`, so both `check_docstrings.py` and
   `check_src_change.py` fired as expected — confirmed implicitly by
   the writes succeeding (a docstring violation would have blocked the
   `Write` outright) and explicitly by `ruff`/`pytest` passing
   afterward. `check_build_log_consistency.py` re-run after this doc and
   the `README.md` update (see below) reports exit 0.
6. `mark_step_done(11)` called via the same MCP workaround used for
   Steps 9/10, against the real `README.md`.

## Not yet done (deliberately)

- **The diff-scoping gap found in Verification §4 is not fixed.**
  `/implement` and `/review` both silently produce an empty diff when
  the entire change is confined to new/untracked files, with no
  fallback stage that handles that case. The live test worked around it
  manually; a real fix (e.g. detecting untracked files via `git status
  --porcelain` and including them) would need to land in `/review`'s
  shared logic too, not just `/implement`'s copy of it — deferred until
  a live run outside this controlled test actually needs it, same
  reasoning already established for `code-reviewer`'s Bash-can-still-
  mutate gap (Step 9) and the SDLC writers' Write-overwrite gap
  (Step 10).
- **`repo_map.py` has no cross-file import graph or relevance ranking.**
  For this repo's current size, a flat per-file listing is enough
  signal; Aider's PageRank-style ranking exists to solve a token-budget
  problem at a scale this repo doesn't have yet. Revisit if/when
  `coding-agent` is regularly working in a directory large enough that
  a flat listing stops being useful at a glance.
- **The corrective-retry path in `/implement` (steps 6-8) has not been
  exercised by a live failing review** — see Verification §4. The logic
  is written and the bound (exactly one retry) is explicit, but it's
  untested against a real Blocking finding.
- The four researched-but-not-pursued features (Cursor's async
  Background Agents, Codex's PR-comment loop, SWE-agent's narrow ACI,
  visual/browser verification) remain just that — researched, with
  reasons recorded above, not built.
