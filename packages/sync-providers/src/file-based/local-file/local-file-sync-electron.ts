import { toSyncLogError } from '@sp/sync-core';
import { LocalFileSyncBase, type LocalFileSyncBaseDeps } from './local-file-sync-base';

export interface LocalFileSyncElectronDeps extends LocalFileSyncBaseDeps {
  isElectron: boolean;
  /**
   * Show the system folder picker and persist the result main-side. Returns
   * the picked path for display only, or undefined if the user cancelled.
   * The renderer must NOT pass the returned value back into FS IPCs — those
   * take a relative path and main resolves against its own stored copy.
   */
  pickDirectory: () => Promise<string | void>;
  /**
   * Query main for the currently-configured sync folder. Returns a string
   * (display only) when configured, or null when the user has not yet picked
   * a folder. This is the source of truth for `isReady` — the renderer no
   * longer holds the path authoritatively (issue #8228).
   */
  getMainSyncFolderPath: () => Promise<string | null>;
}

export class LocalFileSyncElectron extends LocalFileSyncBase {
  private static readonly L = 'LocalFileSyncElectron';

  constructor(private readonly _deps: LocalFileSyncElectronDeps) {
    super(_deps);
  }

  async isReady(): Promise<boolean> {
    if (!this._deps.isElectron) {
      throw new Error('LocalFileSyncElectron is only available in electron');
    }
    const folderPath = await this._deps.getMainSyncFolderPath();
    return !!folderPath;
  }

  /**
   * Returns the *relative* path that the Electron file adapter will hand to
   * the main process. The legacy form joined an absolute folder prefix here
   * and shipped it across the IPC, which let a compromised renderer point
   * at arbitrary filesystem locations (issue #8228). Main now owns the
   * folder and resolves the relative path itself.
   *
   * The leading slash is stripped so `'/data.json'` and `'data.json'` are
   * equivalent — preserved for backward compatibility with existing call
   * sites that prepend a separator.
   */
  async getFilePath(targetPath: string): Promise<string> {
    return targetPath.startsWith('/') ? targetPath.substring(1) : targetPath;
  }

  async pickDirectory(): Promise<string | void> {
    this.logger.normal(`${LocalFileSyncElectron.L}.pickDirectory()`);

    try {
      // Main-side handler persists the result; we just relay the display
      // value to the caller (typically a settings form).
      return await this._deps.pickDirectory();
    } catch (e) {
      this.logger.error(
        `${LocalFileSyncElectron.L}.pickDirectory() error`,
        toSyncLogError(e),
      );
      throw e;
    }
  }
}
