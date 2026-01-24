import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';
import { expectTaskVisible } from '../../utils/supersync-assertions';

/**
 * SuperSync Clean Slate Mechanism E2E Tests
 *
 * Verifies the clean slate mechanism used for encryption password changes:
 * - Server operations are deleted when clean slate is requested
 * - New client ID is generated
 * - Fresh SYNC_IMPORT operation is created
 * - Clean slate prevents mixing of encrypted/unencrypted data
 *
 * Run with E2E_VERBOSE=1 to see browser console logs for debugging.
 */

test.describe('@supersync SuperSync Clean Slate Mechanism', () => {
  test('Clean slate generates new client ID', async ({ browser, baseURL, testRunId }) => {
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      // Setup with initial password
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      // Get original client ID (stored in IndexedDB)
      const originalClientId = await clientA.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('pf', 1);
        return db.get('main', '__client_id_');
      });

      // Verify original client ID exists
      expect(originalClientId).toBeTruthy();
      expect(typeof originalClientId).toBe('string');

      // Create a task and sync
      const taskName = `BeforeCleanSlate-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Change password (triggers clean slate)
      await clientA.sync.changeEncryptionPassword(newPassword);

      // Get new client ID after clean slate
      const newClientId = await clientA.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('pf', 1);
        return db.get('main', '__client_id_');
      });

      // Verify new client ID is different
      expect(newClientId).toBeTruthy();
      expect(typeof newClientId).toBe('string');
      expect(newClientId).not.toBe(originalClientId);

      // Verify task still exists (clean slate preserves data)
      await expectTaskVisible(clientA, taskName);
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });

  test('Clean slate clears local operation log', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      // Setup
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      // Create multiple tasks (generates multiple operations)
      await clientA.workView.addTask(`Task1-${testRunId}`);
      await clientA.page.waitForTimeout(50);
      await clientA.workView.addTask(`Task2-${testRunId}`);
      await clientA.page.waitForTimeout(50);
      await clientA.workView.addTask(`Task3-${testRunId}`);

      // Sync
      await clientA.sync.syncAndWait();

      // Get operation count before clean slate
      const opsBeforeCleanSlate = await clientA.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('SUP_OPS', 1);
        const tx = db.transaction('ops', 'readonly');
        const count = await tx.store.count();
        return count;
      });

      // Should have multiple operations
      expect(opsBeforeCleanSlate).toBeGreaterThan(3);

      // Change password (triggers clean slate)
      await clientA.sync.changeEncryptionPassword(newPassword);

      // Wait a bit for clean slate to complete
      await clientA.page.waitForTimeout(500);

      // Get operation count after clean slate
      const opsAfterCleanSlate = await clientA.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('SUP_OPS', 1);
        const tx = db.transaction('ops', 'readonly');
        const count = await tx.store.count();
        return count;
      });

      // Should have only 1 operation (the SYNC_IMPORT)
      expect(opsAfterCleanSlate).toBe(1);

      // Verify the single operation is a SYNC_IMPORT
      const syncImportOp = await clientA.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('SUP_OPS', 1);
        const tx = db.transaction('ops', 'readonly');
        const ops = await tx.store.getAll();
        return ops.length > 0 ? ops[0] : null;
      });

      expect(syncImportOp).toBeTruthy();
      expect(syncImportOp?.op?.opType).toBe('SYNC_IMPORT');

      // Verify tasks still exist
      await expectTaskVisible(clientA, `Task1-${testRunId}`);
      await expectTaskVisible(clientA, `Task2-${testRunId}`);
      await expectTaskVisible(clientA, `Task3-${testRunId}`);
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });

  test('Clean slate allows clean re-sync for new client', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const oldPassword = `oldpass-${testRunId}`;
      const newPassword = `newpass-${testRunId}`;

      // Client A: Setup and create data
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: oldPassword,
      });

      const taskName = `CleanSlateTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Change password (clean slate)
      await clientA.sync.changeEncryptionPassword(newPassword);

      // Client B: Setup with NEW password
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: newPassword,
      });

      // Sync should succeed
      await clientB.sync.syncAndWait();

      // Verify Client B received the task
      await waitForTask(clientB.page, taskName);
      await expectTaskVisible(clientB, taskName);

      // Verify Client B only has 1 operation (the SYNC_IMPORT it received)
      const clientBOps = await clientB.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('SUP_OPS', 1);
        const tx = db.transaction('ops', 'readonly');
        return tx.store.count();
      });

      // Client B should have minimal operations (just the SYNC_IMPORT + maybe a few local ops)
      expect(clientBOps).toBeLessThanOrEqual(5);
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  test('Clean slate with no encryption works correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    let clientA: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);

      // Setup WITHOUT encryption initially
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });

      // Create task
      const taskName = `UnencryptedTask-${testRunId}`;
      await clientA.workView.addTask(taskName);
      await clientA.sync.syncAndWait();

      // Get client ID before enabling encryption
      const clientIdBefore = await clientA.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('pf', 1);
        return db.get('main', '__client_id_');
      });

      // Enable encryption (this should trigger clean slate)
      const newPassword = `newpass-${testRunId}`;
      await clientA.sync.changeEncryptionPassword(newPassword);

      // Get client ID after enabling encryption
      const clientIdAfter = await clientA.page.evaluate(async () => {
        const { openDB } = await import('idb');
        const db = await openDB('pf', 1);
        return db.get('main', '__client_id_');
      });

      // Client ID should be different (clean slate generates new ID)
      expect(clientIdAfter).not.toBe(clientIdBefore);

      // Task should still exist
      await expectTaskVisible(clientA, taskName);

      // Verify sync still works
      await clientA.sync.syncAndWait();
      await expectTaskVisible(clientA, taskName);
    } finally {
      if (clientA) await closeClient(clientA);
    }
  });
});
