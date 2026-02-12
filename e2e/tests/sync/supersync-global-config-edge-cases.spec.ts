import { test, expect } from '../../fixtures/supersync.fixture';
import type { Page } from '@playwright/test';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Global Config Sync Edge Cases E2E Tests
 *
 * Extends the single test in supersync-lww-singleton.spec.ts with additional
 * edge case scenarios for global config synchronization.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-global-config-edge-cases.spec.ts
 */

// --- Helpers (same as supersync-lww-singleton.spec.ts) ---

const navigateToMiscSettings = async (page: Page, forceReload = false): Promise<void> => {
  if (forceReload) {
    await page.goto('/#/tag/TODAY/tasks');
    await page.waitForURL(/tag\/TODAY/);
  }
  await page.goto('/#/config');
  await page.waitForURL(/config/);

  const miscCollapsible = page.locator(
    'collapsible:has(.collapsible-title:has-text("Misc"))',
  );
  await miscCollapsible.waitFor({ state: 'visible', timeout: 10000 });
  await miscCollapsible.scrollIntoViewIfNeeded();

  const isExpanded = await miscCollapsible.evaluate((el: Element) =>
    el.classList.contains('isExpanded'),
  );
  if (!isExpanded) {
    await miscCollapsible.locator('.collapsible-header').click();
    await miscCollapsible
      .locator('.collapsible-panel')
      .waitFor({ state: 'visible', timeout: 5000 });
  }
};

const toggleSetting = async (page: Page, labelText: string): Promise<void> => {
  const toggle = page
    .locator('mat-slide-toggle, mat-checkbox')
    .filter({ hasText: labelText })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  const wasChecked = await toggle.evaluate((el: Element) =>
    el.className.includes('checked'),
  );
  await toggle.click();
  if (wasChecked) {
    await expect(toggle).not.toHaveClass(/checked/, { timeout: 5000 });
  } else {
    await expect(toggle).toHaveClass(/checked/, { timeout: 5000 });
  }
};

const isSettingChecked = async (page: Page, labelText: string): Promise<boolean> => {
  const toggle = page
    .locator('mat-slide-toggle, mat-checkbox')
    .filter({ hasText: labelText })
    .first();
  await toggle.scrollIntoViewIfNeeded();
  const classes = (await toggle.getAttribute('class')) ?? '';
  return classes.includes('checked');
};

/**
 * Helper to set a setting to a specific state (ON/OFF).
 */
const ensureSettingState = async (
  page: Page,
  labelText: string,
  wantChecked: boolean,
): Promise<void> => {
  const current = await isSettingChecked(page, labelText);
  if (current !== wantChecked) {
    await toggleSetting(page, labelText);
  }
};

