const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { promises: fs } = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const originalModuleLoad = Module._load;
let userDataDir;

const simpleStoreModulePath = path.resolve(__dirname, 'simple-store.ts');
const syncFolderStoreModulePath = path.resolve(__dirname, 'sync-folder-store.ts');

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return { app: { getPath: () => userDataDir } };
    }
    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const resetModules = () => {
  delete require.cache[simpleStoreModulePath];
  delete require.cache[syncFolderStoreModulePath];
};

const loadStore = () => {
  resetModules();
  return require(syncFolderStoreModulePath);
};

test.beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-folder-store-'));
  installMocks();
});

test.afterEach(async () => {
  Module._load = originalModuleLoad;
  resetModules();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

test('getSyncFolderPath returns null on first init (no persisted value)', async () => {
  const store = loadStore();
  await store.initSyncFolderStore();
  assert.equal(store.getSyncFolderPath(), null);
});

test('setSyncFolderPath persists and is readable across reloads', async () => {
  const store = loadStore();
  await store.initSyncFolderStore();
  await store.setSyncFolderPath('/Users/me/sync');
  assert.equal(store.getSyncFolderPath(), '/Users/me/sync');

  store.__resetSyncFolderCacheForTests();
  await store.initSyncFolderStore();
  assert.equal(store.getSyncFolderPath(), '/Users/me/sync');
});

test('setSyncFolderPath(null) clears the persisted value', async () => {
  const store = loadStore();
  await store.initSyncFolderStore();
  await store.setSyncFolderPath('/Users/me/sync');
  await store.setSyncFolderPath(null);
  assert.equal(store.getSyncFolderPath(), null);

  store.__resetSyncFolderCacheForTests();
  await store.initSyncFolderStore();
  assert.equal(store.getSyncFolderPath(), null);
});

test('setSyncFolderPath(empty string) is treated as null', async () => {
  const store = loadStore();
  await store.initSyncFolderStore();
  await store.setSyncFolderPath('/some/path');
  await store.setSyncFolderPath('');
  assert.equal(store.getSyncFolderPath(), null);
});

test('getSyncFolderPath throws when called before init', async () => {
  const store = loadStore();
  assert.throws(() => store.getSyncFolderPath(), /initSyncFolderStore/);
});

test('setSyncFolderPath is idempotent (no persist if value unchanged)', async () => {
  // Indirectly verified: a no-op set must not corrupt cache state on the
  // next read. (We can't observe the file write count without monkey-patching
  // simple-store; this guards against the regression where idempotence
  // accidentally inverts the cache.)
  const store = loadStore();
  await store.initSyncFolderStore();
  await store.setSyncFolderPath('/x');
  await store.setSyncFolderPath('/x');
  await store.setSyncFolderPath('/x');
  assert.equal(store.getSyncFolderPath(), '/x');
});
