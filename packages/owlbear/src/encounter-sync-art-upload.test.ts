import { describe, expect, it, vi } from "vitest";
import type { TokenArt } from "@ttrpg-agents/engine";
import type {
  BridgeMessage,
  TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
import { createEncounterSync } from "./encounter-sync.js";
import { createFakeObr, type FakeFetch } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { createMessageFeed } from "./testing/messages.js";
import { instanceIdOf, type EncounterInstance } from "./sync-plan.js";

const inst = (n: number, monsterKey = "shadow"): EncounterInstance => ({
  id: `i${n}`,
  encounterId: "e1",
  monsterKey,
  displayName: `${monsterKey} ${n}`,
  maxHp: 16,
  currentHp: 16,
  initiative: null,
  armorClass: null,
  groupId: null,
  createdAt: n,
  footprint: 1,
  statsVisible: false,
});

const shadowArt: TokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const SHA256 = "ab".repeat(32);

const stored: TokenImageUploadResponse = {
  ok: true,
  image: { sha256: SHA256, mime: "image/png", width: 300, height: 280 },
};

const failureText = (monsterKey: string, reason: string): string =>
  `Could not store the image of the token art for ${monsterKey}; it is kept as a link: ${reason}`;

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
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets pending promise chains and timers queued by the sync run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function setup(options: {
  fetchImage: FakeFetch;
  storeImage: (bytes: Uint8Array) => Promise<TokenImageUploadResponse>;
}) {
  const fetched: string[] = [];
  const fetchImage = options.fetchImage;
  const fake = createFakeObr(undefined, undefined, {
    pickImage: shadowArt,
    fetchImage: (url) => {
      fetched.push(url);
      return typeof fetchImage === "function" ? fetchImage(url) : fetchImage;
    },
  });
  const uploads: Uint8Array[] = [];
  const failures: string[] = [];
  const errors: unknown[] = [];
  const reported: [string, TokenArt][] = [];
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
        return options.storeImage(bytes);
      },
      onArtStoreFailed: (text) => failures.push(text),
    },
  );
  const tokenOf = (instanceId: string) =>
    fake.scene.getItems().find((item) => instanceIdOf(item) === instanceId);
  return { fake, sync, fetched, uploads, failures, errors, reported, tokenOf };
}

describe("createEncounterSync token art upload", () => {
  it("after a pick, fetches the picked image's url and stores its bytes through storeImage", async () => {
    const feed = createMessageFeed();
    const { sync, fetched, uploads, errors } = setup({
      fetchImage: BYTES,
      storeImage: () => Promise.resolve(stored),
    });

    await sync.handleMessage(feed.snapshot([inst(1), inst(2)]));

    await vi.waitFor(() => expect(uploads).toHaveLength(1));
    expect(fetched).toEqual([shadowArt.url]);
    expect([...(uploads[0] ?? [])]).toEqual([...BYTES]);
    expect(errors).toEqual([]);
  });

  it("after the bytes are stored, sends a token-art-set with the picked art and the returned hash", async () => {
    const feed = createMessageFeed();
    const { sync, reported, failures } = setup({
      fetchImage: BYTES,
      storeImage: () => Promise.resolve(stored),
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));

    await vi.waitFor(() => expect(reported).toHaveLength(2));
    expect(reported).toEqual([
      ["shadow", shadowArt],
      ["shadow", { ...shadowArt, sha256: SHA256 }],
    ]);
    expect(failures).toEqual([]);
  });

  it("sends the picked art without a hash at pick time, before the upload settles", async () => {
    const feed = createMessageFeed();
    const upload = deferred<TokenImageUploadResponse>();
    const { sync, reported, uploads } = setup({
      fetchImage: BYTES,
      storeImage: () => upload.promise,
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(uploads).toHaveLength(1));

    // The upload is still pending: only the link has gone out.
    expect(reported).toEqual([["shadow", shadowArt]]);
    expect(reported[0]?.[1].sha256).toBeUndefined();

    upload.resolve(stored);
    await vi.waitFor(() => expect(reported).toHaveLength(2));
    expect(reported[1]).toEqual(["shadow", { ...shadowArt, sha256: SHA256 }]);
  });

  it("creates the tokens with the picked art while the upload is still pending", async () => {
    const feed = createMessageFeed();
    const bytes = deferred<Uint8Array>();
    const { sync, fetched, uploads, tokenOf, errors } = setup({
      fetchImage: () => bytes.promise,
      storeImage: () => Promise.resolve(stored),
    });

    await sync.handleMessage(feed.snapshot([inst(1), inst(2)]));

    // The fetch has started and not answered; the tokens are already there.
    await vi.waitFor(() => expect(fetched).toEqual([shadowArt.url]));
    expect(uploads).toEqual([]);
    for (const id of ["i1", "i2"])
      expect(tokenOf(id)).toMatchObject({ type: "IMAGE", image: shadowArt });
    expect(errors).toEqual([]);

    bytes.resolve(BYTES);
    await vi.waitFor(() => expect(uploads).toHaveLength(1));
  });

  it("a failed fetch reports that the art is kept as a link and sends no second token-art-set", async () => {
    const feed = createMessageFeed();
    const { sync, fetched, uploads, failures, reported, tokenOf } = setup({
      fetchImage: () => Promise.reject(new Error("404 Not Found")),
      storeImage: () => Promise.resolve(stored),
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));

    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(failures).toEqual([failureText("shadow", "404 Not Found")]);
    await settle();
    expect(fetched).toEqual([shadowArt.url]);
    expect(uploads).toEqual([]);
    expect(reported).toEqual([["shadow", shadowArt]]);
    expect(tokenOf("i1")).toMatchObject({ type: "IMAGE", image: shadowArt });
  });

  it("a refused upload reports the bridge's message and sends no second token-art-set", async () => {
    const feed = createMessageFeed();
    const message = "SVG images are not accepted. Use PNG, JPEG or WebP.";
    const { sync, uploads, failures, reported } = setup({
      fetchImage: BYTES,
      storeImage: () =>
        Promise.resolve({ ok: false, error: { code: "svg", message } }),
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));

    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(failures).toEqual([failureText("shadow", message)]);
    await settle();
    expect(uploads).toHaveLength(1);
    expect(reported).toEqual([["shadow", shadowArt]]);
  });

  it("a failed upload is not tried again by later reconciles", async () => {
    const feed = createMessageFeed();
    const { sync, fetched, uploads, failures, reported } = setup({
      fetchImage: BYTES,
      storeImage: () => Promise.reject(new Error("bridge unreachable")),
    });

    await sync.handleMessage(feed.snapshot([inst(1)]));
    await vi.waitFor(() => expect(failures).toHaveLength(1));
    expect(failures).toEqual([failureText("shadow", "bridge unreachable")]);

    // Later reconciles: a reconnect with its snapshot, then a new instance.
    await sync.handleMessage(helloAck);
    await sync.handleMessage(
      feed.snapshot([inst(1)], { art: { shadow: shadowArt } }),
    );
    await sync.handleMessage(
      feed.snapshot([inst(1), inst(2)], { art: { shadow: shadowArt } }),
    );
    await settle();

    expect(fetched).toEqual([shadowArt.url]);
    expect(uploads).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(reported).toEqual([["shadow", shadowArt]]);
  });
});
