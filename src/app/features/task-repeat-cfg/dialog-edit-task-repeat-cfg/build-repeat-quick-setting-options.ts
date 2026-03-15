import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { RepeatQuickSetting } from '../task-repeat-cfg.model';

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export const buildRepeatQuickSettingOptions = (
  refDate: Date,
  locale: string,
  translateService: TranslateService,
  todayDate?: Date,
): { value: RepeatQuickSetting; label: string }[] => {
  const today = todayDate || new Date();
  const showTodayVariants = !isSameDay(refDate, today);

  const refWeekdayStr = refDate.toLocaleDateString(locale, { weekday: 'long' });
  const refDayStr = refDate.toLocaleDateString(locale, { day: 'numeric' });
  const refDayAndMonthStr = refDate.toLocaleDateString(locale, {
    day: 'numeric',
    month: 'numeric',
  });

  const options: { value: RepeatQuickSetting; label: string }[] = [
    {
      value: 'DAILY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_DAILY),
    },
    {
      value: 'MONDAY_TO_FRIDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONDAY_TO_FRIDAY),
    },
    {
      value: 'WEEKLY_CURRENT_WEEKDAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_WEEKLY_CURRENT_WEEKDAY, {
        weekdayStr: refWeekdayStr,
      }),
    },
  ];

  if (showTodayVariants && refDate.getDay() !== today.getDay()) {
    const todayWeekdayStr = today.toLocaleDateString(locale, { weekday: 'long' });
    options.push({
      value: 'WEEKLY_TODAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_WEEKLY_TODAY, {
        weekdayStr: todayWeekdayStr,
      }),
    });
  }

  options.push({
    value: 'MONTHLY_CURRENT_DATE',
    label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_CURRENT_DATE, {
      dateDayStr: refDayStr,
    }),
  });

  if (showTodayVariants && refDate.getDate() !== today.getDate()) {
    const todayDayStr = today.toLocaleDateString(locale, { day: 'numeric' });
    options.push({
      value: 'MONTHLY_TODAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_TODAY, {
        dateDayStr: todayDayStr,
      }),
    });
  }

  options.push(
    {
      value: 'MONTHLY_FIRST_DAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_FIRST_DAY),
    },
    {
      value: 'MONTHLY_LAST_DAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_MONTHLY_LAST_DAY),
    },
  );

  options.push({
    value: 'YEARLY_CURRENT_DATE',
    label: translateService.instant(T.F.TASK_REPEAT.F.Q_YEARLY_CURRENT_DATE, {
      dayAndMonthStr: refDayAndMonthStr,
    }),
  });

  if (
    showTodayVariants &&
    (refDate.getDate() !== today.getDate() || refDate.getMonth() !== today.getMonth())
  ) {
    const todayDayAndMonthStr = today.toLocaleDateString(locale, {
      day: 'numeric',
      month: 'numeric',
    });
    options.push({
      value: 'YEARLY_TODAY',
      label: translateService.instant(T.F.TASK_REPEAT.F.Q_YEARLY_TODAY, {
        dayAndMonthStr: todayDayAndMonthStr,
      }),
    });
  }

  options.push({
    value: 'CUSTOM',
    label: translateService.instant(T.F.TASK_REPEAT.F.Q_CUSTOM),
  });

  return options;
};
