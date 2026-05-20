import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of, Subject, Subscription } from 'rxjs';
import { CalendarIntegrationEffects } from './calendar-integration.effects';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { BannerService } from '../../../core/banner/banner.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { CalendarIntegrationService } from '../calendar-integration.service';
import { NavigateToTaskService } from '../../../core-ui/navigate-to-task/navigate-to-task.service';
import { IssueService } from '../../issue/issue.service';
import { DateService } from '../../../core/date/date.service';
import { TaskService } from '../../tasks/task.service';
import { TranslateService, TranslateStore } from '@ngx-translate/core';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { selectCalendarProviders } from '../../issue/store/issue-provider.selectors';
import { IssueProviderCalendar } from '../../issue/issue.model';
import { CalendarIntegrationEvent } from '../calendar-integration.model';

describe('CalendarIntegrationEffects pollChanges$ startup guard', () => {
  let effects: CalendarIntegrationEffects;
  let sub: Subscription;
  let addTaskFromIssueSpy: jasmine.Spy;
  let getAllIssueIdsSpy: jasmine.Spy;
  let todayDateStr$: BehaviorSubject<string>;
  let requestEvents$Spy: jasmine.Spy;
  let isInitialSyncDoneSyncSpy: jasmine.Spy;
  let isInSyncWindowSpy: jasmine.Spy;

  const PROVIDER_ID = 'ip-cal-1';

  const buildProvider = (): IssueProviderCalendar =>
    ({
      id: PROVIDER_ID,
      issueProviderKey: 'ICAL',
      isEnabled: true,
      isAutoImportForCurrentDay: true,
      icalUrl: 'https://example.com/cal.ics',
      checkUpdatesEvery: 60 * 60 * 1000,
      showBannerBeforeThreshold: 2 * 60 * 60 * 1000,
      isReferenceCalendar: false,
      isDisabledForWebApp: false,
      filterIncludeRegex: null,
      filterExcludeRegex: null,
    }) as unknown as IssueProviderCalendar;

  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const THIRTY_MINUTES_MS = 30 * 60 * 1000;

  const buildEvent = (id: string): CalendarIntegrationEvent => ({
    id,
    calProviderId: PROVIDER_ID,
    title: `Event ${id}`,
    // Start ~6h in the future so the "due" check stays false (we don't want
    // to assert on the banner branch here). isToday is stubbed to true below.
    start: Date.now() + SIX_HOURS_MS,
    duration: THIRTY_MINUTES_MS,
    issueProviderKey: 'ICAL',
  });

  beforeEach(() => {
    addTaskFromIssueSpy = jasmine.createSpy('addTaskFromIssue');
    getAllIssueIdsSpy = jasmine
      .createSpy('getAllIssueIdsForProviderEverywhere')
      .and.resolveTo([]);
    requestEvents$Spy = jasmine
      .createSpy('requestEvents$')
      .and.returnValue(of([buildEvent('cal-evt-1')]));
    isInitialSyncDoneSyncSpy = jasmine
      .createSpy('isInitialSyncDoneSync')
      .and.returnValue(true);
    isInSyncWindowSpy = jasmine.createSpy('isInSyncWindow').and.returnValue(false);

    todayDateStr$ = new BehaviorSubject<string>('2026-05-20');

    TestBed.configureTestingModule({
      providers: [
        CalendarIntegrationEffects,
        provideMockActions(() => new Subject()),
        provideMockStore({
          selectors: [{ selector: selectCalendarProviders, value: [buildProvider()] }],
        }),
        {
          provide: GlobalTrackingIntervalService,
          useValue: { todayDateStr$ },
        },
        {
          provide: BannerService,
          useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
        },
        {
          provide: TaskService,
          useValue: { getAllIssueIdsForProviderEverywhere: getAllIssueIdsSpy },
        },
        {
          provide: LocaleDatePipe,
          useValue: { transform: () => '' },
        },
        {
          provide: CalendarIntegrationService,
          useValue: {
            requestEvents$: requestEvents$Spy,
            skippedEventIds$: new BehaviorSubject<string[]>([]),
          },
        },
        {
          provide: NavigateToTaskService,
          useValue: jasmine.createSpyObj('NavigateToTaskService', ['navigate']),
        },
        {
          provide: IssueService,
          useValue: { addTaskFromIssue: addTaskFromIssueSpy },
        },
        {
          provide: DateService,
          useValue: { isToday: () => true },
        },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => k, get: (k: string) => of(k) },
        },
        { provide: TranslateStore, useValue: {} },
        {
          provide: SyncTriggerService,
          useValue: { isInitialSyncDoneSync: isInitialSyncDoneSyncSpy },
        },
        {
          provide: HydrationStateService,
          useValue: { isInSyncWindow: isInSyncWindowSpy },
        },
      ],
    });

    effects = TestBed.inject(CalendarIntegrationEffects);
  });

  afterEach(() => {
    sub?.unsubscribe();
  });

  it('imports a today event when first sync is done and we are NOT in a sync window', fakeAsync(() => {
    isInitialSyncDoneSyncSpy.and.returnValue(true);
    isInSyncWindowSpy.and.returnValue(false);

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).toHaveBeenCalledTimes(1);
    expect(addTaskFromIssueSpy.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        issueProviderId: PROVIDER_ID,
        issueDataReduced: jasmine.objectContaining({ id: 'cal-evt-1' }),
        isForceDefaultProject: true,
      }),
    );
  }));

  it('does NOT import while the initial sync has not completed (cold-start race)', fakeAsync(() => {
    isInitialSyncDoneSyncSpy.and.returnValue(false);
    isInSyncWindowSpy.and.returnValue(false);

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  }));

  it('does NOT import while we are inside the sync window (applying remote ops / post-sync cooldown)', fakeAsync(() => {
    isInitialSyncDoneSyncSpy.and.returnValue(true);
    isInSyncWindowSpy.and.returnValue(true);

    sub = effects.pollChanges$.subscribe();
    tick(0);
    flush();

    expect(addTaskFromIssueSpy).not.toHaveBeenCalled();
  }));
});
