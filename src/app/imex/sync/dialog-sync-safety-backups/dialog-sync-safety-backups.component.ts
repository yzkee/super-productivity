import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { SyncSafetyBackupsComponent } from '../sync-safety-backups/sync-safety-backups.component';

@Component({
  selector: 'dialog-sync-safety-backups',
  template: `
    <h1 mat-dialog-title>{{ T.F.SYNC.SAFETY_BACKUP.TITLE | translate }}</h1>
    <mat-dialog-content>
      <sync-safety-backups></sync-safety-backups>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        mat-dialog-close
      >
        {{ T.G.CLOSE | translate }}
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    SyncSafetyBackupsComponent,
    TranslatePipe,
  ],
})
export class DialogSyncSafetyBackupsComponent {
  T = T;
}
