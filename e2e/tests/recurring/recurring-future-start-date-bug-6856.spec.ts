import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/6856
 *
 * When a recurring task is created with a future start date, an active task
 * instance is immediately generated and placed in the Inbox on the same day
 * of creation, ignoring the configured start date entirely.
 *
 * Expected: No active task instance should appear until the configured start
 * date arrives. The task should be scheduled for the start date.
 *
 * NOTE: This test uses the planner view to create a task with a future dueDay,
 * then makes it recurring via the repeat dialog. The dialog initializes
 * startDate from task.dueDay, so the repeat config gets the future start date.
 */
test.describe('Recurring Task - Future Start Date (#6856)', () => {
  test('should not show task in today view when made recurring with future start date', async ({
    page,
    workViewPage,
    taskPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    // 1. Create a task in the today view, then schedule it for a future date
    const taskTitle = `${testPrefix}-FutureRecur`;
    await workViewPage.addTask(taskTitle);

    const task = taskPage.getTaskByText(taskTitle).first();
    await expect(task).toBeVisible({ timeout: 10000 });

    // Schedule the task for a future date via the schedule dialog
    await task.hover();
    await page.waitForTimeout(200);
    const detailBtn = page.getByRole('button', {
      name: 'Show/Hide additional info',
    });
    await detailBtn.click();
    await page.waitForTimeout(300);

    // Click on "Schedule" to open the schedule dialog
    const scheduleItem = page.locator('task-detail-item').filter({
      has: page.locator('mat-icon:has-text("alarm"), mat-icon:has-text("today")'),
    });
    await scheduleItem.click();

    // Wait for schedule dialog
    const scheduleDialog = page.locator('mat-dialog-container');
    await scheduleDialog.waitFor({ state: 'visible', timeout: 10000 });

    // Use the calendar picker in the schedule dialog to select a future date
    const calendarToggle = scheduleDialog
      .locator('mat-datepicker-toggle button')
      .first();
    await calendarToggle.waitFor({ state: 'visible', timeout: 5000 });
    await calendarToggle.click();

    const calendar = page.locator('mat-calendar');
    await calendar.waitFor({ state: 'visible', timeout: 5000 });

    // Navigate to next month
    await calendar.locator('.mat-calendar-next-button').click();
    await page.waitForTimeout(300);

    // Select the 15th of next month
    await calendar.getByRole('button', { name: /15/ }).first().click();
    await page.waitForTimeout(500);

    // Save the schedule dialog
    const scheduleSaveBtn = scheduleDialog.getByRole('button', { name: /Save/i });
    await scheduleSaveBtn.click();
    await scheduleDialog.waitFor({ state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(1000);

    // 2. Navigate to planner to find the now-scheduled task
    await page.goto('/#/tag/TODAY/planner');
    await page.waitForTimeout(1500);

    // Find the task in the planner
    const plannedTask = page.locator('task').filter({ hasText: taskTitle }).first();
    await expect(plannedTask).toBeVisible({ timeout: 10000 });

    // 3. Open task detail and make it recurring
    await plannedTask.hover();
    await page.waitForTimeout(200);
    const detailBtn2 = page.getByRole('button', {
      name: 'Show/Hide additional info',
    });
    await detailBtn2.click();
    await page.waitForTimeout(300);

    // Click on "Recur" item
    const recurItem = page
      .locator('task-detail-item')
      .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') });
    await recurItem.click();

    // Wait for the repeat dialog
    const repeatDialog = page.locator('mat-dialog-container');
    await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

    // startDate defaults to task.dueDay (the future date) — just save
    const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
    await saveBtn.click();
    await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });

    // 4. Wait for effects
    await page.waitForTimeout(2000);

    // 5. Navigate to today view
    await page.goto('/#/tag/TODAY/tasks');
    await workViewPage.waitForTaskList();

    // 6. Assert: task should NOT be visible in today's task list
    // Bug #6856: The task appears immediately instead of being scheduled
    // for the configured future start date.
    await expect(taskPage.getTaskByText(taskTitle)).not.toBeVisible({ timeout: 5000 });
  });
});
