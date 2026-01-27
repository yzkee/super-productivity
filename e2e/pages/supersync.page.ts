import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export interface SuperSyncConfig {
  baseUrl: string;
  accessToken: string;
  isEncryptionEnabled?: boolean;
  password?: string;
  /**
   * If true (default), waits for the automatic initial sync to complete
   * and handles dialogs. Set to false when you want to manually handle
   * dialogs (e.g., to test specific dialog behaviors like wrong password errors).
   */
  waitForInitialSync?: boolean;
}

/**
 * Page object for SuperSync configuration and sync operations.
 * Used for E2E tests that verify multi-client sync via the super-sync-server.
 */
export class SuperSyncPage extends BasePage {
  readonly syncBtn: Locator;
  readonly providerSelect: Locator;
  readonly baseUrlInput: Locator;
  readonly accessTokenInput: Locator;
  readonly enableEncryptionBtn: Locator;
  readonly disableEncryptionBtn: Locator;
  readonly encryptionPasswordInput: Locator;
  readonly saveBtn: Locator;
  readonly syncSpinner: Locator;
  readonly syncCheckIcon: Locator;
  readonly syncErrorIcon: Locator;
  /** Fresh client confirmation dialog - appears when a new client first syncs */
  readonly freshClientDialog: Locator;
  readonly freshClientConfirmBtn: Locator;
  /** Conflict resolution dialog - appears when local and remote have conflicting changes */
  readonly conflictDialog: Locator;
  readonly conflictUseRemoteBtn: Locator;
  readonly conflictApplyBtn: Locator;
  /** Sync import conflict dialog - appears when SYNC_IMPORT filters remote ops */
  readonly syncImportConflictDialog: Locator;
  readonly syncImportUseLocalBtn: Locator;
  readonly syncImportUseRemoteBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.syncBtn = page.locator('button.sync-btn');
    this.providerSelect = page.locator('formly-field-mat-select mat-select');
    this.baseUrlInput = page.locator('.e2e-baseUrl input');
    this.accessTokenInput = page.locator('.e2e-accessToken textarea');
    this.enableEncryptionBtn = page.locator('.e2e-enable-encryption-btn button');
    this.disableEncryptionBtn = page.locator('.e2e-disable-encryption-btn button');
    this.encryptionPasswordInput = page.locator('.e2e-encryptKey input[type="password"]');
    this.saveBtn = page.locator('mat-dialog-actions button[mat-stroked-button]');
    this.syncSpinner = page.locator('.sync-btn mat-icon.spin');
    this.syncCheckIcon = page.locator('.sync-btn mat-icon.sync-state-ico');
    // Error state shows sync_problem icon (no special class, just the icon name)
    this.syncErrorIcon = page.locator('.sync-btn mat-icon:has-text("sync_problem")');
    // Fresh client confirmation dialog elements
    this.freshClientDialog = page.locator('dialog-confirm');
    this.freshClientConfirmBtn = page.locator(
      'dialog-confirm button[mat-stroked-button]',
    );
    // Conflict resolution dialog elements
    this.conflictDialog = page.locator('dialog-conflict-resolution');
    this.conflictUseRemoteBtn = page.locator(
      'dialog-conflict-resolution button:has-text("Use All Remote")',
    );
    this.conflictApplyBtn = page.locator(
      'dialog-conflict-resolution button:has-text("Apply")',
    );
    // Sync import conflict dialog elements
    this.syncImportConflictDialog = page.locator('dialog-sync-import-conflict');
    this.syncImportUseLocalBtn = page.locator(
      'dialog-sync-import-conflict button:has-text("Use My Data")',
    );
    this.syncImportUseRemoteBtn = page.locator(
      'dialog-sync-import-conflict button:has-text("Use Server Data")',
    );
  }

  /**
   * Click the provider dropdown and select "SuperSync" with retry logic.
   * Angular Material dropdowns can be flaky under load - the click may not register
   * or the dropdown may close immediately. This method retries up to 3 times.
   *
   * @private
   */
  private async selectSuperSyncProviderWithRetry(): Promise<void> {
    // Wait for Angular Material to fully initialize the select component
    // and for any animations to complete
    await this.page.waitForTimeout(300);

    // Ensure the provider select is visible and scrolled into view
    await this.providerSelect.scrollIntoViewIfNeeded();
    await this.providerSelect.waitFor({ state: 'visible', timeout: 5000 });

    const superSyncOption = this.page.locator('mat-option:has-text("SuperSync")');
    let dropdownOpened = false;

    for (let attempt = 0; attempt < 3 && !dropdownOpened; attempt++) {
      if (attempt > 0) {
        console.log(`[SuperSyncPage] Retrying dropdown click (attempt ${attempt + 1})`);
        // Wait between retries to let Angular settle
        await this.page.waitForTimeout(500);
      }

      // Ensure no animations are in progress before clicking
      await this.page
        .waitForFunction(
          () =>
            document.getAnimations().filter((a) => a.playState === 'running').length ===
            0,
          { timeout: 2000 },
        )
        .catch(() => {
          // Ignore timeout - proceed anyway if animations can't be detected
        });

      await this.providerSelect.click();
      // Wait for dropdown options to appear (Angular Material animation)
      // Increased timeout from 2s to 3s for slow environments
      dropdownOpened = await superSyncOption
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);
    }

    if (!dropdownOpened) {
      throw new Error('Failed to open provider dropdown after 3 attempts');
    }

    await superSyncOption.click();
  }

  /**
   * Configure SuperSync with server URL and access token.
   * Uses right-click to open settings dialog (works even when sync is already configured).
   *
   * @param config - SuperSync configuration (includes optional waitForInitialSync flag)
   */
  async setupSuperSync(config: SuperSyncConfig): Promise<void> {
    // Extract waitForInitialSync from config, defaulting to true
    const waitForInitialSync = config.waitForInitialSync ?? true;
    // Auto-accept native browser confirm dialogs (window.confirm used for fresh client sync confirmation)
    // Only handles 'confirm' dialogs to avoid conflicts with test handlers that may handle 'alert' dialogs
    // Use 'once' to prevent memory leak from registering multiple handlers on repeated calls
    this.page.once('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') {
        const message = dialog.message();
        // Validate this is the expected fresh client sync confirmation
        const expectedPatterns = [/fresh/i, /remote/i, /sync/i, /operations/i];
        const isExpectedDialog = expectedPatterns.some((pattern) =>
          pattern.test(message),
        );

        if (!isExpectedDialog) {
          console.warn(
            `[SuperSyncPage] Unexpected confirm dialog: "${message}". Accepting anyway...`,
          );
        }
        await dialog.accept();
      }
    });

    // CRITICAL: Ensure any leftover overlays from previous operations are closed
    // This prevents "backdrop intercepts pointer events" errors when clicking buttons
    await this.ensureOverlaysClosed();

    // Open sync settings via right-click (context menu)
    // This allows configuring sync even when already set up
    await this.syncBtn.click({ button: 'right' });

    // Wait for the provider select (indicates dialog is open)
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Select "SuperSync" from provider dropdown with retry logic
    await this.selectSuperSyncProviderWithRetry();
    await this.page.waitForTimeout(500); // Wait for dropdown to close and form to update

    // IMPORTANT: The baseUrl field is now inside the "Advanced Config" collapsible section.
    // We need to expand it first to access the field.
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

    // Check if already expanded (baseUrl input is visible)
    const isExpanded = await this.baseUrlInput.isVisible().catch(() => false);
    if (!isExpanded) {
      await advancedCollapsible.click();
      await this.baseUrlInput.waitFor({ state: 'visible', timeout: 3000 });
    }

    // Fill in base URL
    await this.baseUrlInput.fill(config.baseUrl);

    // Fill in access token (this field is NOT in the Advanced section)
    await this.accessTokenInput.fill(config.accessToken);

    // Track if encryption settings were changed (requires fresh sync)
    let encryptionSettingsChanged = false;

    // Handle encryption settings if provided
    if (config.isEncryptionEnabled !== undefined) {
      const isCurrentlyEnabled = await this.disableEncryptionBtn
        .isVisible()
        .catch(() => false);
      if (config.isEncryptionEnabled !== isCurrentlyEnabled) {
        encryptionSettingsChanged = true;
        if (config.isEncryptionEnabled) {
          if (!config.password) {
            throw new Error('Encryption password required to enable encryption');
          }
          await this.encryptionPasswordInput.waitFor({
            state: 'visible',
            timeout: 3000,
          });
          await this.encryptionPasswordInput.fill(config.password);
          await this.enableEncryptionBtn.waitFor({ state: 'visible', timeout: 3000 });
          await this.enableEncryptionBtn.click();

          // Wait for "Enable Encryption?" confirmation dialog
          const enableDialog = this.page
            .locator('mat-dialog-container')
            .filter({ hasText: 'Enable Encryption?' });
          const dialogAppeared = await enableDialog
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);

          if (dialogAppeared) {
            // Click the confirm button to enable encryption
            const confirmBtn = enableDialog
              .locator('button[mat-flat-button]')
              .filter({ hasText: /enable encryption/i });
            await confirmBtn.click();

            // Wait for the enable encryption dialog to close
            await enableDialog.waitFor({ state: 'hidden', timeout: 60000 });

            // Wait for clean slate operation to complete (server wipe + fresh upload)
            await this.page.waitForTimeout(3000);
          }
        } else {
          await this.disableEncryptionBtn.waitFor({ state: 'visible', timeout: 3000 });
          await this.disableEncryptionBtn.click();

          // Wait for "Disable Encryption?" confirmation dialog
          const disableDialog = this.page
            .locator('mat-dialog-container')
            .filter({ hasText: 'Disable Encryption?' });
          const dialogAppeared = await disableDialog
            .waitFor({ state: 'visible', timeout: 5000 })
            .then(() => true)
            .catch(() => false);

          if (dialogAppeared) {
            // Click the confirm button to disable encryption
            const confirmBtn = disableDialog
              .locator('button[mat-flat-button]')
              .filter({ hasText: /disable encryption/i });
            await confirmBtn.click();

            // Wait for the disable encryption dialog to close
            await disableDialog.waitFor({ state: 'hidden', timeout: 60000 });

            // Wait for clean slate operation to complete (server wipe + fresh upload)
            await this.page.waitForTimeout(3000);
          }
        }
      }
    }

    // Save configuration - but the form might already be closed after disabling encryption
    const hasConfigDialog = (await this.page.locator('mat-dialog-container').count()) > 0;
    if (hasConfigDialog) {
      await expect(this.saveBtn).toBeEnabled({ timeout: 5000 });
      await this.saveBtn.click();
    }

    // Wait for the dialog to close
    // Skip this check if waitForInitialSync is false, as the sync might trigger
    // an error dialog (e.g., decrypt error with wrong password)
    if (waitForInitialSync) {
      await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
        timeout: 10000,
      });
    } else {
      // When waitForInitialSync is false, we expect sync to start and potentially show
      // an error dialog (e.g., decrypt error with wrong password). We need to ensure:
      // 1. The config dialog save action has been processed
      // 2. Sync has started (which may trigger error dialogs)
      // 3. We don't close error dialogs - tests want to interact with them
      //
      // Wait for any of these signals that indicate the config dialog has closed:
      // - Sync spinner appears (sync started)
      // - Sync error icon appears (sync failed immediately)
      // - A different dialog appears (like decrypt error dialog)
      // - Timeout fallback (sync might complete very quickly)
      const syncStartedOrFailed = Promise.race([
        this.syncSpinner
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => 'timeout'),
        this.syncErrorIcon
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => 'timeout'),
        this.page
          .locator('dialog-handle-decrypt-error')
          .waitFor({ state: 'visible', timeout: 5000 })
          .catch(() => 'timeout'),
        this.page.waitForTimeout(2000).then(() => 'timeout'),
      ]);
      await syncStartedOrFailed;
      // NOTE: Do NOT call ensureOverlaysClosed() here - if there's a dialog (like
      // decrypt error), we want it to stay open for the test to interact with.
    }

    if (waitForInitialSync) {
      // If encryption settings changed, we MUST wait for a fresh sync (clean slate operation)
      // Don't skip even if check icon is visible from previous sync
      if (encryptionSettingsChanged) {
        // Trigger a manual sync to ensure we get latest data after encryption change
        await this.page.waitForTimeout(500); // Wait for UI to settle
        // Ensure any lingering overlays from encryption dialogs are closed
        await this.ensureOverlaysClosed();
        await this.syncBtn.click();

        // Wait for sync to start
        const spinnerAppeared = await this.syncSpinner
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        if (spinnerAppeared) {
          // Wait for sync to complete
          await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
        }

        // Wait for check icon
        await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
      } else {
        // Check if sync already completed
        const checkAlreadyVisible = await this.syncCheckIcon
          .isVisible()
          .catch(() => false);

        if (!checkAlreadyVisible) {
          // Wait for sync to start or complete
          // Try to wait for spinner first, but if it's already gone, that's fine
          const spinnerAppeared = await this.syncSpinner
            .waitFor({ state: 'visible', timeout: 2000 })
            .then(() => true)
            .catch(() => false);

          if (spinnerAppeared) {
            // Spinner appeared, wait for it to disappear
            // Increased timeout from 15s to 30s for multi-client scenarios under load
            await this.syncSpinner.waitFor({ state: 'hidden', timeout: 30000 });
          }

          // Now wait for check icon to appear
          await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 5000 });
        }
      }
    }
  }

  /**
   * Enable encryption by reconfiguring the SuperSync provider.
   * This will trigger a clean slate operation (server wipe + fresh encrypted upload).
   *
   * Prerequisites: SuperSync must already be configured without encryption
   */
  async enableEncryption(password: string): Promise<void> {
    // Open sync settings via right-click
    await this.syncBtn.click({ button: 'right' });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // CRITICAL: Select "SuperSync" from provider dropdown to load current configuration
    // Without this, the form shows default/empty values instead of the actual current state
    await this.selectSuperSyncProviderWithRetry();

    // IMPORTANT: Wait for the provider change listener to complete loading the config
    // The listener is async and needs time to load provider config and update the form
    await this.page.waitForTimeout(1000);

    // Expand "Advanced settings" collapsible to access encryption fields
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

    // Check if already expanded
    const isExpanded = await this.enableEncryptionBtn.isVisible().catch(() => false);
    if (!isExpanded) {
      await advancedCollapsible.click();
      await this.enableEncryptionBtn.waitFor({ state: 'visible', timeout: 3000 });
    }

    // Check if already enabled
    const isEnabled = await this.disableEncryptionBtn.isVisible().catch(() => false);
    if (isEnabled) {
      // Already enabled - just close the dialog
      const configDialog = this.page.locator('mat-dialog-container').first();
      const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
      await cancelBtn.click();
      await this.page.waitForTimeout(500);
      return;
    }

    // Enable encryption via explicit action
    await this.encryptionPasswordInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.encryptionPasswordInput.fill(password);
    await this.enableEncryptionBtn.waitFor({ state: 'visible', timeout: 5000 });
    await this.enableEncryptionBtn.click();

    // Wait for any confirmation dialogs that might appear
    const enableDialog = this.page
      .locator('mat-dialog-container')
      .filter({ hasText: 'Enable Encryption?' });
    const enableDialogAppeared = await enableDialog
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (enableDialogAppeared) {
      // Click the confirm button (mat-flat-button with "Enable Encryption" text)
      const confirmBtn = enableDialog
        .locator('button[mat-flat-button]')
        .filter({ hasText: /enable/i });
      await confirmBtn.click();

      // Wait for the enable encryption dialog to close
      await enableDialog.waitFor({ state: 'hidden', timeout: 60000 });
    }

    await this.page.waitForTimeout(500);

    // Close the "Configure Sync" dialog
    const configDialog = this.page.locator('mat-dialog-container').first();
    const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
    await cancelBtn.click();

    // Wait for dialog to close
    await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });

    // CRITICAL: Wait for overlay backdrop to be removed
    // Angular Material backdrop removal is asynchronous, and lingering backdrops
    // can block subsequent button clicks in tests
    const backdrop = this.page.locator('.cdk-overlay-backdrop');
    await backdrop
      .first()
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {
        // Non-fatal: backdrop might already be gone
      });

    // Wait for any snackbars to dismiss
    await this.page.waitForTimeout(1000);

    // Wait for clean slate operation to complete (sync will happen automatically)
    await this.page.waitForTimeout(3000);
  }

  /**
   * Disable encryption by reconfiguring the SuperSync provider.
   * This will trigger a clean slate operation (server wipe + fresh unencrypted upload).
   *
   * Prerequisites: SuperSync must already be configured with encryption enabled
   */
  async disableEncryption(): Promise<void> {
    // Open sync settings via right-click
    await this.syncBtn.click({ button: 'right' });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // CRITICAL: Select "SuperSync" from provider dropdown to load current configuration
    // Without this, the form shows default/empty values instead of the actual current state
    await this.selectSuperSyncProviderWithRetry();

    // IMPORTANT: Wait for the provider change listener to complete loading the config
    // The listener is async and needs time to load provider config and update the form
    await this.page.waitForTimeout(1000);

    // Expand "Advanced settings" collapsible to access encryption fields
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

    // Check if already expanded
    const isExpanded = await this.disableEncryptionBtn.isVisible().catch(() => false);
    if (!isExpanded) {
      await advancedCollapsible.click();
      await this.disableEncryptionBtn.waitFor({ state: 'visible', timeout: 3000 });
    }

    // Check if already disabled
    const isEnabled = await this.disableEncryptionBtn.isVisible().catch(() => false);
    if (isEnabled) {
      await this.disableEncryptionBtn.click();

      // IMPORTANT: The "Disable Encryption?" confirmation dialog appears immediately
      // when the button is clicked, NOT after clicking Save.
      // We must handle this dialog BEFORE trying to click Save on the Configure Sync dialog.

      // Wait for confirmation dialog "Disable Encryption?"
      // Use a longer timeout since the dialog might take time to render
      const confirmDialog = this.page
        .locator('mat-dialog-container')
        .filter({ hasText: 'Disable Encryption?' });
      await confirmDialog.waitFor({ state: 'visible', timeout: 10000 });

      // Click the confirm button (mat-flat-button with "Disable Encryption" text)
      const confirmBtn = confirmDialog
        .locator('button[mat-flat-button]')
        .filter({ hasText: /disable encryption/i });
      await confirmBtn.click();

      // Wait for the disable encryption dialog to close and the operation to complete
      // This includes server wipe + fresh unencrypted upload - can take a while
      await confirmDialog.waitFor({ state: 'hidden', timeout: 60000 });
      await this.page.waitForTimeout(500);
    }

    // Now close the "Configure Sync" dialog
    // After disabling encryption, we just need to close the config dialog
    const configDialog = this.page.locator('mat-dialog-container').first();
    const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
    await cancelBtn.click();

    // Wait for dialog to close
    await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });

    // CRITICAL: Wait for overlay backdrop to be removed
    // Angular Material backdrop removal is asynchronous, and lingering backdrops
    // can block subsequent button clicks in tests (e.g., setupSuperSync called right after)
    const backdrop = this.page.locator('.cdk-overlay-backdrop');
    await backdrop
      .first()
      .waitFor({ state: 'detached', timeout: 3000 })
      .catch(() => {
        // Non-fatal: backdrop might already be gone
      });

    // Wait for any snackbars to dismiss
    await this.page.waitForTimeout(1000);

    // Wait for clean slate operation to complete (sync will happen automatically)
    await this.page.waitForTimeout(3000);
  }

  /**
   * Trigger a manual sync via the sync button and wait for it to complete.
   * Does not handle dialogs - use syncAndWait() for normal operation.
   *
   * @internal Use syncAndWait() instead for most cases
   */
  async triggerSync(): Promise<void> {
    await this.syncBtn.click();

    const spinnerAppeared = await this.syncSpinner
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (spinnerAppeared) {
      // Increased timeout from 15s to 30s for multi-client scenarios under load
      // Also check for error state to fail fast
      const result = await Promise.race([
        this.syncSpinner
          .waitFor({ state: 'hidden', timeout: 30000 })
          .then(() => 'hidden'),
        this.syncErrorIcon
          .waitFor({ state: 'visible', timeout: 30000 })
          .then(() => 'error'),
      ]);

      if (result === 'error') {
        throw new Error('Sync failed with error state during triggerSync()');
      }
    }

    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Wait for an ongoing sync operation to complete.
   * Useful when sync is triggered automatically (e.g., after data changes).
   *
   * @param options.timeout - Maximum time to wait (default: 15000ms)
   * @param options.skipSpinnerCheck - If true, only waits for check icon (useful when sync might already be in progress)
   */
  async waitForSyncToComplete(
    options: { timeout?: number; skipSpinnerCheck?: boolean } = {},
  ): Promise<void> {
    const { timeout = 15000, skipSpinnerCheck = false } = options;

    if (!skipSpinnerCheck) {
      // Wait for spinner to appear (sync started)
      await this.syncSpinner.waitFor({ state: 'visible', timeout: 5000 });
    }

    // Wait for sync to complete (spinner disappears)
    await this.syncSpinner.waitFor({ state: 'hidden', timeout });

    // Verify success (check icon should be visible)
    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 3000 });
  }

  /**
   * Trigger a manual sync and wait for it to complete, handling any dialogs that appear.
   * This is the main method to use for syncing in tests.
   *
   * Automatically handles:
   * - Fresh client confirmation dialogs
   * - Conflict resolution (uses "Use All Remote" by default)
   * - Sync import conflicts (uses remote by default)
   *
   * @param options.useLocal - For conflicts, use local data instead of remote (default: false)
   * @param options.timeout - Maximum time to wait for sync (default: 30000ms)
   */
  async syncAndWait(
    options: { useLocal?: boolean; timeout?: number } = {},
  ): Promise<void> {
    // Increased default timeout from 15s to 30s for multi-client scenarios under load
    const { useLocal = false, timeout = 30000 } = options;

    // Click sync button
    await this.syncBtn.click();

    // Check if sync already completed (for very fast syncs)
    const checkAlreadyVisible = await this.syncCheckIcon.isVisible().catch(() => false);

    if (!checkAlreadyVisible) {
      // Sync not yet complete, wait for it to start or complete
      // Try to wait for spinner, but if it's already gone (sync completed quickly), that's fine
      const spinnerAppeared = await this.syncSpinner
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false);

      if (spinnerAppeared) {
        // Spinner appeared, now wait for dialogs and completion
        // Check for dialogs that might appear during sync
        // These can appear in any order or not at all

        // 1. Check for fresh client confirmation dialog
        const freshDialogVisible = await this.freshClientDialog
          .isVisible()
          .catch(() => false);
        if (freshDialogVisible) {
          console.log('[SuperSyncPage] Fresh client dialog detected, confirming...');
          await this.freshClientConfirmBtn.click();
          await this.freshClientDialog.waitFor({ state: 'hidden', timeout: 5000 });
        }

        // 2. Check for conflict resolution dialog
        const conflictDialogVisible = await this.conflictDialog
          .isVisible()
          .catch(() => false);
        if (conflictDialogVisible) {
          console.log(
            `[SuperSyncPage] Conflict dialog detected, using ${useLocal ? 'local' : 'remote'} data...`,
          );
          if (useLocal) {
            // Keep local changes (manual resolution required - just click Apply)
            await this.conflictApplyBtn.click();
          } else {
            // Use all remote changes
            await this.conflictUseRemoteBtn.click();
            await this.page.waitForTimeout(200);
            await this.conflictApplyBtn.click();
          }
          await this.conflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
        }

        // 3. Check for sync import conflict dialog
        const syncImportConflictVisible = await this.syncImportConflictDialog
          .isVisible()
          .catch(() => false);
        if (syncImportConflictVisible) {
          console.log(
            `[SuperSyncPage] Sync import conflict dialog detected, using ${useLocal ? 'local' : 'remote'} data...`,
          );
          if (useLocal) {
            await this.syncImportUseLocalBtn.click();
          } else {
            await this.syncImportUseRemoteBtn.click();
          }
          await this.syncImportConflictDialog.waitFor({ state: 'hidden', timeout: 5000 });
        }

        // Wait for sync to complete (spinner disappears)
        await this.syncSpinner.waitFor({ state: 'hidden', timeout });
      }

      // Now wait for check icon to appear (whether spinner appeared or not)
      await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  /**
   * Check if sync is currently in error state.
   * Useful for debugging test failures.
   */
  async isSyncInErrorState(): Promise<boolean> {
    return this.syncErrorIcon.isVisible().catch(() => false);
  }

  /**
   * Check if sync button shows an error icon.
   * Alias for isSyncInErrorState for backwards compatibility with tests.
   */
  async hasSyncError(): Promise<boolean> {
    return this.syncErrorIcon.isVisible().catch(() => false);
  }

  /**
   * Open the sync settings dialog and change the encryption password.
   * This will delete all server data and re-upload with the new password.
   *
   * @param newPassword - The new encryption password
   */
  async changeEncryptionPassword(newPassword: string): Promise<void> {
    // Open sync settings via right-click
    await this.syncBtn.click({ button: 'right' });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Expand "Advanced settings" collapsible to access change password button
    const advancedCollapsible = this.page.locator(
      '.collapsible-header:has-text("Advanced")',
    );
    await advancedCollapsible.waitFor({ state: 'visible', timeout: 5000 });

    // Check if already expanded
    const isExpanded = await this.disableEncryptionBtn.isVisible().catch(() => false);
    if (!isExpanded) {
      await advancedCollapsible.click();
      await this.disableEncryptionBtn.waitFor({ state: 'visible', timeout: 3000 });
    }

    // Scroll down to find the change password button
    const dialogContent = this.page.locator('mat-dialog-content');
    await dialogContent.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await this.page.waitForTimeout(200);

    // Click the "Change Password" button
    const changePasswordBtn = this.page.locator('button:has-text("Change Password")');
    await changePasswordBtn.waitFor({ state: 'visible', timeout: 5000 });
    await changePasswordBtn.click();

    // Wait for the change password dialog to appear
    const changePasswordDialog = this.page.locator('dialog-change-encryption-password');
    await changePasswordDialog.waitFor({ state: 'visible', timeout: 5000 });

    // Fill in the new password
    const newPasswordInput = changePasswordDialog.locator('input[name="newPassword"]');
    const confirmPasswordInput = changePasswordDialog.locator(
      'input[name="confirmPassword"]',
    );

    await newPasswordInput.fill(newPassword);
    await newPasswordInput.blur(); // Trigger ngModel update
    await confirmPasswordInput.fill(newPassword);
    await confirmPasswordInput.blur(); // Trigger ngModel update

    // Wait for Angular to process form validation
    await this.page.waitForTimeout(200);

    // Click the "Change Password" confirm button (mat-flat-button, not the "Disable Encryption" button which is mat-stroked-button)
    const confirmBtn = changePasswordDialog.locator(
      'button[mat-flat-button][color="warn"]',
    );
    await confirmBtn.waitFor({ state: 'visible', timeout: 5000 });
    await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
    await confirmBtn.click();

    // Wait for the dialog to close (password change complete)
    await changePasswordDialog.waitFor({ state: 'detached', timeout: 60000 });

    // Wait for the config dialog to close as well
    await this.page.waitForTimeout(500);

    // Close the sync config dialog if still open
    const configDialog = this.page.locator('mat-dialog-container').first();
    const isConfigDialogOpen = await configDialog.isVisible().catch(() => false);
    if (isConfigDialogOpen) {
      const cancelBtn = configDialog.locator('button').filter({ hasText: /cancel/i });
      const hasCancelBtn = await cancelBtn.isVisible().catch(() => false);
      if (hasCancelBtn) {
        await cancelBtn.click();
        await configDialog.waitFor({ state: 'hidden', timeout: 5000 });
      }
    }

    // Wait for password change operation to complete (server wipe + re-upload)
    await this.page.waitForTimeout(2000);
  }

  /**
   * Get the current sync state based on visible icons.
   * Returns: 'syncing' | 'success' | 'error' | 'unknown'
   */
  async getSyncState(): Promise<'syncing' | 'success' | 'error' | 'unknown'> {
    const isSpinnerVisible = await this.syncSpinner.isVisible().catch(() => false);
    if (isSpinnerVisible) return 'syncing';

    const isCheckVisible = await this.syncCheckIcon.isVisible().catch(() => false);
    if (isCheckVisible) return 'success';

    const isErrorVisible = await this.syncErrorIcon.isVisible().catch(() => false);
    if (isErrorVisible) return 'error';

    return 'unknown';
  }

  /**
   * Disable sync by opening settings and disabling the provider.
   * Useful for test cleanup or testing sync re-enabling.
   */
  async disableSync(): Promise<void> {
    // Open sync settings via right-click
    await this.syncBtn.click({ button: 'right' });
    await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

    // Look for "Enable Syncing" toggle (appears when editing existing config)
    const enableToggle = this.page.locator('.e2e-isEnabled input[type="checkbox"]');
    const toggleExists = await enableToggle.isVisible().catch(() => false);

    if (toggleExists) {
      const isChecked = await enableToggle.isChecked();
      if (isChecked) {
        // Click the label to toggle off
        const toggleLabel = this.page.locator('.e2e-isEnabled label');
        await toggleLabel.click();
        await this.page.waitForTimeout(200);
      }
    }

    // Save configuration
    await expect(this.saveBtn).toBeEnabled({ timeout: 5000 });
    await this.saveBtn.click();

    // Wait for dialog to close
    await expect(this.page.locator('mat-dialog-container')).toHaveCount(0, {
      timeout: 10000,
    });
  }

  /**
   * Check if SuperSync is currently configured and enabled.
   * Returns true if sync button shows check or spinner icon.
   */
  async isSyncEnabled(): Promise<boolean> {
    const checkVisible = await this.syncCheckIcon.isVisible().catch(() => false);
    const spinnerVisible = await this.syncSpinner.isVisible().catch(() => false);
    const errorVisible = await this.syncErrorIcon.isVisible().catch(() => false);

    return checkVisible || spinnerVisible || errorVisible;
  }
}
