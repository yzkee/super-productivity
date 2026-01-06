import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { tap, withLatestFrom } from 'rxjs/operators';
import {
  upsertPluginUserData,
  deletePluginUserData,
  upsertPluginMetadata,
  deletePluginMetadata,
} from './plugin.actions';
import { selectPluginUserDataFeatureState } from './plugin-user-data.reducer';
import { selectPluginMetadataFeatureState } from './plugin-metadata.reducer';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';

/**
 * Plugin effects for persistence.
 *
 * Note: In the operation-log architecture, persistence happens automatically
 * through the operation capture meta-reducer. These effects are kept as no-ops
 * for potential future use (e.g., side effects other than persistence).
 */
@Injectable()
export class PluginEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _store = inject(Store);

  // Note: Persistence is now handled by the operation-log meta-reducer.
  // These effects are kept as placeholders for potential non-persistence side effects.

  persistPluginUserData$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(upsertPluginUserData, deletePluginUserData),
        withLatestFrom(this._store.select(selectPluginUserDataFeatureState)),
        tap(([_, _state]) => {
          // No-op: Persistence handled by operation-log
        }),
      ),
    { dispatch: false },
  );

  persistPluginMetadata$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(upsertPluginMetadata, deletePluginMetadata),
        withLatestFrom(this._store.select(selectPluginMetadataFeatureState)),
        tap(([_, _state]) => {
          // No-op: Persistence handled by operation-log
        }),
      ),
    { dispatch: false },
  );
}
