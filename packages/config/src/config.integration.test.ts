import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, SETTINGS } from "./config.js";
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
    },
  };
}

type FileSetting = "database" | "bridgePort";

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
  it.each<FileSetting>(["database", "bridgePort"])(
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

  it.each<FileSetting>(["database", "bridgePort"])(
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
