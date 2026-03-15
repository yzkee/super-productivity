import {
  RepeatQuickSetting,
  TASK_REPEAT_WEEKDAY_MAP,
  TaskRepeatCfg,
} from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

const _buildWeeklyForDay = (date: Date, startDate?: string): Partial<TaskRepeatCfg> => {
  const weekdayStr = TASK_REPEAT_WEEKDAY_MAP[date.getDay()];
  return {
    repeatCycle: 'WEEKLY',
    repeatEvery: 1,
    ...(startDate !== undefined ? { startDate } : {}),
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
    [weekdayStr as keyof TaskRepeatCfg]: true,
  };
};

/**
 * Returns partial TaskRepeatCfg updates based on the quick setting.
 * @param quickSetting The quick setting to apply
 * @param referenceDate Optional date to use for weekday calculation (fixes #5806).
 *                      If not provided, uses current date.
 * @param todayOverride Optional date to use as "today" for _TODAY variants.
 *                      If not provided, uses current date. Useful for testing.
 */
export const getQuickSettingUpdates = (
  quickSetting: RepeatQuickSetting,
  referenceDate?: Date,
  todayOverride?: Date,
): Partial<TaskRepeatCfg> | undefined => {
  const today = todayOverride || new Date();

  switch (quickSetting) {
    case 'DAILY': {
      return {
        repeatCycle: 'DAILY',
        repeatEvery: 1,
      };
    }

    case 'WEEKLY_CURRENT_WEEKDAY': {
      return _buildWeeklyForDay(referenceDate || today);
    }

    case 'WEEKLY_TODAY': {
      return _buildWeeklyForDay(today, getDbDateStr(today));
    }

    case 'MONDAY_TO_FRIDAY': {
      return {
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
      };
    }

    case 'MONTHLY_CURRENT_DATE': {
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(referenceDate || today),
      };
    }

    case 'MONTHLY_TODAY': {
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(today),
      };
    }

    case 'MONTHLY_FIRST_DAY': {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(firstDay),
      };
    }

    case 'MONTHLY_LAST_DAY': {
      // Always use day=31 so the occurrence calculator clamps via
      // Math.min(31, lastDayOfMonth), producing true "last day" behavior.
      // Using the current month's last day would fail in short months (e.g. Feb=28).
      const day31 = new Date(today.getFullYear(), 0, 31);
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(day31),
      };
    }

    case 'YEARLY_CURRENT_DATE': {
      return {
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: getDbDateStr(referenceDate || today),
      };
    }

    case 'YEARLY_TODAY': {
      return {
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: getDbDateStr(today),
      };
    }

    case 'CUSTOM':
    default:
  }
  return undefined;
};

/**
 * Maps ephemeral "today" quick settings to their persistent equivalents.
 * _TODAY variants are selection helpers that set startDate to today;
 * once applied, they should be stored as their _CURRENT_* counterpart
 * so that re-saving doesn't silently shift the recurrence.
 */
export const normalizeQuickSettingForStorage = (
  quickSetting: RepeatQuickSetting,
): RepeatQuickSetting => {
  switch (quickSetting) {
    case 'WEEKLY_TODAY':
      return 'WEEKLY_CURRENT_WEEKDAY';
    case 'MONTHLY_TODAY':
      return 'MONTHLY_CURRENT_DATE';
    case 'YEARLY_TODAY':
      return 'YEARLY_CURRENT_DATE';
    default:
      return quickSetting;
  }
};
