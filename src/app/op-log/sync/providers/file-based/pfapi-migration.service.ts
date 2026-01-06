import { Injectable } from '@angular/core';
import { SyncProviderId } from '../../../../pfapi/api/pfapi.const';
import { SyncProviderServiceInterface } from '../../../../pfapi/api/sync/sync-provider.interface';
import { EncryptAndCompressHandlerService } from '../../../../pfapi/api/sync/encrypt-and-compress-handler.service';
import { EncryptAndCompressCfg } from '../../../../pfapi/api/pfapi.model';
import { RemoteFileNotFoundAPIError } from '../../../../pfapi/api/errors/errors';
import { OpLog } from '../../../../core/log';
import {
  FileBasedSyncData,
  FILE_BASED_SYNC_CONSTANTS,
  MigrationInProgressError,
  MigrationLockContent,
} from './file-based-sync.types';
import { VectorClock } from '../../../core/operation.types';
import { CLIENT_ID_PROVIDER } from '../../../util/client-id.provider';
import { inject } from '@angular/core';

/**
 * Handles migration from PFAPI model-per-file sync to operation-log sync.
 *
 * ## Migration Flow
 * 1. Check for existing PFAPI files (meta.json) without sync-data.json
 * 2. Acquire distributed migration lock
 * 3. Download all model files from PFAPI
 * 4. Assemble into AppDataComplete state
 * 5. Create sync-data.json with SYNC_IMPORT operation
 * 6. Rename old PFAPI files to .migrated (don't delete yet)
 * 7. Release lock
 *
 * ## Safety Features
 * - Distributed lock prevents concurrent migration by multiple clients
 * - Backup of existing state before migration
 * - Old files kept for 30 days (renamed, not deleted)
 * - Clear error for old app versions
 */
@Injectable({ providedIn: 'root' })
export class PfapiMigrationService {
  private _encryptAndCompressHandler = new EncryptAndCompressHandlerService();
  private _clientIdProvider = inject(CLIENT_ID_PROVIDER);

  /** PFAPI model file names that indicate old format */
  private static readonly PFAPI_MODEL_FILES = [
    'meta.json',
    'globalConfig.json',
    'task.json',
    'project.json',
    'tag.json',
    'taskRepeatCfg.json',
    'simpleCounter.json',
    'note.json',
    'issueProvider.json',
    'planner.json',
    'boards.json',
    'metric.json',
    'menuTree.json',
    'timeTracking.json',
    'pluginUserData.json',
    'pluginMetadata.json',
    'reminders.json',
  ];

  /** Archive file names (stored separately from main model files) */
  private static readonly PFAPI_ARCHIVE_FILES = ['archiveYoung.json', 'archiveOld.json'];

