export type ImageLocation = { path: string } | { url: string };

/** Driven port: loads a source image's bytes; rejects with ImageUnavailableError naming the location and the cause. */
export interface ImageSource {
  load(location: ImageLocation): Promise<Uint8Array>;
}

/** How long one image load may take, body included, in milliseconds. */
export const IMAGE_LOAD_TIMEOUT_MS = 5000;

/** `https://...` is a url, `/...` a path; anything else throws InvalidTokenRequestError. */
export function parseImageLocation(image: string): ImageLocation {
  void image;
  throw new Error("not implemented");
}
