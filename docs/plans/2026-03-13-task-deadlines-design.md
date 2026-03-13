# Task Deadlines Feature Design

**Issue:** [#4328](https://github.com/super-productivity/super-productivity/issues/4328)
**Date:** 2026-03-13

## Problem

Users need to distinguish between "when I plan to work on this" (scheduling) and "when this must be done by" (deadline). Currently, only scheduling exists via `dueDay`/`dueWithTime`. Users work around this by putting dates in task titles or using tags like `hard-due`.

## Design Decisions

- Deadlines are **completely independent** from scheduled dates. A task can have both.
- Deadline is **date-only by default, optional time** — keeps the common case simple.
- Visual indicators use **color-coded badges** in task list rows (green/amber/red based on urgency). No dedicated "Overdue" virtual tag in this iteration.
- Reminders **reuse the existing reminder system** — users can optionally set a reminder relative to the deadline.
- Set via **task detail panel only** — a new item below the existing schedule item, opens a date picker dialog.
- Subtask deadlines are **completely independent** from parent task deadlines. No inheritance.
- **No external issue provider mapping** in initial scope.

## Data Model

New optional fields on `TaskCopy` (in `src/app/features/tasks/task.model.ts`):

```typescript
/** Deadline date as ISO string (YYYY-MM-DD). For deadlines without a specific time. */
deadlineDay?: string | null;

/** Deadline as Unix timestamp (ms). For deadlines with a specific time. */
deadlineWithTime?: number | null;

/** Reminder timestamp for the deadline. */
deadlineRemindAt?: number | null;
```

### Mutual Exclusivity

Same pattern as `dueDay`/`dueWithTime` (Architecture Decision #1):
- When `deadlineWithTime` is set, `deadlineDay` must be cleared
- When `deadlineDay` is set, `deadlineWithTime` must be cleared
- When reading, check `deadlineWithTime` first (it takes priority)

### No Migration Needed

All fields are optional (`?`) and not added to `DEFAULT_TASK`. Existing tasks are unaffected.

### New Type Guard

```typescript
export interface TaskWithDeadline extends Task {
  deadlineDay: string;
}
// or deadlineWithTime variant
```

## UI: Task Detail Panel

A new `task-detail-item` placed directly below the existing schedule item (after line 141 in `task-detail-panel.component.html`).

- **Icon:** `event_busy` (calendar with X — distinct from schedule icons)
- **Label:** "Deadline" when empty, "Due by" when set, "Overdue!" when past deadline
- **Value:** Formatted deadline date/time
- **Edit action:** Opens `DialogDeadlineComponent`
- **Color:** `color-warn` when overdue

### DialogDeadlineComponent

A new dialog with:
- Date picker (required)
- Optional time toggle (expands to time picker)
- Optional reminder dropdown (reusing `TaskReminderOptionId`)
- Remove deadline button (when editing)

## UI: Task List Row Badge

A deadline badge in the task row controls area (in `task.component.html`), next to the existing schedule indicator.

- **Always visible** when a deadline is set (not hover-only)
- **Shows:** `event_busy` icon + deadline date (e.g., "Mar 20")
- **Color coding:**
  - Default — 3+ days away
  - Amber (`color-accent`) — within 2 days
  - Red (`color-warn`) — overdue (past deadline, task not done)
- **Tooltip:** Full date/time + "X days remaining" or "X days overdue"

## Overdue Detection

Computed signal, same pattern as existing `isOverdue`:

```typescript
isDeadlineOverdue = computed(() => {
  const t = this.task();
  if (t.isDone) return false;
  if (t.deadlineWithTime) return t.deadlineWithTime < Date.now();
  if (t.deadlineDay) return t.deadlineDay < getDbDateStr();
  return false;
});
```

Deadline proximity (amber badge): check if deadline is within 2 days.

## NgRx State Management

### Actions (in `task-shared.actions.ts`)

- `setDeadline` — `{ taskId: string, deadlineDay?: string, deadlineWithTime?: number, deadlineRemindAt?: number }`
- `removeDeadline` — `{ taskId: string }`

### Reducer (new meta-reducer)

- `setDeadline`: Updates task entity, enforces mutual exclusivity, registers reminder if provided
- `removeDeadline`: Clears all three deadline fields, unregisters deadline reminder

### Effects (using `LOCAL_ACTIONS`)

- Register/unregister deadline reminders with `ReminderService` when deadlines are set/removed

### Sync

New fields are plain task properties — they flow through existing op-log persistence and sync automatically. No special handling needed.

## Reminders

- `deadlineRemindAt` is a timestamp, same as `remindAt` for scheduling
- New `ReminderType` value `'TASK_DEADLINE'` to distinguish deadline reminders in notifications
- Offset calculated relative to deadline using existing `TaskReminderOptionId` options
- Existing `ReminderService` handles notification firing

## Translation Keys (en.json only)

- `F.TASK.ADDITIONAL_INFO.DEADLINE` — "Deadline"
- `F.TASK.ADDITIONAL_INFO.DUE_BY` — "Due by"
- `F.TASK.ADDITIONAL_INFO.OVERDUE_DEADLINE` — "Overdue!"
- `F.TASK.DEADLINE.SET_DEADLINE` — "Set deadline"
- `F.TASK.DEADLINE.REMOVE_DEADLINE` — "Remove deadline"
- `F.TASK.DEADLINE.ADD_TIME` — "Add time"
- `F.TASK.DEADLINE.DAYS_LEFT` — "{count} days left"
- `F.TASK.DEADLINE.DAYS_OVERDUE` — "{count} days overdue"
- `F.TASK.DEADLINE.DUE_TODAY` — "Due today"

## Config

No new global config settings. Deadlines reuse existing `ReminderConfig` for notification behavior.

## Out of Scope (Future Iterations)

- Overdue virtual tag/view
- External issue provider deadline mapping
- Subtask deadline inheritance
- Timeline/Gantt view
- Partial task scheduling
- Start dates
