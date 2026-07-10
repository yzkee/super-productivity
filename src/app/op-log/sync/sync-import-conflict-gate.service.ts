import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  FULL_STATE_OP_TYPES,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { SyncImportConflictData } from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';
import { isExampleTaskCreateOp } from '../validation/is-example-task-op.util';

export interface IncomingFullStateConflictGateResult {
  fullStateOp?: Operation;
  pendingOps: OperationLogEntry[];
  hasMeaningfulPending: boolean;
  discardablePendingOpIds: string[];
  dialogData?: SyncImportConflictData;
}

/**
 * Decides whether an incoming full-state operation would discard meaningful local work.
 *
 * This service intentionally stops at detection: it reads pending local ops and builds
 * dialog data, but leaves dialog display and resolution side effects to
 * OperationLogSyncService. That keeps the same decision usable from both download
 * and piggyback-upload paths without coupling the gate to sync-provider actions.
 */
@Injectable({
  providedIn: 'root',
})
export class SyncImportConflictGateService {
  private opLogStore = inject(OperationLogStoreService);
  private writeFlushService = inject(OperationWriteFlushService);

  /**
   * Every pending op is user work unless it is an onboarding example-task create.
   * Entity-wide exemptions are unsafe: GLOBAL_CONFIG contains synced preferences,
   * while MIGRATION and RECOVERY genesis operations contain the user's full recovered
   * database. Full-state ops are always meaningful because applying a newer full-state
   * op can invalidate their local import/repair semantics.
   */
  hasMeaningfulPendingOps(ops: OperationLogEntry[]): boolean {
    return ops.some((entry) => {
      if (FULL_STATE_OP_TYPES.has(entry.op.opType as OpType)) {
        return true;
      }
      if (isExampleTaskCreateOp(entry)) {
        return false;
      }
      return true;
    });
  }

  /**
   * @param options.preCapturedPendingOps - Exact pending ops selected by the upload
   *        round. The piggyback path unions this snapshot with a live read so it
   *        protects both accepted work from that upload and work created while the
   *        network request was in flight.
   */
  async checkIncomingFullStateConflict(
    incomingOps: Operation[],
    options: {
      flushPendingWrites?: boolean;
      isNeverSynced?: boolean;
      preCapturedPendingOps?: OperationLogEntry[];
    } = {},
  ): Promise<IncomingFullStateConflictGateResult> {
    const fullStateOp = incomingOps.find((op) => FULL_STATE_OP_TYPES.has(op.opType));

    if (!fullStateOp) {
      return {
        pendingOps: [],
        hasMeaningfulPending: false,
        discardablePendingOpIds: [],
      };
    }

    if (options.flushPendingWrites) {
      // Download can race with captured operations that are not persisted yet.
      // Piggyback upload already flushed before uploading, so callers opt in only
      // when they need this second pre-check flush.
      await this.writeFlushService.flushPendingWrites();
    }

    const livePendingOps = await this.opLogStore.getUnsynced();
    const pendingOps = options.preCapturedPendingOps
      ? this._mergePendingOps(options.preCapturedPendingOps, livePendingOps)
      : livePendingOps;
    const hasMeaningfulPending = this.hasMeaningfulPendingOps(pendingOps);
    // Example-task ops that the caller may reject when it accepts the import silently.
    // When `hasMeaningfulPending` is true (real work pending alongside example tasks),
    // the conflict dialog is shown instead and these are intentionally left untouched:
    // if the user keeps local state, their example tasks ride along with the rest.
    //
    // These must come from a LIVE read: with a pre-captured snapshot, example ops
    // accepted earlier in the same upload round are already marked synced and must
    // not be re-marked rejected by the caller.
    const discardablePendingOpIds = livePendingOps
      .filter(isExampleTaskCreateOp)
      .map((entry) => entry.op.id);

    const result = {
      fullStateOp,
      pendingOps,
      hasMeaningfulPending,
      discardablePendingOpIds,
    };

    if (!hasMeaningfulPending) {
      return result;
    }

    // A client that has never completed a sync cannot have diverged from remote — its
    // "meaningful" pending ops are pre-first-sync startup state (e.g. example tasks).
    // Flag this so the dialog guards the destructive USE_LOCAL choice with an extra
    // confirmation (it would overwrite the populated remote with throwaway data).
    //
    // Callers SHOULD pass `isNeverSynced` captured at sync-cycle start (pre-download).
    // A live `hasSyncedOps()` here is unreliable on the piggyback-upload path: by the
    // time that gate runs, this same sync has already persisted downloaded ops
    // (syncedAt set) and marked accepted uploads synced, so reading it now would see
    // post-sync state and wrongly clear the guard. Fall back to a live read only for
    // standalone callers (e.g. the download path, where nothing is persisted yet).
    const isNeverSynced =
      options.isNeverSynced ?? !(await this.opLogStore.hasSyncedOps());

    return {
      ...result,
      dialogData: {
        filteredOpCount: pendingOps.length,
        localImportTimestamp: fullStateOp.timestamp ?? Date.now(),
        syncImportReason: fullStateOp.syncImportReason,
        scenario: 'INCOMING_IMPORT',
        isNeverSynced,
      },
    };
  }

  private _mergePendingOps(
    uploadSnapshot: OperationLogEntry[],
    livePendingOps: OperationLogEntry[],
  ): OperationLogEntry[] {
    const merged = [...uploadSnapshot];
    const seenOpIds = new Set(uploadSnapshot.map((entry) => entry.op.id));

    for (const entry of livePendingOps) {
      if (!seenOpIds.has(entry.op.id)) {
        merged.push(entry);
        seenOpIds.add(entry.op.id);
      }
    }

    return merged;
  }
}
