import { expect, test } from '../../fixtures/test.fixture';

/**
 * Bug: https://github.com/super-productivity/super-productivity/issues/7067
 *
 * An invalid `startTime` on a TaskRepeatCfg (e.g. from sync/import/migration)
 * causes `getDateTimeFromClockString()` to throw "Invalid clock string" at
 * runtime whenever a task list renders the repeat info chip.
 *
 * Reproduction steps (from the issue's first stack trace):
 *   1. A TaskRepeatCfg has startTime = "INVALID_CLOCK_STRING" in the store
 *      (arriving via sync or a legacy corrupt save).
 *   2. The tag-list component computes indicator chips for every task.
 *   3. `getTaskRepeatInfoText()` calls `getDateTimeFromClockString(startTime)`
 *      which throws: "Invalid clock string".
 *
 * Expected: The app should handle an invalid startTime gracefully (skip it or
 *           fall back to no-time display) without crashing.
 * Actual:   Error is thrown inside the computed signal, crashing the view.
 */
test('should not crash when a repeat config has an invalid startTime in the store (bug #7067)', async ({
  page,
  workViewPage,
  taskPage,
}) => {
  // ── Phase 1: Create a task with a timed repeat config ─────────────────────

  await workViewPage.waitForTaskList();
  await workViewPage.addTask('RepeatBug7067');
  const task = taskPage.getTaskByText('RepeatBug7067').first();
  await expect(task).toBeVisible({ timeout: 10000 });

  await taskPage.openTaskDetail(task);
  await page
    .locator('task-detail-item')
    .filter({ has: page.locator('mat-icon[svgIcon="repeat"]') })
    .click();

  const repeatDialog = page.locator('mat-dialog-container');
  await repeatDialog.waitFor({ state: 'visible', timeout: 10000 });

  // Set a valid startTime so the config has startTime + remindAt in the store
  await repeatDialog.locator('collapsible .collapsible-header').last().click();
  const startTimeField = repeatDialog.getByLabel(/Scheduled start time/i);
  await expect(startTimeField).toBeVisible({ timeout: 5000 });
  await startTimeField.fill('10:30');
  await startTimeField.blur();
  await page.waitForTimeout(300);

  const saveBtn = repeatDialog.getByRole('button', { name: /Save/i });
  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.click();
  await repeatDialog.waitFor({ state: 'hidden', timeout: 10000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // ── Phase 2: Corrupt the startTime directly via the Angular store ─────────
  // In Angular dev mode, ng.getComponent(el) exposes component instances.
  // We walk the DOM to find a component that has an NgRx store injected,
  // then dispatch updateTaskRepeatCfg with an invalid startTime — simulating
  // data corruption from sync/import.
  const corrupted = await page.evaluate((): boolean => {
    const ng = (window as any).ng;
    if (!ng?.getComponent) return false;

    for (const el of Array.from(document.querySelectorAll('*'))) {
      try {
        const comp = ng.getComponent(el) as any;
        if (!comp) continue;
        const store = comp._store ?? comp.store ?? comp.__store;
        if (!store?.dispatch) continue;

        let state: any = null;
        store
          .subscribe((s: any) => {
            state = s;
          })
          .unsubscribe();

        if (!state?.taskRepeatCfg?.ids?.length) continue;

        // Find the config we just created (startTime === '10:30')
        const cfgId = state.taskRepeatCfg.ids.find(
          (id: string) => state.taskRepeatCfg.entities[id]?.startTime === '10:30',
        );
        if (!cfgId) continue;

        store.dispatch({
          type: '[TaskRepeatCfg] Update TaskRepeatCfg',
          taskRepeatCfg: { id: cfgId, changes: { startTime: 'INVALID_CLOCK_STRING' } },
        });
        return true;
      } catch {
        // ignore
      }
    }
    return false;
  });

  expect(corrupted).toBe(true); // guard: verify injection worked

  // ── Phase 3: Verify the crash ─────────────────────────────────────────────
  // The tag-list component computes indicator chips which call
  // getTaskRepeatInfoText → getDateTimeFromClockString → throws.

  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/#/tag/TODAY/tasks');
  await page.waitForTimeout(2000);

  // EXPECTED (after fix): no "Invalid clock string" error.
  // ACTUAL (current bug): error thrown, crashing the computed signal.
  const clockErrors = pageErrors.filter((e) => e.includes('Invalid clock string'));
  expect(clockErrors).toHaveLength(0);
});
