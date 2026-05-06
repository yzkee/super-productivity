/**
 * Desktop / light / no custom theme.
 * Slots: 04-list-with-notes, 06-schedule-light.
 */
import { test } from '../../fixture';
import { LOCALES } from '../../matrix';
import { gotoAndSettle, openNotesPanel, resetView } from '../../helpers';

for (const locale of LOCALES) {
  test.describe(`@screenshot desktop light (${locale})`, () => {
    test.use({ locale, theme: 'light' });

    test('all light desktop scenarios', async ({ seededPage, screenshotMaster }) => {
      const page = seededPage;

      // 04 — Project (Work) + notes panel
      await gotoAndSettle(page, '/#/project/work/tasks');
      await page.locator('task').first().waitFor({ state: 'visible' });
      await openNotesPanel(page);
      await page.waitForTimeout(500);
      await screenshotMaster('desktop-04-list-with-notes', 'list-with-notes');
      await resetView(page);

      // 06 — Schedule (light variant)
      await gotoAndSettle(page, '/#/schedule');
      await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
      await screenshotMaster('desktop-06-schedule-light', 'schedule-light');
    });
  });
}
