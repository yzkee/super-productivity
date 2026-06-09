import { IS_ELECTRON } from '../../app.constants';

const IMAGE_CACHE_PREFIX = 'image:';

/**
 * Resolve a background-image URL to something a CSS `background` can render.
 *
 * Post-issue-#8228 the preferred shape is `image:<opaque-id>`, where the
 * file lives in a main-owned cache (electron/image-cache.ts) and main hands
 * back a data URL on demand. Plain http(s) URLs pass through unchanged.
 *
 * Legacy `file://` values are accepted on Electron for backward
 * compatibility with configs saved before this change. They flow through
 * the (still-userData-guarded) `readLocalImageAsDataUrl` IPC. The picker
 * no longer produces new `file://` values, so the long-tail will drain as
 * users re-pick their backgrounds.
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
    if (!IS_ELECTRON) {
      return null;
    }
    const id = bgImage.substring(IMAGE_CACHE_PREFIX.length);
    const imageCacheGetDataUrl = window.ea?.imageCacheGetDataUrl;
    if (!imageCacheGetDataUrl) {
      return null;
    }
    try {
      return (await imageCacheGetDataUrl(id)) || null;
    } catch {
      return null;
    }
  }
  if (!IS_ELECTRON || !bgImage.startsWith('file://')) {
    return bgImage;
  }
  const readLocalImageAsDataUrl = window.ea?.readLocalImageAsDataUrl;
  if (!readLocalImageAsDataUrl) {
    return null;
  }
  try {
    return (await readLocalImageAsDataUrl(bgImage)) || null;
  } catch {
    // A missing/unreadable file just means "no background" — fall back quietly.
    return null;
  }
};
