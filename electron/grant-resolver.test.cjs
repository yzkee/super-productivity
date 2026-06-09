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
const grantResolverModulePath = path.resolve(__dirname, 'grant-resolver.ts');

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        app: {
          getPath: () => userDataDir,
        },
      };
    }
    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const resetModules = () => {
  delete require.cache[simpleStoreModulePath];
  delete require.cache[grantStoreModulePath];
  delete require.cache[grantResolverModulePath];
};

const loadModules = () => {
  resetModules();
  return {
    grantStore: require(grantStoreModulePath),
    resolver: require(grantResolverModulePath),
  };
};

const setupGrant = async (grantStore, syncDir, feature = 'sync') => {
  await grantStore.revalidateGrants();
  const grant = await grantStore.createGrant(feature, syncDir);
  assert.ok(grant);
  return grant;
};

test.beforeEach(async () => {
  userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-grant-resolver-'));
  installMocks();
});

test.afterEach(async () => {
  Module._load = originalModuleLoad;
  resetModules();
  await fs.rm(userDataDir, { recursive: true, force: true });
});

test('resolves a relative file path inside the grant root', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    const grant = await setupGrant(grantStore, syncDir);
    const result = resolver.resolveGrantPath(grant.id, 'main.json', 'sync');
    assert.equal(
      result.absolutePath,
      path.join(fsModule.realpathSync.native(syncDir), 'main.json'),
    );
    assert.equal(result.root, fsModule.realpathSync.native(syncDir));
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('rejects absolute renderer-supplied paths', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    const grant = await setupGrant(grantStore, syncDir);
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, '/etc/passwd', 'sync'),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('rejects .. traversal that escapes the grant root', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    const grant = await setupGrant(grantStore, syncDir);
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, '../escape', 'sync'),
      /Path not allowed/,
    );
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, 'a/../../b', 'sync'),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('rejects an unknown grantId', async () => {
  const { grantStore, resolver } = loadModules();
  await grantStore.revalidateGrants();
  assert.throws(
    () => resolver.resolveGrantPath('deadbeef', 'main.json', 'sync'),
    /Path not allowed/,
  );
});

test('rejects a grant whose feature does not match the expected scope', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    const grant = await setupGrant(grantStore, syncDir, 'sync');
    // A future 'background-image' grant must not be reusable in a 'sync' IPC.
    // We can't construct one yet (only 'sync' is defined), so simulate by
    // asking the resolver for the wrong feature via a forged TS-side cast.
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, 'main.json', 'background-image'),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('rejects a leaf that is a symlink (even pointing inside the root)', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    await fs.writeFile(path.join(syncDir, 'real.json'), '{}', 'utf8');
    await fs.symlink(
      path.join(syncDir, 'real.json'),
      path.join(syncDir, 'link.json'),
      'file',
    );
    const grant = await setupGrant(grantStore, syncDir);
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, 'link.json', 'sync'),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('rejects writing under a directory symlink that escapes the root', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-outside-'));
  try {
    await fs.symlink(outsideDir, path.join(syncDir, 'escape'), 'dir');
    const grant = await setupGrant(grantStore, syncDir);
    // 'escape/new.json' lexically lives inside the root, but writing there
    // would land in outsideDir. Ancestor canonicalization catches this.
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, 'escape/new.json', 'sync'),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  }
});

test('allows writing under a directory symlink that stays inside the root', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    await fs.mkdir(path.join(syncDir, 'real-sub'), { recursive: true });
    await fs.symlink(path.join(syncDir, 'real-sub'), path.join(syncDir, 'sub'), 'dir');
    const grant = await setupGrant(grantStore, syncDir);
    const result = resolver.resolveGrantPath(grant.id, 'sub/new.json', 'sync');
    assert.equal(
      result.absolutePath,
      path.join(fsModule.realpathSync.native(syncDir), 'sub', 'new.json'),
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('rejects non-string inputs (fail-closed)', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    const grant = await setupGrant(grantStore, syncDir);
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, undefined, 'sync'),
      /Path not allowed/,
    );
    assert.throws(
      () => resolver.resolveGrantPath(undefined, 'main.json', 'sync'),
      /Path not allowed/,
    );
    assert.throws(
      () => resolver.resolveGrantPath(grant.id, 42, 'sync'),
      /Path not allowed/,
    );
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});

test('error never includes the offending path', async () => {
  const { grantStore, resolver } = loadModules();
  const syncDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-sync-'));
  try {
    const grant = await setupGrant(grantStore, syncDir);
    let captured;
    try {
      resolver.resolveGrantPath(grant.id, '/etc/passwd', 'sync');
    } catch (e) {
      captured = e;
    }
    assert.ok(captured);
    assert.ok(!String(captured.message).includes('/etc/passwd'));
    assert.equal(captured.name, 'PathNotAllowedError');
  } finally {
    await fs.rm(syncDir, { recursive: true, force: true });
  }
});
