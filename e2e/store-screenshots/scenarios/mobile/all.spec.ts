/**
 * Single-session capture of every mobile scenario across both locales and
 * both themes. NgRx-dispatch flips locale and theme; no relaunch / re-import.
 *
 * Order:
 *   en × dark   (slots 01, 02, 03, 05, 06)
 *   en × light  (slot 04)
 *   de × dark   (slots 01, 02, 03, 05, 06)
 *   de × light  (slot 04)
 */
import { test } from '../../fixture';
import { LOCALES, type Locale } from '../../matrix';
import { applyLocale, applyTheme, gotoAndSettle, resetView } from '../../helpers';
import type { Page } from '@playwright/test';

const captureDarkScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 01 — Planner (default state)
  await gotoAndSettle(page, '/#/planner');
  await page.locator('planner, planner-day').first().waitFor({ state: 'visible' });
  await shoot('mobile-01-planner', 'planner');
  await resetView(page);

  // 02 — Planner expanded (calendar nav header click)
  await gotoAndSettle(page, '/#/planner');
  await page.locator('planner, planner-day').first().waitFor({ state: 'visible' });
  const navHeader = page
    .locator('planner-calendar-nav .header, planner-calendar-nav button')
    .first();
  await navHeader.click({ trial: false }).catch(() => undefined);
  await page.waitForTimeout(400);
  await shoot('mobile-02-planner-expanded', 'planner-expanded');
  await resetView(page);

  // 03 — Eisenhower board
  await gotoAndSettle(page, '/#/boards');
  await page.locator('boards').first().waitFor({ state: 'visible' });
  await page
    .locator('board-panel, .panel, mat-card')
    .first()
    .waitFor({ state: 'visible' });
  await shoot('mobile-03-eisenhower', 'eisenhower');
  await resetView(page);

  // 05 — Schedule
  await gotoAndSettle(page, '/#/schedule');
  await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
  await shoot('mobile-05-schedule', 'schedule');
  await resetView(page);

  // 06 — Today list
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await shoot('mobile-06-today', 'today');
};

const captureLightScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 04 — Planner expanded (light variant)
  await gotoAndSettle(page, '/#/planner');
  await page.locator('planner, planner-day').first().waitFor({ state: 'visible' });
  const navHeader = page
    .locator('planner-calendar-nav .header, planner-calendar-nav button')
    .first();
  await navHeader.click({ trial: false }).catch(() => undefined);
  await page.waitForTimeout(400);
  await shoot('mobile-04-planner-expanded-light', 'planner-expanded-light');
};

test.describe('@screenshot mobile all', () => {
  test.use({ locale: 'en', theme: 'dark' });

  test('every mobile variant in one session', async ({
    seededPage,
    screenshotMaster,
  }) => {
    const page = seededPage;

    for (let i = 0; i < LOCALES.length; i += 1) {
      const lng = LOCALES[i] as Locale;
      if (i > 0) await applyLocale(page, lng);

      await applyTheme(page, 'dark');
      await captureDarkScenes(page, screenshotMaster);

      await applyTheme(page, 'light');
      await captureLightScenes(page, screenshotMaster);
    }
  });
});
