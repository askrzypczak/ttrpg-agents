import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import {
  IMAGE_LOAD_TIMEOUT_MS,
  ImageUnavailableError,
  TOKEN_SOURCE_MAX_BYTES,
  type ImageSource,
} from "@ttrpg-agents/engine";

/** The most redirects one URL load follows. */
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CAP_TEXT = `${String(TOKEN_SOURCE_MAX_BYTES / (1024 * 1024))} MiB`;

/**
 * Loads an absolute file path or an https URL, capped at
 * TOKEN_SOURCE_MAX_BYTES. A URL load follows at most five redirects, each to
 * https only, and is given `timeoutMs` (default IMAGE_LOAD_TIMEOUT_MS) in
 * all, body included. Every refusal is an ImageUnavailableError naming the
 * path or URL and the cause.
 */
export function createNodeImageSource(
  options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {},
): ImageSource {
  const fetch: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? IMAGE_LOAD_TIMEOUT_MS;
  return {
    load(location) {
      return "path" in location
        ? loadFile(location.path)
        : loadUrl(location.url, fetch, timeoutMs);
    },
  };
}

function unavailable(where: string, cause: string): ImageUnavailableError {
  return new ImageUnavailableError(`Cannot load image ${where}: ${cause}.`);
}

/** Checks the path and its size before reading, then reads at most one byte past the cap. */
async function loadFile(path: string): Promise<Uint8Array> {
  if (!isAbsolute(path))
    throw unavailable(path, "the path is not absolute; give an absolute path");
  let size: number;
  try {
    const info = await stat(path);
    if (!info.isFile()) throw unavailable(path, "it is not a file");
    size = info.size;
  } catch (error) {
    if (error instanceof ImageUnavailableError) throw error;
    throw unavailable(path, fileErrorText(error));
  }
  if (size > TOKEN_SOURCE_MAX_BYTES)
    throw unavailable(path, `it is larger than ${CAP_TEXT}`);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    // `end` is inclusive: a file that grew past the cap since the check
    // yields one byte more than the cap, and no more.
    const stream = createReadStream(path, { end: TOKEN_SOURCE_MAX_BYTES });
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      total += chunk.byteLength;
      chunks.push(chunk);
    }
  } catch (error) {
    throw unavailable(path, fileErrorText(error));
  }
  if (total > TOKEN_SOURCE_MAX_BYTES)
    throw unavailable(path, `it is larger than ${CAP_TEXT}`);
  return concat(chunks, total);
}

function fileErrorText(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return "no such file";
  if (code === "EACCES" || code === "EPERM") return "permission denied";
  return errorText(error);
}

/**
 * Fetches an https URL, following redirects by hand (https only, at most
 * MAX_REDIRECTS), all under one timeout that also covers reading the body.
 */
async function loadUrl(
  url: string,
  fetch: typeof globalThis.fetch,
  timeoutMs: number,
): Promise<Uint8Array> {
  let current = httpsUrl(url);
  if (current === undefined)
    throw unavailable(url, "only https URLs are loaded");
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(current.href, {
        redirect: "manual",
        signal,
      });
      if (!REDIRECT_STATUSES.has(response.status)) {
        if (!response.ok) {
          discard(response);
          const server = redirects === 0 ? "the server" : current.href;
          throw unavailable(url, `${server} answered ${statusText(response)}`);
        }
        return await readCapped(response, url, signal);
      }
      discard(response);
      if (redirects === MAX_REDIRECTS)
        throw unavailable(
          url,
          `more than ${String(MAX_REDIRECTS)} redirects; the last was from ${current.href}`,
        );
      current = redirectTarget(response, current, url);
    }
  } catch (error) {
    if (error instanceof ImageUnavailableError) throw error;
    if (signal.aborted)
      throw unavailable(
        url,
        `no complete answer within ${String(timeoutMs)} ms`,
      );
    throw unavailable(url, errorText(error));
  }
}

/** The URL if it parses with the https scheme. */
function httpsUrl(text: string): URL | undefined {
  if (!URL.canParse(text)) return undefined;
  const url = new URL(text);
  return url.protocol === "https:" ? url : undefined;
}

/** Where a redirect points, resolved against the URL that answered it; https only. */
function redirectTarget(response: Response, from: URL, url: string): URL {
  const location = response.headers.get("location");
  if (location === null)
    throw unavailable(
      url,
      `${from.href} answered ${statusText(response)} without a Location`,
    );
  if (!URL.canParse(location, from))
    throw unavailable(
      url,
      `${from.href} redirected to an invalid URL: ${location}`,
    );
  const target = new URL(location, from);
  if (target.protocol !== "https:")
    throw unavailable(
      url,
      `${from.href} redirected to ${target.href}; only https redirects are followed`,
    );
  return target;
}

/**
 * The body, refused before reading when its declared length is over the cap,
 * and abandoned once more than the cap has arrived or the signal aborts.
 */
async function readCapped(
  response: Response,
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (declared > TOKEN_SOURCE_MAX_BYTES) {
    discard(response);
    throw unavailable(
      url,
      `it is ${String(declared)} bytes, larger than ${CAP_TEXT}`,
    );
  }
  if (response.body === null) return new Uint8Array(0);
  const reader = response.body.getReader();
  const stop = () => {
    reader.cancel().catch(() => undefined);
  };
  // A signal that has already aborted fires no event.
  signal.throwIfAborted();
  signal.addEventListener("abort", stop, { once: true });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      // A cancel on abort ends a pending read as if the body were complete.
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > TOKEN_SOURCE_MAX_BYTES) {
        stop();
        throw unavailable(url, `its body is larger than ${CAP_TEXT}`);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", stop);
  }
  return concat(chunks, total);
}

/** Lets go of a response body that will not be read. */
function discard(response: Response): void {
  response.body?.cancel().catch(() => undefined);
}

function statusText(response: Response): string {
  return response.statusText === ""
    ? String(response.status)
    : `${String(response.status)} ${response.statusText}`;
}

function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** An error's message and, when it has one, its cause's (fetch's network errors say only "fetch failed"). */
function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const { cause } = error;
  return cause instanceof Error
    ? `${error.message}: ${cause.message}`
    : error.message;
}
