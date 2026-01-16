import { expect, test } from '../../fixtures/test.fixture';

test.describe('Add to Today - Subtask Support', () => {
  test('should add subtask to Today via button when parent is NOT in Today', async ({
    page,
    workViewPage,
  }) => {
    // Start in Today view
    await workViewPage.waitForTaskList();

    // Add parent task
    await workViewPage.addTask('Parent Task');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'Test Subtask');
    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // Remove parent from Today first to test adding subtask independently
    await parentTask.hover();
    const removeFromTodayBtn = parentTask.locator('button[title*="Remove from"]');
    if (await removeFromTodayBtn.isVisible()) {
      await removeFromTodayBtn.click();
      await page.waitForTimeout(500);
    }

    // Hover over subtask to reveal hover controls
    await subtask.hover();
    await page.waitForTimeout(100); // Allow Angular change detection cycle

    // Click "Add to Today" button (sun icon)
    const addToTodayBtn = subtask.locator('button[title*="Add to My Day"]');
    await addToTodayBtn.waitFor({ state: 'visible', timeout: 5000 });
    await addToTodayBtn.click();

    // Wait for state update
    await page.waitForTimeout(500);

    // Verify subtask appears in Today view (should be visible)
    const todaySubtask = page
      .locator('task task-title')
      .filter({ hasText: 'Test Subtask' });
    await expect(todaySubtask).toBeVisible();
  });

  test('should add subtask to Today via keyboard shortcut (Ctrl+T)', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Add parent task
    await workViewPage.addTask('Parent Task KB');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'KB Subtask');
    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // Remove parent from Today first
    await parentTask.hover();
    const removeFromTodayBtn = parentTask.locator('button[title*="Remove from"]');
    if (await removeFromTodayBtn.isVisible()) {
      await removeFromTodayBtn.click();
      await page.waitForTimeout(500);
    }

    // Focus the subtask (click on it)
    await subtask.click();

    // Press Ctrl+T to add to today
    await page.keyboard.press('Control+t');

    // Wait for state update
    await page.waitForTimeout(500);

    // Verify subtask appears in Today view
    const todaySubtask = page
      .locator('task task-title')
      .filter({ hasText: 'KB Subtask' });
    await expect(todaySubtask).toBeVisible();
  });

  test('should add parent task to Today and verify it works', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Add parent task
    await workViewPage.addTask('Parent for Today');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Task should already be in Today view by default, just verify it's there
    const todayTaskTitle = page
      .locator('task task-title')
      .filter({ hasText: 'Parent for Today' });
    await expect(todayTaskTitle).toBeVisible();
  });

  test('should NOT add subtask when parent is already in Today', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Add parent task (already in Today by default)
    await workViewPage.addTask('Parent Already Today');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'Blocked Subtask');
    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // Count total root tasks (not subtasks) in Today view
    // Use .first() to target only the main task-list, not other task-lists that might be on the page
    const todayRootTasks = page
      .locator('task-list')
      .first()
      .locator('.task-list-inner > task');
    const taskCount = await todayRootTasks.count();

    // Should only have parent task (1 task), subtask should not be a separate root task
    expect(taskCount).toBe(1);

    // Verify it's the parent task
    const todayTaskTitle = todayRootTasks.first().locator('task-title');
    await expect(todayTaskTitle).toContainText('Parent Already Today');
  });

  test('should add subtask from context menu', async ({ page, workViewPage }) => {
    await workViewPage.waitForTaskList();

    // Add parent task
    await workViewPage.addTask('Parent Context Menu');
    const parentTask = page.locator('task').first();
    await expect(parentTask).toBeVisible();

    // Add subtask
    await workViewPage.addSubTask(parentTask, 'Context Menu Subtask');
    const subtask = parentTask.locator('.sub-tasks task').first();
    await expect(subtask).toBeVisible();

    // Remove parent from Today first
    await parentTask.hover();
    const removeFromTodayBtn = parentTask.locator('button[title*="Remove from"]');
    if (await removeFromTodayBtn.isVisible()) {
      await removeFromTodayBtn.click();
      await page.waitForTimeout(500);
    }

    // Right-click on subtask to open context menu
    await subtask.click({ button: 'right' });

    // Click "Add to My Day" in context menu (Material menu renders in overlay)
    const addToTodayMenuItem = page
      .locator('.mat-mdc-menu-item')
      .filter({ hasText: 'Add to My Day' });
    await addToTodayMenuItem.click();

    // Wait for state update
    await page.waitForTimeout(500);

    // Verify subtask appears in Today view
    const todaySubtask = page
      .locator('task task-title')
      .filter({ hasText: 'Context Menu Subtask' });
    await expect(todaySubtask).toBeVisible();
  });
});
