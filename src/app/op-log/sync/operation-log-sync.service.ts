import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OpLog } from '../../core/log';
import {
  OperationSyncCapable,
  SyncProviderBase,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { OperationLogUploadService } from './operation-log-upload.service';
import { DownloadOutcome, UploadOutcome } from '../core/types/sync-results.types';
import { OperationLogDownloadService } from './operation-log-download.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { ServerMigrationService } from './server-migration.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import {
  DownloadResultForRejection,
  RejectedOpsHandlerService,
  RejectionHandlingResult,
} from './rejected-ops-handler.service';
import { SyncImportConflictGateService } from './sync-import-conflict-gate.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { SyncLocalStateService } from './sync-local-state.service';
import { SyncImportConflictCoordinatorService } from './sync-import-conflict-coordinator.service';
import { FileSnapshotDownloadCoordinatorService } from './file-snapshot-download-coordinator.service';
import { RemoteOpsDownloadCoordinatorService } from './remote-ops-download-coordinator.service';
import { ForceRemoteStateCoordinatorService } from './force-remote-state-coordinator.service';
import { SuperSyncStatusService } from './super-sync-status.service';

/**
 * Orchestrates synchronization of the Operation Log with remote storage.
 *
 * ## Overview
 * This service is the main coordinator for syncing operations between clients.
 * It handles uploading local changes, downloading remote changes, detecting conflicts,
 * and ensuring data consistency across all clients.
 *
 * ## Sync Flow
 * ```
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                           UPLOAD FLOW                                   │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  1. Check if fresh client (block upload if no history)                 │
 * │  2. Upload pending ops via OperationLogUploadService                   │
 * │  3. Process piggybacked ops FIRST (triggers conflict detection)        │
 * │  4. Mark server-rejected ops as rejected                               │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                          DOWNLOAD FLOW                                  │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  1. Download remote ops via OperationLogDownloadService                │
 * │  2. Fresh client? → Show confirmation dialog                           │
 * │  3. Process remote ops (_processRemoteOps)                             │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │                     PROCESS REMOTE OPS FLOW                             │
 * ├─────────────────────────────────────────────────────────────────────────┤
 * │  1. Schema migration (receiver-side)                                   │
 * │  2. Filter ops invalidated by SYNC_IMPORT                              │
 * │  3. Full-state op? → Skip conflict detection, apply directly           │
 * │  4. Conflict detection via vector clocks                               │
 * │  5. Conflicts? → Auto-resolve with LWW, piggyback non-conflicting ops  │
 * │  6. No conflicts? → Apply ops directly                                 │
 * │  7. Validate state (Checkpoint D)                                      │
 * └─────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Key Concepts
 *
 * ### Piggybacked Operations
 * When uploading, the server may return ops from other clients in the same response.
 * These are processed BEFORE marking rejected ops so conflict detection works properly.
 *
 * ### Non-Conflicting Ops Piggybacking
 * When conflicts are detected, non-conflicting ops are passed to ConflictResolutionService
 * to be applied together with resolved conflicts. This ensures dependency sorting works
 * (e.g., Task depends on Project from a resolved conflict).
 *
 * ### Fresh Client Safety
 * A client with no history must download before uploading to prevent overwriting
 * valid remote data with empty state. Fresh clients also see a confirmation dialog.
 *
 * ## Delegated Services
 * - **OperationLogUploadService**: Handles server communication for uploads
 * - **OperationLogDownloadService**: Handles server communication for downloads
 * - **ConflictResolutionService**: Presents conflicts to user and applies resolutions
 * - **VectorClockService**: Manages vector clock state and entity frontiers
 * - **OperationApplierService**: Applies operations to NgRx store
 * - **ValidateStateService**: Validates and repairs state after sync (Checkpoint D)
 */
@Injectable({
  providedIn: 'root',
})
export class OperationLogSyncService {
  private opLogStore = inject(OperationLogStoreService);
  private uploadService = inject(OperationLogUploadService);
  private downloadService = inject(OperationLogDownloadService);
  private snackService = inject(SnackService);
  private serverMigrationService = inject(ServerMigrationService);
  private writeFlushService = inject(OperationWriteFlushService);
  private superSyncStatusService = inject(SuperSyncStatusService);

  // Extracted services
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private rejectedOpsHandlerService = inject(RejectedOpsHandlerService);
  private syncImportConflictGateService = inject(SyncImportConflictGateService);
  private providerManager = inject(SyncProviderManager);
  private syncLocalStateService = inject(SyncLocalStateService);
  private syncImportConflictCoordinator = inject(SyncImportConflictCoordinatorService);
  private fileSnapshotDownloadCoordinator = inject(
    FileSnapshotDownloadCoordinatorService,
  );
  private remoteOpsDownloadCoordinator = inject(RemoteOpsDownloadCoordinatorService);
  private forceRemoteStateCoordinator = inject(ForceRemoteStateCoordinatorService);

  /**
   * Checks if this client is "wholly fresh" - meaning it has never synced before
   * and has no local operation history. A fresh client accepting remote data
   * should require user confirmation to prevent accidental data loss.
   *
   * @returns true if this is a fresh client with no history
   */
  async isWhollyFreshClient(): Promise<boolean> {
    return this.syncLocalStateService.isWhollyFreshClient();
  }

  /**
   * Upload pending local operations to remote storage.
   * Any piggybacked operations received during upload are automatically processed.
   *
   * IMPORTANT: The order of operations is critical:
   * 1. Upload ops → server may reject some with CONFLICT_CONCURRENT
   * 2. Process piggybacked ops FIRST → triggers conflict detection with local pending ops
   * 3. THEN mark server-rejected ops as rejected (if not already resolved via conflict dialog)
   *
   * This order ensures users see conflict dialogs when the server rejects their changes,
   * rather than having their local changes silently discarded.
   *
   * SAFETY: A wholly fresh client (no snapshot, no operations) should NOT upload.
   * Fresh clients must first download and apply remote data before they can contribute.
   * This prevents scenarios where a fresh/empty client overwrites existing remote data.
   *
   * SERVER MIGRATION: When a client with history connects to an empty server for the
   * first time (server migration scenario), we create a SYNC_IMPORT with full state
   * before uploading regular ops. This ensures all data is transferred to the new server.
   */
  async uploadPendingOps(
    syncProvider: OperationSyncCapable,
    options?: { skipPiggybackProcessing?: boolean; skipServerMigrationCheck?: boolean },
  ): Promise<UploadOutcome> {
    // CRITICAL: Ensure all pending write operations have completed before uploading.
    // The effect that writes operations uses concatMap for sequential processing,
    // but if sync is triggered before all operations are written to IndexedDB,
    // we would upload an incomplete set. This flush waits for all queued writes.
    await this.writeFlushService.flushPendingWrites();

    // SAFETY: Block upload from wholly fresh clients
    // A fresh client has nothing meaningful to upload and uploading could overwrite
    // valid remote data with empty/default state.
    const isFresh = await this.isWhollyFreshClient();
    if (isFresh) {
      OpLog.warn(
        'OperationLogSyncService: Upload blocked - this is a fresh client with no history. ' +
          'Download remote data first before uploading.',
      );
      return { kind: 'blocked_fresh_client' };
    }

    // SERVER MIGRATION CHECK: Passed as callback to execute INSIDE the upload lock.
    // This prevents race conditions where multiple tabs could both detect migration
    // and create duplicate SYNC_IMPORT operations.
    // Skip migration check for force uploads (e.g., after password change) to avoid
    // DecryptError when downloading ops encrypted with a different key.
    const result = await this.uploadService.uploadPendingOps(syncProvider, {
      preUploadCallback: options?.skipServerMigrationCheck
        ? undefined
        : () => this.serverMigrationService.checkAndHandleMigration(syncProvider),
      skipPiggybackProcessing: options?.skipPiggybackProcessing,
    });

    // STEP 1: Process piggybacked ops FIRST
    // This is critical: piggybacked ops may contain the "winning" remote versions
    // that caused our local ops to be rejected. By processing them first while our
    // local ops are still in the pending list, conflict detection will work properly
    // and the user will see a conflict dialog to choose which version to keep.
    //
    // STEP 2: Now handle server-rejected operations
    // At this point, conflicts have been detected and presented to the user.
    // We mark remaining rejected ops (those not already resolved via conflict dialog)
    // as rejected so they won't be re-uploaded.
    //
    // CRITICAL: Use try-finally to ensure rejected ops are ALWAYS handled,
    // even if processing throws. Otherwise rejected ops remain in pending
    // state and get re-uploaded infinitely.
    let localWinOpsCreated = 0;
    let rejectionResult: RejectionHandlingResult = {
      mergedOpsCreated: 0,
      permanentRejectionCount: 0,
    };

    if (result.piggybackedOps.length > 0) {
      // Check for piggybacked SYNC_IMPORT — mirrors the download path check (lines 552-604).
      // Without this, a SYNC_IMPORT from another client arriving as a piggybacked op
      // would silently replace local state via processRemoteOps().
      const piggybackedConflict =
        await this.syncImportConflictGateService.checkIncomingFullStateConflict(
          result.piggybackedOps,
        );
      if (piggybackedConflict.fullStateOp) {
        const { fullStateOp, pendingOps, dialogData } = piggybackedConflict;

        // Existing synced store data is not a conflict here. Prompt only when
        // local pending user changes would be discarded; otherwise an old client
        // can accidentally force-upload stale state over the remote import.
        // (PASSWORD_CHANGED SYNC_IMPORTs without pending ops also fall through
        // to silent acceptance via this gate — the data is identical, only the
        // encryption changed.)
        if (dialogData) {
          OpLog.warn(
            `OperationLogSyncService: Piggybacked ${fullStateOp.opType} from client ${fullStateOp.clientId} ` +
              `with ${pendingOps.length} pending local ops. Showing conflict dialog.`,
          );

          const conflictResult =
            await this.syncImportConflictCoordinator.handleSyncImportConflict(
              syncProvider,
              dialogData,
              'OperationLogSyncService (piggybacked full-state op)',
            );
          if (conflictResult === 'CANCEL') {
            return { kind: 'cancelled' };
          }
          // USE_LOCAL or USE_REMOTE was handled — report as completed with no further work.
          // Validation failure (if any during USE_REMOTE force-download) is on the
          // session-validation latch already; the wrapper reads it. (#7330)
          return {
            kind: 'completed',
            uploadedCount: result.uploadedCount,
            piggybackedOpsCount: result.piggybackedOps.length,
            localWinOpsCreated: 0,
            permanentRejectionCount: 0,
            hasMorePiggyback: false,
            rejectedOps: [],
          };
        } else {
          OpLog.normal(
            `OperationLogSyncService: Accepting piggybacked ${fullStateOp.opType} from client ` +
              `${fullStateOp.clientId} without conflict dialog; ` +
              `${pendingOps.length} pending op(s), no meaningful pending user changes.`,
          );
        }
      }

      const processResult = await this.remoteOpsProcessingService.processRemoteOps(
        result.piggybackedOps,
      );
      localWinOpsCreated = processResult.localWinOpsCreated;
      // Validation failure (if any) is on the session-validation latch.
    }

    // STEP 2: Handle server-rejected operations
    // handleRejectedOps may create merged ops for concurrent modifications.
    // These need to be uploaded, so we add them to localWinOpsCreated.
    // Pass a download callback so the handler can trigger downloads for concurrent mods.
    //
    // NOTE: This must NOT run after a SYNC_IMPORT conflict dialog resolution (USE_LOCAL,
    // USE_REMOTE, CANCEL) — those paths return early above to avoid stale rejection handling.
    const downloadCallback = async (downloadOptions?: {
      forceFromSeq0?: boolean;
    }): Promise<DownloadResultForRejection> => {
      const outcome = await this.downloadRemoteOps(syncProvider, downloadOptions);
      // Validation failure (if any during the nested download) is on the
      // session-validation latch — no need to thread the boolean back. (#7330)
      switch (outcome.kind) {
        case 'ops_processed':
          return {
            newOpsCount: outcome.newOpsCount,
            allOpClocks: outcome.allOpClocks,
            snapshotVectorClock: outcome.snapshotVectorClock,
          };
        case 'no_new_ops':
        case 'snapshot_hydrated':
          return {
            newOpsCount: 0,
            allOpClocks: outcome.allOpClocks,
            snapshotVectorClock: outcome.snapshotVectorClock,
          };
        case 'server_migration_handled':
        case 'cancelled':
          return { newOpsCount: 0 };
      }
    };
    try {
      rejectionResult = await this.rejectedOpsHandlerService.handleRejectedOps(
        result.rejectedOps,
        downloadCallback,
      );
      localWinOpsCreated += rejectionResult.mergedOpsCreated;
    } catch (rejectionError) {
      // FIX #6571: Propagate rejection handler errors instead of swallowing them.
      // Previously, errors here were logged but not rethrown, causing uploadPendingOps
      // to return kind='completed' with permanentRejectionCount=0, masking the failure.
      OpLog.err('OperationLogSyncService: Error handling rejected ops', rejectionError);
      throw rejectionError;
    }

    // Update pending ops status for UI indicator
    const pendingOps = await this.opLogStore.getUnsynced();
    this.superSyncStatusService.updatePendingOpsStatus(pendingOps.length > 0);

    // Check for encryption state mismatch in piggybacked ops (another client disabled encryption)
    await this.handleEncryptionStateMismatch(
      syncProvider,
      result.piggybackHasOnlyUnencryptedData,
    );

    return {
      kind: 'completed',
      uploadedCount: result.uploadedCount,
      piggybackedOpsCount: result.piggybackedOps.length,
      localWinOpsCreated,
      permanentRejectionCount: rejectionResult.permanentRejectionCount,
      hasMorePiggyback: result.hasMorePiggyback ?? false,
      rejectedOps: result.rejectedOps,
    };
  }

  /**
   * Download and process remote operations from storage.
   * For fresh clients (no local history), shows a confirmation dialog before accepting remote data
   * to prevent accidental data overwrites.
   *
   * When server migration is detected (gap on empty server), triggers a full state upload
   * to ensure all local data is transferred to the new server.
   *
   * @param syncProvider - The sync provider to download from
   * @param options.forceFromSeq0 - Force download from seq 0 to rebuild clock state
   * @returns Result indicating whether server migration was handled (requires follow-up upload)
   *          and how many local-win ops were created during LWW resolution
   */
  async downloadRemoteOps(
    syncProvider: OperationSyncCapable,
    options?: { forceFromSeq0?: boolean },
  ): Promise<DownloadOutcome> {
    const result = await this.downloadService.downloadRemoteOps(syncProvider, options);

    // FIX #6571: Check download success before processing results.
    // Previously, success=false was ignored and treated as "no new ops",
    // causing sync to report IN_SYNC despite a failed download.
    if (!result.success) {
      throw new Error(
        'Download failed - partial or no data received. ' +
          `failedFileCount=${result.failedFileCount}`,
      );
    }

    // Server migration detected: gap on empty server
    // Create a SYNC_IMPORT operation with full local state to seed the new server
    if (result.needsFullStateUpload) {
      await this.serverMigrationService.handleServerMigration(syncProvider);
      // Persist lastServerSeq=0 for the migration case (server was reset)
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
      return { kind: 'server_migration_handled' };
    }

    if (result.providerMode === 'fileSnapshotOps' && result.snapshotState) {
      return this.fileSnapshotDownloadCoordinator.handleSnapshotDownload(
        syncProvider as OperationSyncCapable<'fileSnapshotOps'>,
        result,
      );
    }

    const outcome = await this.remoteOpsDownloadCoordinator.handleRemoteOpsDownload(
      syncProvider,
      result,
    );

    if (outcome.kind === 'ops_processed') {
      await this.handleEncryptionStateMismatch(
        syncProvider,
        result.serverHasOnlyUnencryptedData,
      );
    }

    return outcome;
  }

  /**
   * Force upload local state as a SYNC_IMPORT, replacing all remote data.
   * This is used when user explicitly chooses "USE_LOCAL" in conflict resolution.
   *
   * Unlike server migration, this does NOT check if server is empty - it always
   * creates a SYNC_IMPORT to override remote state with local state.
   *
   * @param syncProvider - The sync provider to upload to
   */
  async forceUploadLocalState(syncProvider: OperationSyncCapable): Promise<void> {
    return this.syncImportConflictCoordinator.forceUploadLocalState(syncProvider);
  }

  /**
   * Force download all remote state, replacing local data.
   * This is used when user explicitly chooses "USE_REMOTE" in conflict resolution.
   *
   * Clears all local unsynced operations and downloads from seq 0 to get
   * the complete remote state including any SYNC_IMPORT.
   *
   * IMPORTANT: This also resets the vector clock to the remote snapshot's clock
   * to ensure rejected local ops don't pollute the causal history.
   *
   * @param syncProvider - The sync provider to download from
   */
  async forceDownloadRemoteState(syncProvider: OperationSyncCapable): Promise<void> {
    return this.forceRemoteStateCoordinator.forceDownloadRemoteState(syncProvider);
  }

  /**
   * Checks if there's an encryption state mismatch between local config and server data.
   * If the server has only unencrypted data but local config has encryption enabled,
   * this means another client disabled encryption. Updates local config to match.
   *
   * @param syncProvider - The sync provider to check and update
   * @param serverHasOnlyUnencryptedData - Whether all downloaded/piggybacked ops were unencrypted
   */
  async handleEncryptionStateMismatch(
    syncProvider: OperationSyncCapable,
    serverHasOnlyUnencryptedData: boolean | undefined,
  ): Promise<void> {
    // No detection possible if we didn't download any ops
    if (!serverHasOnlyUnencryptedData) {
      return;
    }

    // Check if local config has encryption enabled
    const localEncryptKey = syncProvider.getEncryptKey
      ? await syncProvider.getEncryptKey()
      : undefined;

    // No mismatch if local config also has no encryption
    if (!localEncryptKey) {
      return;
    }

    // Mismatch detected: server has only unencrypted data but local has encryption enabled
    OpLog.warn(
      'OperationLogSyncService: Encryption state mismatch detected. ' +
        'Server has only unencrypted data but local config has encryption enabled.',
    );

    // SuperSync: encryption is mandatory — never auto-disable it.
    // An older unencrypted client or stale server must not downgrade encryption.
    const activeProvider = this.providerManager.getActiveProvider();
    if (activeProvider?.id === SyncProviderId.SuperSync) {
      OpLog.warn(
        'OperationLogSyncService: SuperSync requires encryption — ' +
          'NOT auto-disabling. Server has stale unencrypted data.',
      );
      return;
    }

    // Non-SuperSync providers: allow auto-disable
    OpLog.warn(
      'OperationLogSyncService: Non-SuperSync provider — ' +
        'updating local config to match server (disabling encryption).',
    );

    // Check if provider supports config updates using type guard
    if (!this._isSyncProviderWithConfig(syncProvider)) {
      OpLog.warn(
        'OperationLogSyncService: Cannot update encryption config - ' +
          'provider does not support privateCfg or setPrivateCfg.',
      );
      return;
    }

    // Load existing config
    const existingCfg = await syncProvider.privateCfg.load();
    if (!existingCfg) {
      OpLog.warn(
        'OperationLogSyncService: Cannot update encryption config - ' +
          'failed to load existing config.',
      );
      return;
    }

    // Update config via providerManager to ensure currentProviderPrivateCfg$ observable is updated
    await this.providerManager.setProviderConfig(syncProvider.id, {
      ...existingCfg,
      encryptKey: undefined,
      isEncryptionEnabled: false,
    });

    OpLog.normal(
      'OperationLogSyncService: Local encryption config updated to match server state.',
    );

    // Notify user - use WARNING since this is a security-relevant change
    this.snackService.open({
      type: 'WARNING',
      msg: T.F.SYNC.S.ENCRYPTION_DISABLED_ON_OTHER_DEVICE,
    });
  }

  /**
   * Type guard to check if a sync provider supports config updates.
   * Returns true if the provider has both privateCfg.load() and setPrivateCfg().
   */
  private _isSyncProviderWithConfig(
    provider: OperationSyncCapable,
  ): provider is OperationSyncCapable & SyncProviderBase<SyncProviderId> {
    const providerWithCfg = provider as Partial<SyncProviderBase<SyncProviderId>>;
    return (
      typeof providerWithCfg.privateCfg?.load === 'function' &&
      typeof providerWithCfg.setPrivateCfg === 'function'
    );
  }
}
