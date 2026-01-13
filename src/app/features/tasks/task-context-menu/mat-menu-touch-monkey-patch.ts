import { MatMenuTrigger, MatMenuItem } from '@angular/material/menu';
import { IS_TOUCH_PRIMARY } from '../../../util/is-mouse-primary';

/**
 * Shared timestamp tracking when any menu opens.
 * Used by both the monkey patch and MenuTouchFixDirective.
 */
export let lastMenuOpenTime = 0;

/**
 * Update the shared menu open timestamp. Called by the monkey patch.
 */
export const setLastMenuOpenTime = (time: number): void => {
  lastMenuOpenTime = time;
};

/**
 * Monkey patch for Angular Material menu to fix automatic selection issue on touch devices
 * when submenu opens under user's finger near screen edges.
 *
 * Issue: https://github.com/super-productivity/super-productivity/issues/4436
 * Related: https://github.com/angular/components/issues/27508
 *
 * IMPORTANT: This patch depends on Angular Material internal APIs that may change between versions.
 * If Angular Material is updated and menus break on touch devices, check:
 *
 * 1. Run: npm run test:file src/app/features/tasks/task-context-menu/mat-menu-touch-monkey-patch.spec.ts
 *    - If tests fail, the internal APIs have changed
 *
 * 2. Current API dependencies (as of @angular/material 21.x):
 *    - MatMenuItem.prototype._checkDisabled(event) - click handler we override
 *    - MatMenuTrigger.prototype.openMenu() - we intercept to track timing
 *    - MatMenu._allItems - QueryList of menu items
 *    - MatMenuItem._elementRef.nativeElement - DOM element access
 *
 * 3. History of API changes:
 *    - Pre-21.x: Used MatMenuItem.prototype._handleClick
 *    - 21.x+: Changed to MatMenuItem.prototype._checkDisabled
 */
export const applyMatMenuTouchMonkeyPatch = (): void => {
  console.log(
    '[MatMenuPatch] applyMatMenuTouchMonkeyPatch called, IS_TOUCH_PRIMARY:',
    IS_TOUCH_PRIMARY,
  );

  if (!IS_TOUCH_PRIMARY) {
    console.log('[MatMenuPatch] Skipping patch - not a touch device');
    return;
  }

  // Store original methods
  const originalOpenMenu = MatMenuTrigger.prototype.openMenu;
  const originalCheckDisabled = (MatMenuItem.prototype as any)._checkDisabled;

  console.log(
    '[MatMenuPatch] Original _checkDisabled exists:',
    typeof originalCheckDisabled === 'function',
  );

  const TOUCH_DELAY_MS = 300;

  // Override MatMenuTrigger.openMenu
  MatMenuTrigger.prototype.openMenu = function (this: MatMenuTrigger): void {
    setLastMenuOpenTime(Date.now());
    console.log('[MatMenuPatch] openMenu called, lastMenuOpenTime:', lastMenuOpenTime);

    // Call original method
    originalOpenMenu.call(this);

    // Add delay for touch devices
    if (this.menu && (this.menu as any)._allItems) {
      // Temporarily disable all menu items
      const items = (this.menu as any)._allItems.toArray();
      console.log('[MatMenuPatch] Disabling pointer-events on', items.length, 'items');
      items.forEach((item) => {
        const element = item._elementRef.nativeElement as HTMLElement;
        element.style.pointerEvents = 'none';
      });

      // Re-enable after delay
      setTimeout(() => {
        console.log('[MatMenuPatch] Re-enabling pointer-events');
        items.forEach((item) => {
          const element = item._elementRef.nativeElement as HTMLElement;
          element.style.pointerEvents = '';
        });
      }, TOUCH_DELAY_MS);
    }
  };

  // Override MatMenuItem._checkDisabled (was _handleClick in older Angular Material versions)
  (MatMenuItem.prototype as any)._checkDisabled = function (
    this: MatMenuItem,
    event: MouseEvent,
  ): void {
    const timeSinceMenuOpen = Date.now() - lastMenuOpenTime;
    console.log(
      '[MatMenuPatch] _checkDisabled called, timeSinceMenuOpen:',
      timeSinceMenuOpen,
      'isTrusted:',
      event.isTrusted,
    );

    // On touch devices, prevent clicks that happen too quickly after menu opens
    if (event.isTrusted && timeSinceMenuOpen < TOUCH_DELAY_MS) {
      console.log('[MatMenuPatch] BLOCKING click - too soon after menu open');
      event.preventDefault();
      // stopImmediatePropagation prevents OTHER handlers on the SAME element from firing
      // (stopPropagation only prevents bubbling UP to parent elements)
      event.stopImmediatePropagation();
      return;
    }

    console.log('[MatMenuPatch] ALLOWING click');
    // Call original method for disabled check
    originalCheckDisabled.call(this, event);
  };

  console.log('[MatMenuPatch] Patch applied successfully');

  // Use MutationObserver to detect when ANY menu panel appears (including submenus)
  // This is necessary because Angular Material 21 may not call openMenu() for submenus
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const addedNodes = Array.from(mutation.addedNodes);
      for (const node of addedNodes) {
        if (node instanceof HTMLElement) {
          // Check if a menu panel was added (directly or as descendant)
          const menuPanel =
            node.classList?.contains('mat-mdc-menu-panel') ||
            node.querySelector?.('.mat-mdc-menu-panel');
          if (menuPanel) {
            setLastMenuOpenTime(Date.now());
            console.log(
              '[MatMenuPatch] Menu panel detected via MutationObserver, lastMenuOpenTime:',
              lastMenuOpenTime,
            );
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // CRITICAL: Add document-level capturing listener to intercept clicks on menu items
  // BEFORE they reach Angular's event handlers. Adding capturing listener to the
  // target element itself doesn't work because Angular's handlers run at the same phase.
  document.addEventListener(
    'click',
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target) return;

      // Check if click is on a menu item (or inside one)
      const menuItem = target.closest('.mat-mdc-menu-item');
      if (!menuItem) return;

      const timeSinceMenuOpen = Date.now() - lastMenuOpenTime;
      console.log(
        '[MatMenuPatch] Document capturing click on menu item:',
        'timeSinceMenuOpen:',
        timeSinceMenuOpen,
        'isTrusted:',
        event.isTrusted,
      );

      // Block clicks that happen too quickly after menu opened
      if (event.isTrusted && lastMenuOpenTime > 0 && timeSinceMenuOpen < TOUCH_DELAY_MS) {
        console.log(
          '[MatMenuPatch] BLOCKING click via document capture - too soon after menu open',
        );
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true, // CAPTURING phase - runs before target's handlers
  );

  // Note: Menu positioning edge fixes are handled by the CSS touch fixes instead
  // to avoid conflicts with Angular Material's internal positioning strategy
};

/**
 * Call this function once during app initialization to apply the monkey patch
 */
export const initializeMatMenuTouchFix = (): void => {
  if (typeof window !== 'undefined' && IS_TOUCH_PRIMARY) {
    // Apply patch after Angular Material is loaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyMatMenuTouchMonkeyPatch);
    } else {
      // If DOM is already loaded, apply immediately
      setTimeout(applyMatMenuTouchMonkeyPatch, 0);
    }
  }
};
