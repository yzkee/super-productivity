import { Location } from '@angular/common';
import {
  MatDialog,
  MatDialogConfig,
  MatDialogRef,
  MatDialogState,
} from '@angular/material/dialog';
import { DialogFullscreenMarkdownComponent } from './dialog-fullscreen-markdown.component';

/**
 * Open the fullscreen markdown editor so an in-flight edit survives a
 * navigation.
 *
 * MatDialog's default `closeOnNavigation` maps to the overlay's
 * `disposeOnNavigation`, which on a Location change (popstate/hashchange — the
 * Android back button, or the involuntary route change a window resize fires
 * when it crosses the mobile layout breakpoint) DISPOSES the overlay with no
 * result, so `afterClosed` emits `undefined` and the edit is silently dropped
 * (#8434). We opt out of it and instead close through the dialog's save path on
 * the same Location signal, so the content is routed back through `afterClosed`
 * and the caller persists it. The listener self-cleans when the dialog closes.
 *
 * Callers keep their own `afterClosed()` subscription for persistence.
 */
export const openFullscreenMarkdownDialog = (
  matDialog: MatDialog,
  location: Location,
  config: MatDialogConfig,
): MatDialogRef<DialogFullscreenMarkdownComponent> => {
  const dialogRef = matDialog.open<DialogFullscreenMarkdownComponent>(
    DialogFullscreenMarkdownComponent,
    { ...config, closeOnNavigation: false },
  );

  const locationSub = location.subscribe(() => {
    // A breakpoint-crossing resize can emit more than one popstate; only act
    // while the dialog is still open so we don't re-run its exit animation.
    if (dialogRef.getState() === MatDialogState.OPEN) {
      dialogRef.componentInstance?.close();
    }
  });
  dialogRef.afterClosed().subscribe(() => locationSub.unsubscribe());

  return dialogRef;
};
