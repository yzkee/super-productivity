import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  OnInit,
  Renderer2,
  viewChild,
} from '@angular/core';
import { MatMiniFabButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { TagComponent } from '../../../features/tag/tag/tag.component';
import { fadeAnimation } from '../../../ui/animations/fade.ani';
import { expandFadeHorizontalAnimation } from '../../../ui/animations/expand.ani';
import { T } from '../../../t.const';
import { Task } from '../../../features/tasks/task.model';
import { WorkContext } from '../../../features/work-context/work-context.model';
import { TaskService } from '../../../features/tasks/task.service';
import { animationFrameScheduler, Subscription } from 'rxjs';
import { distinctUntilChanged, observeOn } from 'rxjs/operators';
import { NavigateToTaskService } from '../../navigate-to-task/navigate-to-task.service';
import { lazySetInterval } from '../../../util/lazy-set-interval';

@Component({
  selector: 'play-button',
  standalone: true,
  imports: [MatMiniFabButton, MatIcon, MatTooltip, TranslatePipe, TagComponent],
  template: `
    <div class="play-btn-wrapper">
      @if (currentTask(); as task) {
        <div
          @fade
          class="current-task-title"
          (click)="navigateToCurrentTask()"
          matTooltip="{{ T.MH.SHOW_TRACKED_TASK | translate }}"
          matTooltipPosition="below"
        >
          <div class="title">{{ task.title }}</div>
          @if (currentTaskContext(); as taskContext) {
            <tag
              @expandFadeHorizontal
              [tag]="taskContext"
              class="project"
            ></tag>
          }
        </div>
      }
      @if (currentTaskId()) {
        <div
          #pulseCircle
          class="pulse-circle"
        ></div>
      }

      @if (hasTimeEstimate) {
        <svg
          class="circle-svg"
          focusable="false"
          height="36"
          width="36"
        >
          <circle
            #circleSvg
            cx="50%"
            cy="50%"
            fill="none"
            r="10"
            stroke="currentColor"
            stroke-dasharray="62.83185307179586"
            stroke-dashoffset="0"
            stroke-width="20"
          ></circle>
        </svg>
      }

      <button
        (click)="taskService.toggleStartTask()"
        [color]="currentTaskId() ? 'accent' : 'primary'"
        [matTooltip]="tooltipText() | translate"
        matTooltipPosition="below"
        class="play-btn tour-playBtn mat-elevation-z3"
        mat-mini-fab
        [disabled]="isDisabled()"
      >
        @if (!currentTaskId()) {
          <mat-icon>play_arrow</mat-icon>
        } @else {
          <mat-icon>pause</mat-icon>
        }
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }

      /* Finite pulse animation played once per trigger (not infinite).
       * An infinite CSS animation forces the compositor to run at 60fps
       * continuously, causing ~5-10% CPU and ~30% GPU even when idle.
       * Instead, this finite animation is triggered periodically via JS
       * (see effect() in the component class). */
      @keyframes pulse-once {
        0% {
          transform: scale(0.7);
        }
        40% {
          transform: scale(1);
        }
        100% {
          transform: scale(0.7);
        }
      }

      .play-btn-wrapper {
        position: relative;
        margin: 0 6px;

        .pulse-circle {
          width: 42px;
          height: 42px;
          position: absolute;
          top: 0;
          left: -3px;
          right: 0;
          bottom: 0;
          border-radius: 50%;
          margin: auto;
          transform: scale(0.7);
          background: var(--c-accent);
          opacity: 0.6;

          /* Promote to own GPU layer so the pulse animation does not
           * trigger repaints of the button or icon above it. */
          will-change: transform;

          &.do-pulse {
            animation: pulse-once 2s ease-in-out 1;
          }
        }

        .circle-svg {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          margin: auto;
          transform: rotate(-90deg);
          opacity: 0.15;
          pointer-events: none;
          z-index: 3;
        }

        .play-btn {
          position: relative;
          margin-left: 0;
          z-index: 6;
          box-shadow: var(--whiteframe-shadow-2dp);

          .mat-icon {
            position: relative;
            z-index: 2;
            font-variation-settings:
              'FILL' 1,
              'wght' 400,
              'GRAD' 0,
              'opsz' 24;
          }
        }
      }

      .current-task-title {
        position: absolute;
        right: 100%;
        width: auto;
        border: 1.5px solid var(--c-accent);
        border-radius: 10px;
        min-width: 40px;
        white-space: nowrap;
        padding: calc(var(--s-half) * 0.75) var(--s);
        padding-right: calc(var(--s) * 2.25);
        margin-right: calc(-1 * var(--s) * 1.75);
        top: 50%;
        transform: translateY(-50%);
        transition: opacity 0.3s ease-out;
        display: flex;
        background: var(--bg-lighter);
        font-size: 13px;
        z-index: 5;
        cursor: pointer;

        @media (max-width: 1080px) {
          display: none;
        }

        .title {
          max-width: 200px;
          text-overflow: ellipsis;
          overflow: hidden;
        }

        .project {
          max-width: 130px;
          padding-right: 0;
          padding-left: var(--s-half);
          font-size: 12px;
          overflow: hidden;
          text-overflow: ellipsis;

          ::ng-deep .tag-title {
            overflow: hidden;
            text-overflow: ellipsis;
            display: block;
          }
        }
      }
    `,
  ],
  animations: [fadeAnimation, expandFadeHorizontalAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PlayButtonComponent implements OnInit, OnDestroy {
  private _renderer = inject(Renderer2);
  private _cd = inject(ChangeDetectorRef);
  private _navigateToTaskService = inject(NavigateToTaskService);

  readonly T = T;
  readonly taskService = inject(TaskService);

  readonly currentTask = input<Task | null>();
  readonly currentTaskId = input<string | null>();
  readonly currentTaskContext = input<WorkContext | null>();
  readonly hasTrackableTasks = input<boolean>(true);
  readonly circleSvg = viewChild<ElementRef<SVGCircleElement>>('circleSvg');
  readonly pulseCircle = viewChild<ElementRef<HTMLElement>>('pulseCircle');

  readonly isDisabled = computed(
    () => !this.currentTaskId() && !this.hasTrackableTasks(),
  );
  readonly tooltipText = computed(() =>
    this.isDisabled() ? T.MH.NO_TASKS_TO_TRACK : T.MH.TOGGLE_TRACK_TIME,
  );

  private _subs = new Subscription();
  private circumference = 10 * 2 * Math.PI; // ~62.83
  protected hasTimeEstimate = false;
  constructor() {
    // Intermittent pulse animation to indicate active time tracking.
    //
    // Performance note (see https://github.com/super-productivity/super-productivity/issues/6076):
    // CSS `animation: infinite` forces the browser compositor to run at 60fps
    // continuously, even for a simple scale transform. This caused ~5-10% CPU
    // and ~30% GPU usage while tracking.
    //
    // Fix: use a finite CSS animation (`animation-iteration-count: 1`) triggered
    // periodically via lazySetInterval. The compositor goes fully idle between
    // pulses. Combined with `will-change: transform` on the pulse element (which
    // promotes it to its own GPU layer), the animation does not cause repaints of
    // surrounding elements (button, icon).
    effect((onCleanup) => {
      const el = this.pulseCircle()?.nativeElement;
      const isTracking = !!this.currentTaskId();

      if (el && isTracking) {
        // Trigger an initial pulse immediately
        el.classList.add('do-pulse');

        // Remove the class when the animation finishes so it can be re-triggered
        const onAnimEnd = (): void => el.classList.remove('do-pulse');
        el.addEventListener('animationend', onAnimEnd);

        // Re-trigger the pulse every 5s (animation itself is 2s, leaving 3s idle)
        const stopInterval = lazySetInterval(() => {
          el.classList.add('do-pulse');
        }, 5000);

        // Angular calls onCleanup automatically when the effect re-runs or
        // the component is destroyed — no manual ngOnDestroy cleanup needed.
        onCleanup(() => {
          stopInterval();
          el.removeEventListener('animationend', onAnimEnd);
          el.classList.remove('do-pulse');
        });
      }
    });
  }

  ngOnInit(): void {
    // Subscribe to current task to track if it has a time estimate
    this._subs.add(
      this.taskService.currentTask$.subscribe((task) => {
        this.hasTimeEstimate = !!(task && task.timeEstimate && task.timeEstimate > 0);
        this._cd.markForCheck();
      }),
    );

    // Subscribe to task progress for circle animation
    this._subs.add(
      this.taskService.currentTaskProgress$
        .pipe(
          // Align ring updates with the frame budget and skip duplicate ratios.
          observeOn(animationFrameScheduler),
          distinctUntilChanged(),
        )
        .subscribe((progressIN) => {
          const circleSvgEl = this.circleSvg()?.nativeElement;
          if (circleSvgEl) {
            let progress = progressIN || 0;
            if (progress > 1) {
              progress = 1;
            }
            // Calculate dashoffset: 0 when 0%, negative circumference when 100%
            // This shows the completed portion of the circle
            const dashOffset = this.circumference * -progress;
            this._renderer.setStyle(circleSvgEl, 'stroke-dashoffset', dashOffset);
          }
        }),
    );
  }

  navigateToCurrentTask(): void {
    const taskId = this.currentTaskId();
    if (taskId) {
      this._navigateToTaskService.navigate(taskId);
    }
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }
}
