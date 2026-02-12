import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  createProjectReliably,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Cross-Entity Cascade Delete E2E Tests
 *
 * Tests that project deletion propagates correctly across clients,
 * including when another client has created tasks in that project.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-cascade-delete.spec.ts
 */

/**
 * Navigate to project work view by clicking the project in the sidebar.
 */
const navigateToProject = async (
  page: import('@playwright/test').Page,
  projectName: string,
): Promise<void> => {
  // Click on the project in the sidebar
  const projectNavItem = page.locator(`nav-item:has-text("${projectName}")`).first();
  await projectNavItem.waitFor({ state: 'visible', timeout: 10000 });
  await projectNavItem.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
};

/**
 * Delete a project via the context menu on the sidebar nav-item.
 */
const deleteProjectViaContextMenu = async (
  page: import('@playwright/test').Page,
  projectName: string,
): Promise<void> => {
  // Find the project nav-item in the sidebar
  const projectNavItem = page.locator(`nav-item:has-text("${projectName}")`).first();
  await projectNavItem.waitFor({ state: 'visible', timeout: 10000 });

  // Hover to reveal the more_vert button (hidden by default, shown on hover)
  await projectNavItem.hover();
  const moreBtn = projectNavItem.locator('.additional-btn');
  await moreBtn.waitFor({ state: 'visible', timeout: 5000 });
  await moreBtn.click();

  // Click "Delete project" in context menu
  const deleteMenuItem = page.locator('button[mat-menu-item]:has-text("Delete project")');
  await deleteMenuItem.waitFor({ state: 'visible', timeout: 5000 });
  await deleteMenuItem.click();

  // Confirm deletion dialog (button text is "Ok")
  const confirmBtn = page.locator('dialog-confirm button[e2e="confirmBtn"]');
  await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
  await confirmBtn.click();

  // Wait for dialog to close and navigation
  await page.waitForTimeout(1000);
};

test.describe('@supersync Cross-Entity Cascade Delete', () => {
  /**
   * Scenario: Project deletion propagates to client that created tasks in it
   *
   * Flow:
   * 1. Client A creates a project "TestProject"
   * 2. Client A syncs
   * 3. Client B syncs (gets the project)
   * 4. Client B creates tasks in "TestProject"
   * 5. Client B syncs (uploads tasks)
   * 6. Client A deletes "TestProject" (without syncing first to get B's tasks)
   * 7. Client A syncs (uploads project deletion)
   * 8. Client B syncs (receives project deletion)
   * 9. Verify: Both clients have no project and no orphaned tasks
   */
  test('Project deletion cascades correctly across clients', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.setTimeout(180000);
    const appUrl = baseURL || 'http://localhost:4242';
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates project ============
      console.log('[CascadeDelete] Phase 1: Client A creates project');

      clientA = await createSimulatedClient(browser, appUrl, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const projectName = `CascadeProject-${testRunId}`;
      await createProjectReliably(clientA.page, projectName);
      console.log(`[CascadeDelete] Client A created project: ${projectName}`);

      // Create a task in the project to confirm it works
      const taskA = `TaskA-${testRunId}`;
      await clientA.workView.addTask(taskA);
      await waitForTask(clientA.page, taskA);

      // Sync
      await clientA.sync.syncAndWait();
      console.log('[CascadeDelete] Client A synced project and task');

      // ============ PHASE 2: Client B syncs and adds tasks to the project ============
      console.log('[CascadeDelete] Phase 2: Client B adds tasks to project');

      clientB = await createSimulatedClient(browser, appUrl, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);

      // Client B syncs to get the project
      await clientB.sync.syncAndWait();

      // Navigate to the project
      await navigateToProject(clientB.page, projectName);

      // Client B creates tasks in the project
      const taskB1 = `TaskB1-${testRunId}`;
      const taskB2 = `TaskB2-${testRunId}`;
      await clientB.workView.addTask(taskB1);
      await clientB.workView.addTask(taskB2);
      await waitForTask(clientB.page, taskB1);
      await waitForTask(clientB.page, taskB2);

      // Client B syncs
      await clientB.sync.syncAndWait();
      console.log('[CascadeDelete] Client B created tasks in project and synced');

      // ============ PHASE 3: Client A deletes project (without syncing B's tasks first) ============
      console.log('[CascadeDelete] Phase 3: Client A deletes project');

      await deleteProjectViaContextMenu(clientA.page, projectName);
      console.log('[CascadeDelete] Client A deleted project');

      // Client A syncs (uploads deletion)
      await clientA.sync.syncAndWait();
      console.log('[CascadeDelete] Client A synced (deletion uploaded)');

      // ============ PHASE 4: Client B syncs (receives deletion) ============
      console.log('[CascadeDelete] Phase 4: Client B syncs to receive deletion');

      await clientB.sync.syncAndWait();
      // Extra convergence round
      await clientB.sync.syncAndWait();
      console.log('[CascadeDelete] Client B synced');

      // Wait for state to settle
      await clientB.page.waitForTimeout(1000);

      // ============ PHASE 5: Verify no orphans ============
      console.log('[CascadeDelete] Phase 5: Verifying no orphaned tasks');

      // Navigate to root view where orphaned tasks would appear
      await clientA.page.goto('/#/');
      await clientA.page.waitForLoadState('networkidle');
      await clientB.page.goto('/#/');
      await clientB.page.waitForLoadState('networkidle');

      // Verify project is gone from sidebar on both clients
      const projectOnA = clientA.page.locator(`nav-item:has-text("${projectName}")`);
      const projectOnB = clientB.page.locator(`nav-item:has-text("${projectName}")`);
      await expect(projectOnA).not.toBeVisible({ timeout: 5000 });
      await expect(projectOnB).not.toBeVisible({ timeout: 5000 });
      console.log('[CascadeDelete] ✓ Project gone from both clients');

      // Verify tasks are not visible anywhere
      const taskAOnA = clientA.page.locator(`task:has-text("${taskA}")`);
      const taskB1OnB = clientB.page.locator(`task:has-text("${taskB1}")`);
      const taskB2OnB = clientB.page.locator(`task:has-text("${taskB2}")`);
      await expect(taskAOnA).not.toBeVisible({ timeout: 5000 });
      await expect(taskB1OnB).not.toBeVisible({ timeout: 5000 });
      await expect(taskB2OnB).not.toBeVisible({ timeout: 5000 });
      console.log('[CascadeDelete] ✓ All tasks from deleted project are gone');

      console.log('[CascadeDelete] ✓ Cascade delete test PASSED!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
