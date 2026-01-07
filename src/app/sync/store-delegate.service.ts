import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { combineLatest, firstValueFrom } from 'rxjs';
import { first } from 'rxjs/operators';

import { selectBoardsState } from '../features/boards/store/boards.selectors';
import { selectConfigFeatureState } from '../features/config/store/global-config.reducer';
import { selectIssueProviderState } from '../features/issue/store/issue-provider.selectors';
import { selectMenuTreeState } from '../features/menu-tree/store/menu-tree.selectors';
import { selectMetricFeatureState } from '../features/metric/store/metric.selectors';
import { selectPluginUserDataFeatureState } from '../plugins/store/plugin-user-data.reducer';
import { selectPluginMetadataFeatureState } from '../plugins/store/plugin-metadata.reducer';
import { selectReminderFeatureState } from '../features/reminder/store/reminder.reducer';
import { selectNoteFeatureState } from '../features/note/store/note.reducer';
import { selectPlannerState } from '../features/planner/store/planner.selectors';
import { selectProjectFeatureState } from '../features/project/store/project.selectors';
import { selectSimpleCounterFeatureState } from '../features/simple-counter/store/simple-counter.reducer';
import { selectTagFeatureState } from '../features/tag/store/tag.reducer';
import { selectTaskFeatureState } from '../features/tasks/store/task.selectors';
import { selectTaskRepeatCfgFeatureState } from '../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import { selectTimeTrackingState } from '../features/time-tracking/store/time-tracking.selectors';

import { AllSyncModels } from './sync.types';
import { AllModelConfig } from '../op-log/model/model-config';
import { environment } from '../../environments/environment';
import { ArchiveModel } from '../features/time-tracking/time-tracking.model';
import { initialTimeTrackingState } from '../features/time-tracking/store/time-tracking.reducer';
import { LegacyPfDbService } from '../core/persistence/legacy-pf-db.service';

const DEFAULT_ARCHIVE: ArchiveModel = {
  task: { ids: [], entities: {} },
  timeTracking: initialTimeTrackingState,
  lastTimeTrackingFlush: 0,
};

/**
 * Service that provides a delegate function to read all sync model data from the NgRx store.
 *
 * Most models are persisted via OperationLogEffects to SUP_OPS IndexedDB, so we read from NgRx.
 * Archives (archiveYoung, archiveOld) are read directly from the 'pf' IndexedDB.
 */
@Injectable({
  providedIn: 'root',
})
export class PfapiStoreDelegateService {
  private _store = inject(Store);
  private _legacyPfDb = inject(LegacyPfDbService);

  /**
   * Gets all sync model data from NgRx store and IndexedDB.
   *
   * Most models are read from NgRx state (persisted via OperationLogEffects).
   * archiveYoung and archiveOld are read directly from IndexedDB ('pf' database).
   */
  getAllSyncModelDataFromStore(): AllSyncModels<AllModelConfig> {
    // This is now synchronous for NgRx data
    // Archive loading is handled separately when needed
    const ngRxData = this._getNgRxDataSync();

    // Return with default archives - archives will be loaded async when actually needed for sync
    return {
      ...ngRxData,
      archiveYoung: DEFAULT_ARCHIVE,
      archiveOld: DEFAULT_ARCHIVE,
    } as AllSyncModels<AllModelConfig>;
  }

