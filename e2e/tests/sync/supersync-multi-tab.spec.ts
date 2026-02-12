import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { SuperSyncPage } from '../../pages/supersync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForAppReady } from '../../utils/waits';

/**
 * SuperSync Multi-Tab Same Account E2E Tests
 *
 * Tests that two browser tabs sharing the same IndexedDB (same BrowserContext)
 * don't corrupt data when using SuperSync.
 *
 * NOTE: This test is inherently fragile. Two Angular instances sharing IndexedDB
 * may surface real bugs (e.g., transaction conflicts, stale reads). The test uses
 * reload-based verification to ensure state consistency.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-multi-tab.spec.ts
 */

test.describe('@supersync Multi-Tab Same Account', () => {
  /**
   * Scenario: Two tabs share IndexedDB, tasks created in one tab appear in other after reload
   *
   * Flow:
   * 1. Create a SHARED browser context (same IndexedDB)
   * 2. Open Tab 1, set up SuperSync, create task
   * 3. Tab 1 syncs
   * 4. Open Tab 2 in SAME context
   * 5. Tab 2 reloads → should see Tab 1's task (from shared IndexedDB)
   * 6. Tab 2 creates a task
   * 7. Tab 1 reloads → should see both tasks
   * 8. External Client C (separate context) syncs → should see consistent state
   */
  test('Two tabs sharing IndexedDB converge with external client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientC: SimulatedE2EClient | null = null;
    let sharedContext: import('@playwright/test').BrowserContext | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Setup shared context with Tab 1 ============
      console.log('[MultiTab] Phase 1: Setup shared context with Tab 1');

      sharedContext = await browser.newContext({
        storageState: undefined,
        viewport: { width: 1920, height: 1080 },
      });

      const tab1 = await sharedContext.newPage();
      tab1.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.error(`[Tab1] Console error:`, msg.text());
        }
      });

      await tab1.goto(appUrl);
      await waitForAppReady(tab1);

      const tab1Sync = new SuperSyncPage(tab1);
      const tab1WorkView = new WorkViewPage(tab1, `Tab1-${testRunId}`);

      await tab1Sync.setupSuperSync(syncConfig);
      console.log('[MultiTab] Tab 1 setup complete');

      // ============ PHASE 2: Tab 1 creates task and syncs ============
      console.log('[MultiTab] Phase 2: Tab 1 creates task');

      const taskFromTab1 = `Tab1-Task-${testRunId}`;
      await tab1WorkView.addTask(taskFromTab1);
      await waitForTask(tab1, taskFromTab1);

      await tab1Sync.syncAndWait();
      console.log('[MultiTab] Tab 1 created task and synced');

      // ============ PHASE 3: Open Tab 2 in same context ============
      console.log('[MultiTab] Phase 3: Open Tab 2 in same context');

      const tab2 = await sharedContext.newPage();
      tab2.on('console', (msg) => {
        if (msg.type() === 'error') {
          console.error(`[Tab2] Console error:`, msg.text());
        }
      });

      await tab2.goto(appUrl);
      await waitForAppReady(tab2);
      await tab2.waitForTimeout(2000); // Let Angular hydrate from IndexedDB

      // Tab 2 should see Tab 1's task from shared IndexedDB
      await waitForTask(tab2, taskFromTab1);
      console.log("[MultiTab] ✓ Tab 2 sees Tab 1's task from shared IndexedDB");

      // ============ PHASE 4: Tab 2 creates task ============
      console.log('[MultiTab] Phase 4: Tab 2 creates task');

      const tab2WorkView = new WorkViewPage(tab2, `Tab2-${testRunId}`);
      const taskFromTab2 = `Tab2-Task-${testRunId}`;
      await tab2WorkView.addTask(taskFromTab2);
      await waitForTask(tab2, taskFromTab2);
      console.log('[MultiTab] Tab 2 created task');

      // Trigger sync from Tab 2 (SuperSync config is shared via IndexedDB)
      const tab2Sync = new SuperSyncPage(tab2);
      await tab2Sync.syncAndWait();
      console.log('[MultiTab] Tab 2 synced');

      // ============ PHASE 5: Tab 1 reloads and verifies ============
      console.log('[MultiTab] Phase 5: Tab 1 reloads');

      await tab1.reload();
      await waitForAppReady(tab1);
      await tab1.waitForTimeout(2000);

      // Tab 1 should see both tasks
      await waitForTask(tab1, taskFromTab1);
      await waitForTask(tab1, taskFromTab2);
      console.log('[MultiTab] ✓ Tab 1 sees both tasks after reload');

      // ============ PHASE 6: External Client C verifies consistent state ============
      console.log('[MultiTab] Phase 6: External Client C verifies');

      clientC = await createSimulatedClient(browser, appUrl, 'C', testRunId);
      await clientC.sync.setupSuperSync(syncConfig);
      await clientC.sync.syncAndWait();

      await waitForTask(clientC.page, taskFromTab1);
      await waitForTask(clientC.page, taskFromTab2);

      const cTask1 = clientC.page.locator(`task:has-text("${taskFromTab1}")`);
      const cTask2 = clientC.page.locator(`task:has-text("${taskFromTab2}")`);
      await expect(cTask1).toBeVisible();
      await expect(cTask2).toBeVisible();
      console.log('[MultiTab] ✓ External Client C sees consistent state');

      console.log('[MultiTab] ✓ Multi-tab test PASSED!');
    } finally {
      if (clientC) await closeClient(clientC);
      if (sharedContext) {
        await sharedContext.close().catch(() => {});
      }
    }
  });
});
