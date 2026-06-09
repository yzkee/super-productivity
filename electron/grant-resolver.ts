import * as fs from 'fs';
import * as path from 'path';
import { getGrant, type GrantFeature } from './grant-store';

/**
 * Resolve a renderer-supplied (grantId, relativePath) pair to an absolute path
 * the main process is allowed to touch.
 *
 * Layered defenses (any failure → opaque deny, no path leaked back):
 *   1. Grant exists and matches the feature scope expected by the caller.
 *      (A 'background-image' grant must not be reusable in a sync IPC.)
 *   2. `relativePath` is a string, not absolute, and does not traverse out of
 *      the grant root (`path.relative(root, joined)` must not start with '..').
 *   3. The leaf (if it already exists) is not a symlink. v1 policy is "refuse
 *      symlinks" — simpler than O_NOFOLLOW-on-open and sufficient for the sync
 *      use case. The TOCTOU window between this check and the subsequent fs
 *      op is documented as a known limitation; replacing the path-based
 *      check with `open(O_NOFOLLOW)` is a follow-up.
 *   4. The canonicalized resolved path is still inside the canonicalized root.
 *      Catches case-fold / 8.3-shortname aliases (existing concern, same
 *      reasoning as `electron/file-path-guard.ts`).
 */

const _denied = (): Error => {
  const e = new Error('Path not allowed for this grant');
  e.name = 'PathNotAllowedError';
  delete (e as { stack?: string }).stack;
  return e;
};

const _hasTraversal = (root: string, joined: string): boolean => {
  const rel = path.relative(root, joined);
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
};

export interface ResolvedGrantPath {
  /** Absolute filesystem path the IPC handler may operate on. */
  readonly absolutePath: string;
  /** The granted root the path resolved under. Useful for error/log messages. */
  readonly root: string;
}

/**
 * Throws `PathNotAllowedError` if the (grantId, relativePath) pair does not
 * resolve cleanly inside the grant root for `expectedFeature`. On success,
 * returns the absolute path. The returned error never embeds path content.
 */
export const resolveGrantPath = (
  grantId: string,
  relativePath: string,
  expectedFeature: GrantFeature,
): ResolvedGrantPath => {
  if (typeof grantId !== 'string' || typeof relativePath !== 'string') {
    throw _denied();
  }
  const grant = getGrant(grantId);
  if (!grant || grant.feature !== expectedFeature) {
    throw _denied();
  }
  if (path.isAbsolute(relativePath)) {
    throw _denied();
  }

  const joined = path.resolve(grant.root, relativePath);
  if (_hasTraversal(grant.root, joined)) {
    throw _denied();
  }

  let leafLstat: fs.Stats | null = null;
  try {
    leafLstat = fs.lstatSync(joined);
  } catch {
    // Leaf may legitimately not exist yet (e.g. FILE_SYNC_SAVE target).
    leafLstat = null;
  }
  if (leafLstat && leafLstat.isSymbolicLink()) {
    throw _denied();
  }

  // Defense-in-depth: if the leaf exists, its canonical form must still resolve
  // inside the canonical root. Catches case-fold/short-name aliases AND a
  // symlinked intermediate directory (only the LEAF was lstat'd above).
  if (leafLstat) {
    let canonicalLeaf: string;
    try {
      canonicalLeaf = fs.realpathSync.native(joined);
    } catch {
      throw _denied();
    }
    if (_hasTraversal(grant.root, canonicalLeaf)) {
      throw _denied();
    }
  } else {
    // Leaf doesn't exist: check the deepest existing ancestor instead, so a
    // symlinked directory in the middle of the path can't sneak the write
    // outside the root.
    let cursor = path.dirname(joined);
    while (cursor !== path.dirname(cursor)) {
      let realAncestor: string | null = null;
      try {
        realAncestor = fs.realpathSync.native(cursor);
      } catch {
        realAncestor = null;
      }
      if (realAncestor !== null) {
        if (realAncestor !== grant.root && _hasTraversal(grant.root, realAncestor)) {
          throw _denied();
        }
        break;
      }
      cursor = path.dirname(cursor);
    }
  }

  return { absolutePath: joined, root: grant.root };
};
