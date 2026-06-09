import { loadSimpleStoreAll, saveSimpleStore } from './simple-store';

/**
 * Main-owned, persisted location of the user's sync folder.
 *
 * Background (issue #8228): before this store, the renderer held the sync
 * folder path in its own IndexedDB (`privateCfg.syncFolderPath`) and echoed
 * it back as an absolute path on every FILE_SYNC_* IPC. That meant a
 * compromised renderer could swap the path for any other absolute path
 * outside `userData` and get unrestricted read/write. With the path owned
 * by main, the renderer only ever sends the *relative* part; main resolves
 * against the path it stored itself.
 *
 * Persistence piggybacks on `simple-store` so we get the same durability
 * mechanics (atomic write, corruption quarantine, EISDIR recovery, queue).
 * An in-memory cache backs the hot path so per-IPC lookup does not stat
 * the simpleSettings file every call.
 */

const SIMPLE_STORE_KEY = 'syncFolderPath';

interface CacheState {
  value: string | null;
}

let _cache: CacheState | null = null;
let _loadOnce: Promise<void> | null = null;

const _loadIntoCache = async (): Promise<void> => {
  if (_loadOnce) return _loadOnce;
  _loadOnce = (async () => {
    const all = await loadSimpleStoreAll();
    const raw = all[SIMPLE_STORE_KEY];
    _cache = { value: typeof raw === 'string' && raw.length > 0 ? raw : null };
  })();
  return _loadOnce;
};

/**
 * Load the persisted value into the in-memory cache. MUST be called once at
 * app startup before any IPC handler reads via {@link getSyncFolderPath}.
 */
export const initSyncFolderStore = async (): Promise<void> => {
  await _loadIntoCache();
};

/**
 * Synchronously return the current sync folder path, or null if none is set.
 *
 * Callers must have invoked {@link initSyncFolderStore} during app startup.
 * Throws — rather than silently returning null — so a missed startup wiring
 * is loud during development, not a silent permissive-by-default surprise
 * in production.
 */
export const getSyncFolderPath = (): string | null => {
  if (!_cache) {
    throw new Error(
      'sync-folder-store: initSyncFolderStore() must be called before getSyncFolderPath()',
    );
  }
  return _cache.value;
};

/**
 * Persist a new sync folder path. Pass null to clear.
 *
 * The caller is responsible for having validated that `value` is a path the
 * user explicitly approved (typically the result of a main-process file
 * dialog). This module trusts its input — it is only reachable from main
 * code.
 */
export const setSyncFolderPath = async (value: string | null): Promise<void> => {
  await _loadIntoCache();
  if (!_cache) {
    throw new Error('sync-folder-store: cache failed to initialize');
  }
  const next = typeof value === 'string' && value.length > 0 ? value : null;
  if (_cache.value === next) return;
  _cache.value = next;
  await saveSimpleStore(SIMPLE_STORE_KEY, next);
};

/** Test-only: drop the in-memory cache so a fresh init re-reads disk. */
export const __resetSyncFolderCacheForTests = (): void => {
  _cache = null;
  _loadOnce = null;
};
