/**
 * Scenario helpers — UI mechanics for driving the app to specific states.
 * Each helper assumes the app has already been seeded (via `seededPage`).
 *
 * Platform gating is done at the Playwright config level via per-project
 * `testMatch` (desktop projects load `scenarios/desktop/**`, mobile projects
 * load `scenarios/mobile/**`), so specs no longer need a runtime `onlyOn`.
 */

import type { Page } from '@playwright/test';
import { waitForAppReady } from '../utils/waits';

/**
 * Toggle the right-hand notes panel. Selector from
 * `desktop-panel-buttons.component.ts` (`.e2e-toggle-notes-btn`) — desktop
 * only, since mobile uses a different bottom-nav flow.
 */
export const openNotesPanel = async (page: Page): Promise<void> => {
  const btn = page.locator('.e2e-toggle-notes-btn').first();
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
};

/** Toggle the schedule day panel via the e2e-tagged header button. */
export const openSchedulePanel = async (page: Page): Promise<void> => {
  const btn = page.locator('.e2e-toggle-schedule-day-panel').first();
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  await btn.click();
};

/** Standard scenario boot: navigate to a hash route + settle. */
export const gotoAndSettle = async (page: Page, hashRoute: string): Promise<void> => {
  await page.goto(hashRoute);
  await waitForAppReady(page, { ensureRoute: false });
  // Tail buffer for router/animation transitions.
  await page.waitForTimeout(400);
};

/**
 * Reset transient UI state between scenarios in a grouped run. The seed lives
 * in IndexedDB so it survives — only in-memory NgRx + open panels/dialogs are
 * reset. `page.reload()` is the cheapest reliable reset.
 */
export const resetView = async (page: Page): Promise<void> => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, { ensureRoute: false });
  await page.waitForTimeout(200);
};
