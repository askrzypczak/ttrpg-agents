#!/usr/bin/env bash
# Install (or remove) the LaunchAgent that runs scripts/agent-poller.sh every 3 minutes.
# Run from the main checkout, not a worktree.
# Usage: scripts/install-launchd.sh [install|uninstall]
set -euo pipefail

LABEL=com.askrzypczak.ttrpg-agents
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

case "${1:-install}" in
  install)
    case "$REPO" in
      */.claude/worktrees/*) echo "Run this from the main checkout, not a worktree: $REPO" >&2; exit 1 ;;
    esac
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    sed -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" "$REPO/scripts/launchd/$LABEL.plist" >"$PLIST"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Installed. Log: ~/Library/Logs/ttrpg-agents.log"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed."
    ;;
  *) echo "Usage: $0 [install|uninstall]" >&2; exit 2 ;;
esac
