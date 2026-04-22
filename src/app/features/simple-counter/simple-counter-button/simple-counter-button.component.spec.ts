import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of, Subject } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { DateService } from 'src/app/core/date/date.service';
import { BannerService } from '../../../core/banner/banner.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { EMPTY_SIMPLE_COUNTER } from '../simple-counter.const';
import { SimpleCounter, SimpleCounterType } from '../simple-counter.model';
import { SimpleCounterService } from '../simple-counter.service';
import { SimpleCounterButtonComponent } from './simple-counter-button.component';

describe('SimpleCounterButtonComponent', () => {
  let fixture: ComponentFixture<SimpleCounterButtonComponent>;
  let tick$: Subject<{ duration: number; date: string }>;
  let simpleCounterService: jasmine.SpyObj<SimpleCounterService>;

  const TODAY = '2026-04-22';

  beforeEach(async () => {
    tick$ = new Subject<{ duration: number; date: string }>();
    simpleCounterService = jasmine.createSpyObj('SimpleCounterService', [
      'getCountdownRemaining',
      'setCountdownRemaining',
      'clearCountdownRemaining',
      'increaseCounterToday',
      'toggleCounter',
    ]);
    simpleCounterService.getCountdownRemaining.and.returnValue(undefined);

    await TestBed.configureTestingModule({
      imports: [SimpleCounterButtonComponent, NoopAnimationsModule],
      providers: [
        { provide: SimpleCounterService, useValue: simpleCounterService },
        { provide: MatDialog, useValue: jasmine.createSpyObj('MatDialog', ['open']) },
        {
          provide: GlobalTrackingIntervalService,
          useValue: {
            todayDateStr$: of(TODAY),
            tick$,
          },
        },
        {
          provide: DateService,
          useValue: {
            todayStr: (): string => TODAY,
          },
        },
        {
          provide: BannerService,
          useValue: jasmine.createSpyObj('BannerService', ['open', 'dismiss']),
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SimpleCounterButtonComponent);
  });

  it('shows countdown time while a repeated countdown is running', () => {
    simpleCounterService.getCountdownRemaining.and.returnValue(60000);

    setSimpleCounterInput({ isOn: true });
    emitTick();

    expect(getExtraLabelText()).toBe('1:00');
  });

  it('keeps countdown time visible while a repeated countdown is paused', () => {
    simpleCounterService.getCountdownRemaining.and.returnValue(60000);

    setSimpleCounterInput({ isOn: false });
    emitTick();

    expect(getExtraLabelText()).toBe('1:00');
  });

  it('does not show countdown time before a repeated countdown has started', () => {
    setSimpleCounterInput({ isOn: false });
    emitTick();

    expect(getExtraLabelText()).toBeNull();
  });

  const emitTick = (duration = 0): void => {
    tick$.next({ duration, date: TODAY });
    fixture.detectChanges();
  };

  const getExtraLabelText = (): string | null => {
    return (
      fixture.nativeElement.querySelector('.extra-label')?.textContent?.trim() || null
    );
  };

  const setSimpleCounterInput = (overrides: Partial<SimpleCounter>): void => {
    const simpleCounter: SimpleCounter = {
      ...EMPTY_SIMPLE_COUNTER,
      id: 'counter1',
      title: 'Stretch',
      isEnabled: true,
      type: SimpleCounterType.RepeatedCountdownReminder,
      countdownDuration: 120000,
      countOnDay: {},
      ...overrides,
    };

    fixture.componentRef.setInput('simpleCounter', simpleCounter);
    fixture.detectChanges();
  };
});
