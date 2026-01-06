import { type Page, type Locator } from '@playwright/test';
import { TIMEOUTS } from '../constants/timeouts';

/**
 * Material Design component helpers for Playwright E2E tests.
 * Centralizes complex Material UI interactions with retry logic.
 */

/**
 * Opens a mat-select dropdown and selects an option by text.
 * Handles the complexity of Material select components with retry logic.
 *
 * @param page - Playwright Page instance
 * @param selectLocator - Locator for the mat-select element
 * @param optionText - Text of the option to select
 * @param maxRetries - Maximum number of retry attempts (default: 5)
 */
export const selectMaterialOption = async (
  page: Page,
  selectLocator: Locator,
  optionText: string,
  maxRetries: number = 5,
): Promise<void> => {
  const option = page.locator('mat-option').filter({ hasText: optionText });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Ensure the select is in view
    await selectLocator
      .scrollIntoViewIfNeeded({ timeout: TIMEOUTS.DIALOG })
      .catch(async () => {
        // If scrollIntoViewIfNeeded fails, try scrolling the dialog content
        const dialogContent = page.locator('mat-dialog-content');
        if (await dialogContent.isVisible()) {
          await dialogContent.evaluate((el) => el.scrollTo(0, 0));
        }
      });
    await page.waitForTimeout(TIMEOUTS.UI_SETTLE);

    // Focus and try to open the dropdown
    await selectLocator.focus().catch(() => {});
    await page.waitForTimeout(TIMEOUTS.UI_SETTLE);

    // Try different methods to open the dropdown
    if (attempt === 0) {
      await selectLocator.click().catch(() => {});
    } else if (attempt === 1) {
      await page.keyboard.press('Space');
    } else if (attempt === 2) {
      await page.keyboard.press('ArrowDown');
    } else {
      await selectLocator.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(TIMEOUTS.ANIMATION);

    // Wait for any mat-option to appear (dropdown opened)
    const anyOption = page.locator('mat-option').first();
    const anyOptionVisible = await anyOption
      .waitFor({ state: 'visible', timeout: TIMEOUTS.ANGULAR_STABILITY })
      .then(() => true)
      .catch(() => false);

    if (anyOptionVisible) {
      // Wait for the specific option
      const optionVisible = await option
        .waitFor({ state: 'visible', timeout: TIMEOUTS.ANGULAR_STABILITY })
        .then(() => true)
        .catch(() => false);

      if (optionVisible) {
        await option.click();
        await page.waitForTimeout(TIMEOUTS.ANIMATION);
        return;
      }
    }

    // Close dropdown if it opened but option not found, then retry
    await page.keyboard.press('Escape');
    await page.waitForTimeout(TIMEOUTS.ANIMATION);
  }

  throw new Error(`Failed to select option "${optionText}" after ${maxRetries} attempts`);
};

/**
 * Waits for a Material dialog to open.
 *
 * @param page - Playwright Page instance
 * @param timeout - Maximum wait time in ms (default: TIMEOUTS.DIALOG)
 * @returns The dialog locator
 */
export const waitForMatDialogOpen = async (
  page: Page,
  timeout: number = TIMEOUTS.DIALOG,
): Promise<Locator> => {
  const dialog = page.locator('mat-dialog-container, .mat-mdc-dialog-container');
  await dialog.waitFor({ state: 'visible', timeout });
  return dialog;
};

/**
 * Waits for a Material dialog to close.
 *
 * @param page - Playwright Page instance
 * @param timeout - Maximum wait time in ms (default: TIMEOUTS.DIALOG)
 */
export const waitForMatDialogClose = async (
  page: Page,
  timeout: number = TIMEOUTS.DIALOG,
): Promise<void> => {
  const dialog = page.locator('mat-dialog-container, .mat-mdc-dialog-container');
  await dialog.waitFor({ state: 'hidden', timeout });
};

/**
 * Dismisses any visible Material snackbar/toast.
 *
 * @param page - Playwright Page instance
 * @returns true if a snackbar was dismissed, false otherwise
 */
export const dismissSnackbar = async (page: Page): Promise<boolean> => {
  const snackBar = page.locator('.mat-mdc-snack-bar-container');
  if (await snackBar.isVisible({ timeout: TIMEOUTS.ANIMATION }).catch(() => false)) {
    const dismissBtn = snackBar.locator('button');
    if (await dismissBtn.isVisible({ timeout: TIMEOUTS.ANIMATION }).catch(() => false)) {
      await dismissBtn.click().catch(() => {});
      await page.waitForTimeout(TIMEOUTS.ANIMATION);
      return true;
    }
  }
  return false;
};

/**
 * Clicks a Material menu item, scrolling if necessary.
 * Handles hover states and visibility checks.
 *
 * @param page - Playwright Page instance
 * @param menuTrigger - Locator for the element that triggers the menu
 * @param menuItemText - Text of the menu item to click
 */
export const clickMatMenuItem = async (
  page: Page,
  menuTrigger: Locator,
  menuItemText: string,
): Promise<void> => {
  // Hover to reveal menu trigger if needed
  await menuTrigger.hover();
  await page.waitForTimeout(TIMEOUTS.UI_SETTLE);

  // Click to open menu
  await menuTrigger.click();

  // Wait for menu to open
  const menu = page.locator('.mat-mdc-menu-panel, .mat-menu-panel');
  await menu.waitFor({ state: 'visible', timeout: TIMEOUTS.DIALOG });

  // Find and click the menu item
  const menuItem = menu
    .locator('.mat-mdc-menu-item, .mat-menu-item')
    .filter({ hasText: menuItemText });
  await menuItem.scrollIntoViewIfNeeded();
  await menuItem.click();

  // Wait for menu to close
  await menu.waitFor({ state: 'hidden', timeout: TIMEOUTS.DIALOG });
};

/**
 * Fills a Material form field input.
 * Handles the complexity of mat-form-field components.
 *
 * @param formFieldLocator - Locator for the mat-form-field or input container
 * @param value - Value to fill
 */
export const fillMatInput = async (
  formFieldLocator: Locator,
  value: string,
): Promise<void> => {
  const input = formFieldLocator.locator('input, textarea').first();
  await input.waitFor({ state: 'visible', timeout: TIMEOUTS.DIALOG });
  await input.clear();
  await input.fill(value);
};

/**
 * Expands a Material expansion panel if not already expanded.
 *
 * @param panelHeader - Locator for the expansion panel header
 */
export const expandMatExpansionPanel = async (panelHeader: Locator): Promise<void> => {
  const isExpanded = await panelHeader.getAttribute('aria-expanded');
  if (isExpanded !== 'true') {
    await panelHeader.click();
    // Wait for expansion animation
    const panel = panelHeader.locator('..').locator('.mat-expansion-panel-content');
    await panel.waitFor({ state: 'visible', timeout: TIMEOUTS.ANIMATION * 2 });
  }
};

/**
 * Waits for a Material button to be enabled and clicks it.
 *
 * @param button - Locator for the button
 * @param timeout - Maximum wait time in ms (default: TIMEOUTS.ELEMENT_ENABLED)
 */
export const clickMatButton = async (
  button: Locator,
  timeout: number = TIMEOUTS.ELEMENT_ENABLED,
): Promise<void> => {
  await button.waitFor({ state: 'visible', timeout });
  // Wait for button to be enabled (not have disabled attribute)
  await button.waitFor({ state: 'attached', timeout });
  const isDisabled = await button.isDisabled();
  if (isDisabled) {
    // Poll for enabled state
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (!(await button.isDisabled())) break;
      await button.page().waitForTimeout(100);
    }
  }
  await button.click();
};
