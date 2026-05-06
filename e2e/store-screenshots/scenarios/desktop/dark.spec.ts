/**
 * Desktop / dark / no custom theme — captures all scenarios that share this
 * tuple in a single Electron (or web) session, page-reloading between scenes
 * to reset transient UI state.
 *
 * Slots: 01-list-with-schedule, 02-eisenhower, 03-schedule-dark, 05-focus-mode.
 */
import { test } from '../../fixture';
import { LOCALES } from '../../matrix';
import { gotoAndSettle, openSchedulePanel, resetView } from '../../helpers';

for (const locale of LOCALES) {
  test.describe(`@screenshot desktop dark (${locale})`, () => {
    test.use({ locale, theme: 'dark' });

    test('all dark desktop scenarios', async ({ seededPage, screenshotMaster }) => {
      const page = seededPage;

      // 01 — Today + schedule day-panel open
      await gotoAndSettle(page, '/#/tag/TODAY/tasks');
      await page.locator('task').first().waitFor({ state: 'visible' });
      await openSchedulePanel(page);
      await page.waitForTimeout(500);
      await screenshotMaster('desktop-01-list-with-schedule', 'list-with-schedule');
      await resetView(page);

      // 02 — Eisenhower board
      await gotoAndSettle(page, '/#/boards');
      await page.locator('boards').first().waitFor({ state: 'visible' });
      await page
        .locator('board-panel, .panel, mat-card')
        .first()
        .waitFor({ state: 'visible' });
      await screenshotMaster('desktop-02-eisenhower', 'eisenhower');
      await resetView(page);

      // 03 — Schedule
      await gotoAndSettle(page, '/#/schedule');
      await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
      await screenshotMaster('desktop-03-schedule-dark', 'schedule-dark');
      await resetView(page);

      // 05 — Focus mode (best-effort: capture preparation if play disabled)
      await gotoAndSettle(page, '/#/tag/TODAY/tasks');
      await page.locator('task').first().waitFor({ state: 'visible' });
      await page.locator('.focus-btn-wrapper button').first().click();
      await page
        .locator('focus-mode-overlay, focus-mode-main')
        .first()
        .waitFor({ state: 'visible', timeout: 10_000 });
      const playBtn = page.locator('.play-button');
      if (await playBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await playBtn.click({ trial: false }).catch(() => undefined);
        await page.waitForTimeout(2_500);
      } else {
        await page.waitForTimeout(500);
      }
      await screenshotMaster('desktop-05-focus-mode', 'focus-mode');
    });
  });
}
