# Deadline Day Banner — Design

## Problem

When a task has a deadline set for today but isn't planned for today, the user has no proactive notification. They'd only notice by checking the planner's deadlines section or spotting the badge. Date-only deadlines (`deadlineDay`) have no reminder mechanism at all — only time-based deadlines (`deadlineWithTime`) can use `deadlineRemindAt`.

## Solution

A persistent banner (via `BannerService`) that appears when the current day has unplanned deadline tasks.

## Trigger

- Fires at day-change boundary if the app is running, or on next app open.
- Only considers date-only deadlines (`deadlineDay === todayStr`).
- Only shows tasks that are **not already planned for today** (not in TODAY tag) and **not done**.
- Does NOT affect time-based deadlines — those already use the existing reminder system.

## UI

Persistent banner with message and single action:

> "X task(s) due today not yet planned" — **[Add All to Today]**

- "Add All to Today" plans all unplanned deadline-today tasks for today.
- Banner auto-dismisses (via `hideWhen$`) when no unplanned deadline tasks remain for today.

## Implementation Pieces

1. **Selector**: `selectUnplannedDeadlineTasksForToday` — tasks where `deadlineDay === todayStr`, task ID not in TODAY tag's task IDs, and `isDone === false`.
2. **Banner ID**: New `BannerId.DeadlinesToday` with moderate priority (similar to `StartTrackingReminder`).
3. **Effect**: Watches the selector, opens the banner when tasks exist, auto-closes via `hideWhen$` when empty.
4. **Action handler**: On "Add All to Today", dispatches `planTasksForToday` for all returned task IDs.
5. **Translation key**: Banner message in `en.json`.

## Scope Exclusions

- No approaching-deadline warnings (future enhancement).
- No change to time-based deadline reminders (already handled by `deadlineRemindAt` + reminder worker).
- No per-task actions in the banner — just bulk "Add All to Today".
