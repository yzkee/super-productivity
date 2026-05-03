import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { NEVER, of, Subject } from 'rxjs';
import { ReminderModule } from './reminder.module';
import { ReminderService } from './reminder.service';
import { SnackService } from '../../core/snack/snack.service';
import { UiHelperService } from '../ui-helper/ui-helper.service';
import { NotifyService } from '../../core/notify/notify.service';
import { LayoutService } from '../../core-ui/layout/layout.service';
import { TaskService } from '../tasks/task.service';
import { SyncTriggerService } from '../../imex/sync/sync-trigger.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { GlobalConfigService } from '../config/global-config.service';
import { CapacitorReminderService } from '../../core/platform/capacitor-reminder.service';
import {
  NOTIFICATION_ACTION,
  NotificationActionEvent,
} from '../../core/platform/capacitor-notification.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { Task } from '../tasks/task.model';

describe('ReminderModule iOS notification actions', () => {
  let module: ReminderModule;
  let storeSpy: jasmine.SpyObj<Store>;
  let taskServiceSpy: jasmine.SpyObj<TaskService>;
  let syncWrapperSpy: jasmine.SpyObj<SyncWrapperService>;

  const task = {
    id: 'task-1',
    title: 'Task 1',
    isDone: false,
    dueWithTime: 123,
    deadlineDay: '2026-05-04',
    deadlineWithTime: 456,
  } as Task;

  const handleIOSNotificationAction = (event: NotificationActionEvent): Promise<void> =>
    (
      module as unknown as {
        _handleIOSNotificationAction: (event: NotificationActionEvent) => Promise<void>;
      }
    )._handleIOSNotificationAction(event);

  beforeEach(() => {
    const action$ = new Subject<NotificationActionEvent>();

    storeSpy = jasmine.createSpyObj('Store', ['dispatch']);
    taskServiceSpy = jasmine.createSpyObj('TaskService', [
      'currentTaskId',
      'focusTask',
      'getByIdOnce$',
      'setDone',
    ]);
    taskServiceSpy.currentTaskId.and.returnValue(null);
    taskServiceSpy.getByIdOnce$.and.returnValue(of(task));

    syncWrapperSpy = jasmine.createSpyObj('SyncWrapperService', ['sync']);
    syncWrapperSpy.sync.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        ReminderModule,
        {
          provide: ReminderService,
          useValue: jasmine.createSpyObj('ReminderService', ['init'], {
            onRemindersActive$: NEVER,
          }),
        },
        {
          provide: MatDialog,
          useValue: jasmine.createSpyObj('MatDialog', ['open'], { openDialogs: [] }),
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        {
          provide: UiHelperService,
          useValue: jasmine.createSpyObj('UiHelperService', ['focusApp']),
        },
        {
          provide: NotifyService,
          useValue: jasmine.createSpyObj('NotifyService', ['notify']),
        },
        {
          provide: LayoutService,
          useValue: jasmine.createSpyObj('LayoutService', ['isShowAddTaskBar']),
        },
        { provide: TaskService, useValue: taskServiceSpy },
        {
          provide: SyncTriggerService,
          useValue: { afterInitialSyncDoneAndDataLoadedInitially$: NEVER },
        },
        { provide: SyncWrapperService, useValue: syncWrapperSpy },
        { provide: Store, useValue: storeSpy },
        { provide: GlobalConfigService, useValue: { cfg: () => ({}) } },
        {
          provide: CapacitorReminderService,
          useValue: jasmine.createSpyObj('CapacitorReminderService', ['initialize'], {
            action$,
          }),
        },
      ],
    });

    module = TestBed.inject(ReminderModule);
  });

  it('snoozes iOS deadline notification actions via setDeadline', async () => {
    spyOn(Date, 'now').and.returnValue(1_000);

    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.SNOOZE_10M,
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'DEADLINE' },
    });

    expect(storeSpy.dispatch).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: TaskSharedActions.setDeadline.type,
        taskId: 'task-1',
        deadlineDay: '2026-05-04',
        deadlineWithTime: 456,
        deadlineRemindAt: 601_000,
      }),
    );
  });

  it('keeps regular iOS task snooze behavior unchanged', async () => {
    spyOn(Date, 'now').and.returnValue(1_000);

    await handleIOSNotificationAction({
      actionId: NOTIFICATION_ACTION.SNOOZE_1H,
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'TASK' },
    });

    expect(storeSpy.dispatch).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: TaskSharedActions.reScheduleTaskWithTime.type,
        task,
        remindAt: 3_601_000,
        dueWithTime: 123,
        isMoveToBacklog: false,
      }),
    );
  });

  it('clears deadline reminder when tapping an iOS deadline notification', async () => {
    await handleIOSNotificationAction({
      actionId: 'tap',
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'DEADLINE' },
    });

    expect(storeSpy.dispatch).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        type: TaskSharedActions.clearDeadlineReminder.type,
        taskId: 'task-1',
      }),
    );
    expect(taskServiceSpy.focusTask).toHaveBeenCalledOnceWith('task-1');
  });

  it('does not dismiss regular reminders when tapping an iOS due-date notification', async () => {
    await handleIOSNotificationAction({
      actionId: 'tap',
      notificationId: 1,
      extra: { relatedId: 'task-1', reminderType: 'DUE_DATE' },
    });

    expect(storeSpy.dispatch).not.toHaveBeenCalled();
    expect(taskServiceSpy.focusTask).toHaveBeenCalledOnceWith('task-1');
  });
});
