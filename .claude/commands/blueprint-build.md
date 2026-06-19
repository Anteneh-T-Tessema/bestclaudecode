---
description: Delegate implementation of a /blueprint-generated spec to coding-agent, using specs/<slug>/*.md as the spec input.
argument-hint: <project-slug> [target directory]
---
Delegate this to the `coding-agent` subagent — don't implement it
yourself, the point of this command is to exercise that subagent against
a real generated spec.

1. Parse `$ARGUMENTS` as `<slug> [target directory]`. If `specs/<slug>/01-prd.md`
   doesn't exist, tell the user to run `/blueprint <idea>` first instead
   of guessing at a slug.
2. Determine the target directory: the second argument if given,
   otherwise a new top-level `<slug>/` directory.
3. Delegate to `coding-agent`: tell it to read every `specs/<slug>/*.md`
   file that exists (00-idea, 01-prd, 02-ai-requirements if present,
   03-srs, 04-sdd) as its spec, and implement accordingly into the
   target directory from step 2.
4. Once it reports back, run the same review-and-fix loop `/implement`
   uses (its steps 3-8: diff the result, delegate to `code-reviewer`,
   and if Blocking findings come back, give `coding-agent` exactly one
   retry before re-reviewing the cumulative diff and reporting the
   verdict verbatim). If Blocking findings still remain after that one
   retry, say so plainly and remind the user they can run `/review`
   directly or revisit `specs/<slug>/` by hand — don't leave them with
   nothing if the bounded loop doesn't fully resolve things.
