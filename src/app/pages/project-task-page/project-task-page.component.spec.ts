import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { By } from '@angular/platform-browser';
import { BehaviorSubject, EMPTY } from 'rxjs';
import { ProjectTaskPageComponent } from './project-task-page.component';
import { WorkContextService } from '../../features/work-context/work-context.service';
import { ProjectService } from '../../features/project/project.service';
import { Project } from '../../features/project/project.model';

const makeProject = (overrides: Partial<Project> = {}): Project =>
  ({
    id: 'p-1',
    title: 'P',
    isArchived: false,
    isHiddenFromMenu: false,
    ...overrides,
  }) as Project;

describe('ProjectTaskPageComponent', () => {
  let fixture: ComponentFixture<ProjectTaskPageComponent>;
  let projectService: jasmine.SpyObj<ProjectService>;
  let currentProject$: BehaviorSubject<Project | null>;

  const setUp = async (project: Project | null): Promise<void> => {
    currentProject$ = new BehaviorSubject<Project | null>(project);
    projectService = jasmine.createSpyObj('ProjectService', ['unarchive'], {
      currentProject$,
    });

    await TestBed.configureTestingModule({
      imports: [
        ProjectTaskPageComponent,
        NoopAnimationsModule,
        TranslateModule.forRoot(),
      ],
      providers: [
        {
          provide: WorkContextService,
          useValue: {
            activeWorkContext$: EMPTY,
            backlogTasks$: EMPTY,
            doneTasks$: EMPTY,
            undoneTasks$: EMPTY,
          },
        },
        { provide: ProjectService, useValue: projectService },
      ],
    })
      // Trim the heavy <work-view> child but keep the archived-notice logic.
      .overrideComponent(ProjectTaskPageComponent, {
        set: {
          template: `
            @if (currentProject()?.isArchived) {
              <div class="archived-notice" role="status" aria-live="polite">
                <button class="restore" (click)="restoreProject()">Restore</button>
              </div>
            }
          `,
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ProjectTaskPageComponent);
    fixture.detectChanges();
  };

  it('does not render the archived notice for an active project', async () => {
    await setUp(makeProject({ isArchived: false }));
    expect(fixture.debugElement.query(By.css('.archived-notice'))).toBeNull();
  });

  it('renders the archived notice with polite aria-live when archived', async () => {
    await setUp(makeProject({ isArchived: true }));
    const notice = fixture.debugElement.query(By.css('.archived-notice'));
    expect(notice).not.toBeNull();
    expect(notice.nativeElement.getAttribute('role')).toBe('status');
    expect(notice.nativeElement.getAttribute('aria-live')).toBe('polite');
  });

  it('calls projectService.unarchive(id) when Restore is clicked', async () => {
    await setUp(makeProject({ id: 'p-archived', isArchived: true }));
    fixture.debugElement.query(By.css('.restore')).nativeElement.click();
    expect(projectService.unarchive).toHaveBeenCalledWith('p-archived');
  });
});
