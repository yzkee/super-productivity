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
  await typeSelect.click();
  const clickCounterOption = client.page.locator('mat-option:has-text("Click Counter")');
  await clickCounterOption.waitFor({ state: 'visible', timeout: 5000 });
  await clickCounterOption.click();

  await dialog.locator('button[type="submit"]').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });

  await client.page.goto('/#/tag/TODAY/tasks');
  await client.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
};

const getNamedClickCounter = async (
  client: SimulatedE2EClient,
  title: string,
): Promise<ReturnType<typeof client.page.locator>> => {
  const counter = client.page
    .locator('.counters-action-group simple-counter-button')
    .last();
  await counter.waitFor({ state: 'visible', timeout: 15000 });

  // The button renders only the title's initial; the full title lives in a
  // matTooltip that does NOT open on Playwright's synthetic hover in headless
  // CI, so we can't identify by tooltip. This test only ever has one counter
  // per client at each interaction point (A imports after its only counter
  // interaction; B keeps local via USE_LOCAL and never adopts the backup's
  // counters), so the last button is unambiguous — sanity-check its rendered
  // initial matches the expected title instead of hovering for a tooltip.
  await expect(counter.locator('.habit-initial')).toHaveText(
    title.charAt(0).toUpperCase(),
  );
  return counter;
};

const expectClickCounterValue = async (
  client: SimulatedE2EClient,
  title: string,
  expectedValue: number,
): Promise<void> => {
  const counter = await getNamedClickCounter(client, title);
  await expect(counter.locator('.label')).toHaveText(String(expectedValue));
};

const incrementClickCounter = async (
  client: SimulatedE2EClient,
  title: string,
  expectedValue: number,
): Promise<void> => {
  const counter = await getNamedClickCounter(client, title);
  await counter.locator('.main-btn').click();
  await expect(counter.locator('.label')).toHaveText(String(expectedValue));
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
      await incrementClickCounter(clientA, counterTitle, 1);
      await clientA.sync.syncAndWait();
      console.log('[Gate] Client A created + synced a simple counter');

      // ===== PHASE 2: B joins, receives the counter (now non-fresh) =====
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync(syncConfig);
      await clientB.sync.syncAndWait();
      await clientB.page.goto('/#/tag/TODAY/tasks');
      await clientB.page.waitForLoadState('networkidle');
      await expectClickCounterValue(clientB, counterTitle, 1);
      console.log('[Gate] Client B synced and received the counter');

      // ===== PHASE 3: B makes a pending NON-task change (does NOT sync) =====
      await incrementClickCounter(clientB, counterTitle, 2);
      console.log('[Gate] Client B incremented the counter locally (pending, unsynced)');

      // ===== PHASE 4: A imports a backup (SYNC_IMPORT) and syncs it =====
      // A already synced a populated state (PHASE 1), so the import diverges from
      // the server: A's own sync raises the sync-import conflict gate against its
      // pending import op. Resolve it as USE_LOCAL ({ useLocal: true }) so A force
      // uploads the import as a NEW SYNC_IMPORT the server keeps. The default
      // (USE_REMOTE) would discard A's import here, leaving the server unchanged
      // and B with nothing to conflict against — so the PHASE 5 dialog never shows.
      const importPageA = new ImportPage(clientA.page);
      await importPageA.navigateToImportPage();
      await importPageA.importBackupFile(ImportPage.getFixturePath('test-backup.json'));
      await clientA.sync.syncAndWait({ useLocal: true });
      console.log('[Gate] Client A imported a backup and synced the SYNC_IMPORT');

      // ===== PHASE 5: B syncs — the conflict dialog MUST appear =====
      // triggerSync() does NOT auto-resolve dialogs, so we can assert on it.
      const clientBSync = clientB.sync.triggerSync();
      // Prevent a teardown-triggered page close from becoming an unhandled
      // rejection if an assertion below fails before we can await the sync.
      clientBSync.catch(() => {});

      await expect(clientB.sync.syncImportConflictDialog).toBeVisible({ timeout: 30000 });
      console.log('[Gate] ✓ Conflict dialog shown for pending non-task work');

      // Resolving with "Use My Data" keeps B's local work; the point of the test
      // is that B was given the choice at all.
      await clientB.sync.syncImportUseLocalBtn.click();
      await clientB.sync.syncImportConflictDialog.waitFor({
        state: 'hidden',
        timeout: 10000,
      });
      await clientBSync;

      // The dialog itself is not the guarantee: prove the exact pending counter
      // value won, then run another sync and prove it remains durable.
      await clientB.page.goto('/#/tag/TODAY/tasks');
      await clientB.page.waitForURL(/(active\/tasks|tag\/TODAY\/tasks)/);
      await expectClickCounterValue(clientB, counterTitle, 2);

      await clientB.sync.syncAndWait();
      await expectClickCounterValue(clientB, counterTitle, 2);
      console.log('[Gate] ✓ Pending counter value survived resolution and re-sync');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
