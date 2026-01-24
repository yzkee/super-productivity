import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { SyncLog } from '../../core/log';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';
import { CleanSlateService } from '../../op-log/clean-slate/clean-slate.service';
import { OperationLogUploadService } from '../../op-log/sync/operation-log-upload.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { isFullStateOpType } from '../../op-log/core/operation.types';

/**
 * Service for changing the encryption password for SuperSync.
 *
 * Password change flow (using clean slate):
 * 1. Create clean slate locally (generates new client ID, fresh SYNC_IMPORT)
 * 2. Update local config with new password
 * 3. Upload SYNC_IMPORT with isCleanSlate=true flag (server deletes all data first)
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionPasswordChangeService {
  private _providerManager = inject(SyncProviderManager);
  private _cleanSlateService = inject(CleanSlateService);
  private _uploadService = inject(OperationLogUploadService);
  private _derivedKeyCache = inject(DerivedKeyCacheService);
  private _syncWrapper = inject(SyncWrapperService);
  private _opLogStore = inject(OperationLogStoreService);

  /**
   * Changes the encryption password using the clean slate approach.
   *
   * Clean slate flow:
   * 1. Wait for any ongoing sync to complete and block new syncs
   * 2. Create local clean slate (new client ID, fresh SYNC_IMPORT operation)
   * 3. Update config with new encryption password
   * 4. Upload with isCleanSlate=true flag (server deletes all data first)
   *
   * This approach is simpler and more robust than the old approach because:
   * - Server deletion and upload happen atomically in one transaction
   * - No need for complex recovery logic
   * - Fresh client ID prevents any stale operation conflicts
   * - Sync is blocked during the entire operation to prevent race conditions
   *
   * @param newPassword - The new encryption password
   * @throws Error if sync provider is not SuperSync or not ready
   */
  async changePassword(newPassword: string): Promise<void> {
    SyncLog.normal('EncryptionPasswordChangeService: Starting password change...');

    // Get the sync provider
    const syncProvider = this._providerManager.getActiveProvider();
    if (!syncProvider || syncProvider.id !== SyncProviderId.SuperSync) {
      throw new Error('Password change is only supported for SuperSync');
    }

    if (!isOperationSyncCapable(syncProvider)) {
      throw new Error('Sync provider does not support operation sync');
    }

    // Check for unsynced user operations before proceeding.
    // Exclude full-state operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR) as these are
    // recovery/migration ops from failed attempts, not user work that would be lost.
    const unsyncedOps = await this._opLogStore.getUnsynced();
    const unsyncedUserOps = unsyncedOps.filter(
      (entry) => !isFullStateOpType(entry.op.opType),
    );
    if (unsyncedUserOps.length > 0) {
      throw new Error(
        `Cannot change password: ${unsyncedUserOps.length} operation(s) have not been synced yet. ` +
          'Please wait for sync to complete or manually trigger a sync before changing the password.',
      );
    }

    // Run the entire password change with sync blocked to prevent race conditions.
    // This waits for any ongoing sync to complete, then blocks new syncs.
    await this._syncWrapper.runWithSyncBlocked(async () => {
      // Get current config
      const existingCfg =
        (await syncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;

      // STEP 1: Create clean slate locally
      // This generates a new client ID, clears local ops, and creates a fresh SYNC_IMPORT
      SyncLog.normal('EncryptionPasswordChangeService: Creating clean slate...');
      await this._cleanSlateService.createCleanSlate('ENCRYPTION_CHANGE');

      // STEP 2: Update config with new password BEFORE upload
      // This ensures the upload will use the new password for encryption
      SyncLog.normal('EncryptionPasswordChangeService: Updating encryption config...');
      await syncProvider.setPrivateCfg({
        ...existingCfg,
        encryptKey: newPassword,
        isEncryptionEnabled: true,
      } as SuperSyncPrivateCfg);

      // Clear cached encryption keys to force re-derivation with new password
      this._derivedKeyCache.clearCache();

      // STEP 3: Upload the SYNC_IMPORT with isCleanSlate=true flag
      // The server will delete all existing data before accepting the operation
      SyncLog.normal(
        'EncryptionPasswordChangeService: Uploading clean slate with new encryption...',
      );
      try {
        const result = await this._uploadService.uploadPendingOps(syncProvider, {
          isCleanSlate: true,
        });

        if (result.uploadedCount === 0) {
          throw new Error(
            'No operations uploaded - clean slate may not have been created',
          );
        }

        if (result.rejectedCount > 0) {
          throw new Error(
            `Clean slate upload was rejected by server: ${result.rejectedOps[0]?.error || 'Unknown error'}`,
          );
        }

        SyncLog.normal('EncryptionPasswordChangeService: Password change complete!');
      } catch (uploadError) {
        SyncLog.err(
          'EncryptionPasswordChangeService: Upload failed - reverting password config',
          uploadError,
        );

        // Revert the password change in local config
        await syncProvider.setPrivateCfg(existingCfg as SuperSyncPrivateCfg);
        this._derivedKeyCache.clearCache();

        throw new Error(
          `Password change failed: ${uploadError instanceof Error ? uploadError.message : uploadError}. ` +
            'Local password has been reverted. IMPORTANT: Retry the password change before using normal sync ' +
            'to avoid sync issues. If problems persist, you may need to re-import your data from backup.',
        );
      }
    });
  }
}