  /**
   * Async version that also loads archives from IndexedDB
   */
  async getAllSyncModelDataFromStoreAsync(): Promise<AllSyncModels<AllModelConfig>> {
    const [archiveYoung, archiveOld] = await Promise.all([
      this._loadArchive('archiveYoung'),
      this._loadArchive('archiveOld'),
    ]);

    const ngRxData = await firstValueFrom(
      combineLatest([
        this._store.select(selectTaskFeatureState),
        this._store.select(selectProjectFeatureState),
        this._store.select(selectTagFeatureState),
        this._store.select(selectConfigFeatureState),
        this._store.select(selectNoteFeatureState),
        this._store.select(selectIssueProviderState),
        this._store.select(selectPlannerState),
        this._store.select(selectBoardsState),
        this._store.select(selectMetricFeatureState),
        this._store.select(selectSimpleCounterFeatureState),
        this._store.select(selectTaskRepeatCfgFeatureState),
        this._store.select(selectMenuTreeState),
        this._store.select(selectTimeTrackingState),
        this._store.select(selectPluginUserDataFeatureState),
        this._store.select(selectPluginMetadataFeatureState),
        this._store.select(selectReminderFeatureState),
      ]).pipe(first()),
    );

    const [
      task,
      project,
      tag,
      globalConfig,
      note,
      issueProvider,
      planner,
      boards,
      metric,
      simpleCounter,
      taskRepeatCfg,
      menuTree,
      timeTracking,
      pluginUserData,
      pluginMetadata,
      reminders,
    ] = ngRxData;

    return {
      task: {
        ...task,
        selectedTaskId: environment.production ? null : task.selectedTaskId,
        currentTaskId: null,
      },
      project,
      tag,
      globalConfig,
      note,
      issueProvider,
      planner,
      boards,
      metric,
      simpleCounter,
      taskRepeatCfg,
      menuTree,
      timeTracking,
      pluginUserData,
      pluginMetadata,
      reminders,
      archiveYoung,
      archiveOld,
    } as AllSyncModels<AllModelConfig>;
  }

  private _getNgRxDataSync(): Omit<
    AllSyncModels<AllModelConfig>,
    'archiveYoung' | 'archiveOld'
  > {
    // Note: This is a simplified sync version that doesn't include archives
    // The full async version should be used when archives are needed
    let task: any, project: any, tag: any, globalConfig: any, note: any;
    let issueProvider: any, planner: any, boards: any, metric: any;
    let simpleCounter: any, taskRepeatCfg: any, menuTree: any, timeTracking: any;
    let pluginUserData: any, pluginMetadata: any, reminders: any;

    // Subscribe synchronously to get current values
    this._store
      .select(selectTaskFeatureState)
      .pipe(first())
      .subscribe((v) => (task = v));
    this._store
      .select(selectProjectFeatureState)
      .pipe(first())
      .subscribe((v) => (project = v));
    this._store
      .select(selectTagFeatureState)
      .pipe(first())
      .subscribe((v) => (tag = v));
    this._store
      .select(selectConfigFeatureState)
      .pipe(first())
      .subscribe((v) => (globalConfig = v));
    this._store
      .select(selectNoteFeatureState)
      .pipe(first())
      .subscribe((v) => (note = v));
    this._store
      .select(selectIssueProviderState)
      .pipe(first())
      .subscribe((v) => (issueProvider = v));
    this._store
      .select(selectPlannerState)
      .pipe(first())
      .subscribe((v) => (planner = v));
    this._store
      .select(selectBoardsState)
      .pipe(first())
      .subscribe((v) => (boards = v));
    this._store
      .select(selectMetricFeatureState)
      .pipe(first())
      .subscribe((v) => (metric = v));
    this._store
      .select(selectSimpleCounterFeatureState)
      .pipe(first())
      .subscribe((v) => (simpleCounter = v));
    this._store
      .select(selectTaskRepeatCfgFeatureState)
      .pipe(first())
      .subscribe((v) => (taskRepeatCfg = v));
    this._store
      .select(selectMenuTreeState)
      .pipe(first())
      .subscribe((v) => (menuTree = v));
    this._store
      .select(selectTimeTrackingState)
      .pipe(first())
      .subscribe((v) => (timeTracking = v));
    this._store
      .select(selectPluginUserDataFeatureState)
      .pipe(first())
      .subscribe((v) => (pluginUserData = v));
    this._store
      .select(selectPluginMetadataFeatureState)
      .pipe(first())
      .subscribe((v) => (pluginMetadata = v));
    this._store
      .select(selectReminderFeatureState)
      .pipe(first())
      .subscribe((v) => (reminders = v));

    return {
      task: {
        ...task,
        selectedTaskId: environment.production ? null : task?.selectedTaskId,
        currentTaskId: null,
      },
      project,
      tag,
      globalConfig,
      note,
      issueProvider,
      planner,
      boards,
      metric,
      simpleCounter,
      taskRepeatCfg,
      menuTree,
      timeTracking,
      pluginUserData,
      pluginMetadata,
      reminders,
    };
  }

  private async _loadArchive(key: 'archiveYoung' | 'archiveOld'): Promise<ArchiveModel> {
    if (key === 'archiveYoung') {
      return this._legacyPfDb.loadArchiveYoung();
    }
    return this._legacyPfDb.loadArchiveOld();
  }
}
