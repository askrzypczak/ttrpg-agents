import { ImageUnavailableError } from "@ttrpg-agents/engine";
import { describe, expect, it } from "vitest";
import { createNodeImageSource } from "./node-image-source.js";

const URL_A = "https://art.example.com/owlbear.png";
const URL_B = "https://cdn.example.com/owlbear.png";
const MIB = 1024 * 1024;
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

/** A fetch stub answering each call in turn and recording the requested URLs. */
function fetchAnswering(
  ...answers: ((init: RequestInit | undefined) => Promise<Response>)[]
) {
  const urls: string[] = [];
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    urls.push(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const answer = answers.shift();
    return answer
      ? answer(init)
      : Promise.reject(new Error("unexpected fetch"));
  };
  return { fetch: fetch as typeof globalThis.fetch, urls };
}

const ok =
  (
    body: ConstructorParameters<typeof Response>[0],
    headers?: Record<string, string>,
  ) =>
  () =>
    Promise.resolve(new Response(body, { status: 200, headers }));

const redirectTo = (location: string) => () =>
  Promise.resolve(
    new Response(null, { status: 302, headers: { Location: location } }),
  );

/** A body that sends one shared 1 MiB chunk `times` times. */
function chunked(times: number): ReadableStream<Uint8Array> {
  const chunk = new Uint8Array(MIB);
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent === times) {
        controller.close();
        return;
      }
      sent++;
      controller.enqueue(chunk);
    },
  });
}

/** Never answers; rejects with the abort reason once the signal aborts. */
const hanging = (init: RequestInit | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return;
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener("abort", () => {
      reject(signal.reason);
    });
  });

interface RefusalCase {
  url: string;
  answers: ((init: RequestInit | undefined) => Promise<Response>)[];
  fetches: number;
  timeoutMs?: number;
}

describe("createNodeImageSource", () => {
  it("load fetches an https URL through the injected fetch and answers its bytes", async () => {
    const { fetch, urls } = fetchAnswering(ok(BYTES));
    const bytes = await createNodeImageSource({ fetch }).load({ url: URL_A });
    expect(new Uint8Array(bytes)).toEqual(BYTES);
    expect(urls).toEqual([URL_A]);
  });

  it("load follows a redirect to another https URL", async () => {
    const { fetch, urls } = fetchAnswering(redirectTo(URL_B), ok(BYTES));
    const bytes = await createNodeImageSource({ fetch }).load({ url: URL_A });
    expect(new Uint8Array(bytes)).toEqual(BYTES);
    expect(urls).toEqual([URL_A, URL_B]);
  });

  it.each<[string, RefusalCase]>([
    [
      "an http URL, without fetching it",
      {
        url: "http://art.example.com/owlbear.png",
        answers: [],
        fetches: 0,
      },
    ],
    [
      "a declared length over the 20 MiB cap",
      {
        url: URL_A,
        answers: [ok(BYTES, { "Content-Length": String(20 * MIB + 1) })],
        fetches: 1,
      },
    ],
    [
      "a streamed body over the 20 MiB cap, one shared 1 MiB chunk sent 21 times",
      {
        url: URL_A,
        answers: [() => Promise.resolve(new Response(chunked(21)))],
        fetches: 1,
      },
    ],
    [
      "an answer slower than a short `timeoutMs`",
      {
        url: URL_A,
        answers: [hanging],
        fetches: 1,
        timeoutMs: 50,
      },
    ],
    [
      "a redirect to an http URL",
      {
        url: URL_A,
        answers: [redirectTo("http://cdn.example.com/owlbear.png")],
        fetches: 1,
      },
    ],
    [
      "a 404 answer",
      {
        url: URL_A,
        answers: [
          () => Promise.resolve(new Response("not found", { status: 404 })),
        ],
        fetches: 1,
      },
    ],
  ])(
    "load refuses %s with an ImageUnavailableError",
    async (_case, { url, answers, fetches, timeoutMs }) => {
      const { fetch, urls } = fetchAnswering(...answers);
      const source = createNodeImageSource({
        fetch,
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      const error = await source.load({ url }).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ImageUnavailableError);
      expect(urls).toHaveLength(fetches);
    },
  );
});
