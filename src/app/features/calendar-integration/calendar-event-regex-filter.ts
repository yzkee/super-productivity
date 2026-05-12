import { CalendarIntegrationEvent } from './calendar-integration.model';

// Hard cap pattern length to mitigate ReDoS from adversarial user input.
// 256 chars accommodates realistic include/exclude patterns while bounding
// the space of catastrophic-backtracking constructions.
export const CALENDAR_REGEX_FILTER_MAX_LENGTH = 256;

// Module-level cache so the regex compiles once per pattern, not per event.
// `null` sentinel marks patterns whose syntax failed to compile — skip silently
// to preserve the historical "invalid regex ignored, feature non-fatal" UX.
// Oversized patterns are handled upstream by the caller (fail-closed for
// include, fail-open for exclude) before reaching this cache.
const COMPILED_CACHE_LIMIT = 64;
const compiledCache = new Map<string, RegExp | null>();

const getCompiled = (pattern: string): RegExp | null => {
  if (compiledCache.has(pattern)) {
    return compiledCache.get(pattern) ?? null;
  }
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(pattern, 'i');
  } catch {
    compiled = null;
  }
  if (compiledCache.size >= COMPILED_CACHE_LIMIT) {
    const firstKey = compiledCache.keys().next().value;
    if (firstKey !== undefined) compiledCache.delete(firstKey);
  }
  compiledCache.set(pattern, compiled);
  return compiled;
};

const isOversized = (pattern: string): boolean =>
  pattern.length > CALENDAR_REGEX_FILTER_MAX_LENGTH;

export const passesCalendarEventRegexFilter = (
  calEv: CalendarIntegrationEvent,
  filterIncludeRegex: string | null | undefined,
  filterExcludeRegex: string | null | undefined,
): boolean => {
  if (filterIncludeRegex) {
    // Fail-closed: an oversized include filter is unusable, so hide the event
    // rather than silently widening the user's intended scope (which could
    // leak unwanted events into auto-import).
    if (isOversized(filterIncludeRegex)) {
      return false;
    }
    const re = getCompiled(filterIncludeRegex);
    if (re && !re.test(calEv.title)) {
      return false;
    }
  }

  if (filterExcludeRegex && !isOversized(filterExcludeRegex)) {
    // Fail-open for exclude: matches the prior invalid-regex UX where an
    // unusable exclude pattern degrades to "no exclusion" rather than hiding
    // every event.
    const re = getCompiled(filterExcludeRegex);
    if (re && re.test(calEv.title)) {
      return false;
    }
  }

  return true;
};
