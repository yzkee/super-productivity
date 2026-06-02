import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { EMPTY, of } from 'rxjs';
import { TaskDetailPanelComponent } from './task-detail-panel.component';
import { TaskService } from '../task.service';
import { TaskAttachmentService } from '../task-attachment/task-attachment.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { IssueService } from '../../issue/issue.service';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { TaskWithSubTasks } from '../task.model';
import { TaskDetailItemComponent } from './task-additional-info-item/task-detail-item.component';

const fakeTask = (id: string): TaskWithSubTasks =>
  ({ id, subTasks: [], tagIds: [] }) as unknown as TaskWithSubTasks;

/**
 * Regression coverage for the #6578 stale-focus race: a deferred auto-focus
 * scheduled while the panel showed one task must not steal focus once the
 * panel has switched to a different task (e.g. the user arrow-navigated the
 * list). The e2e suite only surfaces this under load, so the timing is proven
 * deterministically here with fakeAsync.
 */
describe('TaskDetailPanelComponent stale-focus guard', () => {
  let component: TaskDetailPanelComponent;
  let fixture: ComponentFixture<TaskDetailPanelComponent>;

  const makeItem = (): TaskDetailItemComponent =>
    ({
      elementRef: { nativeElement: { focus: jasmine.createSpy('focus') } },
    }) as unknown as TaskDetailItemComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TaskDetailPanelComponent],
      providers: [
        {
          provide: TaskService,
          useValue: {
            taskDetailPanelTargetPanel$: EMPTY,
            selectedTaskId: () => undefined,
            getByIdWithSubTaskData$: () => of(null),
            update: () => undefined,
            setSelectedId: () => undefined,
            focusTaskIfPossible: () => undefined,
          },
        },
        { provide: TaskAttachmentService, useValue: {} },
        { provide: LayoutService, useValue: {} },
        { provide: GlobalConfigService, useValue: { cfg: () => ({}) } },
        { provide: IssueService, useValue: { getById$: () => of(null) } },
        {
          provide: TaskRepeatCfgService,
          useValue: { getTaskRepeatCfgByIdAllowUndefined$: () => of(null) },
        },
        { provide: DateTimeFormatService, useValue: { currentLocale: () => 'en-US' } },
        { provide: MatDialog, useValue: {} },
        { provide: Store, useValue: { select: () => EMPTY, dispatch: () => undefined } },
        { provide: TranslateService, useValue: { instant: (k: string) => k } },
      ],
    })
      // Drop the real template/child components — only the focus timing logic is under test.
      .overrideComponent(TaskDetailPanelComponent, {
        set: { template: '', imports: [], schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TaskDetailPanelComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('task', fakeTask('B'));
    fixture.detectChanges();
  });

  it('does not auto-focus the panel when the task changed before the timer fires', fakeAsync(() => {
    // One rendered item so the unguarded code path *would* call focusItem.
    (component as unknown as { itemEls: () => TaskDetailItemComponent[] }).itemEls =
      () => [makeItem()];
    const focusItemSpy = spyOn(component, 'focusItem');

    // Scheduled while showing task B...
    (component as unknown as { _focusFirst: () => void })._focusFirst();
    // ...then the user navigates the list to task A before the 150ms timer fires.
    fixture.componentRef.setInput('task', fakeTask('A'));

    tick(200);

    expect(focusItemSpy).not.toHaveBeenCalled();
  }));

  it('auto-focuses the first item when the task is unchanged', fakeAsync(() => {
    (component as unknown as { itemEls: () => TaskDetailItemComponent[] }).itemEls =
      () => [makeItem()];
    const focusItemSpy = spyOn(component, 'focusItem');

    (component as unknown as { _focusFirst: () => void })._focusFirst();

    tick(200);

    expect(focusItemSpy).toHaveBeenCalled();
  }));

  it('focusItem does not steal focus once the panel switched tasks', fakeAsync(() => {
    const item = makeItem();
    (component as unknown as { itemEls: () => TaskDetailItemComponent[] }).itemEls =
      () => [item];

    component.focusItem(item, 0);
    fixture.componentRef.setInput('task', fakeTask('A'));

    tick(50);

    expect(item.elementRef.nativeElement.focus).not.toHaveBeenCalled();
  }));
});
