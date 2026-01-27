import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './base.page';

export class SyncPage extends BasePage {
  readonly syncBtn: Locator;
  readonly providerSelect: Locator;
  readonly baseUrlInput: Locator;
  readonly userNameInput: Locator;
  readonly passwordInput: Locator;
  readonly syncFolderInput: Locator;
  readonly saveBtn: Locator;
  readonly syncSpinner: Locator;
  readonly syncCheckIcon: Locator;
  readonly encryptionCheckbox: Locator;
  readonly encryptionPasswordInput: Locator;
  readonly removeEncryptionBtn: Locator;

  constructor(page: Page) {
    super(page);
    this.syncBtn = page.locator('button.sync-btn');
    this.providerSelect = page.locator('formly-field-mat-select mat-select');
    this.baseUrlInput = page.locator('.e2e-baseUrl input');
    this.userNameInput = page.locator('.e2e-userName input');
    this.passwordInput = page.locator('.e2e-password input');
    this.syncFolderInput = page.locator('.e2e-syncFolderPath input');
    this.saveBtn = page.locator('mat-dialog-actions button[mat-stroked-button]');
    this.syncSpinner = page.locator('.sync-btn mat-icon.spin');
    this.syncCheckIcon = page.locator('.sync-btn mat-icon.sync-state-ico');
    // Encryption-related locators (Advanced settings section)
    this.encryptionCheckbox = page.locator(
      'formly-field-checkbox input[type="checkbox"]',
    );
    this.encryptionPasswordInput = page.locator(
      'formly-field-input input[type="password"]',
    );
    this.removeEncryptionBtn = page.locator('button:has-text("Remove Encryption")');
  }

