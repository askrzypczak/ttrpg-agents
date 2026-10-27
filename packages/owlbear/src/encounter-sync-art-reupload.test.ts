import { describe, expect, it, vi } from "vitest";
import type { PublishedTokenArt, TokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type {
  BridgeMessage,
  TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
import { createEncounterSync, type Reupload } from "./encounter-sync.js";
import { createFakeObr, type FakePick } from "./fake-adapter.js";
import type { ImageUpload, ObrAdapter } from "./obr-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { SceneModel } from "./scene-model.js";
import {
  PLACED_METADATA_KEY,
  defaultSyncConfig,
  instanceIdOf,
  planSync,
  type EncounterInstance,
} from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";
import type { StoredTokenImage } from "./token-art.js";

const NAMES: Record<string, string> = {
  shadow: "Shadow",
  goblin: "Goblin",
  wolf: "Wolf",
  orc: "Orc",
};

const inst = (n: number, monsterKey = "shadow"): EncounterInstance =>
  makeTestInstance({
    id: `${monsterKey}-${n}`,
    monsterKey,
    displayName: `${NAMES[monsterKey] ?? monsterKey} ${n}`,
    createdAt: n,
  });

const STORED_SHA = "c3".repeat(32);
/** The asset name the stored shadow image is uploaded again under. */
const REUPLOAD_NAME = `ttrpg-art-${"c3".repeat(8)}`;

/** Shadow art with stored bytes; whether its url is alive is up to each test. */
const storedArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-old.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: STORED_SHA,
};

const goblinArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/goblin.png",
  mime: "image/png",
  width: 200,
  height: 200,
  sha256: "d4".repeat(32),
};

const wolfArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/wolf.png",
  mime: "image/png",
  width: 200,
  height: 200,
  sha256: "a1".repeat(32),
};

/** What the GM picks after the re-upload: the new asset. */
const republished: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-c3c3c3c3c3c3c3c3.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

/** An art pick for a type that had none. */
const pickedArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-new.png",
  mime: "image/png",
  width: 256,
  height: 256,
};

const STORED_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7,
]);
const PICKED_SHA = "e5".repeat(32);

const stored: TokenImageUploadResponse = {
  ok: true,
  image: { sha256: PICKED_SHA, mime: "image/png", width: 256, height: 256 },
};

/** The image fields a token is drawn with. */
const pictureOf = ({ url, mime, width, height }: PublishedTokenArt) => ({
  url,
  mime,
  width,
  height,
});

/** The re-upload row of the shadow. */
const shadowRow = (uploaded: boolean): Reupload => ({
  monsterKey: "shadow",
  monsterName: "Shadow",
  assetName: REUPLOAD_NAME,
  uploaded,
});

