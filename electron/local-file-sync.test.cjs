/**
 * Security tests for the local file-sync IPC handlers.
 *
 * Post-issue-#8228 the handlers only accept a `relativePath`; the renderer
 * never supplies an absolute path. Main owns the sync folder via
 * `sync-folder-store` and resolves the relative path against it. These tests
 * cover:
 *
 *   - happy path inside a user-chosen sync folder
 *   - relative-path traversal (`..`) escape attempts
 *   - sync folder pointed at userData (must be denied at config time so the
 *     renderer cannot forge a grant file via the sync API)
 *   - absent sync folder
 *   - unchanged image-inlining and to-file-url guards
 *
 * Run via the standard electron .test.cjs runner.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const modPath = path.resolve(__dirname, 'local-file-sync.ts');
const simpleStorePath = path.resolve(__dirname, 'simple-store.ts');
const syncFolderStorePath = path.resolve(__dirname, 'sync-folder-store.ts');
const syncPathResolverPath = path.resolve(__dirname, 'sync-path-resolver.ts');
const originalModuleLoad = Module._load;

let handlers = {};
let userDataDir;
let externalDir;

const installMocks = (overrides = {}) => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
        app: { getPath: () => userDataDir },
        dialog: overrides.dialog || {
          showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
        },
      };
    }
    if (request === 'electron-log/main') {
      return { log: () => {}, error: () => {} };
    }
    if (/[/\\]main-window$/.test(request)) {
      return { getWin: () => ({}) };
    }
    return originalModuleLoad.call(this, request, parent, isMain);
  };
};

const resetCaches = () => {
  delete require.cache[modPath];
  delete require.cache[simpleStorePath];
  delete require.cache[syncFolderStorePath];
  delete require.cache[syncPathResolverPath];
  handlers = {};
};

const load = () => {
  resetCaches();
  require(modPath).initLocalFileSyncAdapter();
};

const configureSyncFolder = async (folder) => {
  const store = require(syncFolderStorePath);
  await store.setSyncFolderPath(folder);
};

test.beforeEach(() => {
  userDataDir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ud-')),
  );
  externalDir = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ext-')),
  );
  installMocks();
  load();
});

test.afterEach(() => {
  Module._load = originalModuleLoad;
  resetCaches();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(externalDir, { recursive: true, force: true });
});

test('FILE_SYNC_SAVE writes to a user-chosen folder via relativePath', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: 'main.json', dataStr: '{"ok":1}', localRev: null },
  );
  assert.ok(!(result instanceof Error), 'no error');
  assert.equal(typeof result, 'string', 'returns a revision string');
  assert.equal(fs.readFileSync(path.join(externalDir, 'main.json'), 'utf8'), '{"ok":1}');
});

test('FILE_SYNC_SAVE rejects when no sync folder is configured', async () => {
  // No configureSyncFolder() call.
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: 'main.json', dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_SAVE rejects a `..` traversal in the relativePath', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: '../escape.json', dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
  assert.equal(
    fs.existsSync(path.join(externalDir, '..', 'escape.json')),
    false,
    'nothing written outside the sync folder',
  );
});

test('FILE_SYNC_SAVE rejects an absolute renderer-supplied relativePath', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: '/etc/passwd', dataStr: 'x', localRev: null },
  );
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_SAVE rejects when sync folder is configured as userData (grant-file forgery)', async () => {
  // A misbehaving renderer cannot end up with the sync folder pointed at
  // userData, because resolveSyncPath denies any root that equals or lives
  // under userData. Belt-and-braces: even if the persisted value ever did
  // collide with userData, the resolver refuses at every IPC call.
  await configureSyncFolder(userDataDir);
  const result = await handlers['FILE_SYNC_SAVE'](
    {},
    { relativePath: 'simpleSettings', dataStr: '{"pwn":true}', localRev: null },
  );
  assert.ok(result instanceof Error);
  // simpleSettings either doesn't exist yet, or if simple-store wrote one
  // earlier in this test, the sync-save's writeFile must not have overwritten
  // it with the attacker payload.
  const stored = fs.existsSync(path.join(userDataDir, 'simpleSettings'))
    ? fs.readFileSync(path.join(userDataDir, 'simpleSettings'), 'utf8')
    : '';
  assert.ok(!stored.includes('"pwn":true'), 'attacker payload did not land');
});

test('FILE_SYNC_LOAD reads from the configured sync folder', async () => {
  await configureSyncFolder(externalDir);
  fs.writeFileSync(path.join(externalDir, 'main.json'), 'hello');
  const result = await handlers['FILE_SYNC_LOAD'](
    {},
    { relativePath: 'main.json', localRev: null },
  );
  assert.equal(result.dataStr, 'hello');
});

test('FILE_SYNC_LOAD rejects an absolute renderer-supplied relativePath', async () => {
  await configureSyncFolder(externalDir);
  fs.writeFileSync(path.join(userDataDir, 'secret'), 'topsecret');
  const result = await handlers['FILE_SYNC_LOAD'](
    {},
    { relativePath: path.join(userDataDir, 'secret'), localRev: null },
  );
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_REMOVE deletes a file inside the sync folder', async () => {
  await configureSyncFolder(externalDir);
  const target = path.join(externalDir, 'gone.json');
  fs.writeFileSync(target, '{}');
  const result = await handlers['FILE_SYNC_REMOVE']({}, { relativePath: 'gone.json' });
  assert.ok(!(result instanceof Error));
  assert.equal(fs.existsSync(target), false);
});

test('FILE_SYNC_REMOVE rejects traversal outside the sync folder', async () => {
  await configureSyncFolder(externalDir);
  const outside = path.join(externalDir, '..', 'keep');
  fs.writeFileSync(outside, 'do not delete');
  const result = await handlers['FILE_SYNC_REMOVE']({}, { relativePath: '../keep' });
  assert.ok(result instanceof Error);
  assert.equal(fs.existsSync(outside), true);
});

test('CHECK_DIR_EXISTS defaults to the sync root', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['CHECK_DIR_EXISTS']({}, {});
  assert.equal(result, true);
});

test('CHECK_DIR_EXISTS rejects when no sync folder is configured', async () => {
  const result = await handlers['CHECK_DIR_EXISTS']({}, {});
  assert.ok(result instanceof Error);
});

test('FILE_SYNC_LIST_FILES lists the sync root', async () => {
  await configureSyncFolder(externalDir);
  fs.writeFileSync(path.join(externalDir, 'a.json'), '{}');
  fs.writeFileSync(path.join(externalDir, 'b.json'), '{}');
  const result = await handlers['FILE_SYNC_LIST_FILES']({}, {});
  assert.ok(Array.isArray(result));
  assert.deepEqual(result.sort(), ['a.json', 'b.json']);
});

test('FILE_SYNC_LIST_FILES rejects a subdirectory that escapes the root', async () => {
  await configureSyncFolder(externalDir);
  const result = await handlers['FILE_SYNC_LIST_FILES']({}, { relativePath: '..' });
  assert.ok(result instanceof Error);
});

test('GET_SYNC_FOLDER_PATH returns null when unconfigured, then the configured path', async () => {
  assert.equal(await handlers['GET_SYNC_FOLDER_PATH']({}), null);
  await configureSyncFolder(externalDir);
  assert.equal(await handlers['GET_SYNC_FOLDER_PATH']({}), externalDir);
});

test('PICK_DIRECTORY persists the selection main-side', async () => {
  // Re-install mocks with a non-cancelling dialog.
  Module._load = originalModuleLoad;
  const picked = externalDir;
  installMocks({
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: [picked] }),
    },
  });
  load();

  const returned = await handlers['PICK_DIRECTORY']({});
  assert.equal(returned, picked);
  assert.equal(
    await handlers['GET_SYNC_FOLDER_PATH']({}),
    picked,
    'main-side store is updated; renderer does not have to echo back',
  );
});

test('READ_LOCAL_IMAGE_AS_DATA_URL refuses an image inside userData', async () => {
  fs.writeFileSync(path.join(userDataDir, 'secret.png'), 'not-really-png');
  const result = await handlers['READ_LOCAL_IMAGE_AS_DATA_URL'](
    {},
    path.join(userDataDir, 'secret.png'),
  );
  assert.equal(result, null);
});

test('READ_LOCAL_IMAGE_AS_DATA_URL inlines a user image outside userData', async () => {
  fs.writeFileSync(path.join(externalDir, 'bg.png'), 'pngbytes');
  const result = await handlers['READ_LOCAL_IMAGE_AS_DATA_URL'](
    {},
    path.join(externalDir, 'bg.png'),
  );
  assert.match(result, /^data:image\/png;base64,/);
});

test('TO_FILE_URL refuses a userData path (cannot launder into file://)', () => {
  assert.throws(
    () => handlers['TO_FILE_URL']({}, path.join(userDataDir, 'simpleSettings')),
    /protected directory/,
  );
});

test('TO_FILE_URL converts an outside path to a file:// URL', () => {
  const result = handlers['TO_FILE_URL']({}, path.join(externalDir, 'bg.png'));
  assert.match(result, /^file:\/\//);
});
