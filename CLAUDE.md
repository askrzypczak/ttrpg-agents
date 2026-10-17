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
- Agents are dispatched manually with an explicit ticket number and follow the `work-ticket` skill from the `ticket-workflow` plugin (see Work practices). Never auto-pick tickets.
- Find work: `gh issue list --label ready --json number,title`.

## Work practices
- The workflow itself (skills `work-ticket`, `address-feedback`; subagents `implementer`, `reviewer`; `grg.sh`) lives in the private plugin marketplace repo `askrzypczak/claude-workflow` (local clone `~/Projects/claude-workflow`), enabled in `.claude/settings.json`. Change the workflow there, not here. The guardrails and these conventions stay in this repo.
- Flow: plan (plan mode) -> **Tony signs off** -> `implementer` subagent -> green/red/green test proof -> `reviewer` subagent (complex changes only) -> PR with CI green -> **Tony reviews** -> `address-feedback` skill (summarise, ask questions, then fix).
- The local `main` checkout can be stale. Before planning or filing tickets, `git fetch origin` and read `origin/main` (`git show origin/main:<path>`, `git ls-tree`), not the working tree.
- Models: orchestrator in the main session; `implementer` defaults to sonnet/medium (haiku/xhigh for mechanical work, set in the approved plan); `reviewer` is opus/medium.
- Tests are mandatory. No TDD requirement; instead prove tests with green/red/green: the plugin's `grg.sh` (mechanical) plus targeted breaks of the implementation for logic-heavy code. Evidence goes in the PR body.
- "Complex" = branching logic, new abstractions, shared code, security/data handling; complexity decides whether the reviewer runs.
- Agents may push their own `issue-N-*` branch. Humans merge; nobody pushes to `main`, force-pushes, or runs `gh pr merge`. Enforced locally by `.claude/hooks/guard-git.sh` (tests: `.claude/hooks/test-guard-git.sh`) and deny rules in `.claude/settings.json`. GitHub branch protection is unavailable on this free private repo.
- PRs are opened as active (not draft): this is a team of one human, so draft would only signal "review needed", which the `needs-review` label already does. `npm run check` (once scaffolded) is the single definition of done and what CI runs.
