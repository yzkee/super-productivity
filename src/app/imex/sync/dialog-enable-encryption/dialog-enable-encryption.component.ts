import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
  MAT_DIALOG_DATA,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { EncryptionEnableService } from '../encryption-enable.service';
import { SnackService } from '../../../core/snack/snack.service';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import { SyncProviderManager } from '../../../op-log/sync-providers/provider-manager.service';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';

export interface EnableEncryptionDialogData {
  encryptKey: string;
}

export interface EnableEncryptionResult {
  success: boolean;
}

@Component({
  selector: 'dialog-enable-encryption',
  templateUrl: './dialog-enable-encryption.component.html',
  styleUrls: ['./dialog-enable-encryption.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
    MatProgressSpinner,
  ],
})
export class DialogEnableEncryptionComponent {
  private _encryptionEnableService = inject(EncryptionEnableService);
  private _snackService = inject(SnackService);
  private _providerManager = inject(SyncProviderManager);
  private _data = inject<EnableEncryptionDialogData>(MAT_DIALOG_DATA);
  private _matDialogRef =
    inject<MatDialogRef<DialogEnableEncryptionComponent, EnableEncryptionResult>>(
      MatDialogRef,
    );

  T: typeof T = T;
  isLoading = signal(false);
  canProceed = signal(true);
  errorReason = signal<string | null>(null);

  constructor() {
    this._checkPreconditions();
  }

  private _checkPreconditions(): void {
    const provider = this._providerManager.getActiveProvider();

    if (!provider) {
      this.canProceed.set(false);
      this.errorReason.set(T.F.SYNC.FORM.SUPER_SYNC.ENABLE_ENCRYPTION_NOT_READY);
      return;
    }

    if (provider.id !== SyncProviderId.SuperSync) {
      this.canProceed.set(false);
      this.errorReason.set(T.F.SYNC.FORM.SUPER_SYNC.ENABLE_ENCRYPTION_SUPERSYNC_ONLY);
      return;
    }

    if (!this._data?.encryptKey) {
      this.canProceed.set(false);
      this.errorReason.set(T.F.SYNC.FORM.SUPER_SYNC.ENABLE_ENCRYPTION_PASSWORD_REQUIRED);
      return;
    }
  }

  async confirm(): Promise<void> {
    if (this.isLoading() || !this.canProceed()) {
      return;
    }

    this.isLoading.set(true);

    try {
      await this._encryptionEnableService.enableEncryption(this._data.encryptKey);
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.SYNC.FORM.SUPER_SYNC.ENABLE_ENCRYPTION_SUCCESS,
      });
      this._matDialogRef.close({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._snackService.open({
        type: 'ERROR',
        msg: `Failed to enable encryption: ${message}`,
      });
      this.isLoading.set(false);
    }
  }

  cancel(): void {
    this._matDialogRef.close({ success: false });
  }
}
