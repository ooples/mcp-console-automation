#!/usr/bin/env bash

set -euo pipefail

target="codex"
custom_path=""
dev=false
skip_dependencies=false
keep_dev_dependencies=false

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Options:
  --target codex|custom       MCP client to configure (default: codex)
  --custom-path PATH          New JSON config path for --target custom
  --dev                       Keep development dependencies installed
  --skip-dependencies         Reuse the current node_modules directory
  --keep-dev-dependencies     Do not prune development/optional packages
  --help                      Show this help
EOF
}

while (($#)); do
  case "$1" in
    --target)
      target="${2:?--target requires a value}"
      shift 2
      ;;
    --custom-path)
      custom_path="${2:?--custom-path requires a value}"
      shift 2
      ;;
    --dev)
      dev=true
      shift
      ;;
    --skip-dependencies)
      skip_dependencies=true
      shift
      ;;
    --keep-dev-dependencies)
      keep_dev_dependencies=true
      shift
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$target" != "codex" && "$target" != "custom" ]]; then
  echo "Invalid target: $target" >&2
  exit 2
fi

install_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server_path="$install_dir/dist/mcp/server.js"
node_bin="$(command -v node || true)"
npm_bin="$(command -v npm || true)"

[[ -n "$node_bin" ]] || { echo 'Node.js 18 or newer is required.' >&2; exit 1; }
[[ -n "$npm_bin" ]] || { echo 'npm is required.' >&2; exit 1; }

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if ((node_major < 18)); then
  echo "Node.js 18 or newer is required; found $(node --version)." >&2
  exit 1
fi

cd "$install_dir"
if [[ "$skip_dependencies" == false ]]; then
  npm ci
fi
npm run build

if [[ "$dev" == false && "$keep_dev_dependencies" == false ]]; then
  npm prune --omit=dev --omit=optional
fi

[[ -f "$server_path" ]] || { echo "Missing MCP entry point: $server_path" >&2; exit 1; }

if [[ "$target" == "codex" ]]; then
  command -v codex >/dev/null || { echo 'Codex CLI is required.' >&2; exit 1; }
  if codex mcp get console-automation >/dev/null 2>&1; then
    codex mcp remove console-automation
  fi
  codex mcp add console-automation --env LOG_LEVEL=warn -- "$node_bin" "$server_path"
  codex mcp get console-automation
  echo 'Installation complete. Restart Codex, then use /mcp to verify the server.'
  exit 0
fi

[[ -n "$custom_path" ]] || { echo '--custom-path is required for --target custom.' >&2; exit 2; }
[[ ! -e "$custom_path" ]] || { echo "Refusing to overwrite $custom_path" >&2; exit 1; }
mkdir -p "$(dirname "$custom_path")"

node --input-type=module - "$custom_path" "$node_bin" "$server_path" <<'NODE'
import fs from 'node:fs';

const [, , outputPath, nodePath, serverPath] = process.argv;
const config = {
  mcpServers: {
    'console-automation': {
      command: nodePath,
      args: [serverPath],
      env: { LOG_LEVEL: 'warn' },
    },
  },
};
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
NODE

echo "Custom MCP configuration written to $custom_path"
