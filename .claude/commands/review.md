---
description: Delegate to the code-reviewer subagent to critique a diff or path — never edits anything, only reports findings.
argument-hint: [optional path or ref-range, e.g. src/foo.py or main...HEAD]
---
Delegate this to the `code-reviewer` subagent — don't review the code
yourself, the point of this command is to exercise that subagent.

Figure out the scope from `$ARGUMENTS` before delegating, so the
subagent reviews the actual change under review instead of defaulting
to reading the whole repository:

1. Empty — use `git diff` (unstaged changes). If that's empty, fall back
   to `git diff HEAD` (staged + unstaged). If that's also empty, fall
   back to the diff against the upstream merge-base with the default
   branch.
2. Looks like a ref-range (contains `..`) — pass it straight through as
   `git diff $ARGUMENTS`.
3. Looks like a path — diff for that path; if there's no diff for it,
   review the full file instead.

Tell the subagent the exact diff or path scope you determined — do not
let it default to reading the whole repository. Report its findings
back as-is; don't edit anything yourself even if a finding looks
trivial to fix.
