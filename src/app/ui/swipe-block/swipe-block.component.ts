import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  Renderer2,
  signal,
  viewChild,
} from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { PanDirective, PanEvent } from '../swipe-gesture/pan.directive';
import { IS_TOUCH_PRIMARY } from '../../util/is-mouse-primary';

/** Scale factor so the swipe block reaches full width at 50% pan distance */
const PAN_SCALE_FACTOR = 2;

@Component({
  selector: 'swipe-block',
  templateUrl: './swipe-block.component.html',
  styleUrl: './swipe-block.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatIcon, PanDirective],
})
export class SwipeBlockComponent implements OnDestroy {
  readonly isDone = input<boolean>(false);
  readonly canSwipe = input<boolean>(true);
  readonly excludeSelector = input<string>('');
  readonly swipeRight = output<void>();
  readonly swipeLeft = output<void>();

  readonly IS_TOUCH_PRIMARY = IS_TOUCH_PRIMARY;

  readonly isPanHelperVisible = signal(false);
  readonly isPreventPointerEventsWhilePanning = signal(false);
  private _isLockPanLeft = false;
  private _isLockPanRight = false;
  private _isActionTriggered = false;

  readonly blockLeftEl = viewChild<ElementRef>('blockLeftEl');
  readonly blockRightEl = viewChild<ElementRef>('blockRightEl');
  readonly innerWrapperEl = viewChild<ElementRef>('innerWrapperEl');

  private readonly _renderer = inject(Renderer2);
  private readonly _elementRef = inject(ElementRef);
  private _currentPanTimeout?: number;
  private _panHelperVisibilityTimeout?: number;
  private readonly _snapBackHideDelayMs = 200;
  private _cachedWidth = 0;

