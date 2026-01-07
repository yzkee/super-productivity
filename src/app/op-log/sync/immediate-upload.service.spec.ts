import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ImmediateUploadService } from './immediate-upload.service';
import { SyncProviderManager } from '../sync-providers/provider-manager.service';
import { OperationLogSyncService } from './operation-log-sync.service';
import { WrappedProviderService } from '../sync-providers/wrapped-provider.service';
import { ActionType, Operation, OpType } from '../core/operation.types';

describe('ImmediateUploadService', () => {
  let service: ImmediateUploadService;
  let mockProviderManager: jasmine.SpyObj<SyncProviderManager>;
  let mockSyncService: jasmine.SpyObj<OperationLogSyncService>;
  let mockWrappedProvider: jasmine.SpyObj<WrappedProviderService>;
  let mockProvider: any;
  let mockSyncCapableProvider: any;

  const createMockOp = (id: string): Operation => ({
    id,
    clientId: 'clientA',
    actionType: '[Task] Add' as ActionType,
    opType: OpType.Create,
    entityType: 'TASK',
    entityId: `task-${id}`,
    payload: {},
    vectorClock: { clientA: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  beforeEach(() => {
    mockProvider = {
      id: 'SuperProductivitySync',
      supportsOperationSync: true, // Required for isOperationSyncCapable check
      uploadOperations: jasmine.createSpy('uploadOperations'),
      isReady: jasmine.createSpy('isReady').and.returnValue(Promise.resolve(true)),
    };

    // The sync-capable version of the provider (may be wrapped for file-based providers)
    mockSyncCapableProvider = {
      supportsOperationSync: true,
      uploadOps: jasmine.createSpy('uploadOps'),
      downloadOps: jasmine.createSpy('downloadOps'),
    };

    mockProviderManager = jasmine.createSpyObj(
      'SyncProviderManager',
      ['getActiveProvider', 'setSyncStatus'],
      {
        isSyncInProgress: false,
      },
    );
    mockProviderManager.getActiveProvider.and.returnValue(mockProvider);

    // Mock WrappedProviderService to return sync-capable provider
    mockWrappedProvider = jasmine.createSpyObj('WrappedProviderService', [
      'getOperationSyncCapable',
    ]);
    mockWrappedProvider.getOperationSyncCapable.and.returnValue(
      Promise.resolve(mockSyncCapableProvider),
    );

    // ImmediateUploadService now calls syncService.uploadPendingOps() which includes:
    // - Server migration detection
    // - Processing of piggybacked ops
    // - Handling of rejected ops
    mockSyncService = jasmine.createSpyObj('OperationLogSyncService', [
      'uploadPendingOps',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ImmediateUploadService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: OperationLogSyncService, useValue: mockSyncService },
        { provide: WrappedProviderService, useValue: mockWrappedProvider },
      ],
    });

    service = TestBed.inject(ImmediateUploadService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  describe('checkmark (IN_SYNC) behavior', () => {
    it('should show checkmark when upload succeeds and no piggybacked ops', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 3,
          rejectedCount: 0,
          piggybackedOps: [], // No remote ops = confirmed in sync
          rejectedOps: [],
        }),
      );

      service.initialize();
      service.trigger();
      tick(2100); // Debounce (2000ms) + processing

      expect(mockProviderManager.setSyncStatus).toHaveBeenCalledWith('IN_SYNC');
    }));

    it('should NOT show checkmark when piggybacked ops exist', fakeAsync(() => {
      const piggybackedOp = createMockOp('piggybacked-1');
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 2,
          rejectedCount: 0,
          piggybackedOps: [piggybackedOp], // Remote ops exist = may not be fully in sync
          rejectedOps: [],
        }),
      );

      service.initialize();
      service.trigger();
      tick(2100);

      // Piggybacked ops are processed internally by syncService.uploadPendingOps()
      // ImmediateUploadService should NOT show checkmark when there are piggybacked ops
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should NOT show checkmark when nothing was uploaded', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 0, // Nothing uploaded
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
        }),
      );

      service.initialize();
      service.trigger();
      tick(2100);

      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should NOT show checkmark when upload fails', async () => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.reject(new Error('Network error')),
      );

      service.initialize();
      service.trigger();

      // Wait for debounce + processing
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Silent failure - no checkmark, no error state
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    });

    it('should NOT show checkmark when piggybacked ops exist (multiple)', fakeAsync(() => {
      const piggybackedOps = [
        createMockOp('piggybacked-1'),
        createMockOp('piggybacked-2'),
        createMockOp('piggybacked-3'),
      ];
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 5,
          rejectedCount: 0,
          piggybackedOps,
          rejectedOps: [],
        }),
      );

      service.initialize();
      service.trigger();
      tick(2100);

      // Piggybacked ops are processed internally, no checkmark shown
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));
  });

  describe('guards', () => {
    it('should skip upload when sync is in progress', fakeAsync(() => {
      // Need to re-create the mock with isSyncInProgress = true
      Object.defineProperty(mockProviderManager, 'isSyncInProgress', { value: true });
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 1,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
        }),
      );

      service.initialize();
      service.trigger();
      tick(2100);

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));

    it('should handle fresh client (syncService returns null)', fakeAsync(() => {
      // Fresh client handling is now done inside syncService.uploadPendingOps()
      // which returns null for fresh clients
      mockSyncService.uploadPendingOps.and.returnValue(Promise.resolve(null));

      service.initialize();
      service.trigger();
      tick(2100);

      // Upload was called, but returned null - no checkmark shown
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalled();
      expect(mockProviderManager.setSyncStatus).not.toHaveBeenCalled();
    }));

    it('should skip upload when provider is not ready', fakeAsync(() => {
      mockProvider.isReady.and.returnValue(Promise.resolve(false));
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 1,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
        }),
      );

      service.initialize();
      service.trigger();
      tick(2100);

      expect(mockSyncService.uploadPendingOps).not.toHaveBeenCalled();
    }));
  });

  describe('debouncing', () => {
    it('should debounce rapid triggers into single upload', fakeAsync(() => {
      mockSyncService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 1,
          rejectedCount: 0,
          piggybackedOps: [],
          rejectedOps: [],
        }),
      );

      service.initialize();

      // Rapid triggers
      service.trigger();
      service.trigger();
      service.trigger();
      service.trigger();
      service.trigger();

      tick(2100);

      // Should only upload once despite 5 triggers
      expect(mockSyncService.uploadPendingOps).toHaveBeenCalledTimes(1);
    }));
  });
});
