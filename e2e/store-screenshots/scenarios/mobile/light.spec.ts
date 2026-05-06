/**
 * Mobile / light.
 * Slots: 04-planner-expanded-light.
 */
import { test } from '../../fixture';
import { LOCALES } from '../../matrix';
import { gotoAndSettle } from '../../helpers';

for (const locale of LOCALES) {
  test.describe(`@screenshot mobile light (${locale})`, () => {
    test.use({ locale, theme: 'light' });

    test('all light mobile scenarios', async ({ seededPage, screenshotMaster }) => {
      const page = seededPage;

      // 04 — Planner expanded (light variant)
      await gotoAndSettle(page, '/#/planner');
      await page.locator('planner, planner-day').first().waitFor({ state: 'visible' });
      const navHeader = page
        .locator('planner-calendar-nav .header, planner-calendar-nav button')
        .first();
      await navHeader.click({ trial: false }).catch(() => undefined);
      await page.waitForTimeout(400);
      await screenshotMaster(
        'mobile-04-planner-expanded-light',
        'planner-expanded-light',
      );
    });
  });
}
