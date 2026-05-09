import { inject, Injectable } from '@angular/core';
import { OpLog } from '../../core/log';
import { OperationSyncCapable } from '../sync-providers/provider.interface';
import { OperationLogUploadService } from './operation-log-upload.service';
import { ServerMigrationService } from './server-migration.service';
import { ForceRemoteStateCoordinatorService } from './force-remote-state-coordinator.service';
import { SyncImportConflictDialogService } from './sync-import-conflict-dialog.service';
import {
  SyncImportConflictData,
  SyncImportConflictResolution,
} from './dialog-sync-import-conflict/dialog-sync-import-conflict.component';

@Injectable({
  providedIn: 'root',
})
export class SyncImportConflictCoordinatorService {
  private syncImportConflictDialogService = inject(SyncImportConflictDialogService);
  private serverMigrationService = inject(ServerMigrationService);
  private uploadService = inject(OperationLogUploadService);
  private forceRemoteStateCoordinator = inject(ForceRemoteStateCoordinatorService);

  /**
   * Shows the SYNC_IMPORT conflict dialog and executes the user's chosen action.
   */
  async handleSyncImportConflict(
    syncProvider: OperationSyncCapable,
    dialogData: SyncImportConflictData,
    logPrefix: string,
  ): Promise<SyncImportConflictResolution> {
    const resolution =
      await this.syncImportConflictDialogService.showConflictDialog(dialogData);

    switch (resolution) {
      case 'USE_LOCAL':
        OpLog.normal(`${logPrefix}: User chose USE_LOCAL. Force uploading local state.`);
        await this.forceUploadLocalState(syncProvider);
        return 'USE_LOCAL';
      case 'USE_REMOTE':
        OpLog.normal(
          `${logPrefix}: User chose USE_REMOTE. Force downloading remote state.`,
        );
        await this.forceRemoteStateCoordinator.forceDownloadRemoteState(syncProvider);
        return 'USE_REMOTE';
      case 'CANCEL':
      default:
        OpLog.normal(`${logPrefix}: User cancelled SYNC_IMPORT conflict resolution.`);
        return 'CANCEL';
    }
  }

  /**
   * Force upload local state as a SYNC_IMPORT, replacing all remote data.
   */
  async forceUploadLocalState(syncProvider: OperationSyncCapable): Promise<void> {
    OpLog.warn(
      'SyncImportConflictCoordinatorService: Force uploading local state - creating SYNC_IMPORT to override remote.',
    );

    await this.serverMigrationService.handleServerMigration(syncProvider, {
      skipServerEmptyCheck: true,
      syncImportReason: 'FORCE_UPLOAD',
    });

    await this.uploadService.uploadPendingOps(syncProvider, {
      skipPiggybackProcessing: true,
      isCleanSlate: true,
    });

    OpLog.normal('SyncImportConflictCoordinatorService: Force upload complete.');
  }
}
