/**
 * Mobile / dark — captures all scenarios that share this tuple.
 * Slots: 01-planner, 02-planner-expanded, 03-eisenhower, 05-schedule, 06-today.
 */
import { test } from '../../fixture';
import { LOCALES } from '../../matrix';
import { gotoAndSettle, resetView } from '../../helpers';

for (const locale of LOCALES) {
  test.describe(`@screenshot mobile dark (${locale})`, () => {
    test.use({ locale, theme: 'dark' });

    test('all dark mobile scenarios', async ({ seededPage, screenshotMaster }) => {
      const page = seededPage;

      // 01 — Planner (default state)
      await gotoAndSettle(page, '/#/planner');
      await page.locator('planner, planner-day').first().waitFor({ state: 'visible' });
      await screenshotMaster('mobile-01-planner', 'planner');
      await resetView(page);

      // 02 — Planner expanded (calendar nav header click)
      await gotoAndSettle(page, '/#/planner');
      await page.locator('planner, planner-day').first().waitFor({ state: 'visible' });
      const navHeader = page
        .locator('planner-calendar-nav .header, planner-calendar-nav button')
        .first();
      await navHeader.click({ trial: false }).catch(() => undefined);
      await page.waitForTimeout(400);
      await screenshotMaster('mobile-02-planner-expanded', 'planner-expanded');
      await resetView(page);

      // 03 — Eisenhower board
      await gotoAndSettle(page, '/#/boards');
      await page.locator('boards').first().waitFor({ state: 'visible' });
      await page
        .locator('board-panel, .panel, mat-card')
        .first()
        .waitFor({ state: 'visible' });
      await screenshotMaster('mobile-03-eisenhower', 'eisenhower');
      await resetView(page);

      // 05 — Schedule
      await gotoAndSettle(page, '/#/schedule');
      await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
      await screenshotMaster('mobile-05-schedule', 'schedule');
      await resetView(page);

      // 06 — Today list
      await gotoAndSettle(page, '/#/tag/TODAY/tasks');
      await page.locator('task').first().waitFor({ state: 'visible' });
      await screenshotMaster('mobile-06-today', 'today');
    });
  });
}
