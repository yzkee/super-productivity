import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { ImexViewService } from '../imex/imex-meta/imex-view.service';
import { StateSnapshotService } from './state-snapshot.service';
import { OperationLogStoreService } from '../op-log/store/operation-log-store.service';
import { VectorClockService } from '../op-log/sync/vector-clock.service';
import { ClientIdService } from '../core/util/client-id.service';
import { Operation, OpType, ActionType } from '../op-log/core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../op-log/store/schema-migration.service';
import { incrementVectorClock } from '../core/util/vector-clock';
import { uuidv7 } from '../util/uuid-v7';
import { loadAllData } from '../root-store/meta/load-all-data.action';
import { validateFull } from './validation/validation-fn';
import { dataRepair } from './validation/data-repair';
import { isDataRepairPossible } from './validation/is-data-repair-possible.util';
import { PFLog } from '../core/log';
import { AppDataComplete, CROSS_MODEL_VERSION, AllModelConfig } from './model-config';
import { CompleteBackup } from './sync.types';

/**
 * Service for handling backup import and export operations.
 *
 * This service provides:
 * - Complete backup loading (for export)
 * - Complete backup import (for restore/import)
 *
 * All operations persist to the operation log for sync consistency.
 */
@Injectable({
  providedIn: 'root',
})
export class BackupService {
  private _imexViewService = inject(ImexViewService);
  private _store = inject(Store);
  private _stateSnapshotService = inject(StateSnapshotService);
  private _opLogStore = inject(OperationLogStoreService);
  private _vectorClockService = inject(VectorClockService);
  private _clientIdService = inject(ClientIdService);

  /**
   * Loads a complete backup of all application data.
   * Used for error reporting and manual backup creation.
   *
   * @param includeArchives - If true, loads archive data from IndexedDB (slower but complete)
   * @returns CompleteBackup containing all model data
   */
  async loadCompleteBackup(
    includeArchives: boolean = false,
  ): Promise<CompleteBackup<AllModelConfig>> {
    const data = includeArchives
      ? await this._stateSnapshotService.getAllSyncModelDataFromStoreAsync()
      : this._stateSnapshotService.getAllSyncModelDataFromStore();

    return {
      timestamp: Date.now(),
      lastUpdate: Date.now(),
      crossModelVersion: CROSS_MODEL_VERSION,
      data: data as AppDataComplete,
    };
  }

  /**
   * Imports a complete backup, validating and repairing if needed.
   * Persists to operation log and updates NgRx store.
   *
   * @param data - The backup data to import
   * @param isSkipLegacyWarnings - If true, skip legacy data format warnings
   * @param isSkipReload - If true, don't reload the page after import
   * @param isForceConflict - If true, generate new client ID and reset vector clock
   */
  async importCompleteBackup(
    data: AppDataComplete | CompleteBackup<AllModelConfig>,
    isSkipLegacyWarnings: boolean = false,
    isSkipReload: boolean = false,
    isForceConflict: boolean = false,
  ): Promise<void> {
    try {
      this._imexViewService.setDataImportInProgress(true);

      // 1. Normalize backup structure
      let backupData: AppDataComplete;

      if ('crossModelVersion' in data && 'timestamp' in data && 'data' in data) {
        backupData = data.data;
        // crossModelVersion was used for cross-model migrations, which are now removed
      } else {
        backupData = data as AppDataComplete;
      }

      // 2. Validate data
      const validationResult = validateFull(backupData);
      let validatedData = backupData;

      if (!validationResult.isValid) {
        // Try to repair
        if (isDataRepairPossible(backupData)) {
          const errors =
            'errors' in validationResult.typiaResult
              ? validationResult.typiaResult.errors
              : [];
          validatedData = dataRepair(backupData, errors);
        } else {
          throw new Error('Data validation failed and repair not possible');
        }
      }

      // 3. Persist to operation log
      await this._persistImportToOperationLog(validatedData, isForceConflict);

      // 4. Dispatch to NgRx
      this._store.dispatch(loadAllData({ appDataComplete: validatedData }));

      this._imexViewService.setDataImportInProgress(false);

      // Only reload if explicitly requested (legacy behavior fallback)
      if (!isSkipReload && isForceConflict) {
        window.location.reload();
      }
    } catch (e) {
      this._imexViewService.setDataImportInProgress(false);
      throw e;
    }
  }

  private async _persistImportToOperationLog(
    importedData: AppDataComplete,
    isForceConflict: boolean,
  ): Promise<void> {
    PFLog.normal('BackupService: Persisting import to operation log...');

    // 1. Backup current state before clearing operations
    let backupSucceeded = true;
    try {
      const existingStateCache = await this._opLogStore.loadStateCache();
      if (existingStateCache?.state) {
        PFLog.normal('BackupService: Backing up current state before import...');
        await this._opLogStore.saveImportBackup(existingStateCache.state);
      }
    } catch (e) {
      PFLog.warn('BackupService: Failed to backup state before import:', e);
      backupSucceeded = false;
    }

    // 2. Clear all old operations to prevent IndexedDB bloat
    if (backupSucceeded) {
      PFLog.normal('BackupService: Clearing old operations before import...');
      await this._opLogStore.clearAllOperations();
    }

    let clientId: string;
    if (isForceConflict) {
      clientId = await this._clientIdService.generateNewClientId();
    } else {
      const loadedClientId = await this._clientIdService.loadClientId();
      clientId = loadedClientId ?? (await this._clientIdService.generateNewClientId());
    }

    const currentClock = await this._vectorClockService.getCurrentVectorClock();
    const newClock = isForceConflict
      ? { [clientId]: 2 }
      : incrementVectorClock(currentClock, clientId);

    const opId = uuidv7();
    const op: Operation = {
      id: opId,
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.SyncImport,
      entityType: 'ALL',
      entityId: opId,
      payload: { appDataComplete: importedData },
      clientId,
      vectorClock: newClock,
      timestamp: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };

    await this._opLogStore.append(op, 'local');
    const lastSeq = await this._opLogStore.getLastSeq();

    await this._opLogStore.saveStateCache({
      state: importedData,
      lastAppliedOpSeq: lastSeq,
      vectorClock: newClock,
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });

    PFLog.normal('BackupService: Import persisted to operation log.');
  }
}
