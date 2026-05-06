import { expect, test } from '../../fixtures/test.fixture';

/**
 * Regression for #7498: clicking the done-toggle on a task in the Boards view
 * used to make the task vanish — Eisenhower's four quadrants all filtered
 * `taskDoneState: UnDone` and there was no Done column. The fix relaxes the
 * Eisenhower defaults to `All` so completed tasks stay visible in their
 * original quadrant.
 */
test.describe('Boards #7498', () => {
  test('Eisenhower: task stays visible after done-toggle', async ({
    page,
    workViewPage,
  }) => {
    await workViewPage.waitForTaskList();

    // Plain task with no tags lands in the NOT_URGENT_AND_NOT_IMPORTANT
    // quadrant (excluded: [Important, Urgent], included: []).
    await workViewPage.addTask('repro7498 task');

    await page.goto('/#/boards');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('boards')).toBeVisible({ timeout: 10000 });

    const eisenhowerTab = page
      .locator('mat-tab-group [role="tab"]')
      .filter({ hasText: /eisenhower/i })
      .first();
    await eisenhowerTab.click();

    // Default Eisenhower references Important / Urgent tags that don't exist
    // on a fresh profile — accept the auto-create prompt if shown.
    const createTagsBtn = page.locator('button', { hasText: /create tags?/i });
    if (await createTagsBtn.isVisible().catch(() => false)) {
      await createTagsBtn.click();
    }

    const task = page
      .locator('board-panel planner-task')
      .filter({ hasText: 'repro7498 task' })
      .first();
    await expect(task).toBeVisible({ timeout: 10000 });

    await task.hover();
    await task.locator('done-toggle').click();

    // Wait past the 200ms done-animation delay used in toggleDoneWithAnimation.
    await page.waitForTimeout(500);

    // Fixed behavior: the task remains visible somewhere on the board.
    await expect(
      page
        .locator('board-panel planner-task')
        .filter({ hasText: 'repro7498 task' })
        .first(),
    ).toBeVisible();
  });
});
