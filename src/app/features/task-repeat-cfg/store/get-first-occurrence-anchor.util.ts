import { Task } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * Anchor for `getFirstRepeatOccurrence` when converting an existing task to
 * recurring. Returns the task's planned day if the user accepted the dialog
 * default (equality with `cfg.startDate`, #7344), else today.
 *
 * For timed cfgs with a past planned day we clamp to today: otherwise
 * downstream `remindAt` would be in the past and the reminder module
 * (`reminder.module.ts`) would fire a "missed reminder" popup immediately
 * on save (#7354). Non-timed past days are safe to preserve.
 *
 * IMPORTANT: the equality check mirrors the dialog's default in
 * `dialog-edit-task-repeat-cfg.component.ts` (`task.dueDay ??
 * getDbDateStr(task.dueWithTime)`). If the dialog default changes, update
 * this check too.
 *
 * Used only by the two conversion effects; `rescheduleTaskOnRepeatCfgUpdate$`
 * intentionally uses `new Date()`.
 */
export const getFirstOccurrenceAnchor = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  cfg: Pick<TaskRepeatCfg, 'startDate' | 'startTime'>,
): Date => {
  const taskPlannedDayStr =
    task.dueDay ?? (task.dueWithTime ? getDbDateStr(task.dueWithTime) : undefined);
  if (!taskPlannedDayStr || taskPlannedDayStr !== cfg.startDate) {
    return new Date();
  }
  // `yyyy-mm-dd` strings sort lexicographically like calendar dates.
  if (cfg.startTime && taskPlannedDayStr < getDbDateStr()) {
    return new Date();
  }
  return dateStrToUtcDate(taskPlannedDayStr);
};
