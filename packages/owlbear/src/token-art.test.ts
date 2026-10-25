import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TOKEN_IMAGE_UPLOAD_PATH,
  decodeMessage,
  encodeMessage,
  type TokenImageUploadResponse,
} from "@ttrpg-agents/protocol";
import { tokenArtMessage, uploadTokenImage } from "./token-art.js";

const art = {
  url: "https://cdn.owlbear.rodeo/assets/shadow.png",
  mime: "image/png",
  width: 300,
  height: 280,
};

describe("tokenArtMessage", () => {
  it("tokenArtMessage builds a token-art-set envelope that the protocol decodes with the art", () => {
    const decoded = decodeMessage(
      encodeMessage(tokenArtMessage("shadow", art)),
    );
    expect(decoded).toEqual({
      ok: true,
      message: {
        v: 1,
        type: "token-art-set",
        payload: { monsterKey: "shadow", art },
      },
    });
  });
});

const TOKEN = "e7".repeat(32);
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

interface Captured {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: Uint8Array;
}

/** Replaces the global fetch with one that answers `status` and `json`, recording each request. */
function stubFetch(status: number, json: unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body =
        init?.body === undefined || init.body === null
          ? new Uint8Array()
          : new Uint8Array(await new Response(init.body).arrayBuffer());
      calls.push({
        url: input instanceof Request ? input.url : String(input),
        method: init?.method,
        authorization: new Headers(init?.headers).get("authorization"),
        body,
      });
      return new Response(JSON.stringify(json), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return calls;
}

describe("uploadTokenImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stored: TokenImageUploadResponse = {
    ok: true,
    image: { sha256: "ab".repeat(32), mime: "image/png", width: 1, height: 1 },
  };

  it("uploadTokenImage posts the bytes to /token-images with the extension token as a bearer", async () => {
    const calls = stubFetch(200, stored);

    await uploadTokenImage(BYTES, TOKEN);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.endsWith(TOKEN_IMAGE_UPLOAD_PATH)).toBe(true);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.authorization).toBe(`Bearer ${TOKEN}`);
    expect([...(calls[0]?.body ?? [])]).toEqual([...BYTES]);
  });

  it("uploadTokenImage resolves with the bridge's answer, a stored image or a refusal", async () => {
    stubFetch(200, stored);
    await expect(uploadTokenImage(BYTES, TOKEN)).resolves.toEqual(stored);

    const refused: TokenImageUploadResponse = {
      ok: false,
      error: {
        code: "svg",
        message: "SVG images are not accepted. Use PNG, JPEG or WebP.",
      },
    };
    stubFetch(422, refused);
    await expect(uploadTokenImage(BYTES, TOKEN)).resolves.toEqual(refused);

    const unauthorized: TokenImageUploadResponse = {
      ok: false,
      error: { code: "unauthorized", message: "bad token" },
    };
    stubFetch(401, unauthorized);
    await expect(uploadTokenImage(BYTES, TOKEN)).resolves.toEqual(unauthorized);
  });

  it("uploadTokenImage rejects an answer that is not an upload response", async () => {
    const calls = stubFetch(200, { ok: true, image: { sha256: "nope" } });

    await expect(uploadTokenImage(BYTES, TOKEN)).rejects.toBeDefined();
    // The request went out: the rejection is about the answer.
    expect(calls).toHaveLength(1);

    // Control: a well-formed answer from the same request resolves.
    stubFetch(200, stored);
    await expect(uploadTokenImage(BYTES, TOKEN)).resolves.toEqual(stored);
  });
});
