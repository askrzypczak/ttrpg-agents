import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION, type BridgeMessage } from "@ttrpg-agents/protocol";
import { createFakeObr } from "./fake-adapter.js";
import type { ObrAdapter } from "./obr-adapter.js";
import {
  SCENE_ID_METADATA_KEY,
  createOpenSceneReporter,
} from "./open-scene.js";
import { SceneModel } from "./scene-model.js";

/** Lets the reporter's reads and writes finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

/** The scene ids of the scene-open messages, in order. */
const sceneOpens = (messages: BridgeMessage[]): unknown[] =>
  messages.flatMap((m) => {
    const raw = m as { type: string; payload: { sceneId?: unknown } };
    return raw.type === "scene-open" ? [raw.payload.sceneId] : [];
  });

/**
 * A reporter over a fake scene: `sent` holds the messages that went out,
 * `attempts` every one handed to `send`, `writes` each scene metadata write.
 */
function setup(
  options: {
    scene?: SceneModel;
    sceneId?: string | null;
    online?: boolean;
    wrap?: (obr: ObrAdapter) => ObrAdapter;
  } = {},
) {
  const fake = createFakeObr(options.scene ?? new SceneModel(), undefined, {
    sceneId: options.sceneId === undefined ? null : options.sceneId,
  });
  const writes: Record<string, unknown>[] = [];
  const recorded: ObrAdapter = {
    ...fake.obr,
    setSceneMetadata: (update) => (
      writes.push(update),
      fake.obr.setSceneMetadata(update)
    ),
  };
  const obr = options.wrap ? options.wrap(recorded) : recorded;
  const sent: BridgeMessage[] = [];
  const attempts: BridgeMessage[] = [];
  const heard: (string | null)[] = [];
  const link = { online: options.online ?? true };
  let mints = 0;
  const reporter = createOpenSceneReporter(
    obr,
    (message) => {
      attempts.push(message);
      if (link.online) sent.push(message);
      return link.online;
    },
    {
      mint: () => `m${String(++mints)}`,
      onChange: (sceneId) => heard.push(sceneId),
    },
  );
  return {
    reporter,
    scene: fake.scene,
    sent,
    attempts,
    writes,
    heard,
    link,
    mints: () => mints,
  };
}

describe("open scene reporter", () => {
  it("the reporter mints a scene id into the metadata of a ready scene that has none and sends scene-open with it", async () => {
    const { scene, sent, mints } = setup({ sceneId: null });
    await settle();

    expect(scene.getMetadata()[SCENE_ID_METADATA_KEY]).toBe("m1");
    expect(mints()).toBe(1);
    expect(sent).toEqual([
      expect.objectContaining({
        v: PROTOCOL_VERSION,
        type: "scene-open",
        payload: { sceneId: "m1" },
      }),
    ]);
  });

  it("the reporter sends a scene's existing id and never writes it", async () => {
    const { reporter, scene, sent, writes, mints } = setup({ sceneId: "s1" });
    await settle();
    scene.setReady(false);
    scene.setReady(true);
    await reporter.helloAck();
    await settle();

    expect(sceneOpens(sent)).toEqual(["s1", null, "s1", "s1"]);
    expect(writes).toEqual([]);
    expect(mints()).toBe(0);
    expect(scene.getMetadata()[SCENE_ID_METADATA_KEY]).toBe("s1");
  });

  it("the reporter mints once: a later ready change and a hello-ack send the same id", async () => {
    const { reporter, scene, sent, writes, mints } = setup({ sceneId: null });
    await settle();
    scene.setReady(false);
    scene.setReady(true);
    await settle();
    await reporter.helloAck();
    await settle();

    expect(sceneOpens(sent)).toEqual(["m1", null, "m1", "m1"]);
    expect(mints()).toBe(1);
    expect(writes).toEqual([{ [SCENE_ID_METADATA_KEY]: "m1" }]);
  });

  it("the reporter mints over a stored scene id the schema refuses", async () => {
    for (const stored of ["", "x".repeat(201), 42, { id: "s1" }]) {
      const scene = new SceneModel();
      scene.setMetadata({ [SCENE_ID_METADATA_KEY]: stored });
      const { sent } = setup({ scene });
      await settle();

      expect(scene.getMetadata()[SCENE_ID_METADATA_KEY]).toBe("m1");
      expect(sceneOpens(sent)).toEqual(["m1"]);
    }
  });

  it("the reporter reads the open scene on start when a scene is already ready", async () => {
    const { reporter, sent, heard } = setup({ sceneId: "s1" });
    expect(reporter.current()).toBeUndefined();
    await settle();

    expect(sceneOpens(sent)).toEqual(["s1"]);
    expect(reporter.current()).toBe("s1");
    expect(heard).toEqual(["s1"]);

    // A scene that is not ready yet is read once it is.
    const later = setup({
      scene: new SceneModel("gm", false),
      sceneId: "s2",
    });
    await settle();
    expect(sceneOpens(later.sent)).toEqual([]);
    later.scene.setReady(true);
    await settle();
    expect(sceneOpens(later.sent)).toEqual(["s2"]);
  });

  it("the reporter sends scene-open with null when the scene stops being ready", async () => {
    const { reporter, scene, sent, heard } = setup({ sceneId: "s1" });
    await settle();

    scene.setReady(false);
    await settle();

    expect(sceneOpens(sent)).toEqual(["s1", null]);
    expect(reporter.current()).toBeNull();
    expect(heard).toEqual(["s1", null]);
  });

  it("a scene-open that does not go out is not queued, and the next hello-ack sends the latest", async () => {
    const { reporter, scene, sent, attempts, link } = setup({
      sceneId: "s1",
      online: false,
    });
    await settle();
    scene.switchScene({
      items: [],
      metadata: { [SCENE_ID_METADATA_KEY]: "s2" },
    });
    await settle();
    expect(sceneOpens(attempts)).toEqual(["s1", null, "s2"]);
    expect(sent).toEqual([]);

    link.online = true;
    await reporter.helloAck();
    await settle();

    expect(sceneOpens(sent)).toEqual(["s2"]);
  });

  it("a mint read before a scene switch is not written into the next scene", async () => {
    let release: () => void = () => {};
    let first = true;
    const { reporter, scene, sent } = setup({
      sceneId: null,
      wrap: (obr) => ({
        ...obr,
        getSceneMetadata: async () => {
          // The first read answers after the switch, with the first scene's metadata.
          if (first) {
            first = false;
            const answer = await obr.getSceneMetadata();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
            return answer;
          }
          return obr.getSceneMetadata();
        },
      }),
    });
    await settle();

    scene.switchScene({
      items: [],
      metadata: { [SCENE_ID_METADATA_KEY]: "s2" },
    });
    await settle();
    release();
    await settle();

    expect(scene.getMetadata()[SCENE_ID_METADATA_KEY]).toBe("s2");
    expect(sceneOpens(sent)).not.toContain("m1");
    expect(sceneOpens(sent).at(-1)).toBe("s2");
    expect(reporter.current()).toBe("s2");
  });
});
