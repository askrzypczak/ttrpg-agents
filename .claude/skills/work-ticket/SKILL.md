---
name: work-ticket
description: Work a GitHub issue end to end - claim it, branch in a worktree, implement, open a PR, hand off for review. Use when asked to "work ticket #N" or pick up an issue.
---

# work-ticket

Argument: an issue number `N`. Agents are always launched with an explicit number; do not auto-pick, to avoid claim races.

1. **Read**: `gh issue view N --comments --json number,title,body,labels,assignees,state`.
   - Stop and report if the issue is closed, has the `blocked` label, or its body has an open `Blocked by #M` (check `gh issue view M --json state`).
   - Stop if it already has `in-progress` (another agent has it).
2. **Claim**: `gh issue edit N --add-assignee @me --add-label in-progress --remove-label ready`, then comment "Claimed; working in branch `issue-N-<slug>`."
3. **Branch**: enter a worktree and create branch `issue-N-<short-slug>` from `origin/main`.
4. **Work**: implement the ticket. Keep scope to the ticket; file a new issue (`gh issue create`) for anything adjacent instead of expanding.
5. **PR**: commit, push, `gh pr create --draft` with `Closes #N` in the body, then `gh issue edit N --add-label needs-review --remove-label in-progress`.
6. **Report**: comment on the issue with a short summary and the PR link. If you cannot finish, comment what was done and remove `in-progress`, adding `blocked` with the reason.

Never push to `main` and never merge; the owner reviews and merges.
