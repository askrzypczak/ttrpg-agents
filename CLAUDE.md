# ttrpg-agents

Agentic tooling for D&D and TTRPGs in general: assistance for the DM during play, plus related experiments.

## Status
Early setup. Likely TypeScript/Node; no tooling scaffolded yet.

## Conventions
- Owner: Tony (personal GitHub account `askrzypczak`). Private repo.
- Keep this file short; record decisions here as they are made.

## Ticketing workflow
GitHub Issues is the source of truth; use `gh` (at `/opt/homebrew/bin/gh` if not on PATH).
- State labels: `ready` -> `in-progress` -> `needs-review`; `blocked` when waiting. `agent-ok` marks tickets safe for unattended background agents.
- Type labels: `bug`, `feature`, `chore`. Create/refresh all labels with `scripts/setup-labels.sh`.
- One ticket = one worktree = one branch (`issue-N-slug`) = one PR containing `Closes #N`.
- Dependencies: write `Blocked by #M` in the issue body.
- Background agents are launched with an explicit ticket number and follow the `work-ticket` skill (`.claude/skills/work-ticket/SKILL.md`). Never push to `main` or merge.
- Find work: `gh issue list --label ready,agent-ok --json number,title`.
