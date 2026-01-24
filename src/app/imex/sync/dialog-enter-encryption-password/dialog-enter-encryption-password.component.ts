import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { SyncConfigService } from '../sync-config.service';

export interface EnterEncryptionPasswordResult {
  password?: string;
}

@Component({
  selector: 'dialog-enter-encryption-password',
  templateUrl: './dialog-enter-encryption-password.component.html',
  styleUrls: ['./dialog-enter-encryption-password.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatDialogActions,
    MatButton,
    MatIcon,
    TranslatePipe,
  ],
})
export class DialogEnterEncryptionPasswordComponent {
  private _syncConfigService = inject(SyncConfigService);
  private _matDialogRef =
    inject<
      MatDialogRef<DialogEnterEncryptionPasswordComponent, EnterEncryptionPasswordResult>
    >(MatDialogRef);

  T: typeof T = T;
  passwordVal: string = '';

  async saveAndSync(): Promise<void> {
    if (!this.passwordVal) {
      return;
    }
    await this._syncConfigService.updateEncryptionPassword(this.passwordVal);
    this._matDialogRef.close({ password: this.passwordVal });
  }

  cancel(): void {
    this._matDialogRef.close({});
  }
}
