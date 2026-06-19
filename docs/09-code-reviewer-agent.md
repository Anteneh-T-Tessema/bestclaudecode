# Step 9: Code Reviewer Subagent

## What we built

- `.claude/agents/code-reviewer.md` — a second subagent, read-only by
  construction: `tools: Read, Grep, Glob, Bash`, deliberately omitting
  `Edit`/`Write`. It reviews a diff or file and reports structured
  findings (verdict line + severity-grouped list); it never patches
  anything.
- `.claude/commands/review.md` → `/review [path or ref-range]` —
  resolves `$ARGUMENTS` into a concrete diff/file scope, then delegates
  to `code-reviewer`, mirroring `/validate`'s (Step 7) anti-shortcut
  pattern.

## Why this subagent, this way

`coding-agent` (Step 3) can mutate files: `Read, Edit, Write, Bash, Grep,
Glob`. A reviewer should never be able to — and the only way to actually
guarantee that is at the harness level, by not granting `Edit`/`Write`
in the first place, rather than relying on a prompt instruction the
model could ignore or get talked out of. This step exists specifically
to build that contrast as a second, concrete example, not just a
restatement of Step 3.

## Real decisions made

Mapped to the four lenses this exercise was meant to cover:

1. **Tool design** — `tools: Read, Grep, Glob, Bash`, no `Edit`/`Write`/
   `MultiEdit`. `Bash` stays because `git diff`/`git log`/`git show` and
   this project's existing read-only checks (`.venv/bin/ruff check .`,
   `.venv/bin/pytest src/tests/ -q`, `npm test`) all need it — but the
   system prompt explicitly scopes Bash to reading/checking only (no
   `git commit`/`git add`, no `rm`, no `>`/`>>` redirects). That's a
   named, honest gap, not a guarantee — see "Not yet done" below. A
   bespoke MCP tool for `git diff` was considered and rejected: Bash+git
   already does this, and building one without a concrete need would be
   exactly the kind of speculative scaffolding root `CLAUDE.md` warns
   against.
2. **Context engineering** — `/review`'s `$ARGUMENTS` handling resolves
   to a concrete scope before delegating, so the subagent never defaults
   to reading the whole repo: empty → `git diff` (unstaged → staged →
   merge-base fallback chain), a ref-range (contains `..`) → passed
   through to `git diff`, a path → diff for that path or full-file
   review if there's no diff.
3. **Prompt engineering** — `code-reviewer`'s operating loop is renamed
   for its task (Understand → Scope → Critique → Verify claims →
   Report) rather than reusing `coding-agent`'s Plan/Act/Iterate, plus a
   severity taxonomy (`Blocking`/`Should-fix`/`Nit`/`Note`) and an
   explicit "what NOT to flag" section (no praise-padding, no unscoped
   style nits, no speculative refactors) — a reviewer left unconstrained
   tends to either over-praise or scope-creep into a redesign.
4. **Harness engineering** — omitting `Edit`/`Write` from the tool list
   is the structural guarantee; the prompt-level "Bash is read-only"
   instruction is the (weaker, honestly-labeled) fallback for the one
   gap the tool list can't close on its own.

### Decision: no new hook

Considered and rejected adding a fourth hook to police this subagent's
`Bash` usage:

- Omitting `Edit`/`Write` already makes file mutation via that channel
  structurally impossible — a `PreToolUse` hook matching
  `Edit|Write|MultiEdit` would never fire for `code-reviewer`, since it
  has no access to those tool names at all. There's nothing for it to
  catch.
- The real residual gap — `Bash` mutating via `rm`/redirects — is a
  different problem class than this repo's existing three hooks solve.
  Each of those exists because a real rule or incident motivated it
  (Step 6's docstring convention, Step 8's checklist/doc mismatch).
  There isn't an equivalent incident here yet, and writing a hook to
  police a hypothetical is the same speculative-scaffolding trap as
  decision 1 above.
- Mitigation instead: the subagent's own prompt enumerates exactly what
  Bash is for (read-only git/test/lint commands) and says not to use it
  for anything else. If a live run ever shows it misusing Bash, that
  becomes the concrete trigger to add a scoped hook — tracked below as
  deliberately not yet done, not built preemptively.

## Verification performed

