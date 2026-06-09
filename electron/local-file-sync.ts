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
import { getImageDataUrl, importImage } from './image-cache';

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
        const filePath = resolveSyncPath(
          (await getSyncFolderPath()) ?? undefined,
          relativePath,
          getAppPrivateDir(),
        ).absolutePath;
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
        const filePath = resolveSyncPath(
          (await getSyncFolderPath()) ?? undefined,
          relativePath,
          getAppPrivateDir(),
        ).absolutePath;
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
        const filePath = resolveSyncPath(
          (await getSyncFolderPath()) ?? undefined,
          relativePath,
          getAppPrivateDir(),
        ).absolutePath;
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
        const dirPath = resolveSyncPath(
          (await getSyncFolderPath()) ?? undefined,
          relativePath ?? '',
          getAppPrivateDir(),
        ).absolutePath;
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
        const dirPath = resolveSyncPath(
          (await getSyncFolderPath()) ?? undefined,
          relativePath ?? '',
          getAppPrivateDir(),
        ).absolutePath;
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
    IPC.IMAGE_CACHE_IMPORT,
    async (_, absolutePath: string): Promise<{ id: string; mimeType: string } | null> => {
      // The caller passes a path the user just chose via SHOW_OPEN_DIALOG.
      // `importImage` does its own validation (outside userData, allowed
      // extension, size cap) so a renderer cannot use this IPC as a
      // generic file-read primitive — only image-shaped files inside
      // user-readable directories get cached.
      return importImage(absolutePath);
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

/** Test-only: clear the in-memory cache so the next read re-loads from disk. */
export const __resetSyncFolderCacheForTests = (): void => {
  _cachedSyncFolder = undefined;
  _loadPromise = null;
};
