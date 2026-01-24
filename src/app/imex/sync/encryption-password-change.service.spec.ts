import { TestBed } from '@angular/core/testing';
import { EncryptionPasswordChangeService } from './encryption-password-change.service';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { CleanSlateService } from '../../op-log/clean-slate/clean-slate.service';
import { OperationLogUploadService } from '../../op-log/sync/operation-log-upload.service';
import { DerivedKeyCacheService } from '../../op-log/encryption/derived-key-cache.service';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';

describe('EncryptionPasswordChangeService', () => {
  let service: EncryptionPasswordChangeService;
  let mockProviderManager: jasmine.SpyObj<any>;
  let mockCleanSlateService: jasmine.SpyObj<CleanSlateService>;
  let mockUploadService: jasmine.SpyObj<OperationLogUploadService>;
  let mockDerivedKeyCache: jasmine.SpyObj<DerivedKeyCacheService>;
  let mockSyncProvider: jasmine.SpyObj<any>;

  const TEST_PASSWORD = 'new-secure-password-123';

  beforeEach(() => {
    // Create mock sync provider
    mockSyncProvider = jasmine.createSpyObj('SyncProvider', ['setPrivateCfg']);
    mockSyncProvider.id = SyncProviderId.SuperSync;
    mockSyncProvider.supportsOperationSync = true;
    mockSyncProvider.privateCfg = {
      load: jasmine.createSpy('load').and.returnValue(
        Promise.resolve({
          encryptKey: 'old-password',
          isEncryptionEnabled: true,
        }),
      ),
    };
    mockSyncProvider.setPrivateCfg.and.returnValue(Promise.resolve());

    // Create mock SyncProviderManager
    mockProviderManager = {
      getActiveProvider: jasmine
        .createSpy('getActiveProvider')
        .and.returnValue(mockSyncProvider),
    };

    mockCleanSlateService = jasmine.createSpyObj('CleanSlateService', [
      'createCleanSlate',
    ]);
    mockCleanSlateService.createCleanSlate.and.returnValue(Promise.resolve());

    mockUploadService = jasmine.createSpyObj('OperationLogUploadService', [
      'uploadPendingOps',
    ]);
    mockUploadService.uploadPendingOps.and.returnValue(
      Promise.resolve({
        uploadedCount: 1,
        rejectedCount: 0,
        rejectedOps: [],
        piggybackedOps: [],
      }),
    );

    mockDerivedKeyCache = jasmine.createSpyObj('DerivedKeyCacheService', ['clearCache']);

    TestBed.configureTestingModule({
      providers: [
        EncryptionPasswordChangeService,
        { provide: SyncProviderManager, useValue: mockProviderManager },
        { provide: CleanSlateService, useValue: mockCleanSlateService },
        { provide: OperationLogUploadService, useValue: mockUploadService },
        { provide: DerivedKeyCacheService, useValue: mockDerivedKeyCache },
      ],
    });
    service = TestBed.inject(EncryptionPasswordChangeService);
  });

  describe('changePassword', () => {
    it('should successfully change the encryption password', async () => {
      await service.changePassword(TEST_PASSWORD);

      // Should create clean slate
      expect(mockCleanSlateService.createCleanSlate).toHaveBeenCalledWith(
        'ENCRYPTION_CHANGE',
      );

      // Should update config with new password
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true,
        }),
      );

      // Should clear derived key cache
      expect(mockDerivedKeyCache.clearCache).toHaveBeenCalled();

      // Should upload with isCleanSlate flag
      expect(mockUploadService.uploadPendingOps).toHaveBeenCalledWith(mockSyncProvider, {
        isCleanSlate: true,
      });
    });

    it('should preserve existing config properties when updating password', async () => {
      mockSyncProvider.privateCfg.load.and.returnValue(
        Promise.resolve({
          encryptKey: 'old-password',
          isEncryptionEnabled: true,
          someOtherProperty: 'value',
        }),
      );

      await service.changePassword(TEST_PASSWORD);

      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
          isEncryptionEnabled: true,
          someOtherProperty: 'value',
        }),
      );
    });

    it('should throw error if provider is not SuperSync', async () => {
      mockSyncProvider.id = SyncProviderId.WebDAV;

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Password change is only supported for SuperSync',
      );

      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should throw error if provider does not support operation sync', async () => {
      mockSyncProvider.supportsOperationSync = false;

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Sync provider does not support operation sync',
      );

      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should throw error if no active provider', async () => {
      mockProviderManager.getActiveProvider.and.returnValue(null);

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        'Password change is only supported for SuperSync',
      );

      expect(mockCleanSlateService.createCleanSlate).not.toHaveBeenCalled();
    });

    it('should revert password config if upload fails', async () => {
      const originalConfig = {
        encryptKey: 'old-password',
        isEncryptionEnabled: true,
      };
      mockSyncProvider.privateCfg.load.and.returnValue(Promise.resolve(originalConfig));

      mockUploadService.uploadPendingOps.and.returnValue(
        Promise.reject(new Error('Upload failed')),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /Password change failed: Upload failed/,
      );

      // Should have set password to new value initially
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(
        jasmine.objectContaining({
          encryptKey: TEST_PASSWORD,
        }),
      );

      // Should have reverted to old config
      expect(mockSyncProvider.setPrivateCfg).toHaveBeenCalledWith(originalConfig);

      // Should have cleared cache twice (once on change, once on revert)
      expect(mockDerivedKeyCache.clearCache).toHaveBeenCalledTimes(2);
    });

    it('should throw error if no operations are uploaded', async () => {
      mockUploadService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 0, // No ops uploaded!
          rejectedCount: 0,
          rejectedOps: [],
          piggybackedOps: [],
        }),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /No operations uploaded - clean slate may not have been created/,
      );
    });

    it('should throw error if operations are rejected by server', async () => {
      mockUploadService.uploadPendingOps.and.returnValue(
        Promise.resolve({
          uploadedCount: 0,
          rejectedCount: 1,
          rejectedOps: [{ opId: 'op1', error: 'Server rejected' }],
          piggybackedOps: [],
        }),
      );

      await expectAsync(service.changePassword(TEST_PASSWORD)).toBeRejectedWithError(
        /Clean slate upload was rejected by server: Server rejected/,
      );
    });

    it('should execute steps in correct order', async () => {
      const callOrder: string[] = [];

      mockCleanSlateService.createCleanSlate.and.callFake(async () => {
        callOrder.push('createCleanSlate');
      });

      mockSyncProvider.setPrivateCfg.and.callFake(async () => {
        callOrder.push('setPrivateCfg');
      });

      mockDerivedKeyCache.clearCache.and.callFake(() => {
        callOrder.push('clearCache');
      });

      mockUploadService.uploadPendingOps.and.callFake(async () => {
        callOrder.push('uploadPendingOps');
        return {
          uploadedCount: 1,
          rejectedCount: 0,
          rejectedOps: [],
          piggybackedOps: [],
        };
      });

      await service.changePassword(TEST_PASSWORD);

      expect(callOrder).toEqual([
        'createCleanSlate',
        'setPrivateCfg',
        'clearCache',
        'uploadPendingOps',
      ]);
    });
  });
});
