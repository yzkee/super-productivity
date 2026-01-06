import {
  ConflictData,
  EncryptAndCompressCfg,
  MainModelData,
  ModelCfgs,
} from '../pfapi.model';
import { SyncProviderServiceInterface } from './sync-provider.interface';
import { MiniObservable } from '../util/mini-observable';
import { SyncProviderId, SyncStatus } from '../pfapi.const';
import { ImpossibleError } from '../errors/errors';
import { PFLog } from '../../../core/log';
import { OperationLogSyncService } from '../../../op-log/sync/operation-log-sync.service';
import { FileBasedSyncAdapterService } from '../../../op-log/sync/providers/file-based/file-based-sync-adapter.service';
import { isFileBasedOperationSyncCapable } from '../../../op-log/sync/operation-sync.util';
import { OperationSyncCapable } from './sync-provider.interface';
import { PfapiMigrationService } from '../../../op-log/sync/providers/file-based/pfapi-migration.service';

/**
 * Sync Service for Super Productivity
 *
 * All sync now uses the operation log system:
 * - API-based providers (SuperSync) - direct operation sync
 * - File-based providers (WebDAV, Dropbox, LocalFile) - via FileBasedSyncAdapter
 *
 * The legacy PFAPI model-per-file sync has been removed as part of Phase 5 deprecation.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class SyncService<const MD extends ModelCfgs> {
  private static readonly L = 'SyncService';

  constructor(
    private _currentSyncProvider$: MiniObservable<SyncProviderServiceInterface<SyncProviderId> | null>,
    private _encryptAndCompressCfg$: MiniObservable<EncryptAndCompressCfg>,
    private _operationLogSyncService: OperationLogSyncService,
    private _fileBasedSyncAdapterService: FileBasedSyncAdapterService,
    private _pfapiMigrationService: PfapiMigrationService,
  ) {}

  /**
   * Synchronizes data between local and remote storage using operation log sync.
   * @returns Promise containing sync status
   */
  async sync(): Promise<{
    status: SyncStatus;
    conflictData?: ConflictData;
    downloadedMainModelData?: MainModelData;
  }> {
    try {
      const isReady = await this._isReadyForSync();
      if (!isReady) {
        return { status: SyncStatus.NotConfigured };
      }

      const currentSyncProvider = this._currentSyncProvider$.value;
      if (!currentSyncProvider) {
        return { status: SyncStatus.NotConfigured };
      }

      // For file-based providers, check if migration from PFAPI is needed
      if (isFileBasedOperationSyncCapable(currentSyncProvider)) {
        const cfg = this._encryptAndCompressCfg$.value;
        const encryptKey = (await currentSyncProvider.privateCfg.load())?.encryptKey;
        const migrated = await this._pfapiMigrationService.migrateIfNeeded(
          currentSyncProvider,
          cfg,
          encryptKey,
        );
        if (migrated) {
          PFLog.normal(
            `${SyncService.L}.${this.sync.name}(): PFAPI migration completed, continuing with op-log sync`,
          );
        }
      }

      // Get the OperationSyncCapable interface (direct or wrapped)
      const opLogProvider = await this._getOpLogSyncProvider(currentSyncProvider);
      if (!opLogProvider) {
        throw new ImpossibleError('Provider does not support operation sync');
      }

      const uploadResult =
        await this._operationLogSyncService.uploadPendingOps(opLogProvider);

      // OPTIMIZATION: Skip download if all remote ops were already piggybacked during upload.
      let downloadResult: {
        serverMigrationHandled: boolean;
        localWinOpsCreated: number;
        newOpsCount: number;
      };

      if (uploadResult && uploadResult.hasMorePiggyback === false) {
        // Server confirmed all remote ops fit in piggyback - no download needed
        const opCount = uploadResult.piggybackedOps.length;
        PFLog.normal(
          `${SyncService.L}.${this.sync.name}(): All ops piggybacked (${opCount}), skip download`,
        );
        downloadResult = {
          serverMigrationHandled: false,
          localWinOpsCreated: 0,
          newOpsCount: 0,
        };
      } else {
        // Need to download remaining ops
        downloadResult =
          await this._operationLogSyncService.downloadRemoteOps(opLogProvider);
      }

      // Track if we need a re-upload:
      // 1. Server migration created a SYNC_IMPORT that needs uploading
      // 2. LWW local-wins created new update ops from piggybacked ops (during upload)
      // 3. LWW local-wins created new update ops from downloaded ops
      let needsReupload =
        downloadResult.serverMigrationHandled ||
        (uploadResult?.localWinOpsCreated ?? 0) > 0 ||
        downloadResult.localWinOpsCreated > 0;

      // Loop until all merged ops are uploaded
      const MAX_REUPLOAD_ATTEMPTS = 5;
      let reuploadAttempts = 0;

      while (needsReupload && reuploadAttempts < MAX_REUPLOAD_ATTEMPTS) {
        reuploadAttempts++;

        if (downloadResult.serverMigrationHandled && reuploadAttempts === 1) {
          PFLog.normal(
            `${SyncService.L}.${this.sync.name}(): Server migration detected, uploading full state snapshot`,
          );
        } else {
          const totalLocalWinOps =
            (uploadResult?.localWinOpsCreated ?? 0) + downloadResult.localWinOpsCreated;
          PFLog.normal(
            `${SyncService.L}.${this.sync.name}(): LWW local-wins created ` +
              `${totalLocalWinOps} update op(s), re-uploading (attempt ${reuploadAttempts})`,
          );
        }

        const reuploadResult =
          await this._operationLogSyncService.uploadPendingOps(opLogProvider);

        // Check if re-upload created more merged ops (due to concurrent modification)
        needsReupload = (reuploadResult?.localWinOpsCreated ?? 0) > 0;
      }

      if (reuploadAttempts >= MAX_REUPLOAD_ATTEMPTS) {
        PFLog.warn(
          `${SyncService.L}.${this.sync.name}(): Max re-upload attempts reached, some ops may still be pending`,
        );
      }

      PFLog.normal(`${SyncService.L}.${this.sync.name}(): Operation sync complete`);
      return { status: SyncStatus.InSync };
    } catch (e) {
      PFLog.critical(`${SyncService.L}.${this.sync.name}(): Sync error`, e);
      throw e;
    }
  }

  /**
   * Force upload local state, replacing all remote data.
   * Used when user explicitly chooses "USE_LOCAL" in conflict resolution.
   * Creates a SYNC_IMPORT operation with current local state.
   */
  async forceUploadLocalState(): Promise<void> {
    const currentSyncProvider = this._currentSyncProvider$.value;
    if (!currentSyncProvider) {
      throw new Error('No sync provider configured');
    }

    const opLogProvider = await this._getOpLogSyncProvider(currentSyncProvider);
    if (!opLogProvider) {
      throw new Error('Could not get op-log provider');
    }

    await this._operationLogSyncService.forceUploadLocalState(opLogProvider);
  }

  /**
   * Force download all remote state, replacing local data.
   * Used when user explicitly chooses "USE_REMOTE" in conflict resolution.
   * Clears all local unsynced operations and downloads from seq 0.
   */
  async forceDownloadRemoteState(): Promise<void> {
    const currentSyncProvider = this._currentSyncProvider$.value;
    if (!currentSyncProvider) {
      throw new Error('No sync provider configured');
    }

    const opLogProvider = await this._getOpLogSyncProvider(currentSyncProvider);
    if (!opLogProvider) {
      throw new Error('Could not get op-log provider');
    }

    await this._operationLogSyncService.forceDownloadRemoteState(opLogProvider);
  }

  /**
   * Checks if the sync provider is ready for synchronization
   */
  private async _isReadyForSync(): Promise<boolean> {
    const currentSyncProvider = this._currentSyncProvider$.value;
    return currentSyncProvider ? currentSyncProvider.isReady() : Promise.resolve(false);
  }

  /**
   * Gets an OperationSyncCapable interface for the current provider.
   * For API-based providers (SuperSync), returns the provider directly.
   * For file-based providers, wraps them with FileBasedSyncAdapter.
   */
  private async _getOpLogSyncProvider(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<OperationSyncCapable | null> {
    // Check for direct API-based operation sync (SuperSync)
    const p = provider as unknown as OperationSyncCapable;
    if (p.supportsOperationSync) {
      return p;
    }

    // Check for file-based operation sync (WebDAV, Dropbox, LocalFile)
    if (isFileBasedOperationSyncCapable(provider)) {
      const cfg = this._encryptAndCompressCfg$.value;
      const encryptKey = (await provider.privateCfg.load())?.encryptKey;
      return this._fileBasedSyncAdapterService.createAdapter(provider, cfg, encryptKey);
    }

    return null;
  }
}
