import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression for #7498 (Kanban path): the default Kanban DONE column used to
 * exclude the IN_PROGRESS tag, so a task carrying that tag would vanish when
 * marked complete (it stopped matching IN_PROGRESS — UnDone — and was filtered
 * out of DONE by the tag exclusion). The fix removes that exclusion.
 */
test.describe('Boards #7498 — Kanban', () => {
  test('task with In Progress tag lands in DONE after done-toggle', async ({
    page,
    workViewPage,
    testPrefix,
  }) => {
    await workViewPage.waitForTaskList();

    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    // Switch to the Kanban Default board.
    const kanbanTab = page
      .locator('mat-tab-group [role="tab"]')
      .filter({ hasText: /kanban/i })
      .first();
    await kanbanTab.waitFor({ state: 'visible', timeout: 10000 });
    await kanbanTab.click();

    // On a fresh profile the Kanban panels reference KANBAN_IN_PROGRESS which
    // doesn't exist yet — the board renders a "Create Tag" prompt instead of
    // the columns. Click it and wait for the panels to appear.
    const createTagsBtn = page.locator('button', { hasText: /create tags?/i });
    await createTagsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await createTagsBtn.click();

    const inProgressPanel = page
      .locator('board-panel')
      .filter({ has: page.locator('header .title', { hasText: /in[ -]progress/i }) })
      .first();
    await expect(inProgressPanel).toBeVisible({ timeout: 10000 });

    // Add a task via the IN_PROGRESS panel's inline-add bar — its
    // `additionalTaskFields` auto-tags the task with IN_PROGRESS_TAG.
    await inProgressPanel.locator('add-task-inline button').first().click();

    const taskName = `${testPrefix}repro7498-kanban`;
    const inlineInput = inProgressPanel.locator('add-task-bar input').first();
    await inlineInput.waitFor({ state: 'visible', timeout: 5000 });
    await inlineInput.fill(taskName);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    const inProgressTask = inProgressPanel
      .locator('planner-task')
      .filter({ hasText: taskName })
      .first();
    await expect(inProgressTask).toBeVisible({ timeout: 10000 });

    // Click the done-toggle (circle) on the task.
    await inProgressTask.hover();
    await inProgressTask.locator('done-toggle').click();
    await page.waitForTimeout(500);

    // The task should land in the DONE column. Pre-fix it would have been
    // filtered out by `excludedTagIds: [IN_PROGRESS_TAG.id]`.
    const donePanel = page
      .locator('board-panel')
      .filter({ has: page.locator('header .title', { hasText: /^done$/i }) })
      .first();
    await expect(
      donePanel.locator('planner-task').filter({ hasText: taskName }).first(),
    ).toBeVisible({ timeout: 5000 });
  });
});
