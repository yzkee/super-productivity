import { Task } from '../../tasks/task.model';
import { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr } from '../../../util/get-db-date-str';

/**
 * Returns the "today" date that `getFirstRepeatOccurrence` should anchor on
 * when an existing task is being converted into a recurring task.
 *
 * Contract: returns `dateStrToUtcDate(task.dueDay)` ONLY when the task's
 * planned day equals `cfg.startDate` — i.e. the dialog's default is in
 * effect. The dialog defaults `startDate` to `task.dueDay ?? getDbDateStr(
 * task.dueWithTime)`, so equality is the signal that the user accepted the
 * default and intends the existing planned date to become the first
 * occurrence (#7344). If the user changed `startDate`, the anchor falls back
 * to today.
 *
 * NOTE: only used by the two "conversion" effects
 * (`addRepeatCfgToTaskUpdateTask$`, `updateTaskAfterMakingItRepeatable$`).
 * `rescheduleTaskOnRepeatCfgUpdate$` deliberately anchors on `new Date()`
 * instead, because editing an already-existing recurring cfg should compute
 * the next occurrence from today, not retro-anchor on the live task's
 * planned date.
 */
export const getFirstOccurrenceAnchor = (
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
