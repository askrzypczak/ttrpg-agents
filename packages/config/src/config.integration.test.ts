import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { describeProfile, loadConfig, SETTINGS } from "./config.js";
import type { ConfigInputs, Settings } from "./config.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ttrpg-config-${prefix}-`));
  dirs.push(dir);
  return dir;
}

interface Scene {
  home: string;
  configHome: string;
  dataHome: string;
  checkout: string;
  /** Where the loader should look for config.json. */
  configFile: string;
  /** Inputs with the XDG directories set; `env` adds more variables. */
  inputs(env?: Record<string, string | undefined>): ConfigInputs;
  /** Writes config.json: an object is serialised, a string is written as is. */
  writeConfig(content: unknown): void;
  defaults: Settings;
}

/** A temp home, temp XDG config and data directories and a temp checkout. */
function scene(): Scene {
  const home = tempDir("home");
  const configHome = tempDir("xdg-config");
  const dataHome = tempDir("xdg-data");
  const checkout = tempDir("checkout");
  const configDir = join(configHome, "ttrpg-agents");
  const configFile = join(configDir, "config.json");
  return {
    home,
    configHome,
    dataHome,
    checkout,
    configFile,
    inputs: (env = {}) => ({
      env: { XDG_CONFIG_HOME: configHome, XDG_DATA_HOME: dataHome, ...env },
      home,
      checkout,
    }),
    writeConfig(content) {
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        configFile,
        typeof content === "string" ? content : JSON.stringify(content),
      );
    },
    defaults: {
      database: join(dataHome, "ttrpg-agents", "encounters.db"),
      bridgePort: 5199,
      agentTokenFile: join(configDir, "agent-token"),
      bridgeStateFile: join(configDir, "bridge-state.json"),
      extensionDir: join(checkout, "packages", "owlbear", "dist"),
      backupDir: join(dataHome, "ttrpg-agents", "backups"),
    },
  };
}

type FileSetting = "database" | "bridgePort" | "backupDir";

/** A valid file value and a valid, different environment value for each file key. */
function fileSettingValues(
  s: Scene,
  name: FileSetting,
): {
  envVar: string;
  fileValue: string | number;
  envValue: string;
  fromFile: string | number;
  fromEnv: string | number;
} {
  if (name === "backupDir") {
    const fromFile = join(s.home, "file-backups");
    const fromEnv = join(s.home, "env-backups");
    return {
      envVar: "TTRPG_AGENTS_BACKUP_DIR",
      fileValue: fromFile,
      envValue: fromEnv,
      fromFile,
      fromEnv,
    };
  }
  if (name === "database") {
    const fromFile = join(s.home, "file.db");
    const fromEnv = join(s.home, "env.db");
    return {
      envVar: "TTRPG_AGENTS_DB",
      fileValue: fromFile,
      envValue: fromEnv,
      fromFile,
      fromEnv,
    };
  }
  return {
    envVar: "BRIDGE_PORT",
    fileValue: 6101,
    envValue: "6102",
    fromFile: 6101,
    fromEnv: 6102,
  };
}

