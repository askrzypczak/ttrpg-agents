import { describe, expect, it } from "vitest";
import type { PublishedTokenArt } from "@ttrpg-agents/engine";
import { makeTestInstance } from "@ttrpg-agents/engine/testing";
import { createEncounterSync, type Reupload } from "./encounter-sync.js";
import { createFakeObr } from "./fake-adapter.js";
import type { Timers } from "./reconnecting-socket.js";
import { instanceIdOf } from "./sync-plan.js";
import { createMessageFeed } from "./testing/messages.js";

const STORED_SHA = "c3".repeat(32);

/** Shadow art with stored bytes whose Owlbear asset is gone. */
const storedArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/shadow-old.png",
  mime: "image/png",
  width: 300,
  height: 280,
  sha256: STORED_SHA,
};

const shadow = makeTestInstance({
  id: "shadow-1",
  monsterKey: "shadow",
  displayName: "Shadow 1",
  createdAt: 1,
});

/** Timers that never fire: no retry runs behind the test's back. */
const idleTimers: Timers = {
  setTimeout: () => 1,
  clearTimeout: () => {},
};

/** Lets pending promise chains run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** The image the GM picks after the upload. */
const uploadedArt: PublishedTokenArt = {
  url: "https://cdn.owlbear.rodeo/assets/ttrpg-art-c3c3c3c3c3c3c3c3.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

describe("createEncounterSync re-upload errors", () => {
  it("a failed upload is reported through onArtRepublishFailed and keeps the type listed", async () => {
    const failures: string[] = [];
    const reuploads: Reupload[][] = [];
    const fake = createFakeObr(undefined, undefined, {
      imageAlive: false,
      uploadImage: () => Promise.reject(new Error("upload failed")),
    });
    const sync = createEncounterSync(
      fake.obr,
      () => {},
      () => {},
      {
        timers: idleTimers,
        loadImage: () =>
          Promise.resolve({
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            mime: "image/png",
          }),
        onArtRepublishFailed: (text) => failures.push(text),
        onReuploadsChange: (list) => reuploads.push(structuredClone(list)),
      },
    );
    await sync.handleMessage(
      createMessageFeed().snapshot([shadow], { art: { shadow: storedArt } }),
    );
    await settle();
    expect(failures).toEqual([]);

    await sync.reuploadArt("shadow");

    expect(fake.uploads()).toHaveLength(1);
    expect(failures).toEqual([
      "Could not republish the token art for Shadow: upload failed",
    ]);
    expect(reuploads.at(-1)).toEqual([
      {
        monsterKey: "shadow",
        monsterName: "Shadow",
        assetName: `ttrpg-art-${"c3".repeat(8)}`,
        uploaded: false,
      },
    ]);
    expect(sync.artWaits()).toEqual([
      { monsterKey: "shadow", monsterName: "Shadow", step: "reupload" },
    ]);
    expect(fake.pickImageCalls()).toBe(0);
    const token = fake.scene
      .getItems()
      .find((item) => instanceIdOf(item) === "shadow-1");
    expect(token).toMatchObject({ type: "SHAPE" });
  });

  it("a second press of Re-upload or Pick for a type whose re-upload or pick is still running is ignored", async () => {
    const upload = deferred<void>();
    const pick = deferred<PublishedTokenArt | undefined>();
    const fake = createFakeObr(undefined, undefined, {
      imageAlive: false,
      uploadImage: () => upload.promise,
      pickImage: () => pick.promise,
    });
    const sync = createEncounterSync(
      fake.obr,
      () => {},
      () => {},
      {
        timers: idleTimers,
        loadImage: () =>
          Promise.resolve({
            bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            mime: "image/png",
          }),
      },
    );
    await sync.handleMessage(
      createMessageFeed().snapshot([shadow], { art: { shadow: storedArt } }),
    );
    await settle();

    const first = sync.reuploadArt("shadow");
    await settle();
    await sync.reuploadArt("shadow");
    expect(fake.uploads()).toHaveLength(1);
    upload.resolve();
    await first;

    const firstPick = sync.pickUploadedArt("shadow");
    await settle();
    await sync.pickUploadedArt("shadow");
    await sync.reuploadArt("shadow");
    expect(fake.pickImageCalls()).toBe(1);
    expect(fake.uploads()).toHaveLength(1);
    pick.resolve(uploadedArt);
    await firstPick;

    expect(sync.artWaits()).toEqual([]);
  });
});
