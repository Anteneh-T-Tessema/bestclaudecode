---
plan: plans/implement-cli-command-for-searching-python-files.json
---

# Implement CLI command for searching Python files

## Problem
Difficulty in finding specific code snippets in large projects

## Scope
Searching Python files in the project directory and its subdirectories

## Open Questions
- How to handle case sensitivity
- How to optimize search performance for large projects

## Subtasks
- [01] Create a new function in the CLI module to accept a search string and project directory as arguments
- [02] Use the `os` module to walk through the project directory and its subdirectories to find Python files
- [03] Implement a loop to read each Python file line by line and check for the search string using the `re` module
- [04] Print each match with its file path and line number using an f-string
- [05] Handle exceptions for file not found or permission errors when reading files
- [06] Add a `--case-insensitive` flag to the CLI command to allow for case insensitive searching
- [07] Use the `argparse` module to define the CLI command and its arguments
