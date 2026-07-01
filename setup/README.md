# Shared onboarding: console-automation MCP → shared server

Goal: all machines connect to the same Linux server through the console-automation
MCP, using the **same profile name** (`ooples-prod`) — while keeping credentials
per-machine and out of git.

## Model

- **Auth = per-machine `ed25519` keys.** Each machine has its own
  `~/.ssh/claude_automation`. No private key is ever copied or committed. Each
  machine's *public* key is added to the server's `~/.ssh/authorized_keys` once.
- **Connection details = shared, non-secret** in [`server.json`](server.json)
  (host / port / username). Committed to this repo; contains **no secrets**.
- **Profile** is written into each machine's local
  `~/.console-automation-mcp/config.json` by the bootstrap, pointing at that
  machine's own key. Same profile name everywhere → identical usage.

## One-time server-side setup

1. Fill in [`server.json`](server.json) (`host`, `username`) and commit.
2. Collect each machine's public key (printed by its bootstrap run) and append
   all of them to the server:
   ```bash
   # on the server, for each machine's pubkey:
   echo "ssh-ed25519 AAAA... claude-automation@MACHINE" >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

## Per-machine onboarding (run once on each of the 3 machines)

Clone this repo, then:

- **Linux / macOS:** `bash setup/bootstrap.sh`
- **Windows (PowerShell):** `./setup/bootstrap.ps1`

Each bootstrap: builds the MCP, registers it with Claude Code (user scope),
generates `~/.ssh/claude_automation` if missing, **prints the public key to add
to the server**, and writes the `ooples-prod` profile locally.

Restart Claude Code (or `/mcp` reconnect) afterward so the MCP tools load.

## Using it

Once your machine's pubkey is on the server, connect via the shared profile:

```
console_use_profile  name=ooples-prod
```

or explicitly:

```
console_create_session  consoleType=ssh
  sshOptions={ host: <from server.json>, username: <from server.json>,
               privateKeyPath: ~/.ssh/claude_automation }
```

## Rotating / revoking a machine

Remove that machine's line from the server's `authorized_keys`. Other machines
are unaffected (independent keys).
