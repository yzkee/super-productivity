/**
 * Standardized timeout constants for e2e tests.
 * Use these to ensure consistent timeout handling across all tests.
 *
 * Guidelines:
 * - Prefer Playwright's auto-waiting over explicit timeouts
 * - Use these constants when explicit waits are needed
 * - Document WHY a specific timeout value was chosen
 */
export const TIMEOUTS = {
  /** Standard wait for dialogs to appear/disappear */
  DIALOG: 5000,

  /** Standard wait for navigation changes */
  NAVIGATION: 30000,

  /** Wait for sync operations to complete */
  SYNC: 30000,

  /** Maximum wait for scheduled reminders to trigger */
  SCHEDULE_MAX: 60000,

  /** Wait for tasks to become visible */
  TASK_VISIBLE: 10000,

  /** Wait for UI animations to complete (Material Design transitions) */
  ANIMATION: 500,

  /** Wait for Angular stability after state changes */
  ANGULAR_STABILITY: 3000,

  /** Wait for elements to be enabled/clickable */
  ELEMENT_ENABLED: 5000,

  /** Extended timeout for complex operations */
  EXTENDED: 20000,

  /**
   * Wait for IndexedDB writes to persist.
   * NgRx effects write to IndexedDB outside Angular's zone,
   * so we need an explicit wait after state changes before page navigation.
   * 500ms is empirically sufficient for most write operations.
   */
  INDEXEDDB_WRITE: 500,

  /**
   * Playwright action timeout (click, fill, etc.)
   * Should match playwright.config.ts actionTimeout
   */
  ACTION: 15000,

  /**
   * Playwright assertion timeout (expect calls)
   * Should match playwright.config.ts expect.timeout
   */
  ASSERTION: 20000,

  /**
   * Short delay for UI to settle after actions.
   * Use sparingly - prefer Playwright auto-waiting.
   */
  UI_SETTLE: 200,

  /**
   * Retry delay between attempts when using retry logic.
   */
  RETRY_DELAY: 1000,
} as const;

export type TimeoutKey = keyof typeof TIMEOUTS;
