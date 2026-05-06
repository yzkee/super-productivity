/**
 * Tablet capture spec — runs against ipad13 (1032×1376 CSS portrait) and
 * android10Tablet (960×600 CSS landscape). Both render SP's desktop layout
 * (≥ 768 CSS px) but neither has the room for the right-hand notes /
 * schedule day-panel that the desktopMaster scenes rely on, so we keep the
 * scenes panel-free.
 *
 * Touch is emulated (`hasTouch: true` because the matrix marks these as
 * `isMobile`), so any hover-revealed action (e.g. desktop's
 * `.start-task-btn` revealed by hovering a task row) is unreliable —
 * scenes here don't depend on hover.
 *
 * English only for now — extend with a locale loop when the seed grows
 * localized task content.
 */
import { test } from '../../fixture';
import { applyTheme, gotoAndSettle, resetView } from '../../helpers';
import type { Page } from '@playwright/test';

const captureDarkScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 01 — Today list (full vertical canvas, ideal for iPad portrait)
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await shoot('tablet-01-today', 'today');
  await resetView(page);

  // 02 — Eisenhower board
  await gotoAndSettle(page, '/#/boards');
  await page.locator('boards').first().waitFor({ state: 'visible' });
  await page
    .locator('board-panel, .panel, mat-card')
    .first()
    .waitFor({ state: 'visible' });
  await shoot('tablet-02-eisenhower', 'eisenhower');
  await resetView(page);

  // 03 — Schedule (week strip stretches well at tablet widths)
  await gotoAndSettle(page, '/#/schedule');
  await page.locator('schedule, schedule-week').first().waitFor({ state: 'visible' });
  await shoot('tablet-03-schedule', 'schedule');
  await resetView(page);

  // 04 — Project (Work) — routed through a project view so the global
  // background image is suppressed and the project palette carries the look.
  await gotoAndSettle(page, '/#/project/work/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await shoot('tablet-04-project', 'project');
};

const captureLightScenes = async (
  page: Page,
  shoot: (scenario: string, name: string) => Promise<void>,
): Promise<void> => {
  // 05 — Today (light variant)
  await gotoAndSettle(page, '/#/tag/TODAY/tasks');
  await page.locator('task').first().waitFor({ state: 'visible' });
  await shoot('tablet-05-today-light', 'today-light');
};

test.describe('@screenshot tablet all', () => {
  test.use({ locale: 'en', theme: 'dark' });

  test('every tablet variant in one session', async ({
    seededPage,
    screenshotMaster,
  }) => {
    const page = seededPage;
    await applyTheme(page, 'dark');
    await captureDarkScenes(page, screenshotMaster);
    await applyTheme(page, 'light');
    await captureLightScenes(page, screenshotMaster);
  });
});
