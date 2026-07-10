import { inject, Injectable } from '@angular/core';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  FULL_STATE_OP_TYPES,
  extractActionPayload,
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
   * Every pending op is user work unless it is an onboarding example-task create,
   * or the sync-config write required to enable first sync on a fresh client.
   * Full-state ops are always meaningful because applying a newer full-state op
   * can invalidate their local import/repair semantics.
   *
   * The lifecycle default is deliberately conservative: a caller that does not
   * know whether initial sync completed must protect startup-entity changes.
   */
  hasMeaningfulPendingOps(
    ops: OperationLogEntry[],
    options: { hasCompletedInitialSync: boolean } = {
      hasCompletedInitialSync: true,
    },
  ): boolean {
    return ops.some((entry) => {
      if (FULL_STATE_OP_TYPES.has(entry.op.opType as OpType)) {
        return true;
      }
      if (isExampleTaskCreateOp(entry)) {
        return false;
      }
      if (
        !options.hasCompletedInitialSync &&
        entry.op.entityType === 'GLOBAL_CONFIG' &&
        extractActionPayload(entry.op.payload).sectionKey === 'sync'
      ) {
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

    // Example-task ops that the caller may reject when it accepts the import silently.
    // These must come from a LIVE read: with a pre-captured snapshot, example ops
    // accepted earlier in the same upload round are already marked synced and must
    // not be re-marked rejected by the caller.
    const discardablePendingOpIds = livePendingOps
      .filter(isExampleTaskCreateOp)
      .map((entry) => entry.op.id);

    // Preserve the cheap example-task-only path. If nothing could be meaningful
    // even for a synced client, there is no reason to read sync history.
    const canContainMeaningfulPending = this.hasMeaningfulPendingOps(pendingOps);
    if (!canContainMeaningfulPending) {
      return {
        fullStateOp,
        pendingOps,
        hasMeaningfulPending: false,
        discardablePendingOpIds,
      };
    }

    // Capture lifecycle state before deciding whether startup writes are setup
    // noise or post-sync divergence. Piggyback callers pass their pre-sync snapshot
    // because a live read there already includes this sync cycle's writes.
    const isNeverSynced =
      options.isNeverSynced ?? !(await this.opLogStore.hasSyncedOps());
    const hasMeaningfulPending = this.hasMeaningfulPendingOps(pendingOps, {
      hasCompletedInitialSync: !isNeverSynced,
    });

    const result = {
      fullStateOp,
      pendingOps,
      hasMeaningfulPending,
      discardablePendingOpIds,
    };

    if (!hasMeaningfulPending) {
      return result;
    }

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
