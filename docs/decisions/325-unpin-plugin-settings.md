# chore: stop enabling the ticket-workflow plugin in this repo's settings

Issue: [#325](https://github.com/askrzypczak/ttrpg-agents/issues/325).

## 325.1 The ticket-workflow plugin is installed at user scope; this repo's settings do not enable it

- Decided by: maintainer (in the ticket, 2026-10-31); askrzypczak/claude-workflow#187 makes the same change there.
- Context: `.claude/settings.json` carried the plugin and marketplace entries, which made a project-scope install for each clone. In the agent container the poller updates only the user-scope install before each poll, so the project-scope copy went stale: with claude-workflow `main` at `6eb2b84`, this repo's entry was still on `6000ff52de5f`.
- Options:
  - Chosen: user scope only. The settings keep just the permissions, and each machine or container installs the plugin once (`claude plugin marketplace add askrzypczak/claude-workflow`, then `claude plugin install ticket-workflow@askrzypczak-plugins --scope user`). A fresh clone no longer prompts for the plugin.
  - Keep project-scope enabling and update every scope on each poll: more poller work for every served repo, and uninstalling a stale entry rewrites the tracked settings and leaves the clone dirty.
- Where: `.claude/settings.json`; `CLAUDE.md` (Work practices).
- Revisit if: a project needs a plugin version other than the one installed for the user.
- Status: active
