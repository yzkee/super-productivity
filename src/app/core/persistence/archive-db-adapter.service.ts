import { inject, Injectable } from '@angular/core';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { OperationLogStoreService } from '../../op-log/store/operation-log-store.service';

/**
 * Adapter for archive storage operations.
 *
 * ## Purpose
 *
 * This service provides a clean interface for archive persistence operations
 * (archiveYoung, archiveOld). It delegates to OperationLogStoreService which
 * stores archives in the SUP_OPS IndexedDB database.
 *
 * ## Usage
 *
 * Used by `ArchiveOperationHandler` for:
 * - `_handleFlushYoungToOld()`: Reading/writing archiveYoung and archiveOld
 * - `_handleLoadAllData()`: Writing archive data from SYNC_IMPORT/BACKUP_IMPORT
 *
 * @see src/app/op-log/apply/archive-operation-handler.service.ts
 */
@Injectable({
  providedIn: 'root',
})
export class ArchiveDbAdapter {
  private _opLogStore = inject(OperationLogStoreService);

  /**
   * Loads archiveYoung data from SUP_OPS IndexedDB.
   */
  async loadArchiveYoung(): Promise<ArchiveModel | undefined> {
    return this._opLogStore.loadArchiveYoung();
  }

  /**
   * Saves archiveYoung data to SUP_OPS IndexedDB.
   */
  async saveArchiveYoung(data: ArchiveModel): Promise<void> {
    return this._opLogStore.saveArchiveYoung(data);
  }

  /**
   * Loads archiveOld data from SUP_OPS IndexedDB.
   */
  async loadArchiveOld(): Promise<ArchiveModel | undefined> {
    return this._opLogStore.loadArchiveOld();
  }

  /**
   * Saves archiveOld data to SUP_OPS IndexedDB.
   */
  async saveArchiveOld(data: ArchiveModel): Promise<void> {
    return this._opLogStore.saveArchiveOld(data);
  }
}
