
# CLAUDE.md — Agent Workflow Instructions

## Issue → PR Workflow

When given a GitHub issue number to work on:

0. **Update the code ** using `git pull origin main` and then `git checkout main`
1. **Read the issue** using `gh issue view {number}`
2. **Create a branch** `git checkout -b fix/issue-{number}-short-description`
3. **Implement the solution** — write clean, minimal changes
4. **Run tests** before committing
5. **Commit** with `git commit -m "fix: description (#number)"`
6. **Push** the branch
7. **Open a PR** using `gh pr create` with body containing `Closes #{number}`

## PR Template
Title: `fix: {short description} (#issue_number)`
Body:
  - What the issue was
  - What was changed
  - How to test it
  - `Closes #{number}`

## Rules
- Never push directly to main/master
- Always branch from latest main
- Keep PRs small and focused on one issue