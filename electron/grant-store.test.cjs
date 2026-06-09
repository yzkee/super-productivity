const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const fsModule = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;

let userDataDir;

const simpleStoreModulePath = path.resolve(__dirname, 'simple-store.ts');
const grantStoreModulePath = path.resolve(__dirname, 'grant-store.ts');

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: (key) => {
            assert.equal(key, 'userData');
            return userDataDir;
          },
        },
      };
    }
    if (request === 'electron-log/main') {
      return {
        log: () => {},
        error: () => {},
      };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const resetModules = () => {
  delete require.cache[simpleStoreModulePath];
  delete require.cache[grantStoreModulePath];
};

const loadGrantStore = () => {
  resetModules();
  return require(grantStoreModulePath);
};

test.beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-grant-store-'));
  installMocks();
});

test.afterEach(async () => {
  Module._load = originalModuleLoad;
  resetModules();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

test('createGrant canonicalizes the path and persists the grant', async () => {
  const grantStore = loadGrantStore();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    await grantStore.revalidateGrants();
    const grant = await grantStore.createGrant('sync', syncDir);
    assert.ok(grant, 'grant should be created');
    assert.equal(grant.feature, 'sync');
    assert.equal(grant.root, fsModule.realpathSync.native(syncDir));
    assert.match(grant.id, /^[a-f0-9]{32}$/);

    // Reload from disk: grant survives.
    grantStore.__resetGrantCacheForTests();
    await grantStore.revalidateGrants();
    const reloaded = grantStore.getGrant(grant.id);
    assert.ok(reloaded);
    assert.equal(reloaded.root, grant.root);
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('createGrant returns null for a non-existent path', async () => {
  const grantStore = loadGrantStore();
  await grantStore.revalidateGrants();
  const grant = await grantStore.createGrant(
    'sync',
    path.join(userDataDir, 'does-not-exist'),
  );
  assert.equal(grant, null);
});

test('getGrant returns null for an unknown id (renderer cannot guess)', async () => {
  const grantStore = loadGrantStore();
  await grantStore.revalidateGrants();
  assert.equal(grantStore.getGrant('deadbeef'), null);
  assert.equal(grantStore.getGrant(''), null);
  // Non-string defends against renderer-supplied bad input round-tripping JSON.
  assert.equal(grantStore.getGrant(12345), null);
});

test('revokeGrant removes the grant and persists the removal', async () => {
  const grantStore = loadGrantStore();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    await grantStore.revalidateGrants();
    const grant = await grantStore.createGrant('sync', syncDir);
    assert.ok(grant);
    await grantStore.revokeGrant(grant.id);
    assert.equal(grantStore.getGrant(grant.id), null);

    grantStore.__resetGrantCacheForTests();
    await grantStore.revalidateGrants();
    assert.equal(grantStore.getGrant(grant.id), null);
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('revalidateGrants drops grants whose root no longer exists', async () => {
  const grantStore = loadGrantStore();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  await grantStore.revalidateGrants();
  const grant = await grantStore.createGrant('sync', syncDir);
  assert.ok(grant);

  await fs.rm(syncDir, { recursive: true, force: true });

  grantStore.__resetGrantCacheForTests();
  await grantStore.revalidateGrants();
  assert.equal(grantStore.getGrant(grant.id), null);
});

test('revalidateGrants drops grants whose root canonical path changed', async () => {
  const grantStore = loadGrantStore();
  const originalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  const replacementDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-other-'));
  try {
    await grantStore.revalidateGrants();
    const grant = await grantStore.createGrant('sync', originalDir);
    assert.ok(grant);

    // Replace the original directory with a symlink to a different real dir.
    await fs.rm(originalDir, { recursive: true, force: true });
    await fs.symlink(replacementDir, originalDir, 'dir');

    grantStore.__resetGrantCacheForTests();
    await grantStore.revalidateGrants();
    // Canonical root changed (symlink resolves elsewhere) → grant invalidated.
    assert.equal(grantStore.getGrant(grant.id), null);
  } finally {
    await fs.rm(originalDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(replacementDir, { recursive: true, force: true });
  }
});

test('listGrantsByFeature returns only matching grants', async () => {
  const grantStore = loadGrantStore();
  const a = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-a-'));
  const b = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-b-'));
  try {
    await grantStore.revalidateGrants();
    const ga = await grantStore.createGrant('sync', a);
    const gb = await grantStore.createGrant('sync', b);
    assert.ok(ga && gb);
    const list = grantStore.listGrantsByFeature('sync');
    assert.equal(list.length, 2);
  } finally {
    await fs.rm(a, { recursive: true, force: true });
    await fs.rm(b, { recursive: true, force: true });
  }
});

test('persisted store with corrupt grant entries is filtered, not crashed on', async () => {
  const grantStore = loadGrantStore();
  await grantStore.revalidateGrants();
  // Forge a corrupt simpleSettings file mixing a valid-shape grant with junk.
  const validRoot = fsModule.realpathSync.native(
    await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-')),
  );
  try {
    const corrupt = {
      fileGrants: {
        grants: [
          {
            id: 'abc',
            feature: 'sync',
            root: validRoot,
            createdAt: 1,
          },
          { id: 'bad', feature: 'unknown', root: '/x', createdAt: 1 },
          null,
          'not-an-object',
          { id: '', feature: 'sync', root: validRoot, createdAt: 1 },
        ],
      },
    };
    await fs.writeFile(
      path.join(userDataDir, 'simpleSettings'),
      JSON.stringify(corrupt),
      'utf8',
    );
    grantStore.__resetGrantCacheForTests();
    await grantStore.revalidateGrants();
    assert.ok(grantStore.getGrant('abc'));
    assert.equal(grantStore.getGrant('bad'), null);
  } finally {
    await fs.rm(validRoot, { recursive: true, force: true });
  }
});
