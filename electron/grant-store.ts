import { randomBytes } from 'crypto';
import * as fs from 'fs';
import { loadSimpleStoreAll, saveSimpleStore } from './simple-store';

/**
 * Main-owned, persisted capability grants for filesystem access.
 *
 * Background: the renderer (and any plugin/XSS running inside it) can ask the
 * main process to read/write files via the FILE_SYNC_* IPCs. Before grants
 * those IPCs accepted any absolute path outside `userData` — i.e. nearly the
 * whole filesystem. A grant narrows that authority to a specific user-approved
 * root directory and a specific feature (e.g. 'sync').
 *
 * The renderer only ever sees the opaque `id`; the canonicalized `root` never
 * leaves the main process. Grants live in `simple-store` (inside userData),
 * which is itself protected from renderer writes by `assertPathOutside`.
 */

export type GrantFeature = 'sync';

export interface FileGrant {
  readonly id: string;
  readonly feature: GrantFeature;
  /**
   * Canonicalized absolute path (resolved via `fs.realpathSync.native` at
   * creation time so symlink/case-fold aliases cannot be slipped past the
   * containment check at resolve time).
   */
  readonly root: string;
  readonly createdAt: number;
}

const SIMPLE_STORE_KEY = 'fileGrants';

interface PersistedGrants {
  readonly grants: readonly FileGrant[];
}

const GRANT_ID_BYTES = 16;

let _cache: Map<string, FileGrant> | null = null;
let _loadOnce: Promise<void> | null = null;

const _isFileGrant = (v: unknown): v is FileGrant => {
  if (typeof v !== 'object' || v === null) return false;
  const g = v as Record<string, unknown>;
  return (
    typeof g.id === 'string' &&
    g.id.length > 0 &&
    g.feature === 'sync' &&
    typeof g.root === 'string' &&
    g.root.length > 0 &&
    typeof g.createdAt === 'number'
  );
};

const _loadIntoCache = async (): Promise<void> => {
  if (_loadOnce) return _loadOnce;
  _loadOnce = (async () => {
    const all = await loadSimpleStoreAll();
    const raw = all[SIMPLE_STORE_KEY] as PersistedGrants | undefined;
    const list = Array.isArray(raw?.grants) ? raw!.grants.filter(_isFileGrant) : [];
    _cache = new Map(list.map((g) => [g.id, g]));
  })();
  return _loadOnce;
};

const _persist = async (): Promise<void> => {
  const grants = Array.from((_cache ?? new Map<string, FileGrant>()).values());
  await saveSimpleStore(SIMPLE_STORE_KEY, { grants } satisfies PersistedGrants);
};

/**
 * Drop grants whose root no longer resolves to the same canonical path it had
 * at grant time (folder moved, deleted, replaced by a symlink to elsewhere).
 * Called at startup; invalid grants force the user back through the picker.
 */
export const revalidateGrants = async (): Promise<void> => {
  await _loadIntoCache();
  if (!_cache) return;
  const toRemove: string[] = [];
  // Array.from() instead of `for...of map` because ts-node's transpile-only
  // loader (used by *.test.cjs) does not downlevel Map iteration.
  for (const [id, grant] of Array.from(_cache.entries())) {
    let stillValid = false;
    try {
      const real = fs.realpathSync.native(grant.root);
      stillValid = real === grant.root;
    } catch {
      stillValid = false;
    }
    if (!stillValid) toRemove.push(id);
  }
  if (toRemove.length === 0) return;
  for (const id of toRemove) _cache.delete(id);
  await _persist();
};

/**
 * Create a grant for `absolutePath`. Caller must have proven user intent
 * (e.g. the path came from a main-process file dialog). The path is
 * canonicalized; if it does not exist or canonicalization fails, the grant
 * is not created and `null` is returned.
 */
export const createGrant = async (
  feature: GrantFeature,
  absolutePath: string,
): Promise<FileGrant | null> => {
  await _loadIntoCache();
  if (!_cache) return null;
  let canonical: string;
  try {
    canonical = fs.realpathSync.native(absolutePath);
  } catch {
    return null;
  }
  const grant: FileGrant = {
    id: randomBytes(GRANT_ID_BYTES).toString('hex'),
    feature,
    root: canonical,
    createdAt: Date.now(),
  };
  _cache.set(grant.id, grant);
  await _persist();
  return grant;
};

/**
 * Look up a grant by id. Returns null when the id is unknown — callers MUST
 * treat null as a deny, never as "no constraint".
 */
export const getGrant = (id: string): FileGrant | null => {
  if (!_cache) {
    throw new Error('grant-store: revalidateGrants() must be called before getGrant()');
  }
  if (typeof id !== 'string' || id.length === 0) return null;
  return _cache.get(id) ?? null;
};

/**
 * Drop a grant by id. No-op if unknown.
 */
export const revokeGrant = async (id: string): Promise<void> => {
  await _loadIntoCache();
  if (!_cache) return;
  if (!_cache.delete(id)) return;
  await _persist();
};

/**
 * Return all grants for a given feature. Used by callers that need to
 * surface "current sync folder" in the UI without re-prompting the picker.
 */
export const listGrantsByFeature = (feature: GrantFeature): readonly FileGrant[] => {
  if (!_cache) {
    throw new Error(
      'grant-store: revalidateGrants() must be called before listGrantsByFeature()',
    );
  }
  return Array.from(_cache.values()).filter((g) => g.feature === feature);
};

/** Test-only: clear in-memory cache so a fresh `revalidateGrants()` re-reads disk. */
export const __resetGrantCacheForTests = (): void => {
  _cache = null;
  _loadOnce = null;
};