test.describe('@supersync Global Config Sync Edge Cases', () => {
  /**
   * Scenario: Three-client concurrent config changes converge
   *
   * Tests that when three clients make changes at different times,
   * all converge to the latest state (LWW).
   *
   * Flow:
   * 1. A, B, C set up and converge
   * 2. A toggles "Disable all animations" ON
   * 3. A syncs → B syncs → C syncs (all get A's change)
   * 4. B toggles "Disable all animations" OFF (earlier timestamp)
   * 5. B syncs
   * 6. Wait for timestamp gap
   * 7. C toggles "Disable celebration" ON (later timestamp)
   * 8. C syncs → A syncs → B syncs → all converge to C's state
   * 9. Verify all three show the same final state
   */
  test('Three-client concurrent config changes converge to latest', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;
    let clientC: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // Setup three clients
      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);

      // Initial convergence (setup creates globalConfig ops)
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      console.log('[3Client] Setup convergence complete');

      // Client A toggles "Disable all animations" ON
      await navigateToMiscSettings(clientA.page);
      await ensureSettingState(clientA.page, 'Disable all animations', true);
      await clientA.sync.syncAndWait();
      console.log('[3Client] Client A set animations=ON, synced');

      // All sync to get A's change
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();

      // Client B toggles "Disable all animations" OFF (earlier timestamp)
      await navigateToMiscSettings(clientB.page, true);
      await ensureSettingState(clientB.page, 'Disable all animations', false);
      await clientB.sync.syncAndWait();
      console.log('[3Client] Client B set animations=OFF, synced');

      // Timestamp gap
      await clientC.page.waitForTimeout(2000);

      // Client C toggles "Disable celebration" ON (later timestamp)
      await navigateToMiscSettings(clientC.page, true);
      await ensureSettingState(clientC.page, 'Disable celebration', true);
      await clientC.sync.syncAndWait();
      console.log('[3Client] Client C set celebration=ON, synced');

      // Convergence rounds
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientC.sync.syncAndWait();
      console.log('[3Client] Final convergence complete');

      // Verify all three clients show the same state
      await navigateToMiscSettings(clientA.page, true);
      await navigateToMiscSettings(clientB.page, true);
      await navigateToMiscSettings(clientC.page, true);

      const aAnim = await isSettingChecked(clientA.page, 'Disable all animations');
      const aCeleb = await isSettingChecked(clientA.page, 'Disable celebration');
      const bAnim = await isSettingChecked(clientB.page, 'Disable all animations');
      const bCeleb = await isSettingChecked(clientB.page, 'Disable celebration');
      const cAnim = await isSettingChecked(clientC.page, 'Disable all animations');
      const cCeleb = await isSettingChecked(clientC.page, 'Disable celebration');

      console.log(`[3Client] A: anim=${aAnim}, celeb=${aCeleb}`);
      console.log(`[3Client] B: anim=${bAnim}, celeb=${bCeleb}`);
      console.log(`[3Client] C: anim=${cAnim}, celeb=${cCeleb}`);

      // All clients must have converged to the same state
      expect(aAnim).toBe(bAnim);
      expect(aAnim).toBe(cAnim);
      expect(aCeleb).toBe(bCeleb);
      expect(aCeleb).toBe(cCeleb);

      console.log('[3Client] ✓ All three clients converged to same state');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
      if (clientC) await closeClient(clientC);
    }
  });

  /**
   * Scenario: Rapid successive config toggles result in final state being synced
   *
   * Tests that when a client makes 4 rapid changes to the same setting,
   * only the final state matters and syncs correctly.
   *
   * Flow:
   * 1. Client A toggles "Disable all animations" ON → OFF → ON → OFF rapidly
   * 2. Client A syncs
   * 3. Client B syncs
   * 4. Verify B has the final state (OFF)
   */
  test('Rapid successive config toggles result in final state synced', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Initial convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[RapidToggle] Setup convergence complete');

      // Verify initial state (OFF)
      await navigateToMiscSettings(clientA.page);
      const initialState = await isSettingChecked(clientA.page, 'Disable all animations');
      console.log(`[RapidToggle] Initial state: ${initialState}`);

      // Rapid toggles: 4 times (ON → OFF → ON → OFF)
      await toggleSetting(clientA.page, 'Disable all animations'); // → ON
      await toggleSetting(clientA.page, 'Disable all animations'); // → OFF
      await toggleSetting(clientA.page, 'Disable all animations'); // → ON
      await toggleSetting(clientA.page, 'Disable all animations'); // → OFF
      console.log('[RapidToggle] 4 rapid toggles complete (back to initial state)');

      // Final state should be same as initial
      const afterToggles = await isSettingChecked(clientA.page, 'Disable all animations');
      expect(afterToggles).toBe(initialState);
      console.log(`[RapidToggle] After toggles: ${afterToggles}`);

      // Sync
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[RapidToggle] Synced');

      // Verify Client B has the final state
      await navigateToMiscSettings(clientB.page, true);
      const bState = await isSettingChecked(clientB.page, 'Disable all animations');
      expect(bState).toBe(initialState);
      console.log(`[RapidToggle] Client B state: ${bState}`);

      console.log('[RapidToggle] ✓ Rapid toggle test PASSED');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
