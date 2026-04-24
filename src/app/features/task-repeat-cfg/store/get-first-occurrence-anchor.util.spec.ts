import { getFirstOccurrenceAnchor } from './get-first-occurrence-anchor.util';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('getFirstOccurrenceAnchor', () => {
  const addDays = (days: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return getDbDateStr(d);
  };

  describe('default preservation (#7344)', () => {
    it('returns the task dueDay when it matches the config startDate (dialog default)', () => {
      const result = getFirstOccurrenceAnchor(
        { dueDay: '2026-04-01', dueWithTime: undefined },
        { startDate: '2026-04-01' },
      );
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(3);
      expect(result.getDate()).toBe(1);
    });

    it('derives dueDay from dueWithTime when dueDay is missing and matches startDate', () => {
      const dueWithTime = new Date(2026, 3, 1, 10, 30).getTime();
      const result = getFirstOccurrenceAnchor(
        { dueDay: undefined, dueWithTime },
        { startDate: '2026-04-01' },
      );
      expect(result.getFullYear()).toBe(2026);
      expect(result.getMonth()).toBe(3);
      expect(result.getDate()).toBe(1);
    });
  });

  describe('fallback to today', () => {
    it('falls back to today when task has no planned date', () => {
      const before = Date.now();
      const result = getFirstOccurrenceAnchor(
        { dueDay: undefined, dueWithTime: undefined },
        { startDate: '2026-04-01' },
      );
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('falls back to today when task dueDay differs from startDate (user override)', () => {
      const before = Date.now();
      const result = getFirstOccurrenceAnchor(
        { dueDay: '2025-01-20', dueWithTime: undefined },
        { startDate: '2025-01-15' },
      );
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });
  });

  describe('timed-task past-day clamp (#7354)', () => {
    it('clamps to today when cfg is timed and planned day is in the past (derived from dueWithTime)', () => {
      const pastDay = addDays(-20);
      const before = Date.now();
      const result = getFirstOccurrenceAnchor(
        {
          dueDay: undefined,
          dueWithTime: new Date(`${pastDay}T10:00:00`).getTime(),
        },
        { startDate: pastDay, startTime: '10:00' },
      );
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('clamps to today when cfg is timed and planned day is in the past (dueDay only, startTime added in dialog)', () => {
      const pastDay = addDays(-20);
      const before = Date.now();
      const result = getFirstOccurrenceAnchor(
        { dueDay: pastDay, dueWithTime: undefined },
        { startDate: pastDay, startTime: '10:00' },
      );
      const after = Date.now();
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('preserves planned day for timed cfg when planned day is today', () => {
      const today = getDbDateStr();
      const result = getFirstOccurrenceAnchor(
        {
          dueDay: today,
          dueWithTime: undefined,
        },
        { startDate: today, startTime: '10:00' },
      );
      expect(getDbDateStr(result)).toBe(today);
    });

    it('preserves planned day for timed cfg when planned day is in the future', () => {
      const future = addDays(30);
      const result = getFirstOccurrenceAnchor(
        { dueDay: future, dueWithTime: undefined },
        { startDate: future, startTime: '10:00' },
      );
      expect(getDbDateStr(result)).toBe(future);
    });

    it('preserves planned day for non-timed cfg even when planned day is in the past (#7344 regression guard)', () => {
      const pastDay = addDays(-20);
      const result = getFirstOccurrenceAnchor(
        { dueDay: pastDay, dueWithTime: undefined },
        { startDate: pastDay },
      );
      expect(getDbDateStr(result)).toBe(pastDay);
    });
  });
});
