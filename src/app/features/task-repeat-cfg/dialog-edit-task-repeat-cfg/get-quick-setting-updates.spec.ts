import {
  getQuickSettingUpdates,
  normalizeQuickSettingForStorage,
} from './get-quick-setting-updates';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('getQuickSettingUpdates', () => {
  describe('DAILY', () => {
    it('should return DAILY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('DAILY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('DAILY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('DAILY');
      expect(result!.startDate).toBeUndefined();
    });
  });

  describe('WEEKLY_CURRENT_WEEKDAY', () => {
    it('should return WEEKLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('WEEKLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY');
      expect(result!.startDate).toBeUndefined();
    });

    it('should set only today weekday to true when no referenceDate provided', () => {
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY');
      const weekdays = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];
      const todayIndex = new Date().getDay();

      weekdays.forEach((day, index) => {
        if (index === todayIndex) {
          expect((result as any)[day]).toBe(true);
        } else {
          expect((result as any)[day]).toBe(false);
        }
      });
    });

    // Issue #5806: Use referenceDate weekday when provided
    it('should set Sunday to true when referenceDate is a Sunday (fixes #5806)', () => {
      // Sunday Dec 28, 2025
      const sunday = new Date(2025, 11, 28);
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY', sunday);
      expect(result).toBeDefined();
      expect((result as any).sunday).toBe(true);
      expect((result as any).monday).toBe(false);
      expect((result as any).tuesday).toBe(false);
      expect((result as any).wednesday).toBe(false);
      expect((result as any).thursday).toBe(false);
      expect((result as any).friday).toBe(false);
      expect((result as any).saturday).toBe(false);
    });

    it('should set Friday to true when referenceDate is a Friday (fixes #5806)', () => {
      // Friday Dec 26, 2025
      const friday = new Date(2025, 11, 26);
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY', friday);
      expect(result).toBeDefined();
      expect((result as any).sunday).toBe(false);
      expect((result as any).monday).toBe(false);
      expect((result as any).tuesday).toBe(false);
      expect((result as any).wednesday).toBe(false);
      expect((result as any).thursday).toBe(false);
      expect((result as any).friday).toBe(true);
      expect((result as any).saturday).toBe(false);
    });

    it('should set Wednesday to true when referenceDate is a Wednesday (fixes #5806)', () => {
      // Wednesday Dec 31, 2025
      const wednesday = new Date(2025, 11, 31);
      const result = getQuickSettingUpdates('WEEKLY_CURRENT_WEEKDAY', wednesday);
      expect(result).toBeDefined();
      expect((result as any).sunday).toBe(false);
      expect((result as any).monday).toBe(false);
      expect((result as any).tuesday).toBe(false);
      expect((result as any).wednesday).toBe(true);
      expect((result as any).thursday).toBe(false);
      expect((result as any).friday).toBe(false);
      expect((result as any).saturday).toBe(false);
    });
  });

  describe('WEEKLY_TODAY', () => {
    it('should return WEEKLY cycle with repeatEvery 1', () => {
      const today = new Date(2025, 11, 29); // Monday
      const result = getQuickSettingUpdates('WEEKLY_TODAY', undefined, today);
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('WEEKLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to the provided today date', () => {
      const today = new Date(2025, 11, 29); // Monday
      const result = getQuickSettingUpdates('WEEKLY_TODAY', undefined, today);
      expect(result!.startDate).toBe(getDbDateStr(today));
    });

    it('should enable the weekday of the todayOverride date', () => {
      // Monday Dec 29, 2025
      const monday = new Date(2025, 11, 29);
      const result = getQuickSettingUpdates('WEEKLY_TODAY', undefined, monday);
      expect((result as any).monday).toBe(true);
      expect((result as any).tuesday).toBe(false);
      expect((result as any).wednesday).toBe(false);
      expect((result as any).thursday).toBe(false);
      expect((result as any).friday).toBe(false);
      expect((result as any).saturday).toBe(false);
      expect((result as any).sunday).toBe(false);
    });

    it('should use todayOverride not referenceDate for weekday', () => {
      // referenceDate is Friday, todayOverride is Wednesday
      const friday = new Date(2025, 11, 26);
      const wednesday = new Date(2025, 11, 31);
      const result = getQuickSettingUpdates('WEEKLY_TODAY', friday, wednesday);
      expect((result as any).wednesday).toBe(true);
      expect((result as any).friday).toBe(false);
    });
  });

  describe('MONDAY_TO_FRIDAY', () => {
    it('should return WEEKLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('MONDAY_TO_FRIDAY');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('WEEKLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should NOT set startDate (fixes #5594)', () => {
      const result = getQuickSettingUpdates('MONDAY_TO_FRIDAY');
      expect(result!.startDate).toBeUndefined();
    });

    it('should set monday through friday to true and weekend to false', () => {
      const result = getQuickSettingUpdates('MONDAY_TO_FRIDAY');
      expect((result as any).monday).toBe(true);
      expect((result as any).tuesday).toBe(true);
      expect((result as any).wednesday).toBe(true);
      expect((result as any).thursday).toBe(true);
      expect((result as any).friday).toBe(true);
      expect((result as any).saturday).toBe(false);
      expect((result as any).sunday).toBe(false);
    });
  });

  describe('MONTHLY_CURRENT_DATE', () => {
    it('should return MONTHLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('MONTHLY_CURRENT_DATE');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to today (fixes #6699)', () => {
      const result = getQuickSettingUpdates('MONTHLY_CURRENT_DATE');
      expect(result!.startDate).toBe(getDbDateStr());
    });
  });

  describe('MONTHLY_TODAY', () => {
    it('should return MONTHLY cycle with repeatEvery 1', () => {
      const today = new Date(2025, 2, 15);
      const result = getQuickSettingUpdates('MONTHLY_TODAY', undefined, today);
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to todayOverride', () => {
      const today = new Date(2025, 2, 15);
      const result = getQuickSettingUpdates('MONTHLY_TODAY', undefined, today);
      expect(result!.startDate).toBe(getDbDateStr(today));
    });
  });

  describe('MONTHLY_FIRST_DAY', () => {
    it('should return MONTHLY cycle with repeatEvery 1', () => {
      const today = new Date(2025, 2, 15);
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY', undefined, today);
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to the 1st of the month', () => {
      const today = new Date(2025, 2, 15);
      const result = getQuickSettingUpdates('MONTHLY_FIRST_DAY', undefined, today);
      const startDate = new Date(result!.startDate + 'T00:00:00');
      expect(startDate.getDate()).toBe(1);
    });
  });

  describe('MONTHLY_LAST_DAY', () => {
    it('should return MONTHLY cycle with repeatEvery 1', () => {
      const today = new Date(2025, 2, 15);
      const result = getQuickSettingUpdates('MONTHLY_LAST_DAY', undefined, today);
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('MONTHLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should always set startDate with day=31 regardless of current month', () => {
      // Test in February (28 days) — should still produce day=31
      const feb = new Date(2025, 1, 15);
      const resultFeb = getQuickSettingUpdates('MONTHLY_LAST_DAY', undefined, feb);
      const startDateFeb = new Date(resultFeb!.startDate + 'T00:00:00');
      expect(startDateFeb.getDate()).toBe(31);

      // Test in April (30 days)
      const apr = new Date(2025, 3, 15);
      const resultApr = getQuickSettingUpdates('MONTHLY_LAST_DAY', undefined, apr);
      const startDateApr = new Date(resultApr!.startDate + 'T00:00:00');
      expect(startDateApr.getDate()).toBe(31);

      // Test in December (31 days)
      const dec = new Date(2025, 11, 15);
      const resultDec = getQuickSettingUpdates('MONTHLY_LAST_DAY', undefined, dec);
      const startDateDec = new Date(resultDec!.startDate + 'T00:00:00');
      expect(startDateDec.getDate()).toBe(31);
    });
  });

  describe('YEARLY_CURRENT_DATE', () => {
    it('should return YEARLY cycle with repeatEvery 1', () => {
      const result = getQuickSettingUpdates('YEARLY_CURRENT_DATE');
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('YEARLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to today (fixes #6699)', () => {
      const result = getQuickSettingUpdates('YEARLY_CURRENT_DATE');
      expect(result!.startDate).toBe(getDbDateStr());
    });
  });

  describe('YEARLY_TODAY', () => {
    it('should return YEARLY cycle with repeatEvery 1', () => {
      const today = new Date(2025, 2, 15);
      const result = getQuickSettingUpdates('YEARLY_TODAY', undefined, today);
      expect(result).toBeDefined();
      expect(result!.repeatCycle).toBe('YEARLY');
      expect(result!.repeatEvery).toBe(1);
    });

    it('should set startDate to todayOverride', () => {
      const today = new Date(2025, 2, 15);
      const result = getQuickSettingUpdates('YEARLY_TODAY', undefined, today);
      expect(result!.startDate).toBe(getDbDateStr(today));
    });
  });

  describe('CUSTOM', () => {
    it('should return undefined', () => {
      const result = getQuickSettingUpdates('CUSTOM');
      expect(result).toBeUndefined();
    });
  });
});

describe('normalizeQuickSettingForStorage', () => {
  it('should map WEEKLY_TODAY to WEEKLY_CURRENT_WEEKDAY', () => {
    expect(normalizeQuickSettingForStorage('WEEKLY_TODAY')).toBe(
      'WEEKLY_CURRENT_WEEKDAY',
    );
  });

  it('should map MONTHLY_TODAY to MONTHLY_CURRENT_DATE', () => {
    expect(normalizeQuickSettingForStorage('MONTHLY_TODAY')).toBe('MONTHLY_CURRENT_DATE');
  });

  it('should map YEARLY_TODAY to YEARLY_CURRENT_DATE', () => {
    expect(normalizeQuickSettingForStorage('YEARLY_TODAY')).toBe('YEARLY_CURRENT_DATE');
  });

  it('should not change non-TODAY settings', () => {
    expect(normalizeQuickSettingForStorage('DAILY')).toBe('DAILY');
    expect(normalizeQuickSettingForStorage('WEEKLY_CURRENT_WEEKDAY')).toBe(
      'WEEKLY_CURRENT_WEEKDAY',
    );
    expect(normalizeQuickSettingForStorage('MONTHLY_CURRENT_DATE')).toBe(
      'MONTHLY_CURRENT_DATE',
    );
    expect(normalizeQuickSettingForStorage('MONTHLY_FIRST_DAY')).toBe(
      'MONTHLY_FIRST_DAY',
    );
    expect(normalizeQuickSettingForStorage('MONTHLY_LAST_DAY')).toBe('MONTHLY_LAST_DAY');
    expect(normalizeQuickSettingForStorage('YEARLY_CURRENT_DATE')).toBe(
      'YEARLY_CURRENT_DATE',
    );
    expect(normalizeQuickSettingForStorage('CUSTOM')).toBe('CUSTOM');
  });
});
