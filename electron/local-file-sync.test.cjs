/**
 * Security tests for the local file-sync IPC handlers.
 *
 * Post-issue-#8228 the handlers only accept a `relativePath`; the renderer
 * never supplies an absolute path. The sync folder is owned and persisted
 * main-side (the cache lives at the top of `local-file-sync.ts`) and the
 * relative path is resolved against it via `sync-path-resolver`.
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
const syncPathResolverPath = path.resolve(__dirname, 'sync-path-resolver.ts');
const originalModuleLoad = Module._load;

let handlers = {};
let userDataDir;
let externalDir;
let nextDialogResult = { canceled: true, filePaths: [] };

const installMocks = () => {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'electron') {
      return {
        ipcMain: { handle: (channel, fn) => (handlers[channel] = fn) },
        app: { getPath: () => userDataDir },
        dialog: {
          showOpenDialog: async () => nextDialogResult,
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
  delete require.cache[syncPathResolverPath];
  handlers = {};
};

const load = () => {
  resetCaches();
  require(modPath).initLocalFileSyncAdapter();
};

const configureSyncFolder = async (folder) => {
  // Drive the real PICK_DIRECTORY path so the test exercises the same
  // canonicalize-and-persist code production uses.
  nextDialogResult = { canceled: false, filePaths: [folder] };
  const result = await handlers['PICK_DIRECTORY']({});
  if (result instanceof Error) throw result;
  return result;
};

test.beforeEach(() => {
  userDataDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ud-')));
  externalDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ext-')));
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
  nextDialogResult = { canceled: false, filePaths: [externalDir] };
  const returned = await handlers['PICK_DIRECTORY']({});
  assert.equal(returned, externalDir);
  assert.equal(
    await handlers['GET_SYNC_FOLDER_PATH']({}),
    externalDir,
    'main-side store is updated; renderer does not have to echo back',
  );
});

test('PICK_DIRECTORY surfaces a safe error when persistence fails', async () => {
  // Picker returns a path that no longer exists on disk → realpath throws
  // → PICK_DIRECTORY must return a distinct Error, not undefined, so the
  // renderer doesn't confuse persist-failure with user-cancel.
  const gone = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-gone-'));
  fs.rmSync(gone, { recursive: true, force: true });
  nextDialogResult = { canceled: false, filePaths: [gone] };
  const result = await handlers['PICK_DIRECTORY']({});
  assert.ok(result instanceof Error);
  // Cache must not be poisoned with a non-existent path.
  assert.equal(await handlers['GET_SYNC_FOLDER_PATH']({}), null);
});

test('PICK_DIRECTORY returns undefined on user-cancel (distinct from error)', async () => {
  nextDialogResult = { canceled: true, filePaths: [] };
  const result = await handlers['PICK_DIRECTORY']({});
  assert.equal(result, undefined);
});

test('legacy READ_LOCAL_IMAGE_AS_DATA_URL handler is no longer registered', () => {
  // Phase 4: removed entirely. A compromised renderer that still tries this
  // IPC must not find a handler — Electron will reject with "no handler
  // registered for channel" which surfaces to the renderer as a rejection.
  assert.equal(handlers['READ_LOCAL_IMAGE_AS_DATA_URL'], undefined);
});

test('legacy TO_FILE_URL handler is no longer registered', () => {
  assert.equal(handlers['TO_FILE_URL'], undefined);
});

test('IMAGE_CACHE_IMPORT imports an image and IMAGE_CACHE_GET_DATA_URL returns it', async () => {
  fs.writeFileSync(path.join(externalDir, 'bg.png'), 'pngbytes');
  const imported = await handlers['IMAGE_CACHE_IMPORT'](
    {},
    path.join(externalDir, 'bg.png'),
  );
  assert.ok(imported);
  assert.match(imported.id, /^[a-f0-9]{32}$/);
  const url = await handlers['IMAGE_CACHE_GET_DATA_URL']({}, imported.id);
  assert.match(url, /^data:image\/png;base64,/);
});

test('IMAGE_CACHE_IMPORT refuses a path inside userData', async () => {
  fs.writeFileSync(path.join(userDataDir, 'planted.png'), 'fake');
  const imported = await handlers['IMAGE_CACHE_IMPORT'](
    {},
    path.join(userDataDir, 'planted.png'),
  );
  assert.equal(imported, null);
});

test('IMAGE_CACHE_GET_DATA_URL returns null for unknown ids', async () => {
  const result = await handlers['IMAGE_CACHE_GET_DATA_URL']({}, 'a'.repeat(32));
  assert.equal(result, null);
});
