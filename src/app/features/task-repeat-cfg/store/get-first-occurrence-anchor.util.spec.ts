import { getFirstOccurrenceAnchor } from './get-first-occurrence-anchor.util';

describe('getFirstOccurrenceAnchor', () => {
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
