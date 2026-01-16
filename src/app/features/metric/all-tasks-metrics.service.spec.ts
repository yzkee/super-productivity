/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed, fakeAsync, tick, flush } from '@angular/core/testing';
import { AllTasksMetricsService } from './all-tasks-metrics.service';
import { TaskService } from '../tasks/task.service';
import { WorklogService } from '../worklog/worklog.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { TimeTrackingService } from '../time-tracking/time-tracking.service';
import { BehaviorSubject } from 'rxjs';
import { createTask } from '../tasks/task.test-helper';
import { Worklog } from '../worklog/worklog.model';
import { TimeTrackingState } from '../time-tracking/time-tracking.model';

describe('AllTasksMetricsService', () => {
  let service: AllTasksMetricsService;
  let taskService: jasmine.SpyObj<TaskService>;
  let isAllDataLoadedInitially$: BehaviorSubject<boolean>;
  let worklog$: BehaviorSubject<Worklog>;
  let totalTimeSpent$: BehaviorSubject<number>;
  let timeTrackingState$: BehaviorSubject<TimeTrackingState>;

  const createWorklog = (timeSpent: number): Worklog => {
    return {
      2025: {
        timeSpent,
        daysWorked: 1,
        monthWorked: 1,
        ent: {
          1: {
            timeSpent,
            daysWorked: 1,
            weeks: [],
            ent: {
              15: {
                timeSpent,
                logEntries: [],
                dateStr: '2025-01-15',
                dayStr: '2025-01-15',
                workStart: Date.now(),
                workEnd: Date.now(),
              },
            },
          },
        },
      },
    };
  };

  const createTimeTrackingState = (
    overrides: Partial<TimeTrackingState> = {},
  ): TimeTrackingState => {
    return {
      project: {},
      tag: {},
      ...overrides,
    };
  };

  beforeEach(() => {
    isAllDataLoadedInitially$ = new BehaviorSubject<boolean>(false);
    worklog$ = new BehaviorSubject<Worklog>(createWorklog(10000));
    totalTimeSpent$ = new BehaviorSubject<number>(10000);
    timeTrackingState$ = new BehaviorSubject<TimeTrackingState>(
      createTimeTrackingState(),
    );

    const taskServiceSpy = jasmine.createSpyObj('TaskService', ['getAllTasksEverywhere']);
    const worklogServiceSpy = jasmine.createSpyObj('WorklogService', [], {
      worklog$: worklog$.asObservable(),
      totalTimeSpent$: totalTimeSpent$.asObservable(),
    });
    const dataInitStateServiceSpy = jasmine.createSpyObj('DataInitStateService', [], {
      isAllDataLoadedInitially$: isAllDataLoadedInitially$.asObservable(),
    });
    const timeTrackingServiceSpy = jasmine.createSpyObj('TimeTrackingService', [], {
      state$: timeTrackingState$.asObservable(),
    });

    // Default return values
    taskServiceSpy.getAllTasksEverywhere.and.returnValue(
      Promise.resolve([createTask({ id: '1' })]),
    );

    TestBed.configureTestingModule({
      providers: [
        AllTasksMetricsService,
        { provide: TaskService, useValue: taskServiceSpy },
        { provide: WorklogService, useValue: worklogServiceSpy },
        { provide: DataInitStateService, useValue: dataInitStateServiceSpy },
        { provide: TimeTrackingService, useValue: timeTrackingServiceSpy },
      ],
    });

    service = TestBed.inject(AllTasksMetricsService);
    taskService = TestBed.inject(TaskService) as jasmine.SpyObj<TaskService>;
  });

  describe('Signal creation', () => {
    it('should create simpleMetrics signal', () => {
      expect(service.simpleMetrics).toBeDefined();
    });

    it('should return undefined initially (before data is loaded)', () => {
      expect(service.simpleMetrics()).toBeUndefined();
    });

    it('should wait for data to be loaded initially', fakeAsync(() => {
      // Trigger data load
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeDefined();
    }));
  });

  describe('Break aggregation across all contexts', () => {
    it('should aggregate break numbers across all projects', fakeAsync(() => {
      const state = createTimeTrackingState({
        project: {
          'project-1': {
            '2025-01-15': { b: 2, bt: 600000 },
            '2025-01-16': { b: 1, bt: 300000 },
          },
          'project-2': {
            '2025-01-15': { b: 3, bt: 900000 },
          },
        },
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics).toBeDefined();
      // 2025-01-15: 2 + 3 = 5 breaks
      // 2025-01-16: 1 break
      // Total: 6 breaks
      expect(metrics?.breakNr).toBe(6);
    }));

    it('should aggregate break times across all projects', fakeAsync(() => {
      const state = createTimeTrackingState({
        project: {
          'project-1': {
            '2025-01-15': { b: 2, bt: 600000 },
          },
          'project-2': {
            '2025-01-15': { b: 1, bt: 300000 },
          },
        },
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakTime).toBe(900000); // 600000 + 300000
    }));

    it('should aggregate breaks across all tags', fakeAsync(() => {
      const state = createTimeTrackingState({
        tag: {
          'tag-1': {
            '2025-01-15': { b: 1, bt: 300000 },
          },
          'tag-2': {
            '2025-01-15': { b: 2, bt: 600000 },
          },
        },
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(3); // 1 + 2
      expect(metrics?.breakTime).toBe(900000); // 300000 + 600000
    }));

    it('should aggregate breaks across both projects and tags', fakeAsync(() => {
      const state = createTimeTrackingState({
        project: {
          'project-1': {
            '2025-01-15': { b: 2, bt: 600000 },
          },
        },
        tag: {
          'tag-1': {
            '2025-01-15': { b: 1, bt: 300000 },
          },
        },
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(3); // 2 + 1
      expect(metrics?.breakTime).toBe(900000); // 600000 + 300000
    }));

    it('should handle empty time tracking state', fakeAsync(() => {
      const state = createTimeTrackingState({
        project: {},
        tag: {},
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(0);
      expect(metrics?.breakTime).toBe(0);
    }));

    it('should handle projects/tags with no break data', fakeAsync(() => {
      const state = createTimeTrackingState({
        project: {
          'project-1': {
            '2025-01-15': { s: 1000, e: 2000 }, // No breaks (b or bt)
          },
        },
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(0);
      expect(metrics?.breakTime).toBe(0);
    }));
  });

  describe('Task aggregation', () => {
    it('should aggregate tasks from all projects and archives', fakeAsync(() => {
      const allTasks = [
        createTask({ id: '1', projectId: 'project-1' }),
        createTask({ id: '2', projectId: 'project-2' }),
        createTask({ id: '3', projectId: 'project-1' }),
      ];

      taskService.getAllTasksEverywhere.and.returnValue(Promise.resolve(allTasks));
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      expect(taskService.getAllTasksEverywhere).toHaveBeenCalled();

      const metrics = service.simpleMetrics();
      expect(metrics?.nrOfAllTasks).toBe(3);
    }));

    it('should handle empty task list', fakeAsync(() => {
      taskService.getAllTasksEverywhere.and.returnValue(Promise.resolve([]));
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.nrOfAllTasks).toBe(0);
      expect(metrics?.nrOfCompletedTasks).toBe(0);
    }));

    it('should count completed tasks correctly', fakeAsync(() => {
      const allTasks = [
        createTask({ id: '1', isDone: true }),
        createTask({ id: '2', isDone: false }),
        createTask({ id: '3', isDone: true }),
      ];

      taskService.getAllTasksEverywhere.and.returnValue(Promise.resolve(allTasks));
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.nrOfCompletedTasks).toBe(2);
      expect(metrics?.nrOfAllTasks).toBe(3);
    }));
  });

  describe('Worklog integration', () => {
    it('should use total worklog across all contexts', fakeAsync(() => {
      const worklog = createWorklog(25000);
      worklog$.next(worklog);
      totalTimeSpent$.next(25000);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.timeSpent).toBe(25000);
      expect(metrics?.daysWorked).toBe(1);
    }));

    it('should handle empty worklog', fakeAsync(() => {
      worklog$.next({});
      totalTimeSpent$.next(0);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.timeSpent).toBe(0);
      expect(metrics?.daysWorked).toBe(0);
    }));
  });

  describe('Edge cases', () => {
    it('should handle archived tasks', fakeAsync(() => {
      // getAllTasksEverywhere() includes both active and archived tasks
      const allTasks = [
        createTask({ id: '1' }),
        createTask({ id: '2' }), // Archived task
      ];

      taskService.getAllTasksEverywhere.and.returnValue(Promise.resolve(allTasks));
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.nrOfAllTasks).toBe(2);
    }));

    it('should apply 100ms delay before processing', fakeAsync(() => {
      isAllDataLoadedInitially$.next(true);

      // Before delay completes
      tick(50);
      expect(service.simpleMetrics()).toBeUndefined();

      // After delay completes
      tick(150);
      flush();
      expect(service.simpleMetrics()).toBeDefined();
    }));

    it('should use take(1) to prevent redraws', fakeAsync(() => {
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const firstMetrics = service.simpleMetrics();
      expect(firstMetrics).toBeDefined();

      // Update worklog - should NOT trigger new metrics calculation
      worklog$.next(createWorklog(99999));
      tick(200);
      flush();

      const secondMetrics = service.simpleMetrics();
      // Metrics should still be the same (take(1) prevents re-emission)
      expect(secondMetrics).toBe(firstMetrics);
    }));

    it('should handle multiple date entries in break data', fakeAsync(() => {
      const state = createTimeTrackingState({
        project: {
          'project-1': {
            '2025-01-14': { b: 1, bt: 300000 },
            '2025-01-15': { b: 2, bt: 600000 },
            '2025-01-16': { b: 1, bt: 300000 },
          },
        },
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(4); // 1 + 2 + 1
      expect(metrics?.breakTime).toBe(1200000); // 300000 + 600000 + 300000
    }));

    it('should handle break data with undefined or null values', fakeAsync(() => {
      const state = createTimeTrackingState({
        project: {
          'project-1': {
            '2025-01-15': { b: 2, bt: undefined as any },
          },
          'project-2': {
            '2025-01-15': { b: undefined as any, bt: 600000 },
          },
        },
      });

      timeTrackingState$.next(state);
      isAllDataLoadedInitially$.next(true);

      tick(200);
      flush();

      const metrics = service.simpleMetrics();
      expect(metrics?.breakNr).toBe(2); // Only project-1's b is valid
      expect(metrics?.breakTime).toBe(600000); // Only project-2's bt is valid
    }));
  });
});
