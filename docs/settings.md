# Settings

Every process (the MCP server, the bridge, `npm run bridge:start|stop|restart|status`, `npm run status` and the token art import) reads its settings the same way, through `@ttrpg-agents/config` (`packages/config/src/config.ts`). Only the composition roots read them; everything else gets plain values.

| Setting           | File key     | Environment variable      | Default                                 |
| ----------------- | ------------ | ------------------------- | --------------------------------------- |
| `database`        | `database`   | `TTRPG_AGENTS_DB`         | `<data dir>/encounters.db`              |
| `bridgePort`      | `bridgePort` | `BRIDGE_PORT`             | `5199` (`5299` in `dev`)                |
| `agentTokenFile`  | (none)       | `BRIDGE_AGENT_TOKEN_FILE` | `<config dir>/agent-token`              |
| `bridgeStateFile` | (none)       | `BRIDGE_STATE_FILE`       | `<config dir>/bridge-state.json`        |
| `extensionDir`    | (none)       | `BRIDGE_STATIC_DIR`       | `packages/owlbear/dist` in the checkout |

## Precedence

For each setting: the environment variable, else `config.json`, else the default. An empty environment variable counts as unset. An invalid value is reported (see Errors and warnings) and the next source is used.

## Where the files are

The config directory is `$XDG_CONFIG_HOME/ttrpg-agents`, else `~/.config/ttrpg-agents`. The data directory is `$XDG_DATA_HOME/ttrpg-agents`, else `~/.local/share/ttrpg-agents`. An empty or relative `XDG_*` value is ignored. These are the `default` profile's; the `dev` profile uses a folder inside each (see Profiles).

The config file is `config.json` in the config directory. It is optional: without it every setting comes from the environment or its default. Nothing ever writes it.

## Profiles

There are two profiles, `default` and `dev`, and a process keeps the one it picks when it starts: `TTRPG_AGENTS_PROFILE` if set (`default` or `dev`; any other value is an error), else `dev` when its checkout is a linked git worktree (its `.git` is a file), else `default`. `npm run bridge` and `npm run bridge:status` print the profile and why.

In `dev`, the config and data directories are a folder per checkout, `dev/<checkout folder name>-<hash>` inside each (the hash is the first 8 hex digits of the SHA-256 of the checkout's path). It holds that checkout's own `config.json`, agent token, state file, `bridge.log` and database, so worktrees whose branches add migrations never share a database. The default bridge port is 5299 in every checkout: one dev bridge runs at a time unless a dev `config.json` sets another `bridgePort`. Precedence is the same in both profiles.

An environment variable wins in both profiles. Do not export `TTRPG_AGENTS_DB` or the other variables in your shell profile, or a process in a worktree opens the database they name; put settings in the profile's `config.json` instead.

The dev folder of a removed worktree stays behind: remove it by hand.

## Format

A JSON object with the file keys from the table: `database` is a path, `bridgePort` a JSON integer from 0 to 65535 (0 picks any free port). A path, in the file or in an environment variable, is absolute or starts with `~/`, which means your home directory.

```json
{
  "database": "~/games/encounters.db",
  "bridgePort": 5200
}
```

## Errors and warnings

Each process prints every problem to stderr when it starts; the MCP server keeps stdout for its protocol. An error stops the process with exit code 1 before it opens the database or a port: a file that cannot be read, text that is not a JSON object, or an invalid value. A value is checked even when a higher source overrides it. An unknown key in `config.json` is a warning: the key is ignored and the process goes on. `npm run status` is the exception: it reports problems as rows of its report and does not stop (see Check a setup).

## Check a setup

`npm run status`, or the `setup_status` MCP tool, lists the profile, the config file and its problems, every setting with its source, the database, the bridge (reached with this profile's agent token) and the GM tab, with a fix under each problem. `npm run status` always exits 0, whatever it finds.

## No secrets

Keep secrets out of `config.json`. The agent token lives in its own file (mode 0600); the settings say only where that file is.

## Bridge settings

Warning: `BRIDGE_STATIC_DIR` overrides the served folder, and the bridge serves whatever it points at, readable by owlbear.rodeo pages; only point it at the built extension.

`BRIDGE_STATE_FILE` sets where the bridge records itself; `bridge.log` sits beside it. Set it to run a second bridge, or tests, without touching the first one's record.