/** Timers that never fire, so a failed reconcile is not retried behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

const helloAck: BridgeMessage = {
  v: 1,
  type: "hello-ack",
  payload: { serverVersion: "0" },
};

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const byKey = <T extends { monsterKey: string }>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => a.monsterKey.localeCompare(b.monsterKey));

function setup(
  options: {
    imageAlive?: boolean | ((url: string) => boolean | Promise<boolean>);
    pickImage?: FakePick;
    uploadImage?: (image: ImageUpload) => void | Promise<void>;
    /** `null` leaves the option out. Default: answers the stored bytes. */
    loadImage?: ((sha256: string) => Promise<StoredTokenImage>) | null;
    /** Passes a recording `storeImage` option. Default: left out. */
    withStoreImage?: boolean;
    /** Whether a command goes out. Default: always. */
    connected?: () => boolean;
    scene?: SceneModel;
  } = {},
) {
  const alive: string[] = [];
  const searches: (string | undefined)[] = [];
  const loads: string[] = [];
  const failures: string[] = [];
  const fetched: string[] = [];
  const storedBytes: Uint8Array[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const errors: unknown[] = [];
  const overrides: string[] = [];
  const reuploads: Reupload[][] = [];
  const addCalls: number[] = [];
  const answerAlive = options.imageAlive ?? true;
  const pick = options.pickImage;
  const fake = createFakeObr(options.scene, undefined, {
    imageAlive: (url) => {
      alive.push(url);
      return typeof answerAlive === "function" ? answerAlive(url) : answerAlive;
    },
    pickImage: (search) => {
      searches.push(search);
      return typeof pick === "function" ? pick(search) : structuredClone(pick);
    },
    ...(options.uploadImage === undefined
      ? {}
      : { uploadImage: options.uploadImage }),
    fetchImage: (url) => {
      fetched.push(url);
      return STORED_BYTES.slice();
    },
  });
  const obr: ObrAdapter = {
    ...fake.obr,
    addItems: (items) => {
      addCalls.push(items.length);
      return fake.obr.addItems(items);
    },
  };
  const load = options.loadImage;
  const loadImage =
    load === null
      ? undefined
      : (sha256: string) => {
          loads.push(sha256);
          return load === undefined
            ? Promise.resolve({
                bytes: STORED_BYTES.slice(),
                mime: "image/png",
              })
            : load(sha256);
        };
  const connected = options.connected ?? (() => true);
  const sync = createEncounterSync(
    obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      send: (message) => {
        if (!connected()) return false;
        if (message.type === "token-art-set")
          reported.push([message.payload.monsterKey, message.payload.art]);
        return true;
      },
      ...(options.withStoreImage === true
        ? {
            storeImage: (bytes: Uint8Array) => {
              storedBytes.push(bytes);
              return Promise.resolve(stored);
            },
          }
        : {}),
      ...(loadImage === undefined ? {} : { loadImage }),
      onArtRepublishFailed: (text) => failures.push(text),
      onOverride: (text) => overrides.push(text),
      onReuploadsChange: (list) => reuploads.push(structuredClone(list)),
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  const tokens = () =>
    fake.scene.getItems().filter((item) => instanceIdOf(item) !== undefined);
  /** The re-upload list as last reported; empty before any report. */
  const listed = () => reuploads.at(-1) ?? [];
  return {
    fake,
    sync,
    alive,
    searches,
    loads,
    failures,
    fetched,
    storedBytes,
    reported,
    errors,
    overrides,
    reuploads,
    listed,
    addCalls,
    tokenOf,
    tokens,
  };
}

/** Expects one IMAGE token per instance id, drawn with `art`. */
function expectImages(
  tokenOf: (id: string) => unknown,
  ids: string[],
  art: PublishedTokenArt,
): void {
  for (const id of ids)
    expect(tokenOf(id), id).toMatchObject({
      type: "IMAGE",
      image: pictureOf(art),
    });
}

/** Expects one SHAPE (circle) token per instance id. */
function expectCircles(tokenOf: (id: string) => unknown, ids: string[]): void {
  for (const id of ids)
    expect(tokenOf(id), id).toMatchObject({ type: "SHAPE" });
}

/** A sync whose shadow art is gone, after the snapshot with `instances` applied. */
async function listedShadow(
  options: Parameters<typeof setup>[0] = {},
  instances: EncounterInstance[] = [inst(1), inst(2)],
) {
  const feed = createMessageFeed();
  const s = setup({ imageAlive: false, ...options });
  await s.sync.handleMessage(
    feed.snapshot(instances, { art: { shadow: storedArt } }),
  );
  await settle();
  return { ...s, feed };
}

describe("createEncounterSync stored art liveness on a snapshot", () => {
  it("on a snapshot, stored art with a hash and a live url is checked once per session and draws image tokens with no upload and no picker", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true });
    // The goblin has stored art but no instance yet.
    const art = { shadow: storedArt, goblin: goblinArt };

    await s.sync.handleMessage(feed.snapshot([inst(1), inst(2)], { art }));
    await settle();

    expect([...s.alive].sort()).toEqual([goblinArt.url, storedArt.url].sort());
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], storedArt);

    // Later reconciles and a reconnect's snapshot check nothing again.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3), inst(1, "goblin")] }),
    );
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(3), inst(1, "goblin")], { art }),
    );
    await settle();

    expect(s.alive).toHaveLength(2);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2", "shadow-3"], storedArt);
    expectImages(s.tokenOf, ["goblin-1"], goblinArt);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.loads).toEqual([]);
    expect(s.reported).toEqual([]);
    expect(s.listed()).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("on a snapshot, stored art with a hash whose url is gone is listed for re-upload with no upload dialog and no picker, whether or not its type has instances", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false });
    const orcArt: PublishedTokenArt = {
      url: "https://cdn.owlbear.rodeo/assets/orc-gone.png",
      mime: "image/png",
      width: 300,
      height: 300,
      sha256: "b2".repeat(32),
    };

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], {
        art: { shadow: storedArt, orc: orcArt },
      }),
    );
    await settle();

    expect(byKey(s.listed())).toEqual([
      // No orc instance: the type is named by its key.
      {
        monsterKey: "orc",
        monsterName: "orc",
        assetName: `ttrpg-art-${"b2".repeat(8)}`,
        uploaded: false,
      },
      shadowRow(false),
    ]);
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.loads).toEqual([]);
    expect(s.reported).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("without loadImage stored art is used as stored with no liveness check and nothing listed", async () => {
    const without = setup({ loadImage: null, imageAlive: false });
    await without.sync.handleMessage(
      createMessageFeed().snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    await settle();

    expect(without.alive).toEqual([]);
    expectImages(without.tokenOf, ["shadow-1"], storedArt);
    expect(without.listed()).toEqual([]);
    expect(without.sync.artWaits()).toEqual([]);
    expect(without.fake.uploads()).toEqual([]);
    expect(without.fake.pickImageCalls()).toBe(0);

    // Control: with loadImage, the same art is checked.
    const withLoad = setup({ imageAlive: true });
    await withLoad.sync.handleMessage(
      createMessageFeed().snapshot([inst(1)], { art: { shadow: storedArt } }),
    );
    await settle();
    expect(withLoad.alive).toEqual([storedArt.url]);
  });

  it("a liveness check that cannot tell keeps the stored art and lists nothing", async () => {
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );
    await settle();

    expect(s.alive).toEqual([storedArt.url]);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], storedArt);
    expect(s.listed()).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);
    expect(s.loads).toEqual([]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.reported).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("art without a hash is never checked for re-upload or listed", async () => {
    const feed = createMessageFeed();
    const linkOnly = pictureOf(storedArt);
    const s = setup({ imageAlive: false });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(1, "goblin")], {
        art: { shadow: linkOnly, goblin: goblinArt },
      }),
    );
    await settle();

    // Only the goblin's art, which has a hash, is checked and listed.
    expect(s.alive).toEqual([goblinArt.url]);
    expectImages(s.tokenOf, ["shadow-1"], linkOnly);
    expectCircles(s.tokenOf, ["goblin-1"]);
    expect(s.listed().map((row) => row.monsterKey)).toEqual(["goblin"]);
    expect(s.sync.artWaits()).toEqual([
      { monsterKey: "goblin", monsterName: "Goblin", step: "reupload" },
    ]);
    expect(s.loads).toEqual([]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
  });

  it("a type picked this session is not checked or listed", async () => {
    const feed = createMessageFeed();
    const s = setup({
      // Only the goblin's url answers.
      imageAlive: (url) => url === goblinArt.url,
      pickImage: pickedArt,
      withStoreImage: true,
    });

    // No art yet: the GM picks one, and its bytes get a hash.
    await s.sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(s.reported).toHaveLength(2));
    expect(s.reported[1]).toEqual([
      "shadow",
      { ...pickedArt, sha256: PICKED_SHA },
    ]);

    // A later snapshot carries the picked art with its hash, and a goblin
    // with stored art; both types get new tokens.
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(1, "goblin")], {
        art: {
          shadow: { ...pickedArt, sha256: PICKED_SHA },
          goblin: goblinArt,
        },
      }),
    );
    await settle();

    expect(s.alive).toEqual([goblinArt.url]);
    expect(s.fake.pickImageCalls()).toBe(1);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], pickedArt);
    expectImages(s.tokenOf, ["goblin-1"], goblinArt);
    expect(s.listed()).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);
  });

  it("a listed type gets circle tokens with no dialog, and the reconcile places every token at once", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: (url) => url !== storedArt.url });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2), inst(1, "goblin"), inst(2, "goblin")], {
        art: { shadow: storedArt, goblin: goblinArt },
      }),
    );

    expect(s.tokens()).toHaveLength(4);
    expect(s.addCalls).toEqual([4]);
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
    expectImages(s.tokenOf, ["goblin-1", "goblin-2"], goblinArt);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);

    // A later token of the listed type is a circle too, with no dialog.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(3)] }),
    );
    expectCircles(s.tokenOf, ["shadow-3"]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.loads).toEqual([]);
    expect(s.listed()).toEqual([shadowRow(false)]);
    expect(s.errors).toEqual([]);
  });

  it("art without a url lists its type when the encounter has an instance of it, and its tokens are circles", async () => {
    const feed = createMessageFeed();
    const unpublished = { sha256: STORED_SHA } as TokenArt;
    const s = setup();

    // No shadow in the encounter: nothing listed.
    await s.sync.handleMessage(
      feed.snapshot([inst(1, "goblin")], {
        art: { shadow: unpublished, goblin: goblinArt },
      }),
    );
    await settle();
    expect(s.listed()).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);

    // A shadow arrives: its type is listed and its token is a circle.
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(1)] }),
    );
    await settle();
    expect(s.listed()).toEqual([shadowRow(false)]);
    expect(s.sync.artWaits()).toEqual([
      { monsterKey: "shadow", monsterName: "Shadow", step: "reupload" },
    ]);
    expectCircles(s.tokenOf, ["shadow-1"]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.loads).toEqual([]);

    // The last shadow leaves: the type leaves the list.
    await s.sync.handleMessage(feed.event({ type: "removed", id: "shadow-1" }));
    await settle();
    expect(s.listed()).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("a reconcile about to create tokens of a type whose liveness check is pending waits for it and draws circles when the url is gone", async () => {
    const feed = createMessageFeed();
    const check = deferred<boolean>();
    const s = setup({ imageAlive: () => check.promise });

    const applied = s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );
    await settle();
    expect(s.alive).toEqual([storedArt.url]);
    expect(s.tokens()).toEqual([]);

    check.resolve(false);
    await applied;
    await settle();

    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
    expect(s.listed()).toEqual([shadowRow(false)]);
    expect(s.alive).toHaveLength(1);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.errors).toEqual([]);
  });
});

