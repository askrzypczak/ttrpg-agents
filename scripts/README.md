# scripts

## Agent poller (automatic ticket dispatch)

Every 3 minutes a macOS LaunchAgent runs `agent-poller.sh`, which starts an interactive background Claude Code session for each ticket that is ready for an agent. Sessions show up in `claude agents`.

A ticket is picked up when it is **open**, authored by `askrzypczak`, and labelled **`agent-ok` + `ready`** (and is not `in-progress`, `blocked` or `agent-failed`). The session is named `ttrpg-<issue>` and runs the `work-ticket` skill.

### Setup (once)
1. Create the labels: `scripts/setup-labels.sh` (adds `skip-plan` and `agent-failed` among others).
2. Trust the workspace: run `claude` once in the main checkout, accept the prompt, exit. `claude --bg` fails in an untrusted directory.
3. Install the LaunchAgent **from the main checkout, not a worktree**: `scripts/install-launchd.sh`.

Remove it with `scripts/install-launchd.sh uninstall`.

### Daily use
1. Write the ticket, then add `agent-ok` and `ready`. Within ~3 minutes a session starts.
2. Open `claude agents` to see it. A session in the `blocked` state is waiting for you: usually the plan sign-off, but also questions and permission prompts. Attach with `claude attach ttrpg-<issue>`, answer, and leave it running.
3. For easy tickets add `skip-plan`: the session runs `work-ticket N auto` and skips the plan sign-off. It still asks if the ticket is ambiguous or risky.
4. When it finishes, the ticket is `needs-review` with a PR. Review as usual.

### When something fails
If a session fails, is stopped, or ends without handing the ticket off, the poller adds `agent-failed` and comments with how to inspect it (`claude logs ttrpg-<issue>`). To retry, remove `agent-failed` and add `ready` again.

### Checking on it
| What | Command |
|---|---|
| Log | `tail -f ~/Library/Logs/ttrpg-agents.log` |
| Is it loaded? | `launchctl list \| grep ttrpg` |
| Sessions | `claude agents` (or `claude agents --json --all`) |
| One session's output | `claude logs ttrpg-<issue>` |
| Stop a session | `claude stop ttrpg-<issue>` |
| What would launch now | `scripts/agent-poller.sh --dry-run` |
| Pause everything | `scripts/install-launchd.sh uninstall` |

### Options
Set as environment variables. To change one for the LaunchAgent, add it to `EnvironmentVariables` in `scripts/launchd/com.askrzypczak.ttrpg-agents.plist` and rerun `scripts/install-launchd.sh` (it regenerates the installed copy, so edits made only to `~/Library/LaunchAgents/` are overwritten). For a one-off run, prefix the command: `MAX_CONCURRENT=1 scripts/agent-poller.sh`.

| Variable | Default | Meaning |
|---|---|---|
| `MAX_CONCURRENT` | `2` | Max live sessions. `blocked` sessions count, so two plans waiting on you hold off new launches. |
| `CLAUDE_BG_FLAGS` | empty | Extra flags for `claude --bg`, e.g. `--permission-mode acceptEdits`. |
| `AGENT_OWNER` | `askrzypczak` | Only tickets authored by this user are launched. |
| `GH_REPO` | `askrzypczak/ttrpg-agents` | Repo to poll. |
| `REPO_DIR` | `~/Projects/ttrpg-agents` | Checkout the sessions start in. |
| `EXTRA_PATH` | empty | Directories prepended to the poller's PATH (inherited by sessions). fnm's default bin dir (`~/.local/share/fnm/aliases/default/bin`) is always included so sessions find `node`/`npm`. |
| `STATE_DIR` | `~/.local/state/ttrpg-agents` | Lock file and `launched.json` (which tickets already have a session). |

### Notes
- The poller never claims a ticket itself: the session does that (`in-progress`) as part of `work-ticket`.
- A ticket is launched once. Delete its entry from `launched.json` to force a relaunch of a ticket that still has `ready`.
- The Mac must be awake and logged in. Nothing runs while it sleeps; the next run after wake picks up anything missed.

## Other scripts
- `setup-labels.sh [owner/repo]`: create or refresh the ticket label set.
- `install-launchd.sh [install|uninstall]`: manage the LaunchAgent described above.
