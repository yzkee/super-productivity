import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { ImportPage } from '../../pages/import.page';

/**
 * SuperSync: incoming SYNC_IMPORT must not silently discard NON-task local work.
 *
 * Regression test for the widened incoming-full-state conflict gate + the
 * piggyback pre-upload pending-snapshot fix (sync-import-conflict-gate.service).
 *
 * Before the fix the gate only treated CRUD ops on TASK/PROJECT/TAG/NOTE as
 * "meaningful", so a pending SIMPLE_COUNTER change (and MOV/BATCH, time
 * tracking, planner, boards, ...) was silently overwritten when an incoming
 * SYNC_IMPORT from another client arrived — no conflict dialog, no choice.
 * The gate now treats every synced entity as user work, and the piggyback path
 * judges against the pending set captured BEFORE the upload round (ops accepted
 * mid-round are marked synced and would otherwise vanish from a live re-read).
 *
 * Scenario:
 * 1. Client A + B set up sync; A creates a click counter, increments it, syncs.
 * 2. Client B syncs and receives the counter (B now has synced history).
 * 3. Client B increments the counter locally — a pending SIMPLE_COUNTER op it
 *    does NOT sync.
 * 4. Client A imports a backup (creates a SYNC_IMPORT) and syncs it.
 * 5. Client B triggers a sync. The SYNC_IMPORT conflict dialog MUST appear so
 *    the user can choose, instead of the counter change being discarded.
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-conflict-gate-non-task-work.spec.ts
 */

const createClickCounter = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<void> => {
  await client.page.goto('/#/habits');
  await client.page.waitForURL(/habits/);
  await client.page.waitForTimeout(500);

  const addBtn = client.page.locator('.add-habit-btn');
  await addBtn.waitFor({ state: 'visible', timeout: 10000 });
  await addBtn.click();

  const dialog = client.page.locator('dialog-simple-counter-edit-settings');
  await dialog.waitFor({ state: 'visible', timeout: 10000 });

  const titleInput = dialog.locator('formly-form input').first();
  await titleInput.waitFor({ state: 'visible', timeout: 5000 });
  await titleInput.fill(title);

  const typeSelect = dialog.locator('mat-select').first();
  await typeSelect.waitFor({ state: 'visible', timeout: 5000 });
  await client.page.waitForTimeout(500);
  await typeSelect.click();
  await client.page.waitForTimeout(300);
  await client.page.locator('mat-option:has-text("Click Counter")').click();
  await client.page.waitForTimeout(300);

  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });
  await client.page.waitForTimeout(500);

  await client.page.goto('/#/tag/TODAY/tasks');
  await client.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
  await client.page.waitForTimeout(500);
};

const incrementClickCounter = async (client: SimulatedE2EClient): Promise<void> => {
  const counter = client.page
    .locator('.counters-action-group simple-counter-button')
    .last();
  await counter.waitFor({ state: 'visible', timeout: 15000 });
  await counter.locator('.main-btn').click();
  await client.page.waitForTimeout(200);
};

test.describe.configure({ mode: 'serial' });

test.describe('@supersync incoming SYNC_IMPORT preserves non-task local work', () => {
  test('a pending simple-counter change prompts the conflict dialog instead of being discarded', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    test.slow();

    const counterTitle = `GateCounter-${testRunId}-${Date.now()}`;
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const syncConfig = getSuperSyncConfig(user);

      // ===== PHASE 1: A creates + increments a counter, syncs =====
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync(syncConfig);
      await createClickCounter(clientA, counterTitle);
      await incrementClickCounter(clientA);
      await clientA.sync.syncAndWait();
      console.log('[Gate] Client A created + synced a simple counter');

      // ===== PHASE 2: B joins, receives the counter (now non-fresh) =====
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/tag/TODAY/tasks');
      await clientB.page.waitForLoadState('networkidle');
      console.log('[Gate] Client B synced and received the counter');

      // ===== PHASE 3: B makes a pending NON-task change (does NOT sync) =====
      await incrementClickCounter(clientB);
      console.log('[Gate] Client B incremented the counter locally (pending, unsynced)');

      // ===== PHASE 4: A imports a backup (SYNC_IMPORT) and syncs it =====
      const importPageA = new ImportPage(clientA.page);
      await importPageA.navigateToImportPage();
      await importPageA.importBackupFile(ImportPage.getFixturePath('test-backup.json'));
      await clientA.sync.syncAndWait();
      console.log('[Gate] Client A imported a backup and synced the SYNC_IMPORT');

      // ===== PHASE 5: B syncs — the conflict dialog MUST appear =====
      // triggerSync() does NOT auto-resolve dialogs, so we can assert on it.
      await clientB.sync.triggerSync();

      await expect(clientB.sync.syncImportConflictDialog).toBeVisible({ timeout: 30000 });
      console.log('[Gate] ✓ Conflict dialog shown for pending non-task work');

      // Resolving with "Use My Data" keeps B's local work; the point of the test
      // is that B was given the choice at all.
      await clientB.sync.syncImportUseLocalBtn.click();
      await clientB.sync.syncImportConflictDialog.waitFor({
        state: 'hidden',
        timeout: 10000,
      });
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
