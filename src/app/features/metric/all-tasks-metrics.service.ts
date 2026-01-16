import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { combineLatest, from, Observable } from 'rxjs';
import { SimpleMetrics } from './metric.model';
import { delay, map, switchMap, take } from 'rxjs/operators';
import { mapSimpleMetrics } from './metric.util';
import { TaskService } from '../tasks/task.service';
import { WorklogService } from '../worklog/worklog.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { BreakNr, BreakTime } from '../work-context/work-context.model';
import { TimeTrackingState } from '../time-tracking/time-tracking.model';

@Injectable({
  providedIn: 'root',
})
export class AllTasksMetricsService {
  private _taskService = inject(TaskService);
  private _worklogService = inject(WorklogService);
  private _dataInitStateService = inject(DataInitStateService);
  private _timeTrackingService = inject(TimeTrackingService);

  private _simpleMetricsObs$: Observable<SimpleMetrics> =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      // wait for data to settle
      delay(100),
      switchMap(() =>
        combineLatest([
          this._getAllBreakNr$(),
          this._getAllBreakTime$(),
          this._worklogService.worklog$,
          this._worklogService.totalTimeSpent$,
          from(this._taskService.getAllTasksEverywhere()),
        ]).pipe(
          map(mapSimpleMetrics),
          // prevent constant redraws
          take(1),
        ),
      ),
    );

  simpleMetrics = toSignal(this._simpleMetricsObs$);

  /**
   * Aggregate break numbers across all projects and tags
   * Returns a map of date string -> total break count for that date
   */
  private _getAllBreakNr$(): Observable<BreakNr> {
    return this._timeTrackingService.state$.pipe(
      map((state) => this._aggregateBreaksAcrossContexts(state, 'b')),
    );
  }

  /**
   * Aggregate break times across all projects and tags
   * Returns a map of date string -> total break time (ms) for that date
   */
  private _getAllBreakTime$(): Observable<BreakTime> {
    return this._timeTrackingService.state$.pipe(
      map((state) => this._aggregateBreaksAcrossContexts(state, 'bt')),
    );
  }

  /**
   * Aggregates break data (number or time) across all work contexts (projects and tags)
   * @param state TimeTrackingState containing all time tracking data
   * @param field 'b' for break number, 'bt' for break time
   * @returns Aggregated break data by date
   */
  private _aggregateBreaksAcrossContexts(
    state: TimeTrackingState,
    field: 'b' | 'bt',
  ): BreakNr | BreakTime {
    const result: { [key: string]: number } = {};

    // Aggregate from all projects
    Object.values(state.project).forEach((projectData) => {
      Object.entries(projectData).forEach(([dateStr, dayData]) => {
        if (typeof dayData?.[field] === 'number') {
          result[dateStr] = (result[dateStr] || 0) + dayData[field];
        }
      });
    });

    // Aggregate from all tags
    Object.values(state.tag).forEach((tagData) => {
      Object.entries(tagData).forEach(([dateStr, dayData]) => {
        if (typeof dayData?.[field] === 'number') {
          result[dateStr] = (result[dateStr] || 0) + dayData[field];
        }
      });
    });

    return result;
  }
}