  async setupWebdavSync(config: {
    baseUrl: string;
    username: string;
    password: string;
    syncFolderPath: string;
    isEncryptionEnabled?: boolean;
    encryptionPassword?: string;
  }): Promise<void> {
    // Try entire setup flow up to 2 times (dialog-level retry)
    for (let dialogAttempt = 0; dialogAttempt < 2; dialogAttempt++) {
      if (dialogAttempt > 0) {
        console.log(`[setupWebdavSync] Dialog-level retry attempt ${dialogAttempt + 1}`);
      }

      // Dismiss any visible snackbars/toasts that might block clicks
      const snackBar = this.page.locator('.mat-mdc-snack-bar-container');
      if (await snackBar.isVisible({ timeout: 500 }).catch(() => false)) {
        const dismissBtn = snackBar.locator('button');
        if (await dismissBtn.isVisible({ timeout: 500 }).catch(() => false)) {
          await dismissBtn.click().catch(() => {});
        }
        await this.page.waitForTimeout(500);
      }

      // Ensure sync button is visible and clickable
      await this.syncBtn.waitFor({ state: 'visible', timeout: 10000 });

      // Click sync button to open settings dialog - use force click if needed
      await this.syncBtn.click({ timeout: 5000 });

      // Wait for dialog to appear
      const dialog = this.page.locator('mat-dialog-container, .mat-mdc-dialog-container');
      const dialogVisible = await dialog
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      // If dialog didn't open, try clicking again
      if (!dialogVisible) {
        await this.page.waitForTimeout(500);
        await this.syncBtn.click({ force: true });
        await dialog.waitFor({ state: 'visible', timeout: 5000 });
      }

      // Wait for dialog to be fully loaded
      await this.page.waitForLoadState('networkidle');
      await this.providerSelect.waitFor({ state: 'visible', timeout: 10000 });

      // Wait a moment for Angular animations
      await this.page.waitForTimeout(500);

      // Click on provider select to open dropdown with retry
      const webdavOption = this.page.locator('mat-option').filter({ hasText: 'WebDAV' });
      const selectElement = this.providerSelect;
      const selectValueText = this.page.locator(
        'formly-field-mat-select .mat-mdc-select-value-text',
      );

      let selectionSucceeded = false;

      for (let attempt = 0; attempt < 5; attempt++) {
        // Ensure the select is in view
        await selectElement.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(async () => {
          // If scrollIntoViewIfNeeded fails, try scrolling the dialog content
          const dialogContent = this.page.locator('mat-dialog-content');
          if (await dialogContent.isVisible()) {
            await dialogContent.evaluate((el) => el.scrollTo(0, 0));
          }
        });
        await this.page.waitForTimeout(300);

        // Focus and click the select element
        await selectElement.focus().catch(() => {});
        await this.page.waitForTimeout(200);

        // Try multiple ways to open the dropdown
        if (attempt === 0) {
          await selectElement.click().catch(() => {});
        } else if (attempt === 1) {
          await this.page.keyboard.press('Space');
        } else if (attempt === 2) {
          await this.page.keyboard.press('ArrowDown');
        } else {
          await selectElement.click({ force: true }).catch(() => {});
        }
        await this.page.waitForTimeout(500);

        // Wait for any mat-option to appear (dropdown opened)
        const anyOption = this.page.locator('mat-option').first();
        const anyOptionVisible = await anyOption
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true)
          .catch(() => false);

        if (anyOptionVisible) {
          const webdavVisible = await webdavOption
            .waitFor({ state: 'visible', timeout: 3000 })
            .then(() => true)
            .catch(() => false);

          if (webdavVisible) {
            await webdavOption.click();

            // KEY FIX: Verify selection actually took effect by checking mat-select value
            const selectionVerified = await selectValueText
              .waitFor({ state: 'visible', timeout: 3000 })
              .then(async () => {
                const text = await selectValueText.textContent();
                return text?.includes('WebDAV') ?? false;
              })
              .catch(() => false);

            if (selectionVerified) {
              // Selection confirmed - now wait for Formly to process the model change
              await this.page.waitForTimeout(500); // Allow Formly hideExpression to evaluate

              // Wait for WebDAV form fields with increased timeout
              const fieldVisible = await this.baseUrlInput
                .waitFor({ state: 'visible', timeout: 8000 })
                .then(() => true)
                .catch(() => false);

              if (fieldVisible) {
                selectionSucceeded = true;
                break; // Form fields are visible, we can proceed
              }
            }
          }
        }

        // Close dropdown and retry
        await this.page.keyboard.press('Escape');
        await this.page.waitForTimeout(500);
      }

      if (selectionSucceeded) {
        // Final verification with increased timeout
        await this.baseUrlInput.waitFor({ state: 'visible', timeout: 15000 });

        // Fill in the configuration
        await this.baseUrlInput.fill(config.baseUrl);
        await this.userNameInput.fill(config.username);
        await this.passwordInput.fill(config.password);
        await this.syncFolderInput.fill(config.syncFolderPath);

        // Configure encryption if specified
        if (config.isEncryptionEnabled && config.encryptionPassword) {
          await this.expandAdvancedSettings();
          await this.enableEncryption(config.encryptionPassword);
        }

        // Save the configuration
        await this.saveBtn.click();

        // Wait for dialog to close
        await this.page.waitForTimeout(500);
        return; // Success - exit the method
      }

      // Selection failed after all attempts - close dialog and retry from scratch
      console.log(
        '[setupWebdavSync] All dropdown attempts failed, closing dialog to retry',
      );
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(1000);

      // Ensure dialog is closed before retrying
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // If we get here, both dialog-level attempts failed
    throw new Error(
      '[setupWebdavSync] Failed to setup WebDAV sync after multiple dialog-level retries',
    );
  }

