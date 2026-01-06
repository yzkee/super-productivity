import { type Locator } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';

/**
 * Options for retry operations
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Delay between retries in ms (default: TIMEOUTS.RETRY_DELAY) */
  delay?: number;
  /** Callback invoked before each retry attempt */
  onRetry?: (attempt: number, error: Error) => void;
}

const defaultRetryOptions: Required<RetryOptions> = {
  maxRetries: 3,
  delay: TIMEOUTS.RETRY_DELAY,
  onRetry: () => {},
};

/**
 * Executes an async action with retry logic.
 * Catches errors and retries the action up to maxRetries times.
 *
 * @param action - The async action to execute
 * @param options - Retry configuration options
 * @returns The result of the action
 * @throws The last error if all retries fail
 *
 * @example
 * ```ts
 * const result = await retryAction(
 *   async () => await page.locator('.unstable-element').click(),
 *   { maxRetries: 5, delay: 500 }
 * );
 * ```
 */
export const retryAction = async <T>(
  action: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> => {
  const { maxRetries, delay, onRetry } = { ...defaultRetryOptions, ...options };
  let lastError: Error = new Error('No attempts made');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await action();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        onRetry(attempt, lastError);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
};

/**
 * Clicks a locator with retry logic.
 * Useful for elements that may be temporarily obscured or not yet interactive.
 *
 * @param locator - The Playwright locator to click
 * @param options - Retry configuration options
 */
export const retryClick = async (
  locator: Locator,
  options: RetryOptions = {},
): Promise<void> => {
  await retryAction(async () => {
    await locator.click({ timeout: TIMEOUTS.ACTION });
  }, options);
};

/**
 * Fills a locator with retry logic.
 * Clears existing content before filling.
 *
 * @param locator - The Playwright locator to fill
 * @param value - The value to fill
 * @param options - Retry configuration options
 */
export const retryFill = async (
  locator: Locator,
  value: string,
  options: RetryOptions = {},
): Promise<void> => {
  await retryAction(async () => {
    await locator.clear();
    await locator.fill(value);
  }, options);
};

/**
 * Waits for an element to be visible with retry logic.
 * Useful when an element may take time to appear after an action.
 *
 * @param locator - The Playwright locator to wait for
 * @param options - Retry configuration options
 */
export const retryWaitForVisible = async (
  locator: Locator,
  options: RetryOptions = {},
): Promise<void> => {
  await retryAction(async () => {
    await locator.waitFor({ state: 'visible', timeout: TIMEOUTS.ELEMENT_ENABLED });
  }, options);
};

/**
 * Executes an action and waits for a condition to be true.
 * Retries if the condition is not met within the timeout.
 *
 * @param action - The async action to execute
 * @param condition - Function that returns true when the expected state is reached
 * @param options - Retry configuration options
 */
export const retryUntilCondition = async (
  action: () => Promise<void>,
  condition: () => Promise<boolean>,
  options: RetryOptions = {},
): Promise<void> => {
  const { maxRetries, delay, onRetry } = { ...defaultRetryOptions, ...options };
  let lastError: Error = new Error('Condition never met');

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await action();

      // Poll for condition
      const startTime = Date.now();
      while (Date.now() - startTime < TIMEOUTS.ANGULAR_STABILITY) {
        if (await condition()) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      lastError = new Error('Condition not met within timeout');

      if (attempt < maxRetries) {
        onRetry(attempt, lastError);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        onRetry(attempt, lastError);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
};

/**
 * Expands a collapsible element if not already expanded.
 * Uses retry logic to handle timing issues.
 *
 * @param trigger - The locator for the expand trigger (button/header)
 * @param expandedContainer - The locator for the container that appears when expanded
 * @param options - Retry configuration options
 */
export const retryExpand = async (
  trigger: Locator,
  expandedContainer: Locator,
  options: RetryOptions = {},
): Promise<void> => {
  await retryAction(async () => {
    const isExpanded = await trigger.getAttribute('aria-expanded');
    if (isExpanded === 'true') {
      return;
    }

    await trigger.click();
    await expandedContainer.waitFor({
      state: 'visible',
      timeout: TIMEOUTS.ANIMATION * 2,
    });
  }, options);
};
