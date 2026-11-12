# Settings

Every process (the MCP server, the bridge, `npm run bridge:start|stop|restart|status` and the token art import) reads its settings the same way, through `@ttrpg-agents/config` (`packages/config/src/config.ts`). Only the composition roots read them; everything else gets plain values.

| Setting           | File key     | Environment variable      | Default                                 |
| ----------------- | ------------ | ------------------------- | --------------------------------------- |
| `database`        | `database`   | `TTRPG_AGENTS_DB`         | `<data dir>/encounters.db`              |
| `bridgePort`      | `bridgePort` | `BRIDGE_PORT`             | `5199`                                  |
| `agentTokenFile`  | (none)       | `BRIDGE_AGENT_TOKEN_FILE` | `<config dir>/agent-token`              |
| `bridgeStateFile` | (none)       | `BRIDGE_STATE_FILE`       | `<config dir>/bridge-state.json`        |
| `extensionDir`    | (none)       | `BRIDGE_STATIC_DIR`       | `packages/owlbear/dist` in the checkout |

## Precedence

For each setting: the environment variable, else `config.json`, else the default. An empty environment variable counts as unset. An invalid value is reported (see Errors and warnings) and the next source is used.

## Where the files are

The config directory is `$XDG_CONFIG_HOME/ttrpg-agents`, else `~/.config/ttrpg-agents`. The data directory is `$XDG_DATA_HOME/ttrpg-agents`, else `~/.local/share/ttrpg-agents`. An empty or relative `XDG_*` value is ignored.

The config file is `config.json` in the config directory. It is optional: without it every setting comes from the environment or its default. Nothing ever writes it.

## Format

A JSON object with the file keys from the table: `database` is a path, `bridgePort` a JSON integer from 0 to 65535 (0 picks any free port). A path, in the file or in an environment variable, is absolute or starts with `~/`, which means your home directory.

```json
{
  "database": "~/games/encounters.db",
  "bridgePort": 5200
}
```

## Errors and warnings

Each process prints every problem to stderr when it starts; the MCP server keeps stdout for its protocol. An error stops the process with exit code 1 before it opens the database or a port: a file that cannot be read, text that is not a JSON object, or an invalid value. A value is checked even when a higher source overrides it. An unknown key in `config.json` is a warning: the key is ignored and the process goes on.

## No secrets

Keep secrets out of `config.json`. The agent token lives in its own file (mode 0600); the settings say only where that file is.

## Bridge settings

Warning: `BRIDGE_STATIC_DIR` overrides the served folder, and the bridge serves whatever it points at, readable by owlbear.rodeo pages; only point it at the built extension.

`BRIDGE_STATE_FILE` sets where the bridge records itself; `bridge.log` sits beside it. Set it to run a second bridge, or tests, without touching the first one's record.
