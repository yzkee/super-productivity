const IMAGE_CACHE_PREFIX = 'image:';

/**
 * Resolve a background-image URL to something a CSS `background` can render.
 *
 * The shape is `image:<opaque-id>` for files the user picked through the
 * Electron picker (the file lives in a main-owned cache;
 * `electron/image-cache.ts`), or a plain http(s) URL for Unsplash and
 * direct-URL backgrounds.
 *
 * Legacy `file://` values produced by pre-issue-#8228 builds are
 * intentionally not resolved here — the IPC that read them has been
 * removed, since the renderer-supplied-absolute-path shape was the issue.
 * Users with a `file://` background see no image until they re-pick.
 *
 * Returns null when there is no image or the read fails, so callers fall
 * back to no background.
 */
export const resolveBgImageToDataUrl = async (
  bgImage: string | null | undefined,
): Promise<string | null> => {
  if (!bgImage) {
    return null;
  }
  if (bgImage.startsWith(IMAGE_CACHE_PREFIX)) {
    // window.ea is only defined under Electron; on web the absence of the
    // bridge naturally short-circuits to null.
    const imageCacheGetDataUrl = window.ea?.imageCacheGetDataUrl;
    if (!imageCacheGetDataUrl) {
      return null;
    }
    const id = bgImage.substring(IMAGE_CACHE_PREFIX.length);
    try {
      return (await imageCacheGetDataUrl(id)) || null;
    } catch {
      return null;
    }
  }
  if (bgImage.startsWith('file://')) {
    // Legacy shape — picker now produces `image:<id>`. No safe IPC to read
    // an arbitrary renderer-supplied path remains; user must re-pick.
    return null;
  }
  return bgImage;
};
