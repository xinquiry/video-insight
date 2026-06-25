---
name: issue-to-pr
description: Resolve a GitHub issue end-to-end. Read the issue, branch from latest main, implement the fix or enhancement, run checks/tests, commit, push, and open a PR that closes the issue. Use when given a GitHub issue number, or when asked to fix/enhance something and open it as a PR.
---

# Issue → PR Workflow

When given a GitHub issue number (or asked to fix/enhance an issue and open a PR), work it end-to-end:

1. **Sync main** — `git checkout main && git pull origin main`. Always branch from the latest main; never push directly to main/master.
2. **Read the issue** — `gh issue view {number}`. Understand the reported problem or requested enhancement before touching code.
3. **Create a branch** — `git checkout -b fix/issue-{number}-short-description` for fixes, or `enhance/issue-{number}-short-description` for enhancements. Keep it focused on this one issue.
4. **Implement the solution** — write clean, minimal changes that address the issue. Match surrounding code style.
5. **Run checks** — `just check` (lint + type) and `just test` before committing. Fix anything that fails.
6. **Commit** — `git commit -m "fix: short description (#number)"` (or `feat:`/`enhance:` as appropriate), referencing the issue number.
7. **Push** — `git push -u origin <branch>`.
8. **Open a PR** — `gh pr create` with a body that includes `Closes #{number}` so the issue auto-closes on merge.

## PR format

- **Title:** `fix: {short description} (#{issue_number})` (or `feat:` for enhancements)
- **Body:**
  - What the issue was
  - What was changed
  - How to test it
  - `Closes #{number}`

## Rules

- Never push directly to main/master.
- Always branch from latest main (pull before branching).
- Keep PRs small and focused on one issue.
- Don't mark the work done until checks and tests pass.
