import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import {
  DownloadOutcome,
  FileSnapshotDownloadResult,
  SuperSyncDownloadResult,
} from '../core/types/sync-results.types';
import { LocalDataConflictError } from '../core/errors/sync-errors';
import { OpLog } from '../../core/log';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { RemoteOpsProcessingService } from './remote-ops-processing.service';
import { ServerMigrationService } from './server-migration.service';
import { SuperSyncStatusService } from './super-sync-status.service';
import { SyncImportConflictGateService } from './sync-import-conflict-gate.service';
import { SyncImportConflictCoordinatorService } from './sync-import-conflict-coordinator.service';
import { SyncLocalStateService } from './sync-local-state.service';

type ModeDownloadResult = SuperSyncDownloadResult | FileSnapshotDownloadResult;

@Injectable({
  providedIn: 'root',
})
export class RemoteOpsDownloadCoordinatorService {
  private opLogStore = inject(OperationLogStoreService);
  private snackService = inject(SnackService);
  private remoteOpsProcessingService = inject(RemoteOpsProcessingService);
  private serverMigrationService = inject(ServerMigrationService);
  private superSyncStatusService = inject(SuperSyncStatusService);
  private syncImportConflictGateService = inject(SyncImportConflictGateService);
  private syncImportConflictCoordinator = inject(SyncImportConflictCoordinatorService);
  private syncLocalStateService = inject(SyncLocalStateService);

  async handleRemoteOpsDownload(
    syncProvider: OperationSyncCapable,
    result: ModeDownloadResult,
  ): Promise<DownloadOutcome> {
    if (result.newOps.length === 0) {
      const isEmptyServer = result.latestServerSeq === 0;
      if (isEmptyServer) {
        const isFresh = await this.syncLocalStateService.isWhollyFreshClient();
        if (isFresh && this.syncLocalStateService.hasMeaningfulStoreData()) {
          OpLog.warn(
            'RemoteOpsDownloadCoordinatorService: Pre-op-log client with meaningful local data on empty server. ' +
              'Creating SYNC_IMPORT via server migration to seed the server.',
          );
          await this.serverMigrationService.handleServerMigration(syncProvider, {
            syncImportReason: 'SERVER_MIGRATION',
          });
          return { kind: 'server_migration_handled' };
        }
      }

      OpLog.normal(
        'RemoteOpsDownloadCoordinatorService: No new remote operations to process after download.',
      );
      if (result.latestServerSeq !== undefined) {
        await syncProvider.setLastServerSeq(result.latestServerSeq);
      }
      return {
        kind: 'no_new_ops',
        allOpClocks: result.allOpClocks,
        snapshotVectorClock: result.snapshotVectorClock,
      };
    }

    const isFreshClient = await this.syncLocalStateService.isWhollyFreshClient();
    if (isFreshClient && result.newOps.length > 0) {
      if (this.syncLocalStateService.hasMeaningfulStoreData()) {
        OpLog.warn(
          `RemoteOpsDownloadCoordinatorService: Fresh client has local data and ${result.newOps.length} remote ops. Showing conflict dialog.`,
        );
        throw new LocalDataConflictError(0, {});
      }

      OpLog.warn(
        `RemoteOpsDownloadCoordinatorService: Fresh client detected. Requesting confirmation before accepting ${result.newOps.length} remote ops.`,
      );

      const confirmed = this.syncLocalStateService.confirmFreshClientSync(
        result.newOps.length,
      );
      if (!confirmed) {
        OpLog.normal(
          'RemoteOpsDownloadCoordinatorService: User cancelled fresh client sync. Remote data not applied.',
        );
        this.snackService.open({
          msg: T.F.SYNC.S.FRESH_CLIENT_SYNC_CANCELLED,
        });
        return { kind: 'cancelled' };
      }

      OpLog.normal(
        'RemoteOpsDownloadCoordinatorService: User confirmed fresh client sync. Proceeding with remote data.',
      );
    }

    const incomingConflict =
      await this.syncImportConflictGateService.checkIncomingFullStateConflict(
        result.newOps,
        {
          flushPendingWrites: true,
        },
      );
    if (incomingConflict.fullStateOp) {
      const { fullStateOp, pendingOps, dialogData } = incomingConflict;
      if (dialogData) {
        OpLog.warn(
          `RemoteOpsDownloadCoordinatorService: Incoming ${fullStateOp.opType} from client ${fullStateOp.clientId} ` +
            `with ${pendingOps.length} pending local ops. Showing conflict dialog.`,
        );

        const conflictResult =
          await this.syncImportConflictCoordinator.handleSyncImportConflict(
            syncProvider,
            dialogData,
            'RemoteOpsDownloadCoordinatorService (incoming full-state op)',
          );
        if (conflictResult === 'CANCEL') {
          return { kind: 'cancelled' };
        }
        return { kind: 'no_new_ops' };
      }

      OpLog.normal(
        `RemoteOpsDownloadCoordinatorService: Accepting incoming ${fullStateOp.opType} from client ` +
          `${fullStateOp.clientId} without conflict dialog; ` +
          `${pendingOps.length} pending op(s), no meaningful pending user changes.`,
      );
    }

    const processResult = await this.remoteOpsProcessingService.processRemoteOps(
      result.newOps,
    );

    if (
      processResult.allOpsFilteredBySyncImport &&
      processResult.filteredOpCount > 0 &&
      processResult.isLocalUnsyncedImport
    ) {
      OpLog.warn(
        `RemoteOpsDownloadCoordinatorService: All ${processResult.filteredOpCount} remote ops filtered by local SYNC_IMPORT. ` +
          'Showing conflict resolution dialog (local import detected).',
      );

      const conflictResult =
        await this.syncImportConflictCoordinator.handleSyncImportConflict(
          syncProvider,
          {
            filteredOpCount: processResult.filteredOpCount,
            localImportTimestamp: processResult.filteringImport?.timestamp ?? Date.now(),
            syncImportReason: processResult.filteringImport?.syncImportReason,
            scenario: 'LOCAL_IMPORT_FILTERS_REMOTE',
          },
          'RemoteOpsDownloadCoordinatorService (local SYNC_IMPORT filters remote)',
        );
      if (conflictResult === 'CANCEL') {
        return { kind: 'cancelled' };
      }
      return { kind: 'no_new_ops' };
    } else if (
      processResult.allOpsFilteredBySyncImport &&
      processResult.filteredOpCount > 0
    ) {
      OpLog.normal(
        `RemoteOpsDownloadCoordinatorService: ${processResult.filteredOpCount} remote ops silently filtered by ` +
          'remote SYNC_IMPORT (not showing dialog - import came from another client).',
      );
    }

    if (result.latestServerSeq !== undefined) {
      await syncProvider.setLastServerSeq(result.latestServerSeq);
    }

    const pendingOps = await this.opLogStore.getUnsynced();
    this.superSyncStatusService.updatePendingOpsStatus(pendingOps.length > 0);

    return {
      kind: 'ops_processed',
      newOpsCount: result.newOps.length,
      localWinOpsCreated: processResult.localWinOpsCreated,
      allOpClocks: result.allOpClocks,
      snapshotVectorClock: result.snapshotVectorClock,
    };
  }
}
