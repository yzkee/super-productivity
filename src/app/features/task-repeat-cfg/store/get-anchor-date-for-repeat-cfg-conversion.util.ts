import { Task } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * When an existing task is converted into a recurring task, the "first
 * occurrence" of the new schedule should preserve the task's existing planned
 * date ONLY when the dialog's default is in effect — i.e. when the user did
 * not override startDate. The dialog defaults startDate to the task's
 * dueDay/dueWithTime, so `task.dueDay === cfg.startDate` is the signal that
 * the user left the default alone and intends the existing dueDay to become
 * the first occurrence (#7344).
 *
 * If the user changed startDate in the dialog (e.g. set it to today or to a
 * different future date), we fall back to today as the anchor — which matches
 * the pre-#7344 behavior and preserves existing tests that convert a
 * previously-planned task to a recurrence starting on a different date.
 */
export const getAnchorDateForRepeatCfgConversion = (
  task: Pick<Task, 'dueDay' | 'dueWithTime'>,
  cfg: Pick<TaskRepeatCfg, 'startDate'>,
): Date => {
  const taskPlannedDayStr =
    task.dueDay ?? (task.dueWithTime ? getDbDateStr(task.dueWithTime) : undefined);
  if (taskPlannedDayStr && taskPlannedDayStr === cfg.startDate) {
    return dateStrToUtcDate(taskPlannedDayStr);
  }
  return new Date();
};
