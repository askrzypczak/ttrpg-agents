#!/usr/bin/env bash
# Poll GitHub for agent-ready tickets and start background Claude Code sessions
# (visible in `claude agents`). Run from launchd; see scripts/install-launchd.sh.
# Usage: scripts/agent-poller.sh [--dry-run]
#
# A ticket is picked up when it is open, authored by $AGENT_OWNER, and labelled
# `agent-ok` + `ready` (and not in-progress, blocked or agent-failed). The session
# is interactive: it shows as `blocked` in `claude agents` when it needs you
# (plan sign-off, questions, permissions) and waits. Tickets labelled `skip-plan`
# are launched with `auto`, which skips the plan sign-off. The work-ticket skill
# does the claiming itself.
set -euo pipefail

export PATH="${EXTRA_PATH:+$EXTRA_PATH:}$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

REPO_DIR="${REPO_DIR:-$HOME/Projects/ttrpg-agents}"
GH_REPO="${GH_REPO:-askrzypczak/ttrpg-agents}"
OWNER="${AGENT_OWNER:-askrzypczak}"
MAX_CONCURRENT="${MAX_CONCURRENT:-2}"
STATE_DIR="${STATE_DIR:-$HOME/.local/state/ttrpg-agents}"
# Extra flags for `claude --bg` (e.g. "--permission-mode acceptEdits"); word-split.
read -r -a BG_FLAGS <<<"${CLAUDE_BG_FLAGS:-}"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

log() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }
run() {
  if [ "$DRY" = 1 ]; then log "[dry-run] $*"; else "$@"; fi
}

mkdir -p "$STATE_DIR"
LOCK="$STATE_DIR/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  pid=$(cat "$LOCK/pid" 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    log "another run is active (pid $pid); exiting"
    exit 0
  fi
  rm -rf "$LOCK"
  mkdir "$LOCK"
fi
echo $$ >"$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT

STATE="$STATE_DIR/launched.json" # {"<N>": {"name": "...", "at": <epoch>}}
[ -f "$STATE" ] || echo '{}' >"$STATE"

state_set() { # key name
  [ "$DRY" = 1 ] && return 0
  jq --arg k "$1" --arg n "$2" --argjson at "$(date +%s)" '.[$k] = {name: $n, at: $at}' "$STATE" >"$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}
state_del() { # key
  [ "$DRY" = 1 ] && return 0
  jq --arg k "$1" 'del(.[$k])' "$STATE" >"$STATE.tmp" && mv "$STATE.tmp" "$STATE"
}

# Abort (rather than guess) if we cannot read the session list: a wrong empty
# answer would relaunch everything.
SESSIONS=$(claude agents --json --all) || { log "claude agents --json failed; aborting"; exit 1; }
echo "$SESSIONS" | jq -e 'type == "array"' >/dev/null || { log "unexpected agents output; aborting"; exit 1; }

session_state() { # name -> state of the newest session with that name, or empty
  echo "$SESSIONS" | jq -r --arg n "$1" '[.[] | select(.name == $n)] | sort_by(.startedAt) | last | .state // empty'
}

fail_issue() { # number name reason
  log "#$1: $3 -> agent-failed"
  run gh issue edit "$1" --repo "$GH_REPO" --add-label agent-failed --remove-label in-progress || true
  run gh issue comment "$1" --repo "$GH_REPO" --body "Background session \`$2\` ended without finishing: $3. See \`claude logs $2\` or \`claude agents\`. To retry, remove \`agent-failed\` and add \`ready\`."
}

# --- Reconcile sessions we launched ---------------------------------------
now=$(date +%s)
for key in $(jq -r 'keys[]' "$STATE"); do
  n=$key
  name=$(jq -r --arg k "$key" '.[$k].name' "$STATE")
  age=$((now - $(jq -r --arg k "$key" '.[$k].at' "$STATE")))
  st=$(session_state "$name")
  case "$st" in
    working | blocked) continue ;; # blocked = waiting for you; leave it
    "")
      [ "$age" -lt 600 ] && continue # just launched; may not be listed yet
      fail_issue "$n" "$name" "no session found"
      state_del "$key"
      ;;
    failed | stopped)
      fail_issue "$n" "$name" "session $st"
      state_del "$key"
      ;;
    *) # done: check the ticket was handed off
      issue=$(gh issue view "$n" --repo "$GH_REPO" --json state,labels)
      labels=",$(echo "$issue" | jq -r '[.labels[].name] | join(",")'),"
      ok=0
      [ "$(echo "$issue" | jq -r '.state')" = CLOSED ] && ok=1
      case "$labels" in *,needs-review,* | *,blocked,* | *,agent-failed,*) ok=1 ;; esac
      [ "$ok" = 0 ] && fail_issue "$n" "$name" "session finished but the ticket was not handed off"
      state_del "$key"
      ;;
  esac
done

# --- Launch new sessions ---------------------------------------------------
live=$(echo "$SESSIONS" | jq '[.[] | select((.name // "") | startswith("ttrpg-")) | select(.state == "working" or .state == "blocked")] | length')
issues=$(gh issue list --repo "$GH_REPO" --state open --label agent-ok --limit 50 --json number,author,labels)

while read -r row; do
  [ -n "$row" ] || continue
  n=$(echo "$row" | jq -r '.number')
  author=$(echo "$row" | jq -r '.author.login')
  labels=",$(echo "$row" | jq -r '[.labels[].name] | join(",")'),"
  has() { case "$labels" in *",$1,"*) return 0 ;; esac; return 1; }

  has in-progress && continue
  has blocked && continue
  has agent-failed && continue
  has ready || continue

  if [ "$author" != "$OWNER" ]; then
    log "#$n: author $author is not $OWNER; skipping"
    continue
  fi
  [ "$(jq -r --arg k "$n" 'has($k)' "$STATE")" = true ] && continue
  if [ "$live" -ge "$MAX_CONCURRENT" ]; then
    log "at capacity ($live/$MAX_CONCURRENT); #$n waits"
    break
  fi

  name="ttrpg-$n"
  arg="$n"
  has skip-plan && arg="$n auto"
  log "#$n: launching $name"
  # BG_FLAGS may be empty; the [@]+ form keeps macOS bash 3.2 happy under set -u.
  if [ "$DRY" = 1 ]; then
    log "[dry-run] (cd $REPO_DIR && claude --bg --name $name ${BG_FLAGS[*]:-} \"/ticket-workflow:work-ticket $arg\")"
  else
    (cd "$REPO_DIR" && claude --bg --name "$name" ${BG_FLAGS[@]+"${BG_FLAGS[@]}"} "/ticket-workflow:work-ticket $arg")
  fi
  state_set "$n" "$name"
  live=$((live + 1))
done < <(echo "$issues" | jq -c '.[]')

log "done"
