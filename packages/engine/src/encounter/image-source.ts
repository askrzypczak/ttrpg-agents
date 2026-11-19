import { z } from "zod";
import { InvalidTokenRequestError } from "./errors.js";

export type ImageLocation = { path: string } | { url: string };

/** Driven port: loads a source image's bytes; rejects with ImageUnavailableError naming the location and the cause. */
export interface ImageSource {
  load(location: ImageLocation): Promise<Uint8Array>;
}

/** How long one image load may take, body included, in milliseconds. */
export const IMAGE_LOAD_TIMEOUT_MS = 5000;

const httpsUrl = z.url({ protocol: /^https$/ });
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const USE = "Use an https URL or an absolute file path.";

/** `https://...` is a url, `/...` a path; anything else throws InvalidTokenRequestError. */
export function parseImageLocation(image: string): ImageLocation {
  if (image.startsWith("/")) return { path: image };
  if (/^https:\/\//i.test(image) && httpsUrl.safeParse(image).success)
    return { url: image };
  if (image === "")
    throw new InvalidTokenRequestError(`No image given. ${USE}`);
  const reason = SCHEME.test(image)
    ? `is not an https URL`
    : `is not an absolute file path`;
  throw new InvalidTokenRequestError(`Image "${image}" ${reason}. ${USE}`);
}
