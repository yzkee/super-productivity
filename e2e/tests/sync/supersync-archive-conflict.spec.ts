import { test } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  markTaskDone,
  renameTask,
  archiveDoneTasks,
  expectTaskInWorklog,
  navigateToWorkView,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskNotVisible } from '../../utils/supersync-assertions';

/**
 * SuperSync Archive Conflict E2E Tests
 *
 * These tests verify that moveToArchive operations survive concurrent
 * conflict resolution during multi-client sync.
 *
 * Bug A: When moveToArchive is rejected by the server due to concurrent
 * edits from another client, the stale operation resolver permanently
 * discards it because the archived tasks no longer exist in the NgRx store.
 *
 * Prerequisites:
 * - super-sync-server running on localhost:1901 with TEST_MODE=true
 * - Frontend running on localhost:4242
 */

test.describe('@supersync Archive Conflict Resolution', () => {
  test.describe.configure({ mode: 'serial' });

  /**
   * Test A: moveToArchive survives concurrent conflict
   *
   * Scenario:
   * 1. Client A creates Task-1 and Task-2, syncs
   * 2. Client B syncs (gets tasks)
   * 3. Client B renames Task-1, syncs (uploads rename)
   * 4. Client A marks both tasks done, archives them
   * 5. Client A syncs (moveToArchive may be rejected due to conflict with B's rename)
   * 6. Client A syncs again (retry — fix re-uploads with merged clock)
   * 7. Client B syncs (downloads the archive operation)
   *
   * Expected: Both clients have tasks in worklog, not in active task list.
   */
  test('moveToArchive should sync after concurrent conflict @supersync', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ============ PHASE 1: Client A creates tasks and syncs ============
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);

      const task1Name = `ArchConflict-T1-${uniqueId}`;
      const task2Name = `ArchConflict-T2-${uniqueId}`;

      await clientA.workView.addTask(task1Name);
      await clientA.workView.addTask(task2Name);
      console.log(`[ArchConflict] Client A created tasks: ${task1Name}, ${task2Name}`);

      await clientA.sync.syncAndWait();
      console.log('[ArchConflict] Client A synced (uploaded tasks)');

      // ============ PHASE 2: Client B downloads tasks ============
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();

      await waitForTask(clientB.page, task1Name);
      await waitForTask(clientB.page, task2Name);
      console.log('[ArchConflict] Client B received both tasks');

      // ============ PHASE 3: Client B renames Task-1 and syncs ============
      // This creates a concurrent edit that will cause conflict when Client A
      // uploads the moveToArchive operation
      const task1Renamed = `ArchConflict-T1-edited-${uniqueId}`;
      await renameTask(clientB, task1Name, task1Renamed);
      console.log(`[ArchConflict] Client B renamed ${task1Name} → ${task1Renamed}`);

      await clientB.sync.syncAndWait();
      console.log('[ArchConflict] Client B synced (uploaded rename)');

      // ============ PHASE 4: Client A marks tasks done and archives ============
      // Client A still has old task names (hasn't synced B's rename yet)
      await markTaskDone(clientA, task1Name);
      await markTaskDone(clientA, task2Name);
      console.log('[ArchConflict] Client A marked both tasks as done');

      await archiveDoneTasks(clientA);
      console.log('[ArchConflict] Client A archived done tasks');

      // ============ PHASE 5: Client A syncs (may trigger conflict) ============
      await clientA.sync.syncAndWait();
      console.log(
        '[ArchConflict] Client A synced (uploaded archive — may have conflict)',
      );

      // Second sync to handle any re-created ops from conflict resolution
      await clientA.sync.syncAndWait();
      console.log('[ArchConflict] Client A synced again (retry)');

      // ============ PHASE 6: Client B syncs to receive archive ============
      await clientB.sync.syncAndWait();
      console.log('[ArchConflict] Client B synced (downloaded archive)');

      // Extra sync round for convergence
      await clientA.sync.syncAndWait();
      await clientB.sync.syncAndWait();
      console.log('[ArchConflict] Extra sync round for convergence');

      // ============ PHASE 7: Verify tasks NOT in active task list ============
      await navigateToWorkView(clientA);
      await navigateToWorkView(clientB);

      // Tasks should not be visible in the active task list on either client
      await expectTaskNotVisible(clientA, task1Name);
      await expectTaskNotVisible(clientA, task2Name);
      console.log('[ArchConflict] Client A: tasks not visible in active list');

      await expectTaskNotVisible(clientB, task1Renamed);
      await expectTaskNotVisible(clientB, task2Name);
      console.log('[ArchConflict] Client B: tasks not visible in active list');

      // ============ PHASE 8: Verify tasks IN worklog ============
      // Client A archived with original names — worklog shows original task data
      await expectTaskInWorklog(clientA, task1Name);
      await expectTaskInWorklog(clientA, task2Name);
      console.log('[ArchConflict] Client A: tasks found in worklog');

      // Client B should also have tasks in worklog after receiving the archive op
      await expectTaskInWorklog(clientB, task1Name);
      await expectTaskInWorklog(clientB, task2Name);
      console.log('[ArchConflict] Client B: tasks found in worklog');

      console.log(
        '[ArchConflict] ✓ Test A passed: moveToArchive survived concurrent conflict',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
