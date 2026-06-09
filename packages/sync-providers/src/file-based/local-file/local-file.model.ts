/**
 * Stable runtime identifier for the LocalFile provider. The string
 * literal keeps the package free of app-level enums while remaining
 * structurally compatible with `SyncProviderId.LocalFile` app-side.
 */
export const PROVIDER_ID_LOCAL_FILE = 'LocalFile' as const;

export interface LocalFileSyncPrivateCfg {
  encryptKey?: string;
  /**
   * @deprecated Electron-selected sync folder path, kept for migration of
   * pre-issue-#8228 configs. The authoritative copy now lives main-side in
   * `electron/sync-folder-store.ts`; this field may be read once on upgrade
   * to seed the main store, then becomes unused.
   */
  syncFolderPath?: string;
  /** Android Storage Access Framework folder URI. */
  safFolderUri?: string;
}
