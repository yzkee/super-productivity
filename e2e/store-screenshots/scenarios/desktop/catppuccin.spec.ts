/**
 * Desktop / dark / catppuccin-mocha custom theme.
 * Standalone group — customTheme is set in the seed, so a different theme
 * means a different seed file → different Electron/web session.
 *
 * Slots: 07-list-catppuccin.
 */
import { test } from '../../fixture';
import { LOCALES } from '../../matrix';
import { gotoAndSettle } from '../../helpers';

for (const locale of LOCALES) {
  test.describe(`@screenshot desktop catppuccin (${locale})`, () => {
    test.use({ locale, theme: 'dark', customTheme: 'catppuccin-mocha' });

    test('catppuccin scenarios', async ({ seededPage, screenshotMaster }) => {
      const page = seededPage;

      await gotoAndSettle(page, '/#/tag/TODAY/tasks');
      await page.locator('task').first().waitFor({ state: 'visible' });
      // Custom theme CSS bundle takes a beat to load.
      await page.waitForTimeout(800);
      await screenshotMaster('desktop-07-list-catppuccin', 'list-catppuccin');
    });
  });
}