  async triggerSync(): Promise<void> {
    // Dismiss any open dialogs/overlays that might block the sync button
    const overlay = this.page.locator('.cdk-overlay-backdrop');
    if (await overlay.isVisible({ timeout: 500 }).catch(() => false)) {
      // Try pressing Escape to close any open dialog
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
      // If overlay is still there, try clicking outside to dismiss
      if (await overlay.isVisible({ timeout: 300 }).catch(() => false)) {
        await overlay.click({ force: true }).catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }

    await this.syncBtn.click();
    // Wait for any sync operation to start (spinner appears or completes immediately)
    await Promise.race([
      this.syncSpinner.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {}),
      this.syncCheckIcon.waitFor({ state: 'visible', timeout: 1000 }).catch(() => {}),
    ]);
  }

  async waitForSyncComplete(): Promise<void> {
    // Wait for sync spinner to disappear
    await this.syncSpinner.waitFor({ state: 'hidden', timeout: 20000 }); // Reduced from 30s to 20s
    // Verify check icon appears
    await this.syncCheckIcon.waitFor({ state: 'visible' });
  }

  /**
   * Waits for sync to be ready after page load.
   * This ensures the provider config has been loaded from IndexedDB.
   */
  async waitForSyncReady(): Promise<void> {
    // Wait for sync button to show the check icon (indicates provider is ready)
    // The sync button shows sync_disabled when not ready, and check/done_all when ready
    await this.syncCheckIcon.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Expands the Advanced settings section in the sync dialog.
   * The formly-collapsible component uses a custom structure with .collapsible-header
   */
  async expandAdvancedSettings(): Promise<void> {
    // Find the Advanced collapsible header by its text content
    const collapsibleHeader = this.page.locator(
      'formly-collapsible .collapsible-header:has-text("Advanced")',
    );

    // Wait for it to be visible
    await collapsibleHeader.waitFor({ state: 'visible', timeout: 5000 });

    // Check if the panel is already expanded by looking for .collapsible-panel sibling
    const collapsiblePanel = this.page.locator('formly-collapsible .collapsible-panel');
    const isExpanded = await collapsiblePanel.isVisible().catch(() => false);

    if (!isExpanded) {
      await collapsibleHeader.click();
      // Wait for expansion animation
      await this.page.waitForTimeout(500);
      // Wait for panel to be visible
      await collapsiblePanel.waitFor({ state: 'visible', timeout: 3000 });
    }
  }

  /**
   * Enables encryption in the sync settings form.
   * Note: Advanced settings must be expanded first.
   */
  async enableEncryption(password: string): Promise<void> {
    // Find the encryption checkbox by its accessible name
    const checkbox = this.page.getByRole('checkbox', { name: /encryption/i });
    await checkbox.waitFor({ state: 'visible', timeout: 5000 });

    const isChecked = await checkbox.isChecked().catch(() => false);
    if (!isChecked) {
      await checkbox.check({ force: true });
      // Wait for Formly to re-evaluate hideExpressions and render the password field
      await this.page.waitForTimeout(1000);
    }

    // Find the encryption password field
    // Try CSS class selector first (more reliable), then role-based as fallback
    const passwordFieldByClass = this.page.locator('.e2e-file-based-encrypt-key input');
    const passwordFieldByRole = this.page.getByRole('textbox', {
      name: /Encryption Password/i,
    });

    const classCount = await passwordFieldByClass.count();
    const passwordField = classCount > 0 ? passwordFieldByClass : passwordFieldByRole;

    await passwordField.waitFor({ state: 'visible', timeout: 5000 });

    // WORKAROUND: Formly has a bug where setting encryptKey triggers the checkbox's
    // disabled expression, which causes Angular to uncheck the checkbox.
    // This hides the password field since hideExpression depends on isEncryptionEnabled.
    //
    // Solution: Dispatch the input event to properly update Angular's form control,
    // then immediately override Angular's DOM mutation that unchecks the checkbox.
    // We use MutationObserver to catch and prevent the checkbox state change.

    await this.page.evaluate(
      ({ pwd }) => {
        const encryptCheckbox = Array.from(
          document.querySelectorAll('input[type="checkbox"]'),
        ).find((cb) => cb.id.includes('isEncryptionEnabled')) as HTMLInputElement | null;

        const encryptPasswordField = Array.from(
          document.querySelectorAll('input[type="password"]'),
        ).find((f) =>
          (f as HTMLInputElement).id.includes('encryptKey'),
        ) as HTMLInputElement | null;

        if (!encryptCheckbox || !encryptPasswordField) {
          throw new Error('Fields not found');
        }

        // Set up a MutationObserver to IMMEDIATELY revert any checkbox unchecking
        let observerActive = true;
        const observer = new MutationObserver(() => {
          if (observerActive && !encryptCheckbox.checked) {
            encryptCheckbox.checked = true;
          }
        });

        observer.observe(encryptCheckbox, {
          attributes: true,
          attributeFilter: ['checked'],
        });

        // Also observe the checkbox's DOM property directly using a getter/setter override
        const originalCheckedDescriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'checked',
        );
        if (originalCheckedDescriptor) {
          Object.defineProperty(encryptCheckbox, 'checked', {
            get: function () {
              return originalCheckedDescriptor.get?.call(this);
            },
            set: function (value) {
              // Always set to true, ignore attempts to uncheck
              if (observerActive) {
                originalCheckedDescriptor.set?.call(this, true);
              } else {
                originalCheckedDescriptor.set?.call(this, value);
              }
            },
            configurable: true,
          });
        }

        // Now set the password value and dispatch events
        encryptPasswordField.value = pwd;
        encryptPasswordField.dispatchEvent(
          new InputEvent('input', { bubbles: true, data: pwd }),
        );

        // Allow 2 microtasks for Angular to process
        return new Promise<void>((resolve) => {
          queueMicrotask(() => {
            queueMicrotask(() => {
              // Disable observer and restore original descriptor
              observerActive = false;
              observer.disconnect();
              if (originalCheckedDescriptor) {
                Object.defineProperty(
                  encryptCheckbox,
                  'checked',
                  originalCheckedDescriptor,
                );
              }
              // Final ensure checkbox is checked
              encryptCheckbox.checked = true;
              resolve();
            });
          });
        });
      },
      { pwd: password },
    );
    // Wait for Angular to stabilize
    await this.page.waitForTimeout(300);
  }

