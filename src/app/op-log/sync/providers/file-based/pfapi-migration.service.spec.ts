import { TestBed } from '@angular/core/testing';
import { PfapiMigrationService } from './pfapi-migration.service';
import { SyncProviderId } from '../../../../pfapi/api/pfapi.const';
import { SyncProviderServiceInterface } from '../../../../pfapi/api/sync/sync-provider.interface';
import { RemoteFileNotFoundAPIError } from '../../../../pfapi/api/errors/errors';
import { EncryptAndCompressCfg } from '../../../../pfapi/api/pfapi.model';
import {
  FILE_BASED_SYNC_CONSTANTS,
  MigrationInProgressError,
} from './file-based-sync.types';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../../../util/client-id.provider';
import { getSyncFilePrefix } from '../../../../pfapi/api/util/sync-file-prefix';

describe('PfapiMigrationService', () => {
  let service: PfapiMigrationService;
  let mockProvider: jasmine.SpyObj<SyncProviderServiceInterface<SyncProviderId>>;
  let mockClientIdProvider: jasmine.SpyObj<ClientIdProvider>;

  const mockCfg: EncryptAndCompressCfg = {
    isEncrypt: false,
    isCompress: false,
  };

  const mockEncryptKey: string | undefined = undefined;
  const mockClientId = 'test-client-123';

  // Track lock file state for mocking the TOCTOU-safe lock verification
  let lockFileContent: string | null = null;

  // Helper to add PFAPI prefix for mock file downloads
  const addPrefix = (data: unknown, version = 1): string => {
    const prefix = getSyncFilePrefix({
      isCompress: mockCfg.isCompress,
      isEncrypt: mockCfg.isEncrypt,
      modelVersion: version,
    });
    return prefix + JSON.stringify(data);
  };

  // Helper to set up the mock provider with lock file state tracking
  const setupLockFileMocking = (
    downloadCallback: (path: string) => Promise<{ dataStr: string; rev: string }> | never,
  ): void => {
    mockProvider.downloadFile.and.callFake((path: string) => {
      if (path === FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE) {
        if (lockFileContent) {
          return Promise.resolve({ dataStr: lockFileContent, rev: 'lock-rev' });
        }
        throw new RemoteFileNotFoundAPIError(path);
      }
      return downloadCallback(path);
    });

    mockProvider.uploadFile.and.callFake((path: string, content: string) => {
      if (path === FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE) {
        lockFileContent = content;
      }
      return Promise.resolve({ rev: 'rev-1' });
    });
  };

  beforeEach(() => {
    // Reset lock file state
    lockFileContent = null;
    mockClientIdProvider = jasmine.createSpyObj('ClientIdProvider', ['loadClientId']);
    mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(mockClientId));

    TestBed.configureTestingModule({
      providers: [
        PfapiMigrationService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });

    service = TestBed.inject(PfapiMigrationService);

    mockProvider = jasmine.createSpyObj('SyncProvider', [
      'downloadFile',
      'uploadFile',
      'removeFile',
      'getFileRev',
    ]);
    mockProvider.id = SyncProviderId.WebDAV;
  });

  describe('migrateIfNeeded', () => {
    it('should return false when sync-data.json already exists', async () => {
      // sync-data.json exists
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) {
          return Promise.resolve({ rev: 'rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      const result = await service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey);

      expect(result).toBe(false);
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('should return false when no PFAPI files exist (fresh start)', async () => {
      // Neither sync-data.json nor meta.json exist
      mockProvider.getFileRev.and.callFake((path: string) => {
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      const result = await service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey);

      expect(result).toBe(false);
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('should perform migration when PFAPI meta.json exists without sync-data.json', async () => {
      // meta.json exists but sync-data.json doesn't
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      // Use the helper to set up lock file tracking with PFAPI model downloads
      setupLockFileMocking((path: string) => {
        if (path === 'globalConfig.json') {
          return Promise.resolve({ dataStr: addPrefix({ theme: 'dark' }), rev: 'rev-1' });
        }
        if (path === 'task.json') {
          return Promise.resolve({
            dataStr: addPrefix({ ids: ['t1'], entities: { t1: { id: 't1' } } }),
            rev: 'rev-1',
          });
        }
        throw new RemoteFileNotFoundAPIError(path);
      });

      mockProvider.removeFile.and.returnValue(Promise.resolve());

      const result = await service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey);

      expect(result).toBe(true);
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        jasmine.any(String),
        null,
        true,
      );
    });

    it('should create migration lock before migrating', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      // Use the helper to set up lock file tracking
      setupLockFileMocking((path: string) => {
        throw new RemoteFileNotFoundAPIError(path);
      });

      mockProvider.removeFile.and.returnValue(Promise.resolve());

      await service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey);

      // Should have uploaded lock file
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
        jasmine.any(String),
        null,
        true,
      );
    });

    it('should release migration lock after successful migration', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      // Use the helper to set up lock file tracking
      setupLockFileMocking((path: string) => {
        throw new RemoteFileNotFoundAPIError(path);
      });

      mockProvider.removeFile.and.returnValue(Promise.resolve());

      await service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey);

      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
      );
    });

    it('should release migration lock even on error', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      // Use the helper but make globalConfig.json fail
      setupLockFileMocking((path: string) => {
        if (path === 'globalConfig.json') {
          throw new Error('Download failed');
        }
        throw new RemoteFileNotFoundAPIError(path);
      });

      mockProvider.removeFile.and.returnValue(Promise.resolve());

      await expectAsync(
        service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey),
      ).toBeRejected();

      // Lock should still be released
      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
      );
    });

    it('should throw MigrationInProgressError when another client holds lock', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      // Another client's lock
      const otherClientLock = {
        clientId: 'other-client-456',
        timestamp: Date.now(),
        stage: 'downloading',
      };

      mockProvider.downloadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE) {
          return Promise.resolve({
            dataStr: JSON.stringify(otherClientLock),
            rev: 'rev-1',
          });
        }
        throw new RemoteFileNotFoundAPIError(path);
      });

      await expectAsync(
        service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey),
      ).toBeRejectedWith(jasmine.any(MigrationInProgressError));
    });

    it('should override stale migration lock', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      // Stale lock (6 minutes old) - will be returned on first download
      // then our lock will be stored/returned after upload
      const sixMinutesMs = 6 * 60 * 1000;
      const staleLock = {
        clientId: 'other-client-456',
        timestamp: Date.now() - sixMinutesMs,
        stage: 'downloading',
      };

      // Set initial lock file content to the stale lock
      lockFileContent = JSON.stringify(staleLock);

      // Use the helper - it will track uploads and return the latest lock content
      setupLockFileMocking((path: string) => {
        throw new RemoteFileNotFoundAPIError(path);
      });

      mockProvider.removeFile.and.returnValue(Promise.resolve());

      const result = await service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey);

      expect(result).toBe(true);
      // Should have overridden the stale lock
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
        jasmine.any(String),
        null,
        true,
      );
    });

    it('should create migration marker after successful migration', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      // Use the helper to set up lock file tracking
      setupLockFileMocking((path: string) => {
        throw new RemoteFileNotFoundAPIError(path);
      });

      mockProvider.removeFile.and.returnValue(Promise.resolve());

      await service.migrateIfNeeded(mockProvider, mockCfg, mockEncryptKey);

      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        'pfapi-migrated.marker',
        jasmine.any(String),
        null,
        true,
      );
    });
  });

  describe('needsMigration', () => {
    it('should return false when sync-data.json exists', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) {
          return Promise.resolve({ rev: 'rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      const result = await service.needsMigration(mockProvider);

      expect(result).toBe(false);
    });

    it('should return false when no files exist', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      const result = await service.needsMigration(mockProvider);

      expect(result).toBe(false);
    });

    it('should return true when only PFAPI files exist', async () => {
      mockProvider.getFileRev.and.callFake((path: string) => {
        if (path === 'meta.json') {
          return Promise.resolve({ rev: 'meta-rev-1' });
        }
        return Promise.reject(new RemoteFileNotFoundAPIError(path));
      });

      const result = await service.needsMigration(mockProvider);

      expect(result).toBe(true);
    });
  });
});
