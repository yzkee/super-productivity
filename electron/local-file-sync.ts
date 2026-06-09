import { IPC } from './shared-with-frontend/ipc-events.const';
import {
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { error, log } from 'electron-log/main';
import { app, dialog, ipcMain } from 'electron';
import { getWin } from './main-window';
import { resolveSyncPath } from './sync-path-resolver';
import { loadSimpleStoreAll, saveSimpleStore } from './simple-store';
import { getImageDataUrl, importImage, removeCachedImage } from './image-cache';

// SECURITY: file-sync must never read/write/list inside the app's private dir,
// which holds settings/grants/db — touching it is a privilege-escalation
// primitive (e.g. forging the nodeExecution grant file). The path is
// renderer-supplied (untrusted plugin/XSS). Lazy getter — userData can be
// changed at startup (--user-data-dir, Snap). See file-path-guard.ts.
const getAppPrivateDir = (): string => app.getPath('userData');

// Main-owned sync folder path. Backed by simple-store under SYNC_FOLDER_KEY;
// cached in-memory after first load so each FS IPC doesn't re-read the file.
// The canonical form is stored so subsequent realpath comparisons in
// resolveSyncPath line up regardless of symlink/case-fold drift.
const SYNC_FOLDER_KEY = 'syncFolderPath';
let _cachedSyncFolder: string | null | undefined = undefined;
let _loadPromise: Promise<string | null> | null = null;

const _loadSyncFolderFromDisk = async (): Promise<string | null> => {
  const all = await loadSimpleStoreAll();
  const raw = all[SYNC_FOLDER_KEY];
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
};

const getSyncFolderPath = async (): Promise<string | null> => {
  if (_cachedSyncFolder !== undefined) return _cachedSyncFolder;
  if (!_loadPromise) {
    _loadPromise = _loadSyncFolderFromDisk().then((v) => {
      _cachedSyncFolder = v;
      return v;
    });
  }
  return _loadPromise;
};

const setSyncFolderPath = async (rawPath: string): Promise<string> => {
  // Canonicalize at write time so the persisted value is the form
  // resolveSyncPath will compare against, and so a relative or
  // symlinked path is rejected before it gets stored.
  const canonical = realpathSync.native(rawPath);
  await saveSimpleStore(SYNC_FOLDER_KEY, canonical);
  _cachedSyncFolder = canonical;
  return canonical;
};

// Same `(maybeRoot, relative, userData) → absolutePath` resolution wrapped
// so the five handlers below don't repeat the same incantation. Returns the
// absolute path on success; throws PathNotAllowedError on rejection (the
// existing handler try/catch funnels both into a safe IPC error).
const _resolveRelative = async (relativePath: string | undefined): Promise<string> =>
  resolveSyncPath(
    (await getSyncFolderPath()) ?? undefined,
    relativePath ?? '',
    getAppPrivateDir(),
  ).absolutePath;

export const initLocalFileSyncAdapter = (): void => {
  ipcMain.handle(
    IPC.FILE_SYNC_SAVE,
    async (
      ev,
      {
        relativePath,
        dataStr,
        localRev,
      }: {
        relativePath: string;
        dataStr: string;
        localRev: string | null;
      },
    ): Promise<string | Error> => {
      try {
        const filePath = await _resolveRelative(relativePath);
        log(IPC.FILE_SYNC_SAVE, {
          dataLength: dataStr.length,
          hasData: dataStr.length > 0,
        });

        // Atomic write: write to temp file first, then rename.
        // renameSync is atomic on ext4/APFS/NTFS, so a crash mid-write
        // won't corrupt the original file.
        const tempPath = filePath + '.tmp';
        writeFileSync(tempPath, dataStr);
        renameSync(tempPath, filePath);

        return getRev(filePath);
      } catch (e) {
        error('Local file sync save failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_SAVE, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_LOAD,
    async (
      ev,
      {
        relativePath,
        localRev,
      }: {
        relativePath: string;
        localRev: string | null;
      },
    ): Promise<{ rev: string; dataStr: string | undefined } | Error> => {
      try {
        const filePath = await _resolveRelative(relativePath);
        log(IPC.FILE_SYNC_LOAD, {
          hasLocalRev: !!localRev,
        });
        const dataStr = readFileSync(filePath, { encoding: 'utf-8' });
        log('Local file sync load completed', {
          dataLength: dataStr.length,
        });
        return {
          rev: getRev(filePath),
          dataStr,
        };
      } catch (e) {
        error('Local file sync load failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_LOAD, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_REMOVE,
    async (
      ev,
      {
        relativePath,
      }: {
        relativePath: string;
      },
    ): Promise<void | Error> => {
      try {
        const filePath = await _resolveRelative(relativePath);
        log(IPC.FILE_SYNC_REMOVE);
        unlinkSync(filePath);
        return;
      } catch (e) {
        error('Local file sync remove failed', getSafeErrorMeta(e));
        return createSafeIpcError(IPC.FILE_SYNC_REMOVE, e);
      }
    },
  );

  ipcMain.handle(
    IPC.CHECK_DIR_EXISTS,
    async (
      ev,
      {
        relativePath,
      }: {
        relativePath?: string;
      },
    ): Promise<true | Error> => {
      try {
        // Default to the sync root itself (relativePath = '') so the legacy
        // "is the configured sync folder reachable?" check still works.
        const dirPath = await _resolveRelative(relativePath);
        const dirEntries = readdirSync(dirPath);
        log(IPC.CHECK_DIR_EXISTS, {
          dirEntryCount: dirEntries.length,
        });
        return true;
      } catch (e) {
        error('Local file sync directory check failed', getSafeErrorMeta(e));
        if ((e as NodeJS.ErrnoException).code === 'EACCES') {
          log(
            'ERR: Permission denied. If running as a snap, ensure the "home" or "removable-media" interface is connected.',
          );
        }
        return createSafeIpcError(IPC.CHECK_DIR_EXISTS, e);
      }
    },
  );

  ipcMain.handle(
    IPC.FILE_SYNC_LIST_FILES,
    async (
      ev,
      {
        relativePath,
      }: {
        relativePath?: string;
      },
    ): Promise<string[] | Error> => {
      try {
        const dirPath = await _resolveRelative(relativePath);
        return readdirSync(dirPath);
      } catch (e) {
        error('Local file sync list files failed', getSafeErrorMeta(e));
        if ((e as NodeJS.ErrnoException).code === 'EACCES') {
          log(
            'ERR: Permission denied. If running as a snap, ensure the "home" or "removable-media" interface is connected.',
          );
        }
        return createSafeIpcError(IPC.FILE_SYNC_LIST_FILES, e);
      }
    },
  );

  ipcMain.handle(IPC.PICK_DIRECTORY, async (): Promise<string | Error | undefined> => {
    try {
      const { canceled, filePaths } = (await dialog.showOpenDialog(getWin(), {
        title: 'Select sync folder',
        buttonLabel: 'Select Folder',
        properties: [
          'openDirectory',
          'createDirectory',
          'promptToCreate',
          'dontAddToRecent',
        ],
      })) as unknown as { canceled: boolean; filePaths: string[] };
      if (canceled || !filePaths[0]) {
        return undefined;
      }
      // Persist main-side BEFORE returning the display string. If
      // canonicalization or persistence fails (deleted between pick and
      // commit, EACCES on userData, etc.), surface a safe error rather than
      // a silent undefined — otherwise the renderer cannot distinguish
      // failure from user-cancel and the user is left wondering why their
      // pick didn't take.
      return await setSyncFolderPath(filePaths[0]);
    } catch (e) {
      error('PICK_DIRECTORY failed to persist sync folder', getSafeErrorMeta(e));
      return createSafeIpcError(IPC.PICK_DIRECTORY, e);
    }
  });

  ipcMain.handle(IPC.GET_SYNC_FOLDER_PATH, async (): Promise<string | null> => {
    return getSyncFolderPath();
  });

  ipcMain.handle(
    IPC.IMAGE_PICK_AND_IMPORT,
    async (
      _,
      args?: { replacesId?: string },
    ): Promise<{ id: string; mimeType: string } | null> => {
      // SECURITY: the dialog + import are atomic and run together in main.
      // The renderer never holds the absolute path — it cannot trigger an
      // image read without a user clicking through the native picker.
      // (The previous shape exposed an `importImage(path)` IPC that the
      // renderer could call with any image-extension path it pleased; this
      // version closes that gap.)
      const { canceled, filePaths } = (await dialog.showOpenDialog(getWin(), {
        title: 'Select image',
        buttonLabel: 'Select',
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      })) as unknown as { canceled: boolean; filePaths: string[] };
      if (canceled || !filePaths[0]) {
        // User cancelled — distinct from validation failure so the renderer
        // can stay silent instead of showing a "couldn't read image" snack.
        return null;
      }
      const imported = await importImage(filePaths[0]);
      if (!imported) {
        // Reject as an error: validation failed (extension, size, etc.) so
        // the renderer surfaces the error path, not the cancel path.
        throw new Error('Selected image could not be imported');
      }
      if (typeof args?.replacesId === 'string' && args.replacesId) {
        // GC: drop the file the renderer is about to overwrite in its config.
        // Renderer-supplied id is opaque; worst case is removing a cached
        // image that wasn't actually orphaned, which the user can recover by
        // re-picking.
        await removeCachedImage(args.replacesId);
      }
      return imported;
    },
  );

  ipcMain.handle(
    IPC.IMAGE_CACHE_GET_DATA_URL,
    async (_, id: string): Promise<string | null> => {
      return getImageDataUrl(id);
    },
  );

  ipcMain.handle(
    IPC.SHOW_OPEN_DIALOG,
    async (
      _,
      options: {
        properties: string[];
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      },
    ): Promise<string[] | undefined> => {
      const { canceled, filePaths } = (await dialog.showOpenDialog(getWin(), {
        title: options.title || 'Select folder',
        buttonLabel: 'Select',
        properties: options.properties as any,
        defaultPath: options.defaultPath,
        filters: options.filters,
      })) as unknown as { canceled: boolean; filePaths: string[] };
      if (canceled) {
        return undefined;
      } else {
        return filePaths;
      }
    },
  );
};

const getRev = (filePath: string): string => {
  const fileStat = statSync(filePath);
  return fileStat.mtime.getTime().toString();
};

const getSafeErrorMeta = (
  e: unknown,
): {
  errorName: string;
  errorCode?: string | number;
} => {
  const errorName =
    e instanceof Error
      ? e.name
      : typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string'
        ? e.name
        : 'UnknownError';
  const errorCode =
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (typeof e.code === 'string' || typeof e.code === 'number')
      ? e.code
      : undefined;

  return errorCode === undefined ? { errorName } : { errorName, errorCode };
};

const createSafeIpcError = (operation: IPC, e: unknown): Error => {
  const { errorName, errorCode } = getSafeErrorMeta(e);
  const codeMessagePart = errorCode === undefined ? '' : ` (code: ${errorCode})`;
  const safeError = new Error(`${operation} failed: ${errorName}${codeMessagePart}`, {
    cause: { name: errorName, code: errorCode },
  }) as Error & { code?: string | number };
  safeError.name = errorName;
  if (errorCode !== undefined) {
    safeError.code = errorCode;
  }
  delete safeError.stack;

  return safeError;
};
