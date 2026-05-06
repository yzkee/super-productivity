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

/**
 * Switch DARK_MODE without re-importing the seed. Lets a single test session
 * capture both light and dark scenarios — saves ~30 s/spec/locale.
 *
 * Implementation: Playwright's `addInitScript` is append-only. The last
 * registered script runs last on every subsequent navigation, so layering a
 * new DARK_MODE setter on top of the fixture's initial setter wins from here
 * on. We then reload so GlobalThemeService picks up the new value at boot.
 */
export const applyTheme = async (page: Page, theme: 'dark' | 'light'): Promise<void> => {
  await page.addInitScript((darkMode) => {
    try {
      localStorage.setItem('DARK_MODE', darkMode);
    } catch {
      /* noop */
    }
  }, theme);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page, { ensureRoute: false });
  await page.waitForTimeout(200);
};

/**
 * Dispatch an NgRx action via `window.__e2eTestHelpers.store` (exposed in
 * dev/stage builds — see src/main.ts). Throws if the helper isn't present so
 * the pipeline fails loudly instead of silently capturing the wrong locale.
 */
const dispatchInPage = async (page: Page, action: unknown): Promise<void> => {
  await page.evaluate((act) => {
    type Helpers = {
      store?: { dispatch: (a: unknown) => void };
    };
    const helpers = (window as unknown as { __e2eTestHelpers?: Helpers })
      .__e2eTestHelpers;
    if (!helpers?.store) {
      throw new Error(
        '__e2eTestHelpers.store missing — run against a dev/stage build of SP',
      );
    }
    helpers.store.dispatch(act);
  }, action);
};

/**
 * Switch locale without re-importing the seed. Drives the same code path the
 * import flow does: dispatch `[Global Config] Update Global Config Section`
 * on `localization.lng`. The `applyLanguageFromState$` effect picks up the
 * change and calls LanguageService.setLng().
 */
export const applyLocale = async (page: Page, lng: string): Promise<void> => {
  await dispatchInPage(page, {
    type: '[Global Config] Update Global Config Section',
    sectionKey: 'localization',
    sectionCfg: { lng },
    isSkipSnack: true,
    meta: {
      isPersistent: true,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'localization',
      opType: 'UPDATE',
    },
  });
  // Stamp on window so the screenshotMaster fixture can route captures into
  // the correct `<locale>/` subdir without re-querying the store.
  await page.addInitScript((l) => {
    (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale = l;
  }, lng);
  await page.evaluate((l) => {
    (window as unknown as { __spCurrentLocale?: string }).__spCurrentLocale = l;
  }, lng);
  // ngx-translate fetches the i18n bundle on demand; give it a moment to
  // resolve before the next screenshot.
  await page.waitForTimeout(600);
  await waitForAppReady(page, { ensureRoute: false });
};

/**
 * Switch customTheme without re-importing the seed. CustomThemeService
 * subscribes to `globalConfig.misc.customTheme` and lazy-loads the matching
 * stylesheet — give the chunk a beat to land before capturing.
 */
export const applyCustomTheme = async (page: Page, themeId: string): Promise<void> => {
  await dispatchInPage(page, {
    type: '[Global Config] Update Global Config Section',
    sectionKey: 'misc',
    sectionCfg: { customTheme: themeId },
    isSkipSnack: true,
    meta: {
      isPersistent: true,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'misc',
      opType: 'UPDATE',
    },
  });
  await page.waitForTimeout(800);
};
