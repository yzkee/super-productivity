import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { OperationLogSyncService } from '../../op-log/sync/operation-log-sync.service';
import { WrappedProviderService } from '../../op-log/sync-providers/wrapped-provider.service';
import { OperationLogStoreService } from '../../op-log/persistence/operation-log-store.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { GlobalConfigService } from '../../features/config/global-config.service';
import { TranslateService } from '@ngx-translate/core';
import { MatDialog } from '@angular/material/dialog';
import { SnackService } from '../../core/snack/snack.service';
import { ReminderService } from '../../features/reminder/reminder.service';
import { DataInitService } from '../../core/data-init/data-init.service';
import { UserInputWaitStateService } from './user-input-wait-state.service';
import { SuperSyncStatusService } from '../../op-log/sync/super-sync-status.service';
import {
  AuthFailSPError,
  PotentialCorsError,
  SyncProviderId,
  SyncStatus,
} from '../../op-log/sync-exports';
import { SyncAlreadyInProgressError } from '../../op-log/core/errors/sync-errors';
import { LegacySyncProvider } from './legacy-sync-provider.model';

describe('SyncWrapperService', () => {
  let service: SyncWrapperService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncService: jasmine.SpyObj<OperationLogSyncService>;
  let mockWrappedProvider: jasmine.SpyObj<WrappedProviderService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLegacyPfDb: jasmine.SpyObj<LegacyPfDbService>;
  let mockGlobalConfigService: jasmine.SpyObj<GlobalConfigService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockMatDialog: jasmine.SpyObj<MatDialog>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockDataInitService: jasmine.SpyObj<DataInitService>;
  let mockReminderService: jasmine.SpyObj<ReminderService>;
  let mockUserInputWaitState: jasmine.SpyObj<UserInputWaitStateService>;
  let mockSuperSyncStatusService: jasmine.SpyObj<SuperSyncStatusService>;

  let configSubject: BehaviorSubject<any>;
  let mockSyncCapableProvider: any;

  const createMockSyncConfig = (provider: LegacySyncProvider | null): { sync: any } => ({
    sync: {
      syncProvider: provider,
      syncInterval: 60000,
    },
  });

  beforeEach(() => {
    configSubject = new BehaviorSubject(
      createMockSyncConfig(LegacySyncProvider.SuperSync),
    );

    mockSyncCapableProvider = {
      uploadOperations: jasmine.createSpy('uploadOperations'),
      downloadOperations: jasmine.createSpy('downloadOperations'),
    };

    mockProviderManager = jasmine.createSpyObj(
      'SyncProviderManager',
      ['getActiveProvider', 'setSyncStatus', 'setProviderConfig', 'getProviderById'],
      {
        syncStatus$: of('SYNCED'),
        isProviderReady$: of(true),
        isSyncInProgress: false,
      },
    );
    mockProviderManager.getActiveProvider.and.returnValue({
      id: SyncProviderId.SuperSync,
    } as any);

    mockSyncService = jasmine.createSpyObj('OperationLogSyncService', [
      'downloadRemoteOps',
      'uploadPendingOps',
    ]);
    mockSyncService.downloadRemoteOps.and.returnValue(
      Promise.resolve({
        newOpsCount: 0,
        serverMigrationHandled: false,
        localWinOpsCreated: 0,
      }),
    );
    mockSyncService.uploadPendingOps.and.returnValue(
      Promise.resolve({
        uploadedCount: 0,
        rejectedCount: 0,
        piggybackedOps: [],
        rejectedOps: [],
        localWinOpsCreated: 0,
      }),
    );

    mockWrappedProvider = jasmine.createSpyObj('WrappedProviderService', [
      'getOperationSyncCapable',
    ]);
    mockWrappedProvider.getOperationSyncCapable.and.returnValue(
      Promise.resolve(mockSyncCapableProvider),
    );

    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'getVectorClockEntry',
      'setVectorClock',
    ]);
    mockOpLogStore.getVectorClockEntry.and.returnValue(Promise.resolve(null));

    mockLegacyPfDb = jasmine.createSpyObj('LegacyPfDbService', [
      'loadMetaModel',
      'saveMetaModel',
    ]);
    mockLegacyPfDb.loadMetaModel.and.returnValue(Promise.resolve({}));
    mockLegacyPfDb.saveMetaModel.and.returnValue(Promise.resolve());

    mockGlobalConfigService = jasmine.createSpyObj('GlobalConfigService', [], {
      cfg$: configSubject.asObservable(),
    });

    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockMatDialog = jasmine.createSpyObj('MatDialog', ['open']);
    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockTranslateService.instant.and.callFake((key: string) => key);

    mockDataInitService = jasmine.createSpyObj('DataInitService', [
      'reInitFromRemoteSync',
    ]);
    mockReminderService = jasmine.createSpyObj('ReminderService', ['reloadFromDatabase']);

    mockUserInputWaitState = jasmine.createSpyObj('UserInputWaitStateService', [], {
      isWaitingForUserInput$: of(false),
    });

    mockSuperSyncStatusService = jasmine.createSpyObj('SuperSyncStatusService', [], {
      isConfirmedInSync: { value: false },
    });

    TestBed.configureTestingModule({
      providers: [
        SyncWrapperService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: OperationLogSyncService, useValue: mockSyncService },
        { provide: WrappedProviderService, useValue: mockWrappedProvider },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LegacyPfDbService, useValue: mockLegacyPfDb },
        { provide: GlobalConfigService, useValue: mockGlobalConfigService },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: MatDialog, useValue: mockMatDialog },
        { provide: SnackService, useValue: mockSnackService },
        { provide: DataInitService, useValue: mockDataInitService },
        { provide: ReminderService, useValue: mockReminderService },
        { provide: UserInputWaitStateService, useValue: mockUserInputWaitState },
        { provide: SuperSyncStatusService, useValue: mockSuperSyncStatusService },
      ],
    });

    service = TestBed.inject(SyncWrapperService);
  });

  describe('sync() method', () => {
    it('should return HANDLED_ERROR when sync already in progress', async () => {
      // Start first sync but don't await it
      const firstSync = service.sync();

      // Try to start another sync while first is in progress
      const secondResult = await service.sync();

      expect(secondResult).toBe('HANDLED_ERROR');

      // Clean up first sync
      await firstSync;
    });

    it('should set isSyncInProgress true during sync, false after', async () => {
      expect(service.isSyncInProgressSync()).toBe(false);

      const syncPromise = service.sync();

      // Should be true during sync
      expect(service.isSyncInProgressSync()).toBe(true);

      await syncPromise;

      // Should be false after sync
      expect(service.isSyncInProgressSync()).toBe(false);
    });

    it('should reset isSyncInProgress even on error', async () => {
      mockWrappedProvider.getOperationSyncCapable.and.returnValue(
        Promise.reject(new Error('Test error')),
      );

      expect(service.isSyncInProgressSync()).toBe(false);

      await service.sync();

      // Should be false after error
      expect(service.isSyncInProgressSync()).toBe(false);
    });

    it('should return InSync on successful sync', async () => {
      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
    });
  });

  describe('_sync() - Provider handling', () => {
    it('should call _syncVectorClockToPfapi for WebDAV provider', async () => {
      configSubject.next(createMockSyncConfig(LegacySyncProvider.WebDAV));
      mockOpLogStore.getVectorClockEntry.and.returnValue(
        Promise.resolve({
          clock: { clientA: 5 },
          lastUpdate: Date.now(),
        }),
      );

      await service.sync();

      // Should have loaded and saved meta model for vector clock sync
      expect(mockLegacyPfDb.loadMetaModel).toHaveBeenCalled();
      expect(mockLegacyPfDb.saveMetaModel).toHaveBeenCalled();
    });

    it('should call _syncVectorClockToPfapi for Dropbox provider', async () => {
      configSubject.next(createMockSyncConfig(LegacySyncProvider.Dropbox));
      mockOpLogStore.getVectorClockEntry.and.returnValue(
        Promise.resolve({
          clock: { clientA: 5 },
          lastUpdate: Date.now(),
        }),
      );

      await service.sync();

      expect(mockLegacyPfDb.loadMetaModel).toHaveBeenCalled();
      expect(mockLegacyPfDb.saveMetaModel).toHaveBeenCalled();
    });

    it('should NOT call _syncVectorClockToPfapi for SuperSync provider', async () => {
      configSubject.next(createMockSyncConfig(LegacySyncProvider.SuperSync));

      await service.sync();

      // Should NOT have tried to sync vector clock for SuperSync
      expect(mockLegacyPfDb.saveMetaModel).not.toHaveBeenCalled();
    });

    it('should return InSync when provider does not support operation sync', async () => {
      mockWrappedProvider.getOperationSyncCapable.and.returnValue(Promise.resolve(null));

      const result = await service.sync();

      expect(result).toBe(SyncStatus.InSync);
      expect(mockSyncService.downloadRemoteOps).not.toHaveBeenCalled();
      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    });
  });

  describe('_sync() - Sync flow', () => {
    it('should download before upload', async () => {
      const callOrder: string[] = [];
      mockSyncService.downloadRemoteOps.and.callFake(async () => {
        callOrder.push('download');
        return { newOpsCount: 0, serverMigrationHandled: false, localWinOpsCreated: 0 };
      });
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        callOrder.push('upload');
        return {
          uploadedCount: 0,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
          localWinOpsCreated: 0,
        };
      });

      await service.sync();

      expect(callOrder).toEqual(['download', 'upload']);
    });

    it('should re-upload when localWinOpsCreated > 0 from download', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          newOpsCount: 5,
          serverMigrationHandled: false,
          localWinOpsCreated: 3, // LWW created 3 local-win ops
        }),
      );
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 3,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
          localWinOpsCreated: 0,
        }),
      );

      await service.sync();

      // Upload should be called twice: initial + re-upload for LWW ops
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
    });

    it('should re-upload when localWinOpsCreated > 0 from upload', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          newOpsCount: 0,
          serverMigrationHandled: false,
          localWinOpsCreated: 0,
        }),
      );
      // First upload returns localWinOpsCreated > 0
      let uploadCallCount = 0;
      mockSyncService.uploadPendingOps.and.callFake(async () => {
        uploadCallCount++;
        if (uploadCallCount === 1) {
          return {
            uploadedCount: 2,
            rejectedCount: 0,
            piggybackedOps: [],
            rejectedOps: [],
            localWinOpsCreated: 2, // LWW created ops from piggybacked
          };
        }
        return {
          uploadedCount: 2,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
          localWinOpsCreated: 0,
        };
      });

      await service.sync();

      // Upload should be called twice
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(2);
    });

    it('should NOT re-upload when no localWinOpsCreated', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.resolve({
          newOpsCount: 5,
          serverMigrationHandled: false,
          localWinOpsCreated: 0,
        }),
      );
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 3,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
          localWinOpsCreated: 0,
        }),
      );

      await service.sync();

      // Upload should be called only once
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    });
  });

  describe('Status handling', () => {
    it('should set setSyncStatus IN_SYNC after successful sync', async () => {
      await service.sync();

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    });

    it('should NOT set IN_SYNC when error occurs', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new Error('Network error')),
      );

      await service.sync();

      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle PotentialCorsError with snack message', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new PotentialCorsError('https://example.com')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    });

    it('should handle AuthFailSPError with config dialog action', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new AuthFailSPError()),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          actionFn: jasmine.any(Function),
        }),
      );
    });

    it('should handle SyncAlreadyInProgressError silently', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new SyncAlreadyInProgressError()),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      // Should NOT show snack for this error
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should handle permission errors with appropriate message', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new Error('EACCES: permission denied')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    });

    it('should handle unknown errors with generic snack', async () => {
      mockSyncService.downloadRemoteOps.and.returnValue(
        Promise.reject(new Error('Some unexpected error')),
      );

      const result = await service.sync();

      expect(result).toBe('HANDLED_ERROR');
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
        }),
      );
    });
  });

  describe('isSyncInProgressSync()', () => {
    it('should return false initially', () => {
      expect(service.isSyncInProgressSync()).toBe(false);
    });
  });

  describe('syncProviderId$', () => {
    it('should convert LegacySyncProvider to SyncProviderId', (done) => {
      configSubject.next(createMockSyncConfig(LegacySyncProvider.SuperSync));

      service.syncProviderId$.subscribe((providerId) => {
        expect(providerId).toBe(SyncProviderId.SuperSync);
        done();
      });
    });

    it('should return null for null sync provider', (done) => {
      configSubject.next(createMockSyncConfig(null));

      service.syncProviderId$.subscribe((providerId) => {
        expect(providerId).toBeNull();
        done();
      });
    });
  });
});
