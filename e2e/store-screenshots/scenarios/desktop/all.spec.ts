/**
 * Single-session capture of every desktop scenario across both locales,
 * both themes, and the catppuccin custom theme. Switches are driven via
 * NgRx dispatch through `window.__e2eTestHelpers.store` (exposed in dev/
 * stage builds — see src/main.ts), so we don't relaunch the
 * browser / Electron app or re-import the seed between variants.
 *
 * Order:
 *   en × dark   (slots 01, 02, 03, 05)
 *   en × light  (slots 04, 06)
 *   de × dark   (slots 01, 02, 03, 05)
 *   de × light  (slots 04, 06)
 *   en × dark × catppuccin-mocha (slot 07)
 */
import { test } from '../../fixture';
import { LOCALES, type Locale } from '../../matrix';
import {
  applyCustomTheme,
  applyLocale,
  applyTheme,
  gotoAndSettle,
  openNotesPanel,
  openSchedulePanel,
  resetView,
} from '../../helpers';
import type { Page } from '@playwright/test';

const captureDarkScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 01 — Today + schedule day-panel open
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await openSchedulePanel(page);
  await page.waitForTimeout(500);
  await shoot('desktop-01-list-with-schedule', 'list-with-schedule');
  await resetView(page);

  // 02 — Eisenhower board
  await gotoAndSettle(page, '/#/boards');
  await page.locator('boards').first().waitFor({ state: 'visible' });
  await page
    .locator('board-panel, .panel, mat-card')
    .first()
    .waitFor({ state: 'visible' });
  await shoot('desktop-02-eisenhower', 'eisenhower');
  await resetView(page);

  // 03 — Schedule
  await gotoAndSettle(page, '/#/schedule');
  await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
  await shoot('desktop-03-schedule-dark', 'schedule-dark');
  await resetView(page);

  // 05 — Focus mode (set current task first so the title renders).
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  const firstTask = page.locator('task').first();
  await firstTask.waitFor({ state: 'visible' });
  await firstTask.hover();
  const playOnTask = firstTask.locator('.start-task-btn');
  await playOnTask.waitFor({ state: 'visible', timeout: 5_000 });
  await playOnTask.click();
  await page.waitForTimeout(200);
  await page.locator('.focus-btn-wrapper button').first().click();
  await page
    .locator('focus-mode-overlay, focus-mode-main')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(500);
  await shoot('desktop-05-focus-mode', 'focus-mode');
};

const captureLightScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 04 — Project (Work) + notes panel
  await gotoAndSettle(page, '/#/project/work/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await openNotesPanel(page);
  await page.waitForTimeout(500);
  await shoot('desktop-04-list-with-notes', 'list-with-notes');
  await resetView(page);

  // 06 — Schedule (light variant)
  await gotoAndSettle(page, '/#/schedule');
  await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
  await shoot('desktop-06-schedule-light', 'schedule-light');
};

test.describe('@screenshot desktop all', () => {
  // Initial values; switches happen mid-test.
  test.use({ locale: 'en', theme: 'dark' });

  test('every desktop variant in one session', async ({
    seededPage,
    screenshotMaster,
  }) => {
    const page = seededPage;

    for (let i = 0; i < LOCALES.length; i += 1) {
      const lng = LOCALES[i] as Locale;
      // The seed already starts on `en`; only dispatch a switch when we move
      // to a different locale, otherwise we'd waste a translate-bundle fetch.
      if (i > 0) await applyLocale(page, lng);

      await applyTheme(page, 'dark');
      await captureDarkScenes(page, screenshotMaster);

      await applyTheme(page, 'light');
      await captureLightScenes(page, screenshotMaster);
    }

    // 07 — Catppuccin Mocha. Routed through a project view so the global
    // background image is suppressed and the catppuccin palette reads clearly.
    await applyLocale(page, 'en');
    await applyTheme(page, 'dark');
    await applyCustomTheme(page, 'catppuccin-mocha');
    await gotoAndSettle(page, '/#/project/work/tasks');
    await page.locator('task').first().waitFor({ state: 'visible' });
    await screenshotMaster('desktop-07-project-catppuccin', 'project-catppuccin');
  });
});
