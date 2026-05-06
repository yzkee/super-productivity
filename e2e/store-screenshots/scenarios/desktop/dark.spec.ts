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

      // 05 — Focus mode. Set the current task first so focus-mode renders the
      // task title instead of the "Select task to focus" placeholder. The
      // backup importer drops currentTaskId by design (see TaskSharedActions
      // .loadAllData reducer), so we drive it via the UI.
      await gotoAndSettle(page, '/#/tag/TODAY/tasks');
      const firstTask = page.locator('task').first();
      await firstTask.waitFor({ state: 'visible' });
      // Hover to materialise <task-hover-controls> (conditionally rendered),
      // then click the play button to mark it as the current task.
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
      // Stay on the mode-selector screen — task title + Flowtime/Pomodoro/
      // Countdown picker reads better than the prep countdown rocket screen.
      await page.waitForTimeout(500);
      await screenshotMaster('desktop-05-focus-mode', 'focus-mode');
    });
  });
}
