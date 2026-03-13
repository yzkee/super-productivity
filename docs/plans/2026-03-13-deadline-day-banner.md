# Deadline Day Banner — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a persistent banner when there are unplanned deadline tasks for today, with a one-click "Add All to Today" action.

**Architecture:** A new NgRx selector computes unplanned deadline-today tasks. An effect watches this selector and opens/closes a banner via `BannerService`. The banner's action dispatches `planTasksForToday` for all matching task IDs.

**Tech Stack:** Angular 19+, NgRx, BannerService, TypeScript strict mode

**Design Doc:** `docs/plans/2026-03-13-deadline-day-banner-design.md`

---

## Task 1: Add the selector

**Files:**
- Modify: `src/app/features/tasks/store/task.selectors.ts`

**Step 1: Add `selectUnplannedDeadlineTasksForToday`**

Add after `selectUndoneOverdueDeadlineTasks`. This selector finds tasks where `deadlineDay === todayStr`, the task is not done, and the task ID is NOT in the today task list.

Note: We cannot import `selectTodayTaskIds` from `work-context.selectors.ts` due to circular dependencies (task selectors are imported by work-context selectors). Use `selectTodayTagTaskIds` from `tag.reducer.ts` and `computeOrderedTaskIdsForToday` pattern, or use the simpler approach: check `task.dueDay === todayStr` on the task itself (which is how TODAY membership is determined). A task is "planned for today" if its `dueDay === todayStr` or `dueWithTime` falls within today.

```typescript
export const selectUnplannedDeadlineTasksForToday = createSelector(
  selectTaskFeatureState,
  selectTodayStr,
  selectStartOfNextDayDiffMs,
  (taskState, todayStr, startOfNextDayDiffMs): Task[] => {
    const today = dateStrToUtcDate(todayStr);
    today.setHours(0, 0, 0, 0);
    const todayStartMs = today.getTime() + startOfNextDayDiffMs;
    const todayEndMs = todayStartMs + 24 * 60 * 60 * 1000;

    return taskState.ids
      .map((id) => taskState.entities[id])
      .filter(
        (task): task is Task =>
          !!task &&
          !task.isDone &&
          // Has a date-only deadline for today
          task.deadlineDay === todayStr &&
          // Not already planned for today (dueDay or dueWithTime)
          task.dueDay !== todayStr &&
          !(task.dueWithTime && task.dueWithTime >= todayStartMs && task.dueWithTime < todayEndMs),
      );
  },
);
```

**Step 2: Run checkFile**

```bash
npm run checkFile src/app/features/tasks/store/task.selectors.ts
```

**Step 3: Commit**

```
feat(tasks): add selector for unplanned deadline tasks for today
```

---

## Task 2: Add BannerId and translation keys

**Files:**
- Modify: `src/app/core/banner/banner.model.ts`
- Modify: `src/assets/i18n/en.json`
- Modify: `src/app/t.const.ts`

**Step 1: Add `DeadlinesToday` to `BannerId` enum and priority map**

In `banner.model.ts`, add to the enum:

```typescript
DeadlinesToday = 'DeadlinesToday',
```

Add to `BANNER_SORT_PRIO_MAP` with priority 3 (same as TimeEstimateExceeded — important but not as urgent as calendar events or reminders):

```typescript
[BannerId.DeadlinesToday]: 3,
```

**Step 2: Add translation keys**

In `en.json`, add to the `F.TASK.B` section:

```json
"DEADLINES_TODAY": "{{count}} task(s) due today not yet planned",
"ADD_ALL_TO_TODAY": "Add all to today"
```

In `t.const.ts`, add to `F.TASK.B`:

```typescript
DEADLINES_TODAY: 'F.TASK.B.DEADLINES_TODAY',
ADD_ALL_TO_TODAY: 'F.TASK.B.ADD_ALL_TO_TODAY',
```

**Step 3: Run checkFile on all modified files**

```bash
npm run checkFile src/app/core/banner/banner.model.ts
npm run checkFile src/assets/i18n/en.json
npm run checkFile src/app/t.const.ts
```

**Step 4: Commit**

```
feat(tasks): add banner ID and translation keys for deadline-today banner
```

---

## Task 3: Add the banner effect

**Files:**
- Modify: `src/app/features/tasks/store/task-ui.effects.ts`

**Step 1: Add the deadline banner effect**

Follow the existing `timeEstimateExceeded$` pattern. Add to `TaskUiEffects`:

```typescript
deadlineTodayBanner$ = createEffect(
  () =>
    this._store$.select(selectUnplannedDeadlineTasksForToday).pipe(
      skipWhileApplyingRemoteOps(),
      distinctUntilChanged((a, b) => a.length === b.length && a.every((t, i) => t.id === b[i].id)),
      tap((tasks) => {
        if (tasks.length > 0) {
          this._bannerService.open({
            id: BannerId.DeadlinesToday,
            ico: 'flag',
            msg: T.F.TASK.B.DEADLINES_TODAY,
            translateParams: { count: tasks.length },
            action: {
              label: T.F.TASK.B.ADD_ALL_TO_TODAY,
              fn: () => {
                this._store$.dispatch(
                  TaskSharedActions.planTasksForToday({
                    taskIds: tasks.map((t) => t.id),
                  }),
                );
              },
            },
            hideWhen$: this._store$.select(selectUnplannedDeadlineTasksForToday).pipe(
              filter((t) => t.length === 0),
            ),
          });
        }
      }),
    ),
  { dispatch: false },
);
```

**Step 2: Add required imports**

Add imports for `selectUnplannedDeadlineTasksForToday`, `BannerId`, `TaskSharedActions`, and `skipWhileApplyingRemoteOps`.

Check which of these are already imported in the file and only add the missing ones.

**Step 3: Run checkFile**

```bash
npm run checkFile src/app/features/tasks/store/task-ui.effects.ts
```

**Step 4: Commit**

```
feat(tasks): add deadline-today banner effect
```

---

## Verification

### Manual Testing

1. **Start dev server:** `ng serve`
2. **Set a date-only deadline for today** on a task that is NOT planned for today. Verify banner appears.
3. **Click "Add all to today"** — verify tasks move to today and banner disappears.
4. **Set deadline for today on a task already planned for today** — verify NO banner appears.
5. **Mark deadline task as done** — verify banner disappears (or count updates).
6. **Set deadline for tomorrow** — verify no banner.

### Automated

```bash
npm run checkFile <each-modified-file>
npm run lint
npm test
```

### Key Files Modified

| File | Change |
|------|--------|
| `src/app/features/tasks/store/task.selectors.ts` | New selector |
| `src/app/core/banner/banner.model.ts` | New BannerId + priority |
| `src/assets/i18n/en.json` | Translation keys |
| `src/app/t.const.ts` | Translation constants |
| `src/app/features/tasks/store/task-ui.effects.ts` | Banner effect |
