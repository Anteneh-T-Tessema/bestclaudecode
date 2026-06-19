---
description: Generate a full pre-development spec (PRD, AI requirements if applicable, SRS, SDD) for a new project idea by delegating each stage to a dedicated writer subagent.
argument-hint: <business idea description>
---
This command's whole point is to exercise the spec-writer subagents in
sequence — don't write any of these documents yourself.

1. If `$ARGUMENTS` is empty, ask the user to describe the idea instead of
   guessing one.
2. Derive a short kebab-case slug from the idea (2-4 words, lowercase,
   hyphen-separated). Create `specs/<slug>/` and write
   `specs/<slug>/00-idea.md` containing the idea description verbatim
   plus today's date.
3. Delegate to the `prd-writer` subagent: tell it the slug and to read
   `specs/<slug>/00-idea.md` and write `specs/<slug>/01-prd.md`.
4. Summarize the PRD's business problem and goals in a few lines, then
   ask the user to confirm before continuing. A bad PRD cascades into
   every downstream document, so this is the one checkpoint in this
   pipeline — don't skip it. If they want changes, go back to
   `prd-writer` with their feedback rather than continuing.
5. Decide whether this idea has a meaningful AI/ML component (a model,
   RAG, an agent, predictions — not merely "calls a third-party API").
   State your reasoning either way.
   - If yes, delegate to the `ai-requirements-writer` subagent: tell it
     the slug, to read `specs/<slug>/00-idea.md` and
     `specs/<slug>/01-prd.md`, and write `specs/<slug>/02-ai-requirements.md`.
   - If no, say explicitly that you're skipping this stage and why.
6. Delegate to the `srs-writer` subagent: tell it the slug, to read
   `specs/<slug>/01-prd.md` (and `specs/<slug>/02-ai-requirements.md` if
   it exists), and write `specs/<slug>/03-srs.md`.
7. Delegate to the `sdd-writer` subagent: tell it the slug, to read
   `specs/<slug>/03-srs.md` (and `specs/<slug>/02-ai-requirements.md` if
   it exists), and write `specs/<slug>/04-sdd.md`.
8. Report a summary of every document produced (path + one-line
   description) and tell the user they can run
   `/blueprint-build <slug>` to start implementation, or review/edit any
   document by hand first.

Files under `specs/` are outside `docs/` and `src/` on purpose — they
don't interact with this repo's own build-log hooks at all.
