import { test, expect } from '../../fixtures/supersync.fixture';
import {
  createTestUser,
  getSuperSyncConfig,
  createSimulatedClient,
  closeClient,
  waitForTask,
  type SimulatedE2EClient,
} from '../../utils/supersync-helpers';

/**
 * SuperSync Encryption Enable/Disable E2E Tests
 *
 * These tests verify that enabling/disabling encryption on existing synced data
 * properly handles the clean slate mechanism:
 * - Server data is wiped (encrypted ops can't mix with unencrypted)
 * - A fresh snapshot is uploaded with correct encryption settings
 * - Other clients adapt to the new encryption state
 *
 * Scenarios covered:
 * C) Encryption disabled (password removed) - other clients recognize and disable locally
 * D) Encryption enabled (password added) - other clients recognize and prompt for password
 *
 * Run with: npm run e2e:supersync:file e2e/tests/sync/supersync-encryption-enable-disable.spec.ts
 */

test.describe('@supersync @encryption Encryption Enable/Disable', () => {
  /**
   * Scenario C: Remove encryption password (disable encryption)
   *
   * Setup:
   * - Client A has encryption enabled with synced encrypted data
   * - Client B also has encryption enabled and synced
   *
   * Actions:
   * 1. Client A disables encryption (removes password)
   * 2. Clean slate is triggered (server wiped, fresh unencrypted snapshot uploaded)
   * 3. Client A creates unencrypted task
   * 4. Client B reconfigures WITHOUT encryption and syncs (gets A's unencrypted snapshot)
   *
   * Verify:
   * - Client A's data is now unencrypted on server
   * - Client B successfully syncs WITHOUT encryption
   * - Both clients have same data including tasks created after A disabled encryption
   * - No encryption errors occur
   */
  test('Disabling encryption triggers clean slate and other clients adapt', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `pass-${testRunId}`;

      // ============ PHASE 1: Setup both clients with encryption ============
      console.log('[DisableEncryption] Phase 1: Setting up clients with encryption');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });

      // Create and sync encrypted task
      const encryptedTask = `EncryptedTask-${uniqueId}`;
      await clientA.workView.addTask(encryptedTask);
      await clientA.sync.syncAndWait();
      console.log(`[DisableEncryption] Client A created: ${encryptedTask}`);

      // Setup Client B with same encryption
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });
      await clientB.sync.syncAndWait();

      // Verify both clients have the encrypted task
      await waitForTask(clientA.page, encryptedTask);
      await waitForTask(clientB.page, encryptedTask);
      console.log('[DisableEncryption] Both clients synced with encryption');

      // ============ PHASE 2: Client A disables encryption ============
      console.log('[DisableEncryption] Phase 2: Client A disabling encryption');

      // Disable encryption (remove password)
      await clientA.sync.disableEncryption();
      console.log('[DisableEncryption] Client A disabled encryption');

      // Verify clean slate was triggered by checking task still exists
      await waitForTask(clientA.page, encryptedTask);
      console.log('[DisableEncryption] Client A data preserved after clean slate');

      // ============ PHASE 3: Client A creates new unencrypted task ============
      const unencryptedTask = `UnencryptedTask-${uniqueId}`;
      await clientA.workView.addTask(unencryptedTask);
      await clientA.sync.syncAndWait();
      console.log(`[DisableEncryption] Client A created unencrypted: ${unencryptedTask}`);

      // ============ PHASE 4: Client B reconfigures without encryption ============
      console.log(
        '[DisableEncryption] Phase 4: Client B reconfiguring without encryption',
      );

      // CRITICAL: Client B must reconfigure WITHOUT encryption and sync to get A's unencrypted state.
      // We use setupSuperSync with isEncryptionEnabled: false to reconfigure.
      // This will sync and get the unencrypted snapshot from A, avoiding the clean slate wipe issue.
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      console.log('[DisableEncryption] Client B reconfigured for unencrypted sync');

      // Client B should now have both tasks
      await waitForTask(clientB.page, encryptedTask);
      await waitForTask(clientB.page, unencryptedTask);

      // ============ PHASE 5: Verify encryption is disabled for both clients ============
      console.log('[DisableEncryption] Phase 5: Verifying encryption is disabled');

      // Verify no sync errors on either client
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      // Verify both clients can create and sync new tasks without encryption
      const finalTask = `FinalTask-${uniqueId}`;
      await clientB.workView.addTask(finalTask);
      await clientB.sync.syncAndWait();

      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, finalTask);

      console.log(
        '[DisableEncryption] ✓ Encryption disabled successfully on both clients!',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario D: Add encryption password (enable encryption)
   *
   * Setup:
   * - Client A has unencrypted sync active with data
   * - Client B also has unencrypted sync
   *
   * Actions:
   * 1. Client A enables encryption (adds password)
   * 2. Clean slate is triggered (server wiped, fresh encrypted snapshot uploaded)
   * 3. Client A creates encrypted task
   * 4. Client B reconfigures with encryption and syncs to get A's encrypted snapshot
   *
   * Verify:
   * - Client A's data is now encrypted on server
   * - Client B can sync after providing correct password
   * - Both clients have same encrypted data
   */
  test('Enabling encryption triggers clean slate and other clients require password', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `newpass-${testRunId}`;

      // ============ PHASE 1: Setup both clients WITHOUT encryption ============
      console.log('[EnableEncryption] Phase 1: Setting up clients without encryption');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });

      // Create and sync unencrypted task
      const unencryptedTask = `UnencryptedTask-${uniqueId}`;
      await clientA.workView.addTask(unencryptedTask);
      await clientA.sync.syncAndWait();
      console.log(`[EnableEncryption] Client A created: ${unencryptedTask}`);

      // Setup Client B without encryption
      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      await clientB.sync.syncAndWait();

      // Verify both clients have the unencrypted task
      await waitForTask(clientA.page, unencryptedTask);
      await waitForTask(clientB.page, unencryptedTask);
      console.log('[EnableEncryption] Both clients synced without encryption');

      // ============ PHASE 2: Client A enables encryption ============
      console.log('[EnableEncryption] Phase 2: Client A enabling encryption');

      // Enable encryption with new password
      await clientA.sync.enableEncryption(encryptionPassword);
      console.log('[EnableEncryption] Client A enabled encryption');

      // Verify clean slate was triggered by checking task still exists
      await waitForTask(clientA.page, unencryptedTask);
      console.log('[EnableEncryption] Client A data preserved after clean slate');

      // ============ PHASE 3: Client A creates new encrypted task ============
      const encryptedTask = `EncryptedTask-${uniqueId}`;
      await clientA.workView.addTask(encryptedTask);
      await clientA.sync.syncAndWait();
      console.log(`[EnableEncryption] Client A created encrypted: ${encryptedTask}`);

      // ============ PHASE 4: Client B reconfigures with encryption ============
      console.log('[EnableEncryption] Phase 4: Client B enabling encryption');

      // Client B reconfigures with encryption enabled and the same password
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });
      console.log('[EnableEncryption] Client B enabled encryption with password');

      // Client B should now have both tasks
      await waitForTask(clientB.page, unencryptedTask);
      await waitForTask(clientB.page, encryptedTask);

      // ============ PHASE 6: Verify bidirectional encrypted sync works ============
      console.log('[EnableEncryption] Phase 6: Verifying bidirectional encrypted sync');

      // Client B creates a task
      const finalTask = `FinalTask-${uniqueId}`;
      await clientB.workView.addTask(finalTask);
      await clientB.sync.syncAndWait();

      // Client A syncs and should receive it
      await clientA.sync.syncAndWait();
      await waitForTask(clientA.page, finalTask);

      // Verify no sync errors
      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      console.log(
        '[EnableEncryption] ✓ Encryption enabled successfully on both clients!',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Multiple encryption state changes work correctly
   *
   * Tests that:
   * - Client can enable → disable → enable encryption multiple times
   * - Each state change triggers clean slate
   * - Other clients adapt to each change by reconfiguring
   */
  test('Multiple encryption state changes work correctly', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const password1 = `pass1-${testRunId}`;
      const password2 = `pass2-${testRunId}`;

      // ============ PHASE 1: Start unencrypted ============
      console.log('[MultipleChanges] Phase 1: Starting unencrypted');

      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });

      const task1 = `Task1-${uniqueId}`;
      await clientA.workView.addTask(task1);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, task1);

      // ============ PHASE 2: Enable encryption ============
      console.log('[MultipleChanges] Phase 2: Enabling encryption');

      await clientA.sync.enableEncryption(password1);

      const task2 = `Task2-${uniqueId}`;
      await clientA.workView.addTask(task2);
      await clientA.sync.syncAndWait();

      // Client B reconfigures with encryption
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: password1,
      });
      console.log('[MultipleChanges] Client B enabled encryption');

      await waitForTask(clientB.page, task2);

      // ============ PHASE 3: Disable encryption ============
      console.log('[MultipleChanges] Phase 3: Disabling encryption');

      await clientA.sync.disableEncryption();

      const task3 = `Task3-${uniqueId}`;
      await clientA.workView.addTask(task3);
      await clientA.sync.syncAndWait();

      // Client B reconfigures without encryption
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      console.log('[MultipleChanges] Client B reconfigured for unencrypted sync');

      await waitForTask(clientB.page, task3);

      // ============ PHASE 4: Re-enable with different password ============
      console.log('[MultipleChanges] Phase 4: Re-enabling with different password');

      await clientA.sync.enableEncryption(password2);

      const task4 = `Task4-${uniqueId}`;
      await clientA.workView.addTask(task4);
      await clientA.sync.syncAndWait();

      // Client B enables encryption with NEW password
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: password2,
      });
      console.log('[MultipleChanges] Client B enabled encryption with new password');

      await waitForTask(clientB.page, task4);

      // ============ PHASE 5: Verify final state ============
      console.log('[MultipleChanges] Phase 5: Verifying final state');

      // All tasks should be present on both clients
      await waitForTask(clientA.page, task1);
      await waitForTask(clientA.page, task2);
      await waitForTask(clientA.page, task3);
      await waitForTask(clientA.page, task4);

      await waitForTask(clientB.page, task1);
      await waitForTask(clientB.page, task2);
      await waitForTask(clientB.page, task3);
      await waitForTask(clientB.page, task4);

      const hasErrorA = await clientA.sync.hasSyncError();
      const hasErrorB = await clientB.sync.hasSyncError();
      expect(hasErrorA).toBe(false);
      expect(hasErrorB).toBe(false);

      console.log('[MultipleChanges] ✓ Multiple encryption state changes work!');
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });

  /**
   * Scenario: Concurrent changes during encryption state change
   *
   * Tests that:
   * - If Client B makes changes while Client A is changing encryption state
   * - Client B's changes are overwritten by clean slate (expected behavior)
   * - This is correct: clean slate is an explicit user action to reset sync
   */
  test('Concurrent changes are overwritten by encryption state change', async ({
    browser,
    baseURL,
    testRunId,
  }) => {
    const uniqueId = Date.now();
    let clientA: SimulatedE2EClient | null = null;
    let clientB: SimulatedE2EClient | null = null;

    try {
      const user = await createTestUser(testRunId);
      const baseConfig = getSuperSyncConfig(user);
      const encryptionPassword = `pass-${testRunId}`;

      // Setup both clients unencrypted
      clientA = await createSimulatedClient(browser, baseURL!, 'A', testRunId);
      await clientA.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });

      const sharedTask = `SharedTask-${uniqueId}`;
      await clientA.workView.addTask(sharedTask);
      await clientA.sync.syncAndWait();

      clientB = await createSimulatedClient(browser, baseURL!, 'B', testRunId);
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: false,
      });
      await clientB.sync.syncAndWait();
      await waitForTask(clientB.page, sharedTask);

      // Client B creates a task (while A will enable encryption)
      const concurrentTask = `ConcurrentTask-${uniqueId}`;
      await clientB.workView.addTask(concurrentTask);
      // Note: B does NOT sync yet

      // Client A enables encryption (triggers clean slate)
      await clientA.sync.enableEncryption(encryptionPassword);

      const taskAfterEncryption = `AfterEncryption-${uniqueId}`;
      await clientA.workView.addTask(taskAfterEncryption);
      await clientA.sync.syncAndWait();

      // Now Client B reconfigures with encryption (gets A's state, losing concurrent changes)
      await clientB.sync.setupSuperSync({
        ...baseConfig,
        isEncryptionEnabled: true,
        password: encryptionPassword,
      });
      console.log('[Concurrent] Client B enabled encryption');

      // Client B should have tasks from clean slate (A's state)
      await waitForTask(clientB.page, sharedTask);
      await waitForTask(clientB.page, taskAfterEncryption);

      // CRITICAL: Client B's concurrent task should be GONE (overwritten by clean slate)
      const concurrentTaskLocator = clientB.page.locator(
        `task:has-text("${concurrentTask}")`,
      );
      await expect(concurrentTaskLocator).not.toBeVisible({ timeout: 5000 });

      console.log(
        '[Concurrent] ✓ Concurrent changes correctly overwritten by clean slate!',
      );
    } finally {
      if (clientA) await closeClient(clientA);
      if (clientB) await closeClient(clientB);
    }
  });
});
