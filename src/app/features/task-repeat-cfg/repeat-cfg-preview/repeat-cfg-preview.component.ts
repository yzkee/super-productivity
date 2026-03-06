import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { MatDialog } from '@angular/material/dialog';
import { DialogEditTaskRepeatCfgComponent } from '../dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { getTaskRepeatInfoText } from '../../tasks/task-detail-panel/get-task-repeat-info-text.util';
import { T } from '../../../t.const';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { getNextRepeatOccurrence } from '../store/get-next-repeat-occurrence.util';
import { formatMonthDay } from '../../../util/format-month-day.util';

@Component({
  selector: 'repeat-cfg-preview',
  templateUrl: './repeat-cfg-preview.component.html',
  styleUrl: './repeat-cfg-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIcon, TranslatePipe, MatTooltip],
})
export class RepeatCfgPreviewComponent {
  private _matDialog = inject(MatDialog);
  private _translateService = inject(TranslateService);
  private _dateTimeFormatService = inject(DateTimeFormatService);

  repeatCfg = input.required<TaskRepeatCfg>();

  T = T;

  nextDueTooltip = computed(() => {
    const cfg = this.repeatCfg();
    const nextDate = getNextRepeatOccurrence(cfg, new Date());
    if (!nextDate) {
      return '';
    }
    const locale = this._dateTimeFormatService.currentLocale();
    const formatted = formatMonthDay(nextDate, locale);
    const nextLabel = this._translateService.instant(T.SCHEDULE.NEXT);
    return `${nextLabel} ${formatted}`;
  });

  editTaskRepeatCfg(): void {
    this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
      restoreFocus: false,
      data: { repeatCfg: this.repeatCfg() },
    });
  }

  getRepeatInfoText(): string {
    const [key, params] = getTaskRepeatInfoText(
      this.repeatCfg(),
      this._dateTimeFormatService.currentLocale(),
      this._dateTimeFormatService,
    );
    return this._translateService.instant(key, params);
  }
}
