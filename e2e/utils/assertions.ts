import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { TaskPage } from '../pages/task.page';
import type { DialogPage } from '../pages/dialog.page';
import type { ProjectPage } from '../pages/project.page';
import type { TagPage } from '../pages/tag.page';
import { TIMEOUTS } from '../constants/timeouts';

/**
 * Assert that the task list has the expected number of tasks.
 */
export const expectTaskCount = async (
  taskPage: TaskPage,
  count: number,
): Promise<void> => {
  await expect(taskPage.getAllTasks()).toHaveCount(count);
};

/**
 * Assert that a task with the given text is visible.
 */
export const expectTaskVisible = async (
  taskPage: TaskPage,
  text: string,
): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).toBeVisible();
};

/**
 * Assert that a task with the given text is NOT visible.
 */
export const expectTaskNotVisible = async (
  taskPage: TaskPage,
  text: string,
): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).not.toBeVisible();
};

/**
 * Assert that a dialog is currently visible.
 */
export const expectDialogVisible = async (dialogPage: DialogPage): Promise<void> => {
  const dialog = await dialogPage.waitForDialog();
  await expect(dialog).toBeVisible();
};

/**
 * Assert that no dialog is currently visible.
 */
export const expectNoDialog = async (page: Page): Promise<void> => {
  const dialog = page.locator('mat-dialog-container, .mat-mdc-dialog-container');
  await expect(dialog).not.toBeVisible();
};

/**
 * Assert that no global error alert is displayed.
 */
export const expectNoGlobalError = async (page: Page): Promise<void> => {
  const error = page.locator('.global-error-alert');
  await expect(error).not.toBeVisible();
};

/**
 * Assert that a task is marked as done.
 */
export const expectTaskDone = async (taskPage: TaskPage, text: string): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).toHaveClass(/isDone/);
};

/**
 * Assert that a task is NOT marked as done.
 */
export const expectTaskNotDone = async (
  taskPage: TaskPage,
  text: string,
): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).not.toHaveClass(/isDone/);
};

/**
 * Assert that the done task count matches expected.
 */
export const expectDoneTaskCount = async (
  taskPage: TaskPage,
  count: number,
): Promise<void> => {
  await expect(taskPage.getDoneTasks()).toHaveCount(count);
};

/**
 * Assert that the undone task count matches expected.
 */
export const expectUndoneTaskCount = async (
  taskPage: TaskPage,
  count: number,
): Promise<void> => {
  await expect(taskPage.getUndoneTasks()).toHaveCount(count);
};

/**
 * Assert that a task has the expected number of subtasks.
 */
export const expectSubTaskCount = async (
  taskPage: TaskPage,
  task: Locator,
  count: number,
): Promise<void> => {
  const subtasks = taskPage.getSubTasks(task);
  await expect(subtasks).toHaveCount(count);
};

/**
 * Assert that a project exists in the sidebar navigation.
 */
export const expectProjectExists = async (
  projectPage: ProjectPage,
  projectName: string,
): Promise<void> => {
  const projectsTree = projectPage['page']
    .locator('nav-list-tree')
    .filter({ hasText: 'Projects' });
  const project = projectsTree
    .locator('[role="treeitem"]')
    .filter({ hasText: projectName });
  await expect(project).toBeVisible({ timeout: TIMEOUTS.NAVIGATION });
};

/**
 * Assert that a tag exists in the sidebar navigation.
 */
export const expectTagExists = async (
  tagPage: TagPage,
  tagName: string,
): Promise<void> => {
  const exists = await tagPage.tagExistsInSidebar(tagName);
  expect(exists).toBe(true);
};

/**
 * Assert that sync completed successfully (check icon visible).
 */
export const expectSyncComplete = async (page: Page): Promise<void> => {
  const syncCheckIcon = page.locator('.sync-btn mat-icon.sync-state-ico');
  await expect(syncCheckIcon).toBeVisible({ timeout: TIMEOUTS.SYNC });
};

/**
 * Assert that no sync conflict dialog is visible.
 */
export const expectNoConflictDialog = async (page: Page): Promise<void> => {
  const conflictDialog = page.locator('dialog-sync-conflict');
  await expect(conflictDialog).not.toBeVisible();
};

/**
 * Assert that the page title contains the expected text.
 */
export const expectPageTitle = async (page: Page, title: string): Promise<void> => {
  const pageTitle = page.locator('.page-title').first();
  await expect(pageTitle).toContainText(title);
};

/**
 * Assert that no snackbar error is displayed.
 */
export const expectNoSnackbarError = async (page: Page): Promise<void> => {
  const snackBars = page.locator('.mat-mdc-snack-bar-container');
  const count = await snackBars.count();
  for (let i = 0; i < count; i++) {
    const text = await snackBars.nth(i).innerText();
    expect(text.toLowerCase()).not.toContain('error');
    expect(text.toLowerCase()).not.toContain('fail');
  }
};

/**
 * Assert that a task is currently being tracked (has isCurrent class).
 */
export const expectTaskTracking = async (
  taskPage: TaskPage,
  text: string,
): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).toHaveClass(/isCurrent/);
};

/**
 * Assert that a task is NOT currently being tracked.
 */
export const expectTaskNotTracking = async (
  taskPage: TaskPage,
  text: string,
): Promise<void> => {
  const task = taskPage.getTaskByText(text);
  await expect(task).not.toHaveClass(/isCurrent/);
};
