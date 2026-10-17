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
- Agents are dispatched manually with an explicit ticket number and follow the `work-ticket` skill (`.claude/skills/work-ticket/SKILL.md`). Never auto-pick tickets.
- Find work: `gh issue list --label ready --json number,title`.

## Work practices
- Flow: plan (plan mode) -> **Tony signs off** -> `implementer` subagent -> green/red/green test proof -> `reviewer` subagent (complex changes only) -> draft PR with CI green -> **Tony reviews** -> `address-feedback` skill (summarise, ask questions, then fix).
- Models: orchestrator in the main session; `implementer` defaults to sonnet/medium (haiku/xhigh for mechanical work, set in the approved plan); `reviewer` is opus/medium. Agents live in `.claude/agents/`.
- Tests are mandatory. No TDD requirement; instead prove tests with green/red/green: `scripts/grg.sh` (mechanical) plus targeted breaks of the implementation for logic-heavy code. Evidence goes in the PR body.
- "Complex" = branching logic, new abstractions, shared code, security/data handling; complexity decides whether the reviewer runs.
- Agents may push their own `issue-N-*` branch. Humans merge; nobody pushes to `main`, force-pushes, or runs `gh pr merge`. Enforced locally by `.claude/hooks/guard-git.sh` (tests: `.claude/hooks/test-guard-git.sh`) and deny rules in `.claude/settings.json`. GitHub branch protection is unavailable on this free private repo.
- All PRs are opened as drafts. `npm run check` (once scaffolded) is the single definition of done and what CI runs.
