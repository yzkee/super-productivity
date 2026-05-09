import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SyncHydrationService } from '../persistence/sync-hydration.service';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import {
  DownloadOutcome,
  FileSnapshotDownloadResult,
} from '../core/types/sync-results.types';
import { LocalDataConflictError } from '../core/errors/sync-errors';
import { OpLog } from '../../core/log';
import { compareVectorClocks, isVectorClockEmpty } from '../../core/util/vector-clock';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { SyncImportConflictGateService } from './sync-import-conflict-gate.service';
import { SyncLocalStateService } from './sync-local-state.service';

@Injectable({
  providedIn: 'root',
})
export class FileSnapshotDownloadCoordinatorService {
  private opLogStore = inject(OperationLogStoreService);
  private syncHydrationService = inject(SyncHydrationService);
  private snackService = inject(SnackService);
  private syncImportConflictGateService = inject(SyncImportConflictGateService);
  private syncLocalStateService = inject(SyncLocalStateService);

  async handleSnapshotDownload(
    syncProvider: OperationSyncCapable<'fileSnapshotOps'>,
    result: FileSnapshotDownloadResult,
  ): Promise<DownloadOutcome> {
    if (!result.snapshotState) {
      return {
        kind: 'no_new_ops',
        allOpClocks: result.allOpClocks,
        snapshotVectorClock: result.snapshotVectorClock,
      };
    }

    // Issue #7339: a file-based snapshot whose vector clock is dominated by the
    // local clock contains nothing the local client does not already have. Hydrating
    // would discard local-only ops and a conflict dialog has nothing to resolve.
    if (result.snapshotVectorClock && !isVectorClockEmpty(result.snapshotVectorClock)) {
      const localClock = await this.opLogStore.getVectorClock();
      if (!isVectorClockEmpty(localClock)) {
        const cmp = compareVectorClocks(localClock, result.snapshotVectorClock);
        if (cmp === 'EQUAL' || cmp === 'GREATER_THAN') {
          OpLog.normal(
            `FileSnapshotDownloadCoordinatorService: Local vector clock ${cmp} remote snapshot - ` +
              'skipping snapshot hydration (local already has all remote data).',
          );
          // Deliberately do NOT append result.newOps here. Appending historical
          // remote ops at the current tail can regress per-entity frontiers.
          if (result.latestServerSeq !== undefined) {
            await syncProvider.setLastServerSeq(result.latestServerSeq);
          }
          return {
            kind: 'no_new_ops',
            allOpClocks: result.allOpClocks,
            snapshotVectorClock: result.snapshotVectorClock,
          };
        }
      }
    }

    OpLog.normal(
      'FileSnapshotDownloadCoordinatorService: Received snapshotState from file-based sync. Hydrating...',
    );

    const unsyncedOps = await this.opLogStore.getUnsynced();
    const hasLocalChanges = unsyncedOps.length > 0;

    if (hasLocalChanges) {
      const hasMeaningfulUserData =
        this.syncImportConflictGateService.hasMeaningfulPendingOps(unsyncedOps) ||
        this.syncLocalStateService.hasMeaningfulStoreData();

      if (hasMeaningfulUserData) {
        OpLog.warn(
          `FileSnapshotDownloadCoordinatorService: Client has ${unsyncedOps.length} unsynced local ops ` +
            'with meaningful user data. Throwing LocalDataConflictError.',
        );

        throw new LocalDataConflictError(
          unsyncedOps.length,
          result.snapshotState as Record<string, unknown>,
          result.snapshotVectorClock,
        );
      }

      OpLog.normal(
        `FileSnapshotDownloadCoordinatorService: Client has ${unsyncedOps.length} unsynced ops but no meaningful user data. ` +
          'Proceeding with snapshot download.',
      );
    }

    if (!hasLocalChanges) {
      const isFreshClient = await this.syncLocalStateService.isWhollyFreshClient();

      if (isFreshClient && this.syncLocalStateService.hasMeaningfulStoreData()) {
        OpLog.warn(
          'FileSnapshotDownloadCoordinatorService: Fresh client detected with meaningful local data in store. ' +
            'Throwing LocalDataConflictError.',
        );

        throw new LocalDataConflictError(
          0,
          result.snapshotState as Record<string, unknown>,
          result.snapshotVectorClock,
        );
      }

      if (isFreshClient) {
        OpLog.warn(
          'FileSnapshotDownloadCoordinatorService: Fresh client detected. Requesting confirmation before accepting snapshot.',
        );

        const confirmed = this.syncLocalStateService.confirmFreshClientSync(1);
        if (!confirmed) {
          OpLog.normal(
            'FileSnapshotDownloadCoordinatorService: User cancelled fresh client sync. Snapshot not applied.',
          );
          this.snackService.open({
            msg: T.F.SYNC.S.FRESH_CLIENT_SYNC_CANCELLED,
          });
          return { kind: 'cancelled' };
        }

        OpLog.normal(
          'FileSnapshotDownloadCoordinatorService: User confirmed fresh client sync. Proceeding with snapshot.',
        );
      }
    }

    await this.hydrateSnapshotAndPersistRecentOps(
      syncProvider,
      result,
      'normal-download',
    );

    return {
      kind: 'snapshot_hydrated',
      allOpClocks: result.allOpClocks,
      snapshotVectorClock: result.snapshotVectorClock,
    };
  }

  async hydrateSnapshotAndPersistRecentOps(
    syncProvider: OperationSyncCapable<'fileSnapshotOps'>,
    result: FileSnapshotDownloadResult,
    source: 'normal-download' | 'force-download',
  ): Promise<void> {
    await this.syncHydrationService.hydrateFromRemoteSync(
      result.snapshotState as Record<string, unknown>,
      result.snapshotVectorClock,
      false,
    );

    if (result.newOps.length > 0) {
      const appendResult = await this.opLogStore.appendBatchSkipDuplicates(
        result.newOps,
        'remote',
      );
      const suffix =
        source === 'force-download'
          ? 'after force-download hydration.'
          : '(prevents duplication on next sync cycle).';
      OpLog.normal(
        `FileSnapshotDownloadCoordinatorService: Wrote ${appendResult.writtenOps.length} snapshot ops to IndexedDB ` +
          suffix +
          (appendResult.skippedCount > 0
            ? ` Skipped ${appendResult.skippedCount} duplicate(s).`
            : ''),
      );
    }

    if (result.latestServerSeq !== undefined) {
      await syncProvider.setLastServerSeq(result.latestServerSeq);
    }

    OpLog.normal('FileSnapshotDownloadCoordinatorService: Snapshot hydration complete.');
  }
}
