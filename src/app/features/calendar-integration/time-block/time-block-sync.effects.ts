import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { createEffect, ofType } from '@ngrx/effects';
import { EMPTY, Observable, from } from 'rxjs';
import { catchError, concatMap, filter, map, first } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskService } from '../../tasks/task.service';
import { Task } from '../../tasks/task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../../planner/store/planner.actions';
import { PluginHttpService } from '../../../plugins/issue-provider/plugin-http.service';
import { PluginIssueProviderRegistryService } from '../../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { PluginHttp } from '../../../plugins/issue-provider/plugin-issue-provider.model';
import { selectEnabledIssueProviders } from '../../issue/store/issue-provider.selectors';
import { IssueProviderPluginType } from '../../issue/issue.model';
import { SnackService } from '../../../core/snack/snack.service';
import { getErrorTxt } from '../../../util/get-error-text';
import { TimeBlockDeleteSidecarService } from './time-block-delete-sidecar.service';

const GCAL_API = 'https://www.googleapis.com/calendar/v3';
const GCAL_PLUGIN_KEY = 'plugin:google-calendar-provider';

/**
 * Derive a deterministic Google Calendar event ID from a task ID.
 * Google Calendar event IDs: base32hex chars (a-v, 0-9), 5-1024 length.
 * SP task IDs are UUIDs (hex 0-9a-f + hyphens) — strip non-base32hex chars.
 */
const taskIdToGcalEventId = (taskId: string): string =>
  'sp' + taskId.replace(/[^a-v0-9]/g, '');

const gcalEventUrl = (calendarId: string, eventId?: string): string => {
  const base = `${GCAL_API}/calendars/${encodeURIComponent(calendarId)}/events`;
  return eventId ? `${base}/${encodeURIComponent(eventId)}` : base;
};

const toUTCISO = (ts: number): string => new Date(ts).toISOString();

const getTimeBlockCalendarId = (cfg: Record<string, unknown>): string =>
  (cfg['timeBlockCalendarId'] as string) ||
  (cfg['writeCalendarId'] as string) ||
  'primary';

const isHttpStatus = (err: unknown, status: number): boolean =>
  typeof err === 'object' &&
  err !== null &&
  'status' in err &&
  (err as { status: number }).status === status;

interface TimeBlockContext {
  http: PluginHttp;
  calendarId: string;
}