describe("loadConfig", () => {
  it.each<FileSetting>(["database", "bridgePort", "backupDir"])(
    "the environment beats config.json for %s",
    (name) => {
      const s = scene();
      const v = fileSettingValues(s, name);
      s.writeConfig({ [name]: v.fileValue });

      const loaded = loadConfig(s.inputs({ [v.envVar]: v.envValue }));

      expect(loaded.settings[name]).toBe(v.fromEnv);
      expect(loaded.sources[name]).toBe("environment");
      expect(loaded.problems).toEqual([]);
    },
  );

  it.each<FileSetting>(["database", "bridgePort", "backupDir"])(
    "config.json beats the default for %s",
    (name) => {
      const s = scene();
      const v = fileSettingValues(s, name);
      s.writeConfig({ [name]: v.fileValue });

      const loaded = loadConfig(s.inputs());

      expect(loaded.settings[name]).toBe(v.fromFile);
      expect(loaded.sources[name]).toBe("file");
      expect(loaded.configFile).toEqual({ path: s.configFile, found: true });
      expect(loaded.problems).toEqual([]);
    },
  );

  it.each(SETTINGS)(
    "each setting's environment variable beats its default ($name)",
    (spec) => {
      const s = scene();
      const envValue =
        spec.name === "bridgePort" ? "6103" : join(s.home, `${spec.name}-env`);
      const expected = spec.name === "bridgePort" ? 6103 : envValue;

      const loaded = loadConfig(s.inputs({ [spec.env]: envValue }));

      expect(loaded.settings[spec.name]).toBe(expected);
      expect(loaded.sources[spec.name]).toBe("environment");
      expect(loaded.problems).toEqual([]);
    },
  );

  it("with no config.json every setting has its default, every source is default, and there is no problem", () => {
    const s = scene();

    const loaded = loadConfig(s.inputs());

    expect(loaded.settings).toEqual(s.defaults);
    expect(loaded.sources).toEqual({
      database: "default",
      bridgePort: "default",
      agentTokenFile: "default",
      bridgeStateFile: "default",
      extensionDir: "default",
      backupDir: "default",
    });
    expect(loaded.configFile).toEqual({ path: s.configFile, found: false });
    expect(loaded.problems).toEqual([]);
  });

  it.each([
    ["malformed text", '{ "bridgePort": 6104,'],
    ["a JSON array", '[{ "bridgePort": 6104 }]'],
  ])(
    "invalid JSON in config.json is an error naming the file (%s)",
    (_, text) => {
      const s = scene();
      s.writeConfig(text);

      const loaded = loadConfig(s.inputs());

      const errors = loaded.problems.filter((p) => p.level === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ source: "file" });
      expect(errors[0]?.message).toContain(s.configFile);
      expect(loaded.configFile).toEqual({ path: s.configFile, found: true });
      expect(loaded.settings).toEqual(s.defaults);
    },
  );

  interface BadValueCase {
    label: string;
    file?: Record<string, unknown>;
    env?: Record<string, string>;
    problemSource: "file" | "environment";
    key: string;
    setting: FileSetting;
    /** The value expected after falling back; a function of the scene for paths. */
    expected: (s: Scene) => { value: string | number; source: string };
  }

  const badValues: BadValueCase[] = [
    {
      label: 'file bridgePort "abc"',
      file: { bridgePort: "abc" },
      problemSource: "file",
      key: "bridgePort",
      setting: "bridgePort",
      expected: () => ({ value: 5199, source: "default" }),
    },
    {
      label: "file bridgePort 70000",
      file: { bridgePort: 70000 },
      problemSource: "file",
      key: "bridgePort",
      setting: "bridgePort",
      expected: () => ({ value: 5199, source: "default" }),
    },
    {
      label: 'file database "relative.db"',
      file: { database: "relative.db" },
      problemSource: "file",
      key: "database",
      setting: "database",
      expected: (s) => ({ value: s.defaults.database, source: "default" }),
    },
    {
      label: "env BRIDGE_PORT=abc",
      file: { bridgePort: 6105 },
      env: { BRIDGE_PORT: "abc" },
      problemSource: "environment",
      key: "BRIDGE_PORT",
      setting: "bridgePort",
      expected: () => ({ value: 6105, source: "file" }),
    },
    {
      label: "env TTRPG_AGENTS_DB=relative.db",
      file: { database: "/srv/ttrpg/file.db" },
      env: { TTRPG_AGENTS_DB: "relative.db" },
      problemSource: "environment",
      key: "TTRPG_AGENTS_DB",
      setting: "database",
      expected: () => ({ value: "/srv/ttrpg/file.db", source: "file" }),
    },
  ];

  it.each(badValues)(
    "an invalid value is an error naming the key and its source, and the setting falls back to the next source ($label)",
    (c) => {
      const s = scene();
      if (c.file) s.writeConfig(c.file);

      const loaded = loadConfig(s.inputs(c.env));

      const errors = loaded.problems.filter((p) => p.level === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ source: c.problemSource, key: c.key });
      expect(errors[0]?.message).toContain(c.key);
      if (c.problemSource === "file") {
        expect(errors[0]?.message).toContain(s.configFile);
      }
      const { value, source } = c.expected(s);
      expect(loaded.settings[c.setting]).toBe(value);
      expect(loaded.sources[c.setting]).toBe(source);
    },
  );

  it("an invalid config.json value is an error even when its environment variable is set", () => {
    const s = scene();
    s.writeConfig({ bridgePort: "abc" });

    const loaded = loadConfig(s.inputs({ BRIDGE_PORT: "6106" }));

    expect(loaded.settings.bridgePort).toBe(6106);
    expect(loaded.sources.bridgePort).toBe("environment");
    expect(loaded.problems).toContainEqual(
      expect.objectContaining({
        level: "error",
        source: "file",
        key: "bridgePort",
      }),
    );
  });

  it("an unknown key in config.json is a warning and is ignored", () => {
    const s = scene();
    s.writeConfig({ databse: "/srv/ttrpg/typo.db", bridgePort: 6107 });

    const loaded = loadConfig(s.inputs());

    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]).toMatchObject({
      level: "warning",
      source: "file",
      key: "databse",
    });
    expect(loaded.problems[0]?.message).toContain("databse");
    expect(loaded.problems[0]?.message).toContain(s.configFile);
    expect(loaded.settings.database).toBe(s.defaults.database);
    expect(loaded.settings.bridgePort).toBe(6107);
  });

  it("XDG_CONFIG_HOME and XDG_DATA_HOME move the config file and the default paths", () => {
    const s = scene();
    const homeConfigDir = join(s.home, ".config", "ttrpg-agents");
    mkdirSync(homeConfigDir, { recursive: true });
    writeFileSync(
      join(homeConfigDir, "config.json"),
      JSON.stringify({ bridgePort: 6108 }),
    );
    s.writeConfig({ bridgePort: 6109 });

    const moved = loadConfig(s.inputs());
    expect(moved.configFile).toEqual({ path: s.configFile, found: true });
    expect(moved.settings).toEqual({ ...s.defaults, bridgePort: 6109 });

    const unmoved = loadConfig({ env: {}, home: s.home, checkout: s.checkout });
    expect(unmoved.configFile).toEqual({
      path: join(homeConfigDir, "config.json"),
      found: true,
    });
    expect(unmoved.settings).toEqual({
      database: join(
        s.home,
        ".local",
        "share",
        "ttrpg-agents",
        "encounters.db",
      ),
      bridgePort: 6108,
      agentTokenFile: join(homeConfigDir, "agent-token"),
      bridgeStateFile: join(homeConfigDir, "bridge-state.json"),
      extensionDir: s.defaults.extensionDir,
      backupDir: join(s.home, ".local", "share", "ttrpg-agents", "backups"),
    });
  });

  it("a path starting with ~/ is expanded against home", () => {
    const s = scene();
    s.writeConfig({ database: "~/games/encounters.db" });

    const loaded = loadConfig(
      s.inputs({ BRIDGE_STATE_FILE: "~/state/bridge-state.json" }),
    );

    expect(loaded.problems).toEqual([]);
    expect(loaded.settings.database).toBe(
      join(s.home, "games", "encounters.db"),
    );
    expect(loaded.settings.bridgeStateFile).toBe(
      join(s.home, "state", "bridge-state.json"),
    );
  });

  it("an empty environment variable counts as unset", () => {
    const s = scene();
    const fileDb = join(s.home, "file.db");
    s.writeConfig({ database: fileDb, bridgePort: 6110 });

    const loaded = loadConfig(
      s.inputs({ TTRPG_AGENTS_DB: "", BRIDGE_PORT: "", BRIDGE_STATIC_DIR: "" }),
    );

    expect(loaded.problems).toEqual([]);
    expect(loaded.settings.database).toBe(fileDb);
    expect(loaded.sources.database).toBe("file");
    expect(loaded.settings.bridgePort).toBe(6110);
    expect(loaded.sources.bridgePort).toBe("file");
    expect(loaded.settings.extensionDir).toBe(s.defaults.extensionDir);
    expect(loaded.sources.extensionDir).toBe("default");
  });

  it("config.ts copied alone into an empty directory loads under node -e and resolves the defaults", () => {
    const s = scene();
    // Stands for an unbuilt checkout: no dist, no node_modules, no siblings.
    const isolated = tempDir("unbuilt");
    writeFileSync(
      join(isolated, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    const copy = join(isolated, "config.ts");
    copyFileSync(fileURLToPath(new URL("./config.ts", import.meta.url)), copy);

    const inputs = s.inputs();
    const code = `import(${JSON.stringify(pathToFileURL(copy).href)}).then((m) => {
  process.stdout.write(JSON.stringify(m.loadConfig(${JSON.stringify(inputs)})));
});`;
    const result = spawnSync(process.execPath, ["-e", code], {
      cwd: isolated,
      encoding: "utf8",
      timeout: 20_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const loaded = JSON.parse(result.stdout) as ReturnType<typeof loadConfig>;
    expect(loaded.settings).toEqual(s.defaults);
    expect(loaded.problems).toEqual([]);
  });
});

type CheckoutKind = "worktree" | "main" | "plain";

/** Gives the checkout a `.git` file (a linked worktree), a `.git` directory, or neither. */
function markCheckout(checkout: string, kind: CheckoutKind): void {
  if (kind === "worktree")
    writeFileSync(
      join(checkout, ".git"),
      "gitdir: /elsewhere/.git/worktrees/x\n",
    );
  else if (kind === "main") mkdirSync(join(checkout, ".git"));
}

/** The checkout's folder name in ttrpg-agents/dev/. */
function devFolder(checkout: string): string {
  const full = resolve(checkout);
  const name = basename(full).replace(/[^A-Za-z0-9._-]/g, "_");
  const hash = createHash("sha256").update(full).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

interface DevPaths {
  configDir: string;
  dataDir: string;
  configFile: string;
  defaults: Settings;
}

function devPaths(
  configHome: string,
  dataHome: string,
  checkout: string,
): DevPaths {
  const folder = devFolder(checkout);
  const configDir = join(configHome, "ttrpg-agents", "dev", folder);
  const dataDir = join(dataHome, "ttrpg-agents", "dev", folder);
  return {
    configDir,
    dataDir,
    configFile: join(configDir, "config.json"),
    defaults: {
      database: join(dataDir, "encounters.db"),
      bridgePort: 5299,
      agentTokenFile: join(configDir, "agent-token"),
      bridgeStateFile: join(configDir, "bridge-state.json"),
      extensionDir: join(checkout, "packages", "owlbear", "dist"),
      backupDir: join(dataDir, "backups"),
    },
  };
}

function writeDevConfig(dev: DevPaths, content: unknown): void {
  mkdirSync(dev.configDir, { recursive: true });
  writeFileSync(dev.configFile, JSON.stringify(content));
}

describe("loadConfig profile", () => {
  it("TTRPG_AGENTS_PROFILE=dev or =default wins over the checkout kind and is reported with the reason environment", () => {
    const toDev = scene();
    markCheckout(toDev.checkout, "main");
    const dev = loadConfig(toDev.inputs({ TTRPG_AGENTS_PROFILE: "dev" }));
    expect(dev.profile).toEqual({ name: "dev", reason: "environment" });
    expect(dev.settings).toEqual(
      devPaths(toDev.configHome, toDev.dataHome, toDev.checkout).defaults,
    );
    expect(dev.problems).toEqual([]);

    const toDefault = scene();
    markCheckout(toDefault.checkout, "worktree");
    const kept = loadConfig(
      toDefault.inputs({ TTRPG_AGENTS_PROFILE: "default" }),
    );
    expect(kept.profile).toEqual({ name: "default", reason: "environment" });
    expect(kept.settings).toEqual(toDefault.defaults);
    expect(kept.problems).toEqual([]);
  });

  it("an unknown TTRPG_AGENTS_PROFILE value is an error naming the variable, and the profile falls back to the checkout kind", () => {
    const cases: [CheckoutKind, { name: string; reason: string }][] = [
      ["worktree", { name: "dev", reason: "worktree" }],
      ["main", { name: "default", reason: "none" }],
    ];
    for (const [kind, expected] of cases) {
      const s = scene();
      markCheckout(s.checkout, kind);

      const loaded = loadConfig(s.inputs({ TTRPG_AGENTS_PROFILE: "staging" }));

      const errors = loaded.problems.filter((p) => p.level === "error");
      expect(errors, kind).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        level: "error",
        source: "environment",
        key: "TTRPG_AGENTS_PROFILE",
      });
      expect(errors[0]?.message).toContain("TTRPG_AGENTS_PROFILE");
      expect(loaded.profile, kind).toEqual(expected);
    }
  });

  it("an empty TTRPG_AGENTS_PROFILE counts as unset", () => {
    const s = scene();
    markCheckout(s.checkout, "worktree");

    const loaded = loadConfig(s.inputs({ TTRPG_AGENTS_PROFILE: "" }));

    expect(loaded.problems).toEqual([]);
    expect(loaded.profile).toEqual({ name: "dev", reason: "worktree" });
  });

  it("a checkout whose .git is a file resolves dev with the reason worktree", () => {
    const s = scene();
    markCheckout(s.checkout, "worktree");

    const loaded = loadConfig(s.inputs());

    expect(loaded.problems).toEqual([]);
    expect(loaded.profile).toEqual({ name: "dev", reason: "worktree" });
    expect(loaded.settings).toEqual(
      devPaths(s.configHome, s.dataHome, s.checkout).defaults,
    );
  });

  it("a checkout whose .git is a directory, or that has no .git, resolves default with the reason none", () => {
    for (const kind of ["main", "plain"] as const) {
      const s = scene();
      markCheckout(s.checkout, kind);

      const loaded = loadConfig(s.inputs());

      expect(loaded.problems, kind).toEqual([]);
      expect(loaded.profile, kind).toEqual({ name: "default", reason: "none" });
      expect(loaded.settings, kind).toEqual(s.defaults);
      expect(describeProfile(loaded.profile), kind).toBe(
        "default (not a linked git worktree)",
      );
    }
  });

  it("in dev, config.json, the database, the backups, the agent token file and the state file default to the checkout's folder in ttrpg-agents/dev/, named after the checkout folder and a short hash of its path, and the default port is 5299", () => {
    const s = scene();
    // A folder name with characters outside [A-Za-z0-9._-].
    const checkout = join(tempDir("parent"), "my checkout+1");
    mkdirSync(checkout);
    markCheckout(checkout, "worktree");

    const loaded = loadConfig({ ...s.inputs(), checkout });

    const folder = devFolder(checkout);
    expect(folder).toMatch(/^my_checkout_1-[0-9a-f]{8}$/);
    const configDir = join(s.configHome, "ttrpg-agents", "dev", folder);
    const dataDir = join(s.dataHome, "ttrpg-agents", "dev", folder);
    expect(loaded.problems).toEqual([]);
    expect(loaded.configFile).toEqual({
      path: join(configDir, "config.json"),
      found: false,
    });
    expect(loaded.settings).toEqual({
      database: join(dataDir, "encounters.db"),
      bridgePort: 5299,
      agentTokenFile: join(configDir, "agent-token"),
      bridgeStateFile: join(configDir, "bridge-state.json"),
      extensionDir: join(checkout, "packages", "owlbear", "dist"),
      backupDir: join(dataDir, "backups"),
    });
    expect(Object.values(loaded.sources)).toEqual(
      SETTINGS.map(() => "default"),
    );
  });

  it("in dev, config.json is read from the checkout's dev folder and not from the default profile's config directory", () => {
    const s = scene();
    markCheckout(s.checkout, "worktree");
    const dev = devPaths(s.configHome, s.dataHome, s.checkout);
    s.writeConfig({ bridgePort: 6201 });
    writeDevConfig(dev, { bridgePort: 6202 });

    const loaded = loadConfig(s.inputs());

    expect(loaded.problems).toEqual([]);
    expect(loaded.configFile).toEqual({ path: dev.configFile, found: true });
    expect(loaded.settings.bridgePort).toBe(6202);
    expect(loaded.sources.bridgePort).toBe("file");
  });

  it("in dev, an environment variable still beats config.json and the default", () => {
    const s = scene();
    markCheckout(s.checkout, "worktree");
    const dev = devPaths(s.configHome, s.dataHome, s.checkout);
    const fileDb = join(s.home, "file.db");
    const envDb = join(s.home, "env.db");
    const envToken = join(s.home, "env-agent-token");
    writeDevConfig(dev, { database: fileDb, bridgePort: 6203 });

    const loaded = loadConfig(
      s.inputs({
        TTRPG_AGENTS_DB: envDb,
        BRIDGE_PORT: "6204",
        BRIDGE_AGENT_TOKEN_FILE: envToken,
      }),
    );

    expect(loaded.problems).toEqual([]);
    expect(loaded.configFile).toEqual({ path: dev.configFile, found: true });
    expect(loaded.settings).toEqual({
      ...dev.defaults,
      database: envDb,
      bridgePort: 6204,
      agentTokenFile: envToken,
    });
    expect(loaded.sources).toEqual({
      database: "environment",
      bridgePort: "environment",
      agentTokenFile: "environment",
      bridgeStateFile: "default",
      extensionDir: "default",
      backupDir: "default",
    });
  });

  it("in dev, a relative or empty XDG_CONFIG_HOME or XDG_DATA_HOME is ignored and the dev folders fall under ~/.config and ~/.local/share", () => {
    const variants: Record<string, string>[] = [
      { XDG_CONFIG_HOME: "relative/config", XDG_DATA_HOME: "" },
      { XDG_CONFIG_HOME: "", XDG_DATA_HOME: "relative/data" },
    ];
    for (const xdg of variants) {
      const s = scene();
      markCheckout(s.checkout, "worktree");
      const dev = devPaths(
        join(s.home, ".config"),
        join(s.home, ".local", "share"),
        s.checkout,
      );

      const loaded = loadConfig(s.inputs(xdg));

      expect(loaded.problems).toEqual([]);
      expect(loaded.configFile).toEqual({ path: dev.configFile, found: false });
      expect(loaded.settings).toEqual(dev.defaults);
    }
  });

  it("two linked worktrees at different paths resolve different dev databases and config folders and the same default port 5299", () => {
    const s = scene();
    // The same folder name under two parents.
    const first = join(tempDir("first"), "worktree");
    const second = join(tempDir("second"), "worktree");
    for (const checkout of [first, second]) {
      mkdirSync(checkout);
      markCheckout(checkout, "worktree");
    }

    const a = loadConfig({ ...s.inputs(), checkout: first });
    const b = loadConfig({ ...s.inputs(), checkout: second });

    expect(a.profile).toEqual({ name: "dev", reason: "worktree" });
    expect(b.profile).toEqual({ name: "dev", reason: "worktree" });
    expect(a.settings.database).not.toBe(b.settings.database);
    expect(a.configFile.path).not.toBe(b.configFile.path);
    expect(a.settings.agentTokenFile).not.toBe(b.settings.agentTokenFile);
    expect(a.settings.bridgeStateFile).not.toBe(b.settings.bridgeStateFile);
    expect(a.settings).toEqual(
      devPaths(s.configHome, s.dataHome, first).defaults,
    );
    expect(b.settings).toEqual(
      devPaths(s.configHome, s.dataHome, second).defaults,
    );
    expect(a.settings.bridgePort).toBe(5299);
    expect(b.settings.bridgePort).toBe(5299);
  });
});
