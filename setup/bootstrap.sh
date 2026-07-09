#!/usr/bin/env bash
# One-time onboarding for a Linux/macOS machine to use the console-automation MCP
# against the shared server. Safe to re-run (idempotent).
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEY="$HOME/.ssh/claude_automation"

command -v node >/dev/null 2>&1 || { echo "ERROR: Node >=18 required"; exit 1; }
command -v claude >/dev/null 2>&1 || echo "WARN: 'claude' CLI not on PATH — MCP registration step will be skipped."

echo "[1/4] Build the MCP"
( cd "$REPO" && npm install && npm run build )

echo "[2/4] Register the MCP with Claude Code (user scope)"
if command -v claude >/dev/null 2>&1; then
  if ! output=$(claude mcp add console-automation --scope user -- node "$REPO/dist/mcp/server.js" 2>&1); then
    case "$output" in
      *already*) echo "  (already registered)" ;;
      *) echo "$output" >&2; exit 1 ;;
    esac
  fi
fi

echo "[3/4] Ensure this machine's ed25519 key"
mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "claude-automation@$(hostname)"
fi
echo "  >>> ADD THIS PUBLIC KEY to the server's ~/.ssh/authorized_keys:"
echo "  ----------------------------------------------------------------"
cat "$KEY.pub" | sed 's/^/  /'
echo "  ----------------------------------------------------------------"

echo "[4/4] Write the shared connection profile"
node "$REPO/setup/apply-profile.mjs" "$REPO/setup/server.json" "$KEY"

echo
echo "DONE. Restart Claude Code (or /mcp reconnect), then connect with the 'ooples-prod' profile."
echo "NOTE: the connection only works after this machine's public key (above) is in the server's authorized_keys."