@Injectable()
export class TimeBlockSyncEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _pluginRegistry = inject(PluginIssueProviderRegistryService);
  private readonly _pluginHttpService = inject(PluginHttpService);
  private readonly _snackService = inject(SnackService);
  private readonly _deletesSidecar = inject(TimeBlockDeleteSidecarService);

  /**
   * When a task is scheduled or rescheduled, create/update the time-block event.
   */
  createOrUpdateOnSchedule$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.scheduleTaskWithTime,
          TaskSharedActions.reScheduleTaskWithTime,
          TaskSharedActions.applyShortSyntax,
        ),
        map((action) => {
          if (action.type === TaskSharedActions.applyShortSyntax.type) {
            const a = action as ReturnType<typeof TaskSharedActions.applyShortSyntax>;
            if (!a.schedulingInfo?.dueWithTime) return null;
            return { taskId: a.task.id, dueWithTime: a.schedulingInfo.dueWithTime };
          }
          const a = action as ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>;
          return { taskId: a.task.id, dueWithTime: a.dueWithTime };
        }),
        filter((v): v is { taskId: string; dueWithTime: number } => v !== null),
        concatMap(({ taskId, dueWithTime }) =>
          this._withTimeBlockContext$((ctx) =>
            this._taskService
              .getByIdOnce$(taskId)
              .pipe(
                concatMap((task) =>
                  from(this._createOrUpdateEvent(ctx, task, dueWithTime)).pipe(
                    catchError((err) => this._handleError('sync time block', err)),
                  ),
                ),
              ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When title or timeEstimate changes on a scheduled task, update the event.
   */
  updateOnFieldChange$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter((action) => {
          const changes = action.task.changes;
          return 'title' in changes || 'timeEstimate' in changes || 'isDone' in changes;
        }),
        concatMap((action) =>
          this._taskService.getByIdOnce$(action.task.id as string).pipe(
            filter((task) => !!task?.dueWithTime),
            concatMap((task) =>
              this._withTimeBlockContext$((ctx) =>
                from(this._updateEventFields(ctx, task, action.task.changes)).pipe(
                  catchError((err) => this._handleError('update time block', err)),
                ),
              ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a task is unscheduled or moved to day-only, delete the time-block event.
   */
  deleteOnUnschedule$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.unscheduleTask,
          PlannerActions.planTaskForDay,
          PlannerActions.transferTask,
          PlannerActions.moveBeforeTask,
        ),
        map((action): string | null => {
          if (action.type === TaskSharedActions.unscheduleTask.type) {
            return (action as ReturnType<typeof TaskSharedActions.unscheduleTask>).id;
          }
          if (action.type === PlannerActions.planTaskForDay.type) {
            const a = action as ReturnType<typeof PlannerActions.planTaskForDay>;
            return a.task.dueWithTime ? a.task.id : null;
          }
          if (action.type === PlannerActions.transferTask.type) {
            const a = action as ReturnType<typeof PlannerActions.transferTask>;
            return a.task.dueWithTime ? a.task.id : null;
          }
          // moveBeforeTask
          const a = action as ReturnType<typeof PlannerActions.moveBeforeTask>;
          return a.fromTask.dueWithTime ? a.fromTask.id : null;
        }),
        filter((taskId): taskId is string => taskId !== null),
        concatMap((taskId) =>
          this._withTimeBlockContext$((ctx) =>
            from(this._deleteEvent(ctx, taskId)).pipe(
              catchError((err) => this._handleError('delete time block', err)),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a single task is deleted, delete its time-block event.
   */
  deleteOnTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        filter(({ task }) => !!task.dueWithTime),
        concatMap(({ task }) =>
          this._withTimeBlockContext$((ctx) =>
            from(this._deleteEvent(ctx, task.id)).pipe(
              catchError((err) => this._handleError('delete time block', err)),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When tasks are bulk-deleted, delete their time-block events.
   * Task IDs with dueWithTime are captured by the sidecar before dispatch.
   */
  deleteOnBulkTaskDelete$: Observable<unknown> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTasks),
        concatMap(() => {
          const taskIds = this._deletesSidecar.consume();
          if (!taskIds.length) return EMPTY;
          return this._withTimeBlockContext$((ctx) =>
            from(taskIds).pipe(
              concatMap((taskId) =>
                from(this._deleteEvent(ctx, taskId)).pipe(
                  catchError((err) => this._handleError('delete time block', err)),
                ),
              ),
            ),
          );
        }),
      ),
    { dispatch: false },
  );

  // --- Helpers ---

  /**
   * Find the first enabled Google Calendar provider with isAutoTimeBlock,
   * create an authenticated HTTP helper, and run the callback.
   * Returns EMPTY if no provider is configured.
   */
  private _withTimeBlockContext$<T>(
    fn: (ctx: TimeBlockContext) => Observable<T>,
  ): Observable<T> {
    return this._store.select(selectEnabledIssueProviders).pipe(
      first(),
      concatMap((providers) => {
        const provider = providers.find(
          (p): p is IssueProviderPluginType =>
            p.issueProviderKey === GCAL_PLUGIN_KEY &&
            !!(p as IssueProviderPluginType).pluginConfig?.['isAutoTimeBlock'],
        );
        if (!provider) return EMPTY;

        const definition = this._pluginRegistry.getProvider(GCAL_PLUGIN_KEY)?.definition;
        if (!definition) return EMPTY;

        const http = this._pluginHttpService.createHttpHelper(() =>
          definition.getHeaders(provider.pluginConfig),
        );
        const calendarId = getTimeBlockCalendarId(provider.pluginConfig);
        return fn({ http, calendarId });
      }),
    );
  }

  private async _createOrUpdateEvent(
    ctx: TimeBlockContext,
    task: Task,
    dueWithTime: number,
  ): Promise<void> {
    const eventId = taskIdToGcalEventId(task.id);
    const duration = Math.max(task.timeEstimate - task.timeSpent, 0) || 30 * 60 * 1000;
    const body = {
      id: eventId,
      summary: task.isDone ? `[DONE] ${task.title}` : task.title,
      start: { dateTime: toUTCISO(dueWithTime) },
      end: { dateTime: toUTCISO(dueWithTime + duration) },
      extendedProperties: { private: { spTaskId: task.id } },
    };

    try {
      await ctx.http.post(gcalEventUrl(ctx.calendarId), body);
    } catch (err) {
      if (isHttpStatus(err, 409)) {
        // Event already exists — update instead
        await ctx.http.patch(gcalEventUrl(ctx.calendarId, eventId), {
          summary: body.summary,
          start: body.start,
          end: body.end,
        });
      } else {
        throw err;
      }
    }
  }

  private async _updateEventFields(
    ctx: TimeBlockContext,
    task: Task,
    changes: Partial<Task>,
  ): Promise<void> {
    const dueWithTime = task.dueWithTime;
    if (!dueWithTime) return;

    const eventId = taskIdToGcalEventId(task.id);
    const patch: Record<string, unknown> = {};

    // Determine the effective isDone and title (post-reducer values are on `task`)
    const isDone = 'isDone' in changes ? !!changes.isDone : task.isDone;
    const title = ('title' in changes && changes.title) || task.title;

    if ('isDone' in changes || 'title' in changes) {
      patch['summary'] = isDone ? `[DONE] ${title}` : title;
    }
    if ('timeEstimate' in changes) {
      const duration =
        Math.max((changes.timeEstimate ?? 0) - task.timeSpent, 0) || 30 * 60 * 1000;
      patch['start'] = { dateTime: toUTCISO(dueWithTime) };
      patch['end'] = { dateTime: toUTCISO(dueWithTime + duration) };
    }

    if (Object.keys(patch).length === 0) return;

    try {
      await ctx.http.patch(gcalEventUrl(ctx.calendarId, eventId), patch);
    } catch (err) {
      if (isHttpStatus(err, 404)) {
        // Event was deleted externally — recreate
        await this._createOrUpdateEvent(ctx, task, dueWithTime);
      } else {
        throw err;
      }
    }
  }

  private async _deleteEvent(ctx: TimeBlockContext, taskId: string): Promise<void> {
    const eventId = taskIdToGcalEventId(taskId);
    try {
      await ctx.http.delete(gcalEventUrl(ctx.calendarId, eventId));
    } catch (err) {
      if (!isHttpStatus(err, 404)) throw err;
    }
  }

  private _handleError(action: string, err: unknown): Observable<never> {
    console.error(`[TimeBlock] Failed to ${action}`, err);
    this._snackService.open({
      type: 'ERROR',
      msg: `Failed to ${action}: ${getErrorTxt(err)}`,
    });
    return EMPTY;
  }
}
