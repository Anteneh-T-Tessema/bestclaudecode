# Idea

Date: 2026-06-18

A CLI tool that turns git commit history into changelog entries. Point
it at a repo and a commit range (e.g. a tag range), and it groups commits
by type (feature, fix, chore, etc., inferred from conventional-commit
prefixes where present) and generates a clean, human-readable CHANGELOG
section ready to paste into a release.