1. **Config-validity check** (same level as Step 3's subagent check —
   a `.claude/agents/` file is config, not `src/` code, per
   `skills/test-writing/SKILL.md`'s exemption): parsed the frontmatter,
   confirmed `name`/`description`/`tools`/`model` are present, `name` is
   the slug `code-reviewer`, and — the one check that actually matters
   for the harness-engineering claim — `tools` does **not** contain
   `Edit`, `Write`, or `MultiEdit`. Passed.
2. **Attempted a live `/review` run and hit a real, honest limitation**
   instead of a clean pass:
   - First tried invoking it via the `Skill` tool. That resolved to an
     unrelated, pre-existing, globally-installed Skill also named
     "review" (part of a separate toolset on this machine, living under
     `~/.claude/skills/review/`) — not this repo's `.claude/commands/`
     slash command. Skills (`.claude/skills/*/SKILL.md`) and slash
     commands (`.claude/commands/*.md`) are different mechanisms; the
     `Skill` tool only resolves the former. That unrelated skill's
     instructions were not executed.
   - Corrected by manually following `review.md`'s own instructions
     (the same approach Step 7 used to test `/validate`/`/build-status`)
     and delegating to `code-reviewer` directly via the `Agent` tool.
     That call failed: `Agent type 'code-reviewer' not found` — the
     Agent tool's available-agent registry still only listed the
     original set (`coding-agent`, etc.) from session start. Unlike
     slash commands, which Step 7 confirmed hot-reload immediately, a
     new `.claude/agents/*.md` file is not picked up mid-session — the
     same class of limitation Step 5/7 already hit with the
     `build-log-server` MCP connection (confirmed here too: searching
     for `mark_step_done`/`list_build_steps`/`get_step_log` in this
     session still finds nothing).
   - Given that, the actual subagent delegation and the "no
     Edit/Write/MultiEdit calls" transcript check are deferred to a
     fresh session rather than faked — see "Not yet done."
3. **Live behavioral test, run after the subagent-registration gap above
   resolved itself in a later session**: created
   `scratch_review_test.py` at the repo root (outside `src/`, so Step 6's
   hooks don't fire) with a planted, obvious bug — `average()` computed
   `total / len(numbers) - 1` instead of `total / len(numbers)` — then
   delegated to `code-reviewer` directly via the `Agent` tool (the file
   was untracked, so `git diff` for it was empty; per `review.md`'s
   own fallback rule, that means reviewing the full file instead).
   - **Run 1 (buggy version)**: verdict "1 blocking, 1 should-fix."
     The blocking finding correctly identified the exact bug, cited
     `scratch_review_test.py:10`, and — per the "Verify claims" step —
     actually ran `average([1,2,3])` and `average([4])` and reported the
     real wrong outputs (`1.0`/`3.0` instead of `2.0`/`4.0`) rather than
     asserting the bug without checking. It also independently found a
     real should-fix issue not planted on purpose (`average([])` raises
     `ZeroDivisionError`, verified by actually running it), plus a Note
     correctly declining to weigh in on whether the scratch file should
     be deleted (a workflow decision, not a code-review finding).
   - Fixed the bug, leaving the empty-list edge case in place.
   - **Run 2 (fixed version)**: verdict "no blocking issues, no
     should-fix issues" — confirmed it does not fabricate findings
     against a corrected file. One honest nuance: the same empty-list
     `ZeroDivisionError` that was Should-fix in run 1 was downgraded to
     a Note in run 2, reasoned as "given the file's own docstring states
     it's a throwaway scratch file... this isn't worth flagging." That's
     a defensible severity judgment reacting to context the file itself
     states, not a fabricated or contradicted finding (the underlying
     fact — division by zero is unhandled — was reported identically
     both times), but it's a real example of severity judgment shifting
     between runs and is recorded here rather than smoothed over.
   - **Harness guarantee**: `code-reviewer`'s tool list is `Read, Grep,
     Glob, Bash` — `Edit`/`Write`/`MultiEdit` are not present in its
     tool definitions at all, so there is no transcript to inspect for
     "did it call them" the way there would be for a subagent that has
     those tools and is merely instructed not to use them. The guarantee
     holds by construction, confirmed by the same config check in
     verification item 1 above, not by post-hoc transcript review.
   - Deleted `scratch_review_test.py` afterward; confirmed via
     `git status` that the repo returned to a clean state with no trace
     of the scratch file.
4. **Stop hook**: ran `check_build_log_consistency.py` directly
   (`echo '{}' | python3 .claude/hooks/check_build_log_consistency.py`)
   → exit 0. Writing this doc doesn't trip it: the hook only
   cross-checks step numbers that already have a line in README's
   checklist, and Step 9 doesn't have one yet (see below), so there's
   nothing to compare against until that line is added.

## Not yet done (deliberately)

- **Update**: the live behavioral test above (delegating to
  `code-reviewer` against a planted bug, then a clean re-run) is now
  done — see verification item 3. It ran via direct `Agent`-tool
  delegation rather than literally typing `/review`, since slash
  commands can only be triggered by typed user input, not invoked by
  the assistant itself; this mirrors how Step 7 verified `/validate`.
  The actual `/review` command file's `$ARGUMENTS`-resolution logic
  (empty → `git diff` fallback chain, ref-range, path) is still only
  verified by inspection, not by a literal `/review <args>` invocation
  in this session — left for a fresh session along with the item below.
- **Update**: `mark_step_done` for step 9 is also done now — the
  `build-log-server` MCP tools were still unreachable through Claude
  Code's own tool-calling in this session, so rather than wait for a
  fresh session, `mark_step_done` was called the same way
  `validate_build_log` was verified earlier: piping raw JSON-RPC
  directly to the compiled server over stdio (`node
  dist/index.js`), against this repo's real `README.md`, not a
  fixture. It first refused with "Step 9 isn't in README.md's status
  checklist at all" — correct, since (unlike Steps 6-8, which had their
  unchecked lines pre-added before being built) Step 9's line never
  existed. Added `- [ ] Step 9: Code reviewer subagent` by hand (matching
  how Steps 6-8's lines were originally added, per `git log -p --
  README.md`), then called `mark_step_done` again — it flipped the
  checkbox for real. `validate_build_log` and
  `check_build_log_consistency.py` both confirm the repo is consistent
  afterward.
  - **Aside**: piping `mark_step_done` and `validate_build_log` as two
    requests in the same stdio batch showed their responses arrive
    out of request order — `validate_build_log`'s response (still
    reporting Step 9 inconsistent) came back before `mark_step_done`'s,
    even though it was sent second. The two calls aren't queued
    sequentially; each handler's async I/O can resolve in either order.
    Re-running `validate_build_log` alone, after confirming the write
    had landed, gave the correct "consistent" result. Not a bug — just
    a reminder that two tool calls piped in one batch over stdio are
    concurrent, not synchronous, and order-dependent reads need to wait
    for the write's response first.
- The `Bash`-can-still-mutate gap noted in "Real decisions made" has no
  enforcement beyond the prompt instruction — intentionally deferred
  until a live test surfaces a real incident (see "Decision: no new
  hook").
