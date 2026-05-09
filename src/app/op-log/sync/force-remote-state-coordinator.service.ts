import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { FULL_STATE_OP_TYPES } from '../core/operation.types';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { OperationLogDownloadService } from './operation-log-download.service';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { FileSnapshotDownloadCoordinatorService } from './file-snapshot-download-coordinator.service';
import { OpLog } from '../../core/log';
import { getDefaultMainModelData } from '../model/model-config';
import { loadAllData } from '../../root-store/meta/load-all-data.action';

@Injectable({
  providedIn: 'root',
})
export class ForceRemoteStateCoordinatorService {
  private store = inject(Store);
  private opLogStore = inject(OperationLogStoreService);
  private downloadService = inject(OperationLogDownloadService);
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private fileSnapshotDownloadCoordinator = inject(
    FileSnapshotDownloadCoordinatorService,
  );

  async forceDownloadRemoteState(syncProvider: OperationSyncCapable): Promise<void> {
    OpLog.warn(
      'ForceRemoteStateCoordinatorService: Force downloading remote state - clearing local import and unsynced ops.',
    );

    const clearedFullStateOps = await this.opLogStore.clearFullStateOps();
    if (clearedFullStateOps > 0) {
      OpLog.normal(
        `ForceRemoteStateCoordinatorService: Cleared ${clearedFullStateOps} local full-state op(s).`,
      );
    }

    await this.opLogStore.clearUnsyncedOps();
    await syncProvider.setLastServerSeq(0);

    const result = await this.downloadService.downloadRemoteOps(syncProvider, {
      forceFromSeq0: true,
    });

    if (!result.success) {
      throw new Error(
        'Download failed - partial or no data received. ' +
          `failedFileCount=${result.failedFileCount}`,
      );
    }

    if (result.snapshotVectorClock) {
      await this.opLogStore.setVectorClock(result.snapshotVectorClock);
      OpLog.normal(
        'ForceRemoteStateCoordinatorService: Reset vector clock to remote snapshot clock.',
      );
    }

    if (result.providerMode === 'fileSnapshotOps' && result.snapshotState) {
      OpLog.normal(
        'ForceRemoteStateCoordinatorService: Force download received snapshotState. Hydrating...',
      );
      await this.fileSnapshotDownloadCoordinator.hydrateSnapshotAndPersistRecentOps(
        syncProvider as OperationSyncCapable<'fileSnapshotOps'>,
        result,
        'force-download',
      );
      OpLog.normal(
        'ForceRemoteStateCoordinatorService: Force download snapshot hydration complete.',
      );
      return;
    }

    if (result.newOps.length > 0) {
      const hasFullStateOp = result.newOps.some((op) =>
        FULL_STATE_OP_TYPES.has(op.opType),
      );

      if (!hasFullStateOp) {
        OpLog.normal(
          'ForceRemoteStateCoordinatorService: No full-state op in remote. Resetting state before applying incremental ops.',
        );
        const defaultData = getDefaultMainModelData();
        this.store.dispatch(
          loadAllData({
            appDataComplete: defaultData as Parameters<
              typeof loadAllData
            >[0]['appDataComplete'],
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      await this.remoteOpsProcessingService.processRemoteOps(result.newOps, {
        skipConflictDetection: true,
      });

      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
    }

    OpLog.normal(
      `ForceRemoteStateCoordinatorService: Force download complete. Processed ${result.newOps.length} ops.`,
    );
  }
}
