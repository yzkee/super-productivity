import { inject, Injectable } from '@angular/core';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { VectorClockService } from '../../op-log/sync/vector-clock.service';
import {
  CLIENT_ID_PROVIDER,
  ClientIdProvider,
} from '../../op-log/util/client-id.provider';
import { isOperationSyncCapable } from '../../op-log/sync/operation-sync.util';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { SuperSyncPrivateCfg } from '../../op-log/sync-providers/super-sync/super-sync.model';
import { CURRENT_SCHEMA_VERSION } from '../../op-log/persistence/schema-migration.service';
import { SyncLog } from '../../core/log';
import { uuidv7 } from '../../util/uuid-v7';

/**
 * Service for enabling encryption for SuperSync.
 *
 * Enable encryption flow:
 * 1. Delete all data on server (unencrypted operations can't be mixed with encrypted)
 * 2. Upload current state as encrypted snapshot
 * 3. Update local config to enable encryption and set the key
 */
@Injectable({
  providedIn: 'root',
})
export class EncryptionEnableService {
  private _providerManager = inject(SyncProviderManager);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _vectorClockService = inject(VectorClockService);
  private _clientIdProvider: ClientIdProvider = inject(CLIENT_ID_PROVIDER);

  /**
   * Enables encryption by deleting all server data
   * and uploading a new encrypted snapshot.
   *
   * @param encryptKey The encryption key to use
   * @throws Error if sync provider is not SuperSync or not ready
   */
  async enableEncryption(encryptKey: string): Promise<void> {
    SyncLog.normal('EncryptionEnableService: Starting encryption enable...');

    if (!encryptKey) {
      throw new Error('Encryption key is required');
    }

    // Get the sync provider
    const syncProvider = this._providerManager.getActiveProvider();
    if (!syncProvider) {
      throw new Error('No active sync provider. Please enable sync first.');
    }
    if (syncProvider.id !== SyncProviderId.SuperSync) {
      throw new Error(
        `Enable encryption is only supported for SuperSync (current: ${syncProvider.id})`,
      );
    }

    if (!isOperationSyncCapable(syncProvider)) {
      throw new Error('Sync provider does not support operation sync');
    }

    // Get current config
    const existingCfg =
      (await syncProvider.privateCfg.load()) as SuperSyncPrivateCfg | null;

    // Get current state
    // IMPORTANT: Must use async version to load real archives from IndexedDB
    // The sync getStateSnapshot() returns DEFAULT_ARCHIVE (empty) which causes data loss
    SyncLog.normal('EncryptionEnableService: Getting current state...');
    const currentState = await this._stateSnapshotService.getStateSnapshotAsync();
    const vectorClock = await this._vectorClockService.getCurrentVectorClock();
    const clientId = await this._clientIdProvider.loadClientId();
    if (!clientId) {
      throw new Error('Client ID not available');
    }

    // Delete all server data (unencrypted ops can't be mixed with encrypted)
    SyncLog.normal('EncryptionEnableService: Deleting server data...');
    await syncProvider.deleteAllData();

    // Update local config first - enable encryption and set the key
    // This must happen BEFORE upload so the upload uses the new key
    SyncLog.normal('EncryptionEnableService: Updating local config...');
    await syncProvider.setPrivateCfg({
      ...existingCfg,
      encryptKey,
      isEncryptionEnabled: true,
    } as SuperSyncPrivateCfg);

    // Upload encrypted snapshot
    SyncLog.normal('EncryptionEnableService: Uploading encrypted snapshot...');
    try {
      const response = await syncProvider.uploadSnapshot(
        currentState,
        clientId,
        'recovery',
        vectorClock,
        CURRENT_SCHEMA_VERSION,
        true, // isPayloadEncrypted = true
        uuidv7(), // opId - server must use this ID
      );

      if (!response.accepted) {
        throw new Error(`Snapshot upload failed: ${response.error}`);
      }

      // Update lastServerSeq to the new snapshot's seq
      if (response.serverSeq !== undefined) {
        await syncProvider.setLastServerSeq(response.serverSeq);
      } else {
        SyncLog.err(
          'EncryptionEnableService: Snapshot accepted but serverSeq is missing. ' +
            'Sync state may be inconsistent - consider using "Sync Now" to verify.',
        );
      }

      SyncLog.normal('EncryptionEnableService: Encryption enabled successfully!');
    } catch (uploadError) {
      // CRITICAL: Server data was deleted but new snapshot failed to upload.
      // Try to revert local config to unencrypted state
      SyncLog.err(
        'EncryptionEnableService: Snapshot upload failed after deleting server data!',
        uploadError,
      );

      // Revert local config
      await syncProvider.setPrivateCfg({
        ...existingCfg,
        encryptKey: undefined,
        isEncryptionEnabled: false,
      } as SuperSyncPrivateCfg);

      throw new Error(
        'CRITICAL: Failed to upload encrypted snapshot after deleting server data. ' +
          'Your local data is safe. Encryption has been reverted. Please use "Sync Now" to re-upload your data. ' +
          `Original error: ${uploadError instanceof Error ? uploadError.message : uploadError}`,
      );
    }
  }
}
