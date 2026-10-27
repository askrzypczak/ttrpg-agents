import { describe, expect, it, vi } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import type {
  BridgeMessage,
  TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import {
  createFakeObr,
  type FakeFetch,
  type FakePick,
} from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { createMessageFeed } from "./testing/messages.js";
import { instanceIdOf, type EncounterInstance } from "./sync-plan.js";
import type { StoredTokenImage } from "./token-art.js";

const inst = (n: number, monsterKey = "shadow"): EncounterInstance =>
  makeTestInstance({
    id: `${monsterKey}-${n}`,
    monsterKey,
    displayName: `${monsterKey} ${n}`,
    createdAt: n,
  });

/** Shadow art stored as a link only: a url and no hash. */
const shadowArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

/** Goblin art stored as a link only. */
const goblinArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/goblin.png",
  mime: "image/png",
  width: 200,
  height: 200,
};

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256 = "ab".repeat(32);

const stored: TokenImageUploadResponse = {
  ok: true,
  image: { sha256: SHA256, mime: "image/png", width: 300, height: 280 },
};

const failureText = (monsterKey: string, reason: string): string =>
  `Could not store the image of the token art for ${monsterKey}; it is kept as a link: ${reason}`;

/** The image fields a token is drawn with. */
const pictureOf = ({ url, mime, width, height }: PublishedTokenArt) => ({
  url,
  mime,
  width,
  height,
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

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(
  options: {
    imageAlive?: boolean | ((url: string) => boolean | Promise<boolean>);
    fetchImage?: FakeFetch;
    storeImage?: (bytes: Uint8Array) => Promise<TokenImageUploadResponse>;
    pickImage?: FakePick;
    /** Passes a recording `loadImage` option. Default: left out. */
    withLoadImage?: boolean;
  } = {},
) {
  const alive: string[] = [];
  const fetched: string[] = [];
  const uploads: Uint8Array[] = [];
  const failures: string[] = [];
  const republishFailures: string[] = [];
  const prompts: unknown[] = [];
  const loads: string[] = [];
  const reported: [string, PublishedTokenArt][] = [];
  const errors: unknown[] = [];
  const answerAlive = options.imageAlive ?? true;
  const answerFetch = options.fetchImage ?? BYTES;
  const answerStore = options.storeImage ?? (() => Promise.resolve(stored));
  const fake = createFakeObr(undefined, undefined, {
    imageAlive: (url) => {
      alive.push(url);
      return typeof answerAlive === "function" ? answerAlive(url) : answerAlive;
    },
    fetchImage: (url) => {
      fetched.push(url);
      return typeof answerFetch === "function"
        ? answerFetch(url)
        : answerFetch.slice();
    },
    pickImage: options.pickImage,
  });
  const loadImage = (sha256: string): Promise<StoredTokenImage> => {
    loads.push(sha256);
    return Promise.resolve({ bytes: BYTES.slice(), mime: "image/png" });
  };
  const sync = createEncounterSync(
    fake.obr,
    (e) => errors.push(e),
    () => {},
    {
      timers: idleTimers,
      send: (message) => {
        if (message.type === "token-art-set")
          reported.push([message.payload.monsterKey, message.payload.art]);
        return true;
      },
      storeImage: (bytes) => {
        uploads.push(bytes);
        return answerStore(bytes);
      },
      onArtStoreFailed: (text) => failures.push(text),
      onArtRepublishFailed: (text) => republishFailures.push(text),
      // What the GM is asked: an art step, or a type listed for re-upload.
      onArtStep: (step) => prompts.push(step),
      onReuploadsChange: (list) => {
        if (list.length > 0) prompts.push(list);
      },
      ...(options.withLoadImage === true ? { loadImage } : {}),
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  return {
    fake,
    sync,
    alive,
    fetched,
    uploads,
    failures,
    republishFailures,
    prompts,
    loads,
    reported,
    errors,
    tokenOf,
  };
}

describe("createEncounterSync storing the bytes of art without a hash", () => {
  it("a snapshot's art with a url and no hash whose url is alive is fetched, stored through storeImage and sent again with the returned hash", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true });

    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: shadowArt } }),
    );

    await vi.waitFor(() => expect(s.reported).toHaveLength(1));
    expect(s.alive).toEqual([shadowArt.url]);
    expect(s.fetched).toEqual([shadowArt.url]);
    expect(s.uploads).toHaveLength(1);
    expect([...(s.uploads[0] ?? [])]).toEqual([...BYTES]);
    expect(s.reported).toEqual([["shadow", { ...shadowArt, sha256: SHA256 }]]);
    expect(s.failures).toEqual([]);
    expect(s.errors).toEqual([]);
  });

  it("storing the bytes of art without a hash opens no picker, uploads nothing to Owlbear and prompts the GM for nothing", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true, withLoadImage: true });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: shadowArt } }),
    );

    await vi.waitFor(() => expect(s.reported).toHaveLength(1));
    await settle();
    expect(s.uploads).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.prompts).toEqual([]);
    expect(s.loads).toEqual([]);
    expect(s.republishFailures).toEqual([]);
    expect(s.tokenOf("shadow-1")).toMatchObject({
      type: "IMAGE",
      image: pictureOf(shadowArt),
    });
  });

  it("art without a hash is stored on connect whether or not its type gets tokens", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true });

    // Shadows are in the encounter; no goblin is.
    await s.sync.handleMessage(
      feed.snapshot([inst(1)], {
        art: { shadow: shadowArt, goblin: goblinArt },
      }),
    );

    await vi.waitFor(() => expect(s.reported).toHaveLength(2));
    expect([...s.alive].sort()).toEqual([goblinArt.url, shadowArt.url].sort());
    expect([...s.fetched].sort()).toEqual(
      [goblinArt.url, shadowArt.url].sort(),
    );
    expect(s.uploads).toHaveLength(2);
    expect([...s.reported].sort(([a], [b]) => a.localeCompare(b))).toEqual([
      ["goblin", { ...goblinArt, sha256: SHA256 }],
      ["shadow", { ...shadowArt, sha256: SHA256 }],
    ]);
    expect(s.fake.pickImageCalls()).toBe(0);
  });

  it("art without a hash whose url is dead is left unchanged, with nothing fetched, stored or sent", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: false });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: shadowArt } }),
    );

    await vi.waitFor(() => expect(s.alive).toEqual([shadowArt.url]));
    await settle();
    expect(s.fetched).toEqual([]);
    expect(s.uploads).toEqual([]);
    expect(s.reported).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.tokenOf("shadow-1")).toMatchObject({
      type: "IMAGE",
      image: pictureOf(shadowArt),
    });
    expect(s.errors).toEqual([]);
  });

  it("art without a hash whose liveness check cannot tell is left unchanged, with nothing fetched, stored or sent and no failure reported", async () => {
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: () => Promise.reject(new TypeError("Failed to fetch")),
    });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: shadowArt } }),
    );

    await vi.waitFor(() => expect(s.alive).toEqual([shadowArt.url]));
    await settle();
    expect(s.fetched).toEqual([]);
    expect(s.uploads).toEqual([]);
    expect(s.reported).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(s.fake.uploads()).toEqual([]);
    expect(s.fake.pickImageCalls()).toBe(0);
    expect(s.tokenOf("shadow-1")).toMatchObject({
      type: "IMAGE",
      image: pictureOf(shadowArt),
    });
    expect(s.errors).toEqual([]);
  });

  it("a failed fetch of art without a hash leaves it unchanged and is reported through onArtStoreFailed", async () => {
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: true,
      fetchImage: () => Promise.reject(new Error("404 Not Found")),
    });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: shadowArt } }),
    );

    await vi.waitFor(() => expect(s.failures).toHaveLength(1));
    expect(s.failures).toEqual([failureText("shadow", "404 Not Found")]);
    await settle();
    expect(s.fetched).toEqual([shadowArt.url]);
    expect(s.uploads).toEqual([]);
    expect(s.reported).toEqual([]);
    expect(s.tokenOf("shadow-1")).toMatchObject({
      type: "IMAGE",
      image: pictureOf(shadowArt),
    });
    expect(s.errors).toEqual([]);
  });

  it("a refused or failed upload of art without a hash leaves it unchanged and is reported through onArtStoreFailed", async () => {
    const refusal = "SVG images are not accepted. Use PNG, JPEG or WebP.";
    const cases = [
      {
        label: "refused",
        storeImage: (): Promise<TokenImageUploadResponse> =>
          Promise.resolve({
            ok: false,
            error: { code: "svg", message: refusal },
          }),
        reason: refusal,
      },
      {
        label: "failed",
        storeImage: (): Promise<TokenImageUploadResponse> =>
          Promise.reject(new Error("bridge unreachable")),
        reason: "bridge unreachable",
      },
    ];
    for (const { label, storeImage, reason } of cases) {
      const feed = createMessageFeed();
      const s = setup({ imageAlive: true, storeImage });

      await s.sync.handleMessage(
        feed.snapshot([inst(1)], { art: { shadow: shadowArt } }),
      );

      await vi.waitFor(() => expect(s.failures, label).toHaveLength(1));
      expect(s.failures, label).toEqual([failureText("shadow", reason)]);
      await settle();
      expect(s.fetched, label).toEqual([shadowArt.url]);
      expect(s.uploads, label).toHaveLength(1);
      expect(s.reported, label).toEqual([]);
      expect(s.tokenOf("shadow-1"), label).toMatchObject({
        type: "IMAGE",
        image: pictureOf(shadowArt),
      });
      expect(s.errors, label).toEqual([]);
    }
  });

  it("art without a hash is checked at most once per session, whatever the outcome, across later snapshots and reconciles", async () => {
    const cases: {
      label: string;
      imageAlive: boolean | (() => Promise<boolean>);
      fetchImage?: FakeFetch;
      storeImage?: () => Promise<TokenImageUploadResponse>;
    }[] = [
      { label: "dead", imageAlive: false },
      {
        label: "cannot tell",
        imageAlive: () => Promise.reject(new TypeError("Failed to fetch")),
      },
      {
        label: "failed fetch",
        imageAlive: true,
        fetchImage: () => Promise.reject(new Error("404 Not Found")),
      },
      {
        label: "failed upload",
        imageAlive: true,
        storeImage: () => Promise.reject(new Error("bridge unreachable")),
      },
      { label: "stored", imageAlive: true },
    ];
    for (const { label, ...answers } of cases) {
      const feed = createMessageFeed();
      const s = setup(answers);
      const art = { shadow: shadowArt };

      await s.sync.handleMessage(feed.snapshot([inst(1)], { art }));
      await vi.waitFor(() => expect(s.alive, label).toHaveLength(1));
      await settle();

      // Later reconciles: a reconnect with its snapshot, then a new instance.
      await s.sync.handleMessage(helloAck);
      await s.sync.handleMessage(feed.snapshot([inst(1)], { art }));
      await s.sync.handleMessage(
        feed.event({ type: "added", instances: [inst(2)] }),
      );
      await settle();

      expect(s.alive, label).toEqual([shadowArt.url]);
      expect(s.fetched.length, label).toBeLessThanOrEqual(1);
      expect(s.uploads.length, label).toBeLessThanOrEqual(1);
      expect(s.failures.length, label).toBeLessThanOrEqual(1);
      expect(s.reported.length, label).toBeLessThanOrEqual(1);
      expect(s.fake.pickImageCalls(), label).toBe(0);
    }
  });

  it("a type picked this session is not stored again when a later snapshot brings its art without a hash", async () => {
    const feed = createMessageFeed();
    const s = setup({
      imageAlive: true,
      pickImage: shadowArt,
      storeImage: () => Promise.reject(new Error("bridge unreachable")),
    });

    // No art yet: the GM picks one, and storing its bytes fails.
    await s.sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(s.failures).toHaveLength(1));
    expect(s.fetched).toEqual([shadowArt.url]);
    expect(s.uploads).toHaveLength(1);

    // The reconnect's snapshot carries the picked art as a link, and the
    // link-only art of a goblin that was not picked this session.
    await s.sync.handleMessage(helloAck);
    await s.sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], {
        art: { shadow: shadowArt, goblin: goblinArt },
      }),
    );
    await vi.waitFor(() => expect(s.alive).toEqual([goblinArt.url]));
    await settle();

    expect(s.alive).toEqual([goblinArt.url]);
    expect(s.fetched.filter((url) => url === shadowArt.url)).toHaveLength(1);
    expect(s.fake.pickImageCalls()).toBe(1);
    expect(
      s.failures.filter((text) => text.includes("token art for shadow;")),
    ).toHaveLength(1);
  });

  it("art with a hash, with or without a url, is not fetched or stored", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], {
        art: {
          shadow: { ...shadowArt, sha256: SHA256 },
          orc: { sha256: "cd".repeat(32) },
          // Control: link-only art in the same snapshot is checked.
          goblin: goblinArt,
        },
      }),
    );

    await vi.waitFor(() => expect(s.alive).toEqual([goblinArt.url]));
    await settle();
    expect(s.alive).toEqual([goblinArt.url]);
    expect(s.fetched).toEqual([goblinArt.url]);
    expect(s.uploads).toHaveLength(1);
    expect(s.reported.map(([key]) => key)).toEqual(["goblin"]);
  });

  it("a type's tokens are created with its art without a hash while the liveness check is still pending", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: () => new Promise<boolean>(() => {}) });

    await s.sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: shadowArt } }),
    );

    await vi.waitFor(() =>
      expect(s.tokenOf("shadow-1")).toMatchObject({
        type: "IMAGE",
        image: pictureOf(shadowArt),
      }),
    );
    expect(s.alive).toEqual([shadowArt.url]);
    expect(s.fetched).toEqual([]);
  });

  it("a type whose bytes were stored on connect is not checked again when it first gets tokens", async () => {
    const feed = createMessageFeed();
    const s = setup({ imageAlive: true, withLoadImage: true });

    await s.sync.handleMessage(
      feed.snapshot([], { art: { shadow: shadowArt } }),
    );
    await vi.waitFor(() => expect(s.reported).toHaveLength(1));
    await s.sync.handleMessage(
      feed.event({ type: "added", instances: [inst(1)] }),
    );
    await settle();

    expect(s.alive).toEqual([shadowArt.url]);
    expect(s.loads).toEqual([]);
    expect(s.tokenOf("shadow-1")).toMatchObject({
      type: "IMAGE",
      image: pictureOf(shadowArt),
    });
  });
});
