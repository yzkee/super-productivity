import { inject, Injectable, OnDestroy } from '@angular/core';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, exhaustMap, filter } from 'rxjs/operators';
import { isOnline } from '../../util/is-online';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { WrappedProviderService } from '../sync-providers/wrapped-provider.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { OpLog } from '../../core/log';

const IMMEDIATE_UPLOAD_DEBOUNCE_MS = 2000;

/**
 * Uploads operations to sync providers immediately after they're persisted to IndexedDB.
 *
 * This service provides near-real-time sync by uploading operations as they happen,
 * rather than waiting for periodic sync triggers. Features:
 *
 * - 2000ms debounce to batch rapid operations
 * - Silent failure (normal sync will pick up pending ops)
 * - Handles piggybacked operations from server responses
 *
 * ## Provider Types
 * - **SuperSync**: Uses API-based sync directly
 * - **File-based (Dropbox, WebDAV, LocalFile)**: Wrapped with FileBasedSyncAdapterService
 *
 * ## Checkmark (IN_SYNC) behavior
 *
 * The sync checkmark is ONLY shown when the server confirms there are no pending
 * remote operations (i.e., piggybackedOps is empty). This ensures the checkmark
 * accurately represents "fully in sync" state:
 *
 * - Upload succeeds + no piggybacked ops → Show checkmark (confirmed in sync)
 * - Upload succeeds + piggybacked ops exist → Process them, but NO checkmark
 *   (there may be more remote ops; let normal sync confirm full sync)
 *
 * Guards:
 * - Only uploads when online
 * - Only uploads when provider supports operation sync (via WrappedProviderService)
 * - Skips when full sync is in progress
 * - Skips for fresh clients (no history)
 */
@Injectable({
  providedIn: 'root',
})
export class ImmediateUploadService implements OnDestroy {
  private _providerManager = inject(SyncProviderManager);
  private _wrappedProvider = inject(WrappedProviderService);
  private _syncService = inject(OperationLogSyncService);

  private _uploadTrigger$ = new Subject<void>();
  private _subscription: Subscription | null = null;
  private _isInitialized = false;

  /**
   * Initializes the immediate upload pipeline.
   * Call once after app initialization.
   */
  initialize(): void {
    if (this._subscription) {
      return; // Already initialized
    }

    this._subscription = this._uploadTrigger$
      .pipe(
        debounceTime(IMMEDIATE_UPLOAD_DEBOUNCE_MS),
        filter(() => this._canUpload()),
        exhaustMap(() => this._performUpload()),
      )
      .subscribe();

    this._isInitialized = true;
    OpLog.verbose('ImmediateUploadService: Initialized');
  }

  /**
   * Trigger an immediate upload attempt.
   * Called by OperationLogEffects after persisting an operation.
   */
  trigger(): void {
    if (this._isInitialized) {
      this._uploadTrigger$.next();
    }
  }

  /**
   * Synchronous guard checks before attempting upload.
   * Note: Operation sync capability is checked asynchronously in _performUpload()
   * since file-based providers need to be wrapped (requires async privateCfg load).
   */
  private _canUpload(): boolean {
    // Must be online
    if (!isOnline()) {
      return false;
    }

    // Don't overlap with full sync
    if (this._providerManager.isSyncInProgress) {
      return false;
    }

    // Must have an active provider (capability checked in _performUpload)
    const provider = this._providerManager.getActiveProvider();
    if (!provider) {
      return false;
    }

    return true;
  }

  /**
   * Performs the immediate upload with all async checks and error handling.
   *
   * Uses OperationLogSyncService.uploadPendingOps() which includes:
   * - Server migration detection and SYNC_IMPORT creation
   * - Processing of piggybacked ops from server
   * - Handling of rejected ops
   */
  private async _performUpload(): Promise<void> {
    const rawProvider = this._providerManager.getActiveProvider();
    if (!rawProvider) {
      return;
    }

    // Get operation-sync-capable version of the provider
    // (SuperSync returns as-is, file-based providers get wrapped with FileBasedSyncAdapterService)
    const syncCapableProvider =
      await this._wrappedProvider.getOperationSyncCapable(rawProvider);
    if (!syncCapableProvider) {
      OpLog.verbose(
        'ImmediateUploadService: Provider does not support operation sync, skipping',
      );
      return;
    }

    // Check provider is ready (authenticated)
    if (!(await rawProvider.isReady())) {
      OpLog.verbose('ImmediateUploadService: Provider not ready, skipping');
      return;
    }

    try {
      OpLog.verbose('ImmediateUploadService: Starting immediate upload...');

      // Use sync service's uploadPendingOps which includes migration detection callback.
      // This ensures SYNC_IMPORT is created when switching to a new/empty server.
      // Returns null if fresh client (blocked from upload).
      const result = await this._syncService.uploadPendingOps(syncCapableProvider);
      if (!result) {
        OpLog.verbose('ImmediateUploadService: Upload returned null (fresh client)');
        return;
      }

      // Note: piggybacked ops and rejected ops are already handled by _syncService.uploadPendingOps()
      // We just need to handle the sync status here.

      // If LWW local-wins created new update ops from piggybacked ops,
      // do a follow-up upload to push them to the server immediately
      if ((result.localWinOpsCreated ?? 0) > 0) {
        OpLog.verbose(
          `ImmediateUploadService: LWW created ${result.localWinOpsCreated} local-win op(s), re-uploading`,
        );
        await this._syncService.uploadPendingOps(syncCapableProvider);
      }

      // Don't show checkmark when piggybacked ops exist - there may be more
      // remote ops pending. Let normal sync cycle confirm full sync state.
      if (result.piggybackedOps.length > 0) {
        OpLog.verbose(
          `ImmediateUploadService: Uploaded ${result.uploadedCount} ops, ` +
            `processed ${result.piggybackedOps.length} piggybacked (checkmark deferred)`,
        );
        return;
      }

      // Show checkmark ONLY when server confirms no pending remote ops
      // (empty piggybackedOps means we're confirmed in sync)
      if (result.uploadedCount > 0 || (result.localWinOpsCreated ?? 0) > 0) {
        this._providerManager.setSyncStatus('IN_SYNC');
        OpLog.verbose(
          `ImmediateUploadService: Uploaded ${result.uploadedCount} ops, confirmed in sync`,
        );
      }
    } catch (e) {
      // Silent failure - normal sync will pick up pending ops
      OpLog.warn(
        'ImmediateUploadService: Immediate upload failed, will retry on normal sync',
        e,
      );
      // Don't emit ERROR state - transient failures are expected
    }
  }

  ngOnDestroy(): void {
    this._subscription?.unsubscribe();
    this._subscription = null;
  }
}
