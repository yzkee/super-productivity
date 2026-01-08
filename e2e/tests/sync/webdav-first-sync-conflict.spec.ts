import { test, expect } from '../../fixtures/test.fixture';
import { SyncPage } from '../../pages/sync.page';
import { WorkViewPage } from '../../pages/work-view.page';
import { waitForStatePersistence } from '../../utils/waits';
import { isWebDavServerUp } from '../../utils/check-webdav';
import {
  WEBDAV_CONFIG_TEMPLATE,
  setupSyncClient,
  createSyncFolder,
  waitForSyncComplete,
  generateSyncFolderName,
  dismissTourIfVisible,
} from '../../utils/sync-helpers';
import { waitForAppReady } from '../../utils/waits';

/**
 * Tests for first sync conflict when both clients have existing data.
 *
 * Scenario:
 * 1. Client A has data, sets up WebDAV sync → uploads data
 * 2. Client B has DIFFERENT data, sets up WebDAV sync to same folder
 * 3. Expected: Conflict dialog with "Use Local" vs "Use Remote" options
 */
test.describe('WebDAV First Sync Conflict', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    const isUp = await isWebDavServerUp(WEBDAV_CONFIG_TEMPLATE.baseUrl);
    if (!isUp) {
      test.skip(true, 'WebDAV server not reachable');
    }
  });

  test('should show conflict dialog and allow USE_LOCAL to upload local data', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-first-conflict-local');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create task and upload ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);

    // Capture console logs from Client A for debugging
    pageA.on('console', (msg) => {
      if (msg.text().includes('DEBUG')) {
        console.log(`[Client A Console] ${msg.text()}`);
      }
    });

    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    // Setup sync and create task
    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    const taskA = 'Task from Client A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);

    // Upload to remote
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded task');

    // --- Client B: Create local task BEFORE setting up sync ---
    // IMPORTANT: Do NOT use setupSyncClient - we need to NOT auto-accept dialogs
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();

    // Capture console logs from Client B for debugging
    pageB.on('console', (msg) => {
      if (msg.text().includes('DEBUG') || msg.text().includes('Marked')) {
        console.log(`[Client B Console] ${msg.text()}`);
      }
    });

    // Don't add dialog handler here - we want the conflict dialog to appear

    await pageB.goto('/');
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    // Create a local task BEFORE setting up sync
    const taskB = 'Task from Client B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    // Now setup sync - this triggers auto-sync which should show conflict dialog
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Test] Client B set up sync, waiting for conflict dialog...');

    // Wait for conflict dialog to appear (auto-sync triggers after save)
    // The dialog contains "Sync: Conflicting Data" title and "Keep local"/"Keep remote" buttons
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] Conflict dialog appeared on Client B');

    // Click "Keep local" button
    const useLocalBtn = conflictDialog.locator('button', { hasText: /Keep local/i });
    await expect(useLocalBtn).toBeVisible();
    await useLocalBtn.click();
    console.log('[Test] Clicked Use Local on Client B');

    // Handle potential confirmation dialog (for overwrites with many changes)
    const confirmDialog = pageB.locator('dialog-confirm');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
      // Click the confirm/OK button
      await confirmDialog
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear - that's fine
    }

    // Wait for sync to complete
    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Sync completed on Client B');

    // Verify Client B still has its local task
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible({
      timeout: 5000,
    });
    // Client A's task should NOT be visible (we chose USE_LOCAL, which replaced remote)
    await expect(pageB.locator('task', { hasText: taskA })).not.toBeVisible();
    console.log('[Test] Verified Client B has local task, not remote task');

    // --- Verify Client A now gets Client B's data ---
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A synced');

    // Client A should now have Client B's task (remote was replaced by B's local data)
    await expect(pageA.locator('task', { hasText: taskB })).toBeVisible({
      timeout: 5000,
    });
    // Client A's original task is gone (replaced by B's upload)
    await expect(pageA.locator('task', { hasText: taskA })).not.toBeVisible();
    console.log('[Test] Verified Client A received Client B data');

    await contextA.close();
    await contextB.close();
  });

  test('should show conflict dialog and allow USE_REMOTE to download remote data', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-first-conflict-remote');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create task and upload ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    const taskA = 'Task from Client A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded task');

    // --- Client B: Create local task, then connect ---
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();

    await pageB.goto('/');
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    const taskB = 'Task from Client B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Test] Client B set up sync, waiting for conflict dialog...');

    // Wait for conflict dialog (auto-sync triggers after save)
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] Conflict dialog appeared');

    // Click "Keep remote" button
    const useRemoteBtn = conflictDialog.locator('button', { hasText: /Keep remote/i });
    await expect(useRemoteBtn).toBeVisible();
    await useRemoteBtn.click();
    console.log('[Test] Clicked Use Remote');

    // Handle potential confirmation dialog
    const confirmDialog = pageB.locator('dialog-confirm');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
      await confirmDialog
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear
    }

    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Sync completed');

    // Verify Client B now has remote data (Client A's task)
    await expect(pageB.locator('task', { hasText: taskA })).toBeVisible({
      timeout: 5000,
    });
    // Client B's local task should be gone
    await expect(pageB.locator('task', { hasText: taskB })).not.toBeVisible();
    console.log('[Test] Verified Client B has remote task, not local task');

    await contextA.close();
    await contextB.close();
  });

  /**
   * Regression test for: Repeated conflict dialog after USE_LOCAL resolution
   *
   * Bug: After resolving first sync conflict with "Keep local", every subsequent
   * change would trigger the conflict dialog again.
   *
   * Root cause: After snapshot upload, serverSeq was incorrectly set to 0 instead
   * of syncVersion (1). This caused the next download to use sinceSeq=0, which
   * returned snapshotState, triggering LocalDataConflictError.
   *
   * Fix: file-based-sync-adapter.service.ts now returns serverSeq: newSyncVersion
   * after snapshot upload.
   */
  test('should NOT show conflict dialog on subsequent changes after USE_LOCAL resolution', async ({
    browser,
    baseURL,
    request,
  }) => {
    test.slow();
    const SYNC_FOLDER_NAME = generateSyncFolderName('e2e-no-repeat-conflict');
    await createSyncFolder(request, SYNC_FOLDER_NAME);
    const WEBDAV_CONFIG = {
      ...WEBDAV_CONFIG_TEMPLATE,
      syncFolderPath: `/${SYNC_FOLDER_NAME}`,
    };
    const url = baseURL || 'http://localhost:4242';

    // --- Client A: Create task and upload ---
    const { context: contextA, page: pageA } = await setupSyncClient(browser, url);
    const syncPageA = new SyncPage(pageA);
    const workViewPageA = new WorkViewPage(pageA);
    await workViewPageA.waitForTaskList();

    await syncPageA.setupWebdavSync(WEBDAV_CONFIG);
    const taskA = 'Initial Task from A - ' + Date.now();
    await workViewPageA.addTask(taskA);
    await waitForStatePersistence(pageA);
    await syncPageA.triggerSync();
    await waitForSyncComplete(pageA, syncPageA);
    console.log('[Test] Client A uploaded initial task');

    // --- Client B: Create local task, connect, and resolve conflict ---
    const contextB = await browser.newContext({ baseURL: url });
    const pageB = await contextB.newPage();

    await pageB.goto('/');
    await waitForAppReady(pageB);
    await dismissTourIfVisible(pageB);

    const syncPageB = new SyncPage(pageB);
    const workViewPageB = new WorkViewPage(pageB);
    await workViewPageB.waitForTaskList();

    const taskB = 'Local Task from B - ' + Date.now();
    await workViewPageB.addTask(taskB);
    await waitForStatePersistence(pageB);
    console.log('[Test] Client B created local task');

    // Setup sync - triggers conflict
    await syncPageB.setupWebdavSync(WEBDAV_CONFIG);
    console.log('[Test] Client B set up sync, waiting for conflict dialog...');

    // Wait for conflict dialog and resolve with USE_LOCAL
    const conflictDialog = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });
    await expect(conflictDialog).toBeVisible({ timeout: 30000 });
    console.log('[Test] First conflict dialog appeared');

    const useLocalBtn = conflictDialog.locator('button', { hasText: /Keep local/i });
    await useLocalBtn.click();
    console.log('[Test] Clicked Use Local');

    // Handle potential confirmation dialog
    const confirmDialog = pageB.locator('dialog-confirm');
    try {
      await confirmDialog.waitFor({ state: 'visible', timeout: 3000 });
      await confirmDialog
        .locator('button[color="warn"], button:has-text("OK")')
        .first()
        .click();
    } catch {
      // Confirmation might not appear
    }

    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] First sync completed after conflict resolution');

    // Verify Client B has its local task
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible();
    console.log('[Test] Verified local task is present');

    // --- KEY TEST: Create ANOTHER task and sync ---
    // This is where the bug manifested: every change would trigger conflict dialog again
    const taskB2 = 'Second Task from B - ' + Date.now();
    await workViewPageB.addTask(taskB2);
    await waitForStatePersistence(pageB);
    console.log('[Test] Created second task');

    // Trigger sync - should NOT show conflict dialog
    await syncPageB.triggerSync();

    // Wait a moment for potential conflict dialog (should NOT appear)
    const conflictDialogSecond = pageB.locator('mat-dialog-container', {
      hasText: 'Conflicting Data',
    });

    // Give it a short window to potentially appear (it shouldn't)
    await pageB.waitForTimeout(2000);

    // Verify conflict dialog did NOT appear
    const isConflictVisible = await conflictDialogSecond.isVisible();
    expect(isConflictVisible).toBe(false);
    console.log('[Test] Verified NO conflict dialog on second sync');

    // Wait for sync to complete normally
    await waitForSyncComplete(pageB, syncPageB, 30000);
    console.log('[Test] Second sync completed without conflict');

    // Verify both tasks are present on Client B
    await expect(pageB.locator('task', { hasText: taskB })).toBeVisible();
    await expect(pageB.locator('task', { hasText: taskB2 })).toBeVisible();
    console.log('[Test] Verified both tasks are present on Client B');

    // Note: We don't verify Client A receives the data here because that's
    // testing sync propagation, not the conflict dialog regression.
    // The key assertion is that NO conflict dialog appeared on the second sync.

    await contextA.close();
    await contextB.close();
  });
});