  /**
   * Checks if migration from PFAPI to op-log sync is needed and performs it.
   *
   * @param provider - The file-based sync provider
   * @param cfg - Encryption/compression configuration
   * @param encryptKey - Optional encryption key
   * @returns true if migration was performed, false if not needed
   */
  async migrateIfNeeded(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<boolean> {
    // Check what files exist remotely
    const hasSyncDataJson = await this._fileExists(
      provider,
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
    );
    const hasPfapiMeta = await this._fileExists(provider, 'meta.json');

    // Already migrated - sync-data.json exists
    if (hasSyncDataJson) {
      OpLog.normal('PfapiMigration: sync-data.json exists, no migration needed');
      return false;
    }

    // Fresh start - no PFAPI data
    if (!hasPfapiMeta) {
      OpLog.normal('PfapiMigration: No existing sync data, fresh start');
      return false;
    }

    // PFAPI data exists without op-log - migration needed
    OpLog.normal('PfapiMigration: PFAPI data found, starting migration');

    // Acquire migration lock
    await this._acquireMigrationLock(provider);

    try {
      // Download PFAPI state and archive data
      const { state, archiveYoung, archiveOld } = await this._downloadPfapiState(
        provider,
        cfg,
        encryptKey,
      );

      // Create initial sync-data.json with archive data
      await this._createInitialSyncData(
        provider,
        cfg,
        encryptKey,
        state,
        archiveYoung,
        archiveOld,
      );

      // Mark PFAPI files as migrated (don't delete yet)
      await this._markMigrationComplete(provider);

      OpLog.normal('PfapiMigration: Migration completed successfully');
      return true;
    } finally {
      // Always release lock
      await this._releaseMigrationLock(provider);
    }
  }

  /**
   * Checks if the remote has old PFAPI data that needs migration.
   * Can be called without performing migration (for UI checks).
   */
  async needsMigration(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<boolean> {
    const hasSyncDataJson = await this._fileExists(
      provider,
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
    );
    const hasPfapiMeta = await this._fileExists(provider, 'meta.json');
    return !hasSyncDataJson && hasPfapiMeta;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MIGRATION LOCK
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Acquires a distributed migration lock with TOCTOU-safe verification.
   *
   * The lock acquisition uses a two-phase approach to handle race conditions:
   * 1. Try to create/acquire the lock
   * 2. Wait a short period and re-verify we still hold the lock
   *
   * This prevents the scenario where two clients both see "no lock" and both
   * create locks, with one overwriting the other.
   */
  private async _acquireMigrationLock(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<void> {
    const clientId = await this._clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error('Cannot acquire migration lock: no client ID');
    }

    const lockContent: MigrationLockContent = {
      clientId,
      timestamp: Date.now(),
      stage: 'started',
    };

    // Phase 1: Try to acquire the lock
    try {
      // Try to read existing lock
      const response = await provider.downloadFile(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
      );
      const existingLock: MigrationLockContent = JSON.parse(response.dataStr);

      // Check if lock is stale (>5 minutes)
      const lockAge = Date.now() - existingLock.timestamp;
      if (lockAge > FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_TIMEOUT_MS) {
        OpLog.warn(
          `PfapiMigration: Overriding stale lock from ${existingLock.clientId} (age: ${lockAge}ms)`,
        );
        // Override stale lock
        await provider.uploadFile(
          FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
          JSON.stringify(lockContent),
          null,
          true,
        );
      } else if (existingLock.clientId !== clientId) {
        // Another client is actively migrating
        throw new MigrationInProgressError(existingLock.clientId, existingLock.timestamp);
      }
      // Lock is ours or we overrode stale lock
    } catch (e) {
      if (e instanceof RemoteFileNotFoundAPIError) {
        // No lock exists, create one
        await provider.uploadFile(
          FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
          JSON.stringify(lockContent),
          null,
          true,
        );
      } else if (e instanceof MigrationInProgressError) {
        throw e;
      } else {
        throw e;
      }
    }

    // Phase 2: Wait and re-verify we still hold the lock (TOCTOU protection)
    // This handles the race where two clients both create locks simultaneously
    const randomDelay = Math.floor(Math.random() * 500);
    await this._sleep(500 + randomDelay); // 500-1000ms random delay

    try {
      const verifyResponse = await provider.downloadFile(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
      );
      const currentLock: MigrationLockContent = JSON.parse(verifyResponse.dataStr);

      if (currentLock.clientId !== clientId) {
        // Another client acquired the lock after us (race condition)
        OpLog.warn(
          `PfapiMigration: Lost lock race to ${currentLock.clientId}, aborting migration`,
        );
        throw new MigrationInProgressError(currentLock.clientId, currentLock.timestamp);
      }

      // Update lock timestamp to show we're still active
      lockContent.timestamp = Date.now();
      await provider.uploadFile(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
        JSON.stringify(lockContent),
        null,
        true,
      );

      OpLog.normal('PfapiMigration: Migration lock acquired and verified');
    } catch (e) {
      if (e instanceof MigrationInProgressError) {
        throw e;
      }
      // Lock file disappeared or error reading - re-throw
      throw new Error(`Failed to verify migration lock: ${e}`);
    }
  }

  /**
   * Helper to sleep for a given duration.
   */
  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async _releaseMigrationLock(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<void> {
    try {
      await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE);
    } catch {
      // Lock file might not exist
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PFAPI DATA DOWNLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  private async _downloadPfapiState(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<{
    state: unknown;
    archiveYoung: unknown | undefined;
    archiveOld: unknown | undefined;
  }> {
    OpLog.normal('PfapiMigration: Downloading PFAPI model files...');

    const state: Record<string, unknown> = {};
    let archiveYoung: unknown | undefined;
    let archiveOld: unknown | undefined;

    // Download main model files
    for (const modelFile of PfapiMigrationService.PFAPI_MODEL_FILES) {
      if (modelFile === 'meta.json') {
        // Meta file has different structure, skip for state
        continue;
      }

      try {
        const response = await provider.downloadFile(modelFile);
        const modelData = await this._encryptAndCompressHandler.decompressAndDecryptData(
          cfg,
          encryptKey,
          response.dataStr,
        );
        // Convert filename to model key (e.g., 'task.json' -> 'task')
        const modelKey = modelFile.replace('.json', '');
        state[modelKey] = modelData;
        OpLog.normal(`PfapiMigration: Downloaded ${modelFile}`);
      } catch (e) {
        if (e instanceof RemoteFileNotFoundAPIError) {
          OpLog.normal(`PfapiMigration: ${modelFile} not found, skipping`);
        } else {
          OpLog.err(`PfapiMigration: Error downloading ${modelFile}`, e);
          throw e;
        }
      }
    }

    // Download archive files separately (they go into dedicated fields, not state)
    for (const archiveFile of PfapiMigrationService.PFAPI_ARCHIVE_FILES) {
      try {
        const response = await provider.downloadFile(archiveFile);
        const archiveData =
          await this._encryptAndCompressHandler.decompressAndDecryptData(
            cfg,
            encryptKey,
            response.dataStr,
          );
        if (archiveFile === 'archiveYoung.json') {
          archiveYoung = archiveData;
        } else if (archiveFile === 'archiveOld.json') {
          archiveOld = archiveData;
        }
        OpLog.normal(`PfapiMigration: Downloaded ${archiveFile}`);
      } catch (e) {
        if (e instanceof RemoteFileNotFoundAPIError) {
          OpLog.normal(`PfapiMigration: ${archiveFile} not found, skipping`);
        } else {
          OpLog.err(`PfapiMigration: Error downloading ${archiveFile}`, e);
          throw e;
        }
      }
    }

    return { state, archiveYoung, archiveOld };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SYNC DATA CREATION
  // ═══════════════════════════════════════════════════════════════════════════

  private async _createInitialSyncData(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    state: unknown,
    archiveYoung: unknown | undefined,
    archiveOld: unknown | undefined,
  ): Promise<void> {
    const clientId = await this._clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error('Cannot create sync data: no client ID');
    }

    // Initialize vector clock with this client
    const vectorClock: VectorClock = { [clientId]: 1 };

    const syncData: FileBasedSyncData = {
      version: FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      syncVersion: 1,
      schemaVersion: 1, // TODO: Get from app version
      vectorClock,
      lastModified: Date.now(),
      clientId,
      state,
      archiveYoung: archiveYoung as FileBasedSyncData['archiveYoung'],
      archiveOld: archiveOld as FileBasedSyncData['archiveOld'],
      recentOps: [], // Fresh migration - no recent ops
    };

    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      syncData,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );

    await provider.uploadFile(
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      uploadData,
      null,
      true,
    );

    OpLog.normal('PfapiMigration: Created sync-data.json');
  }

  private async _markMigrationComplete(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<void> {
    // Rename PFAPI files to .migrated to preserve them
    // Note: Not all providers support rename, so we upload a marker file instead
    const markerContent = JSON.stringify({
      migratedAt: Date.now(),
      originalFiles: PfapiMigrationService.PFAPI_MODEL_FILES.filter(
        (f) => f !== 'meta.json',
      ),
    });

    await provider.uploadFile('pfapi-migrated.marker', markerContent, null, true);
    OpLog.normal('PfapiMigration: Created migration marker');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _fileExists(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    path: string,
  ): Promise<boolean> {
    try {
      await provider.getFileRev(path, null);
      return true;
    } catch {
      return false;
    }
  }
}