  ngOnDestroy(): void {
    window.clearTimeout(this._currentPanTimeout);
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
    }
  }

  onPanStart(ev: PanEvent): void {
    if (!IS_TOUCH_PRIMARY || !this.canSwipe()) {
      return;
    }
    this._resetAfterPan();
    const targetEl = ev.target as HTMLElement | null;
    const exclude = this.excludeSelector();
    if (
      (exclude && targetEl?.closest(exclude)) ||
      Math.abs(ev.deltaY) > Math.abs(ev.deltaX) ||
      ev.isFinal
    ) {
      this._hidePanHelper();
      return;
    }
    this._showPanHelper();
    this.isPreventPointerEventsWhilePanning.set(true);
    this._cachedWidth = this._elementRef.nativeElement.offsetWidth;
  }

  onPanEnd(): void {
    if (!IS_TOUCH_PRIMARY || (!this._isLockPanLeft && !this._isLockPanRight)) {
      return;
    }
    const blockLeftElRef = this.blockLeftEl();
    const blockRightElRef = this.blockRightEl();
    const hideDelay = this._snapBackHideDelayMs;

    this.isPreventPointerEventsWhilePanning.set(false);
    if (blockLeftElRef) {
      this._renderer.removeStyle(blockLeftElRef.nativeElement, 'transition');
    }
    if (blockRightElRef) {
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transition');
    }

    if (this._currentPanTimeout) {
      window.clearTimeout(this._currentPanTimeout);
    }

    if (this._isActionTriggered) {
      if (this._isLockPanLeft) {
        if (blockRightElRef) {
          this._renderer.setStyle(
            blockRightElRef.nativeElement,
            'transform',
            `scaleX(1)`,
          );
        }
        this._currentPanTimeout = window.setTimeout(() => {
          this.swipeLeft.emit();
          this._resetAfterPan(hideDelay);
        }, 100);
      } else if (this._isLockPanRight) {
        if (blockLeftElRef) {
          this._renderer.setStyle(blockLeftElRef.nativeElement, 'transform', `scaleX(1)`);
        }
        this._currentPanTimeout = window.setTimeout(() => {
          this.swipeRight.emit();
          this._resetAfterPan(hideDelay);
        }, 100);
      }
    } else {
      this._resetAfterPan(hideDelay);
    }
  }

  onPanCancel(): void {
    this._resetAfterPan(this._snapBackHideDelayMs);
  }

  handlePan(ev: PanEvent): void {
    if (!IS_TOUCH_PRIMARY) {
      return;
    }
    const innerWrapperElRef = this.innerWrapperEl();
    const blockLeftElRef = this.blockLeftEl();
    const blockRightElRef = this.blockRightEl();
    if (!innerWrapperElRef || !blockLeftElRef || !blockRightElRef) {
      return;
    }

    const isPanningRight = ev.deltaX > 0;
    const isPanningLeft = ev.deltaX < 0;

    this._isLockPanRight = isPanningRight;
    this._isLockPanLeft = isPanningLeft;

    const targetRef = isPanningRight ? blockLeftElRef : blockRightElRef;

    this.isPreventPointerEventsWhilePanning.set(true);

    this._renderer.setStyle(blockLeftElRef.nativeElement, 'width', '0');
    this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
    this._renderer.removeClass(blockLeftElRef.nativeElement, 'isActive');
    this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');

    if (targetRef && ev.deltaX !== 0) {
      let scale = (Math.abs(ev.deltaX) / (this._cachedWidth || 1)) * PAN_SCALE_FACTOR;
      scale = Math.min(1, Math.max(0, scale));

      if (scale > 0.5) {
        this._isActionTriggered = true;
        this._renderer.addClass(targetRef.nativeElement, 'isActive');
      } else {
        this._isActionTriggered = false;
      }

      const moveBy = Math.abs(ev.deltaX);
      this._renderer.setStyle(targetRef.nativeElement, 'width', `${moveBy}px`);
      this._renderer.setStyle(targetRef.nativeElement, 'transition', `none`);
      this._renderer.setStyle(
        innerWrapperElRef.nativeElement,
        'transform',
        `translateX(${ev.deltaX}px)`,
      );
    }
  }

  private _showPanHelper(): void {
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
      this._panHelperVisibilityTimeout = undefined;
    }
    this.isPanHelperVisible.set(true);
  }

  private _hidePanHelper(delayMs: number = 0): void {
    if (this._panHelperVisibilityTimeout) {
      window.clearTimeout(this._panHelperVisibilityTimeout);
    }
    if (delayMs > 0) {
      this._panHelperVisibilityTimeout = window.setTimeout(() => {
        this.isPanHelperVisible.set(false);
        this._panHelperVisibilityTimeout = undefined;
      }, delayMs);
    } else {
      this.isPanHelperVisible.set(false);
      this._panHelperVisibilityTimeout = undefined;
    }
  }

  private _resetAfterPan(hideDelay: number = 0): void {
    if (this._currentPanTimeout) {
      window.clearTimeout(this._currentPanTimeout);
      this._currentPanTimeout = undefined;
    }
    const blockLeftElRef = this.blockLeftEl();
    const blockRightElRef = this.blockRightEl();
    const innerWrapperElRef = this.innerWrapperEl();
    this.isPreventPointerEventsWhilePanning.set(false);
    this._isActionTriggered = false;
    this._isLockPanLeft = false;
    this._isLockPanRight = false;
    if (blockLeftElRef) {
      this._renderer.removeClass(blockLeftElRef.nativeElement, 'isActive');
      this._renderer.setStyle(blockLeftElRef.nativeElement, 'width', '0');
      this._renderer.removeStyle(blockLeftElRef.nativeElement, 'transition');
      this._renderer.removeStyle(blockLeftElRef.nativeElement, 'transform');
    }
    if (blockRightElRef) {
      this._renderer.removeClass(blockRightElRef.nativeElement, 'isActive');
      this._renderer.setStyle(blockRightElRef.nativeElement, 'width', '0');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transition');
      this._renderer.removeStyle(blockRightElRef.nativeElement, 'transform');
    }
    if (innerWrapperElRef) {
      this._renderer.setStyle(innerWrapperElRef.nativeElement, 'transform', ``);
    }
    this._hidePanHelper(hideDelay);
  }
}
