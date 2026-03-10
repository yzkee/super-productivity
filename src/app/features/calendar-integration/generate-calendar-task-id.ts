/**
 * Generates a deterministic task ID from a calendar provider ID and event ID.
 * This ensures that the same calendar event produces the same task ID on all
 * devices, preventing duplicates when multiple devices auto-import events.
 *
 * Uses djb2 hash to produce a compact, collision-resistant ID.
 */
export const generateCalendarTaskId = (
  issueProviderId: string,
  calendarEventId: string,
): string => {
  const input = `${issueProviderId}::${calendarEventId}`;
  const hash = djb2Hash(input);
  return `cal_${hash}`;
};

// 32-bit hash: ~77k inputs for 50% collision probability, acceptable for per-user calendar event volumes
const djb2Hash = (str: string): string => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  // Convert to unsigned 32-bit and then to base36 for compact representation
  return (hash >>> 0).toString(36);
};