  /**
   * Disables encryption for file-based providers.
   * Opens the sync settings dialog, expands advanced settings,
   * and clicks the "Remove Encryption" button.
   */
  async disableEncryptionForFileBased(): Promise<void> {
    // Open sync settings dialog using right-click
    // (normal click triggers sync when sync is configured, right-click opens settings)
    await this.syncBtn.click({ button: 'right' });
    const dialog = this.page.locator('mat-dialog-container, .mat-mdc-dialog-container');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });

    // Wait for dialog to settle
    await this.page.waitForTimeout(500);

    // Expand advanced settings
    await this.expandAdvancedSettings();

    // Click "Remove Encryption" button (role-based selector for reliability)
    const removeBtn = this.page.getByRole('button', { name: /Remove Encryption/i });
    await removeBtn.waitFor({ state: 'visible', timeout: 5000 });
    await removeBtn.click();

    // Wait for confirmation dialog to appear (it opens on top of the settings dialog)
    // The confirmation dialog is DialogChangeEncryptionPasswordComponent in 'disable-only' mode
    await this.page.waitForTimeout(500);

    // Look for the "Disable Encryption" button in the confirmation dialog
    const disableBtn = this.page.getByRole('button', { name: /Disable Encryption/i });
    await disableBtn.waitFor({ state: 'visible', timeout: 5000 });
    await disableBtn.click();

    // Wait for operation to complete - look for success snackbar or dialog close
    await this.page.waitForTimeout(2000);

    // Close any remaining dialogs
    const dialogs = this.page.locator('mat-dialog-container');
    const dialogCount = await dialogs.count();
    for (let i = 0; i < dialogCount; i++) {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(300);
    }

    // Ensure all dialogs are closed
    await dialogs
      .first()
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
  }
}