describe("createEncounterSync re-upload list", () => {
  it("artWaits lists the types to re-upload as reupload with their monster names", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(1, "wolf"), inst(2, "wolf")], {
        art: { shadow: storedArt, wolf: wolfArt },
      }),
    );
    await settle();

    expect(byKey(s.sync.artWaits())).toEqual([
      { monsterKey: "shadow", monsterName: "Shadow", step: "reupload" },
      { monsterKey: "wolf", monsterName: "Wolf", step: "reupload" },
    ]);
    // In the order of the re-upload list.
    expect(s.sync.artWaits().map((wait) => wait.monsterKey)).toEqual(
      s.listed().map((row) => row.monsterKey),
    );
  });

  it("onReuploadsChange reports the list when a type is listed, uploaded or picked", async () => {
    const s = await listedShadow({ pickImage: republished });
    expect(s.listed()).toEqual([shadowRow(false)]);
    const reports = s.reuploads.length;

    await s.sync.reuploadArt("shadow");
    expect(s.reuploads.length).toBeGreaterThan(reports);
    expect(s.listed()).toEqual([shadowRow(true)]);

    await s.sync.pickUploadedArt("shadow");
    await settle();
    expect(s.listed()).toEqual([]);
  });

  it("reuploadArt loads the stored bytes and uploads them under the hash-derived name, marks the type uploaded and opens no picker", async () => {
    const s = await listedShadow({ pickImage: republished });
    expect(s.fake.uploads()).toEqual([]);
    expect(s.loads).toEqual([]);

    await s.sync.reuploadArt("shadow");

    expect(s.loads).toEqual([STORED_SHA]);
    const uploads = s.fake.uploads();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]?.name).toBe(REUPLOAD_NAME);
    expect(uploads[0]?.mime).toBe("image/png");
    expect([...(uploads[0]?.bytes ?? [])]).toEqual([...STORED_BYTES]);
    expect(s.listed()).toEqual([shadowRow(true)]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);

    // A type that is not listed: nothing happens.
    await s.sync.reuploadArt("goblin");
    expect(s.loads).toEqual([STORED_SHA]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.errors).toEqual([]);
  });

  it("pickUploadedArt opens the picker with the asset name as its search; a valid pick becomes the type's art with the existing sha256, is sent as one token-art-set and takes the type off the list", async () => {
    const s = await listedShadow({
      pickImage: republished,
      withStoreImage: true,
    });
    await s.sync.reuploadArt("shadow");

    await s.sync.pickUploadedArt("shadow");
    await settle();

    expect(s.searches).toEqual([REUPLOAD_NAME]);
    expect(s.reported).toEqual([
      ["shadow", { ...republished, sha256: STORED_SHA }],
    ]);
    expect(s.listed()).toEqual([]);
    expect(s.sync.artWaits()).toEqual([]);
    // The same bytes: nothing is fetched or stored again.
    expect(s.fetched).toEqual([]);
    expect(s.storedBytes).toEqual([]);

    // A later token of the type is drawn with the new art, with no dialog.
    await s.sync.handleMessage(
      s.feed.event({ type: "added", instances: [inst(3)] }),
    );
    expectImages(s.tokenOf, ["shadow-3"], republished);
    expect(s.reported).toHaveLength(1);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it("a cancelled, failed or invalid pick, or a failed upload, keeps the type listed and its tokens circles", async () => {
    const unusable: PublishedTokenArt = {
      url: "http://insecure.example/shadow.png",
      mime: "image/png",
      width: 0,
      height: 280,
    };
    const cases: {
      label: string;
      pickImage: FakePick;
      uploadImage?: () => Promise<void>;
      uploaded: boolean;
      picks: number;
    }[] = [
      {
        label: "cancelled pick",
        pickImage: undefined,
        uploaded: true,
        picks: 1,
      },
      {
        label: "picker error",
        pickImage: () => Promise.reject(new Error("picker failed")),
        uploaded: true,
        picks: 1,
      },
      { label: "invalid pick", pickImage: unusable, uploaded: true, picks: 1 },
      {
        label: "upload error",
        pickImage: republished,
        uploadImage: () => Promise.reject(new Error("upload failed")),
        uploaded: false,
        picks: 0,
      },
    ];
    for (const { label, pickImage, uploadImage, uploaded, picks } of cases) {
      const s = await listedShadow({
        pickImage,
        ...(uploadImage === undefined ? {} : { uploadImage }),
      });

      await expect(s.sync.reuploadArt("shadow"), label).resolves.toBe(
        undefined,
      );
      if (uploaded)
        await expect(s.sync.pickUploadedArt("shadow"), label).resolves.toBe(
          undefined,
        );
      await settle();

      expect(s.fake.pickImageCalls(), label).toBe(picks);
      expect(s.listed(), label).toEqual([shadowRow(uploaded)]);
      expect(s.sync.artWaits(), label).toEqual([
        { monsterKey: "shadow", monsterName: "Shadow", step: "reupload" },
      ]);
      expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
      expect(s.reported, label).toEqual([]);
      expect(s.errors, label).toEqual([]);

      // The GM can press again.
      await s.sync.reuploadArt("shadow");
      expect(s.fake.uploads(), label).toHaveLength(2);
    }
  });

  it("stored bytes the bridge cannot serve are reported through onArtRepublishFailed and keep the type listed", async () => {
    const reason = "no token image with that hash";
    const s = await listedShadow({
      pickImage: republished,
      loadImage: () => Promise.reject(new Error(reason)),
    });
    // Nothing is loaded before the GM presses Re-upload.
    expect(s.loads).toEqual([]);
    expect(s.failures).toEqual([]);

    await s.sync.reuploadArt("shadow");

    expect(s.loads).toEqual([STORED_SHA]);
    expect(s.failures).toEqual([
      `Could not republish the token art for shadow: ${reason}`,
    ]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.listed()).toEqual([shadowRow(false)]);
    expect(s.sync.artWaits()).toEqual([
      { monsterKey: "shadow", monsterName: "Shadow", step: "reupload" },
    ]);
    expectCircles(s.tokenOf, ["shadow-1", "shadow-2"]);
    expect(s.errors).toEqual([]);
  });

  it("a stale snapshot after a re-upload pick keeps the re-uploaded art", async () => {
    // The socket is down until the hello-ack, so the re-picked art waits.
    let connected = false;
    const s = await listedShadow(
      { pickImage: republished, connected: () => connected },
      [inst(1)],
    );
    await s.sync.reuploadArt("shadow");
    await s.sync.pickUploadedArt("shadow");
    await settle();
    expectImages(s.tokenOf, ["shadow-1"], republished);
    expect(s.reported).toEqual([]);

    // The reconnect's snapshot was built before the queued pick reached the
    // store: it still carries the gone art.
    connected = true;
    await s.sync.handleMessage(helloAck);
    expect(s.reported).toEqual([
      ["shadow", { ...republished, sha256: STORED_SHA }],
    ]);
    await s.sync.handleMessage(
      s.feed.snapshot([inst(1), inst(2)], { art: { shadow: storedArt } }),
    );
    await settle();

    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], republished);
    expect(s.alive).toEqual([storedArt.url]);
    expect(s.listed()).toEqual([]);
    expect(s.fake.uploads()).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(s.errors).toEqual([]);
  });

  it("after a re-upload pick the type's circle tokens are replaced with image tokens and its image tokens redrawn with the art", async () => {
    // Shadow 1's token was drawn with the stored art in an earlier session,
    // before its Owlbear asset went away.
    const scene = new SceneModel();
    const earlier = planSync([inst(1)], [], defaultSyncConfig, {
      viewportCenter: { x: 0, y: 0 },
      placed: new Set(),
      art: { shadow: storedArt },
    });
    scene.addItems(earlier.add);
    scene.setMetadata({ [PLACED_METADATA_KEY]: ["shadow-1"] });
    const oldId = scene.getItems()[0]?.id;

    const s = await listedShadow({ pickImage: republished, scene }, [
      inst(1),
      inst(2),
    ]);
    expectImages(s.tokenOf, ["shadow-1"], storedArt);
    expectCircles(s.tokenOf, ["shadow-2"]);
    const circleId = s.tokenOf("shadow-2")?.id;

    await s.sync.reuploadArt("shadow");
    await s.sync.pickUploadedArt("shadow");
    await settle();

    expect(s.tokens()).toHaveLength(2);
    expectImages(s.tokenOf, ["shadow-1", "shadow-2"], republished);
    // Shadow 1 is redrawn in place; Shadow 2's circle is replaced.
    expect(s.tokenOf("shadow-1")?.id).toBe(oldId);
    expect(s.tokenOf("shadow-2")?.id).not.toBe(circleId);
    expect(s.tokenOf("shadow-1")?.scale ?? { x: 1, y: 1 }).toEqual({
      x: 1,
      y: 1,
    });
    expect(s.overrides).toEqual([
      "Shadow 2's token was replaced with a new one drawn with the art uploaded for its monster type; any attachments on the old token were deleted with it.",
    ]);
    expect(s.errors).toEqual([]);
  });
});
