import { IPC } from './shared-with-frontend/ipc-events.const';
import {
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  unlinkSync,
} from 'fs';
import { error, log } from 'electron-log/main';
import { app, dialog, ipcMain } from 'electron';
import { getWin } from './main-window';
import { fileURLToPath, pathToFileURL } from 'url';
import { assertPathOutside } from './file-path-guard';
import { resolveSyncPath } from './sync-path-resolver';
import {
  getSyncFolderPath,
  initSyncFolderStore,
  setSyncFolderPath,
} from './sync-folder-store';

// SECURITY: file-sync must never read/write/list inside the app's private dir,
// which holds settings/grants/db — touching it is a privilege-escalation
// primitive (e.g. forging the nodeExecution grant file). The path is
// renderer-supplied (untrusted plugin/XSS). Lazy getter — userData can be
// changed at startup (--user-data-dir, Snap). See file-path-guard.ts.
const getAppPrivateDir = (): string => app.getPath('userData');

// Resolve a renderer-supplied relativePath against the main-owned sync folder.
// Throws a generic, path-free error so the offending input never round-trips
// to the renderer via createSafeIpcError.
const _resolveOrThrow = (relativePath: unknown): string => {
  if (typeof relativePath !== 'string') {
    const e = new Error('Path not allowed for the sync folder');
    e.name = 'PathNotAllowedError';
    delete (e as { stack?: string }).stack;
    throw e;
  }
  return resolveSyncPath(
    getSyncFolderPath() ?? undefined,
    relativePath,
    getAppPrivateDir(),
  ).absolutePath;
};

export const initLocalFileSyncAdapter = (): void => {
  // Fire-and-forget: subsequent IPC handlers also `await initSyncFolderStore()`
  // defensively (it is idempotent via _loadOnce), so we don't need to gate
  // handler registration on this promise resolving.
  void initSyncFolderStore();

  ipcMain.handle(
    IPC.READ_LOCAL_IMAGE_AS_DATA_URL,
    async (_, filePathOrUrl: string): Promise<string | null> => {
      try {
        const normalized = filePathOrUrl.startsWith('file://')
          ? fileURLToPath(filePathOrUrl)
          : filePathOrUrl;

        // SECURITY: never inline a file from the app's private dir (the path is
        // renderer-supplied background-image config).
        assertPathOutside(getAppPrivateDir(), normalized);

        const ext = normalized.toLowerCase().split('.').pop() || '';

        const mimeTypeByExt: Record<string, string> = {
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          webp: 'image/webp',
          svg: 'image/svg+xml',
          bmp: 'image/bmp',
          avif: 'image/avif',
        };

        const mimeType = mimeTypeByExt[ext];

        // Reject unsupported file types before reading
        if (!mimeType) {
          return null;
        }

        const fs = await import('fs');

        const stat = await fs.promises.stat(normalized);

        const MAX_FILE_SIZE = 5 * 1024 * 1024;

        if (stat.size > MAX_FILE_SIZE) {
          throw new Error('Background image exceeds 5 MB limit');
        }

        const buffer = await fs.promises.readFile(normalized);

        return `data:${mimeType};base64,${buffer.toString('base64')}`;
      } catch (e) {
        error('Read local image as data URL failed', getSafeErrorMeta(e));
        return null;
      }
    },
  );

  ipcMain.handle(IPC.TO_FILE_URL, (_, filePath: string): string => {
    // SECURITY: a userData path must not be laundered into a file:// URL that
    // later flows back through READ_LOCAL_IMAGE_AS_DATA_URL or a navigation
    // guard. Same backstop as the other file-sync IPCs.
    assertPathOutside(getAppPrivateDir(), filePath);
    return pathToFileURL(filePath).href;
  });

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
        await initSyncFolderStore();
        const filePath = _resolveOrThrow(relativePath);
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
        await initSyncFolderStore();
        const filePath = _resolveOrThrow(relativePath);
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
        await initSyncFolderStore();
        const filePath = _resolveOrThrow(relativePath);
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
        await initSyncFolderStore();
        // Default to operating on the sync root itself (relativePath = '').
        const dirPath = _resolveOrThrow(relativePath ?? '');
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
        await initSyncFolderStore();
        const dirPath = _resolveOrThrow(relativePath ?? '');
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

  ipcMain.handle(IPC.PICK_DIRECTORY, async (): Promise<string | undefined> => {
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
    if (canceled) {
      return undefined;
    }
    const selected = filePaths[0];
    if (!selected) {
      return undefined;
    }
    // Persist main-side immediately so the renderer never holds the
    // authoritative copy of the sync folder path. The renderer may still
    // receive the path for display, but a subsequent IPC will look up the
    // stored value rather than trusting whatever the renderer echoes back.
    try {
      await setSyncFolderPath(selected);
    } catch (e) {
      error('Failed to persist sync folder selection', getSafeErrorMeta(e));
      return undefined;
    }
    return selected;
  });

  ipcMain.handle(IPC.GET_SYNC_FOLDER_PATH, async (): Promise<string | null> => {
    await initSyncFolderStore();
    return getSyncFolderPath();
  });

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
