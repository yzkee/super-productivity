import { TestBed } from '@angular/core/testing';
import { FileBasedSyncAdapterService } from './file-based-sync-adapter.service';
import { SyncProviderId } from '../provider.const';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  SyncOperation,
} from '../provider.interface';
import {
  FILE_BASED_SYNC_CONSTANTS,
  FileBasedSyncData,
  SyncDataCorruptedError,
} from './file-based-sync.types';
import { RemoteFileNotFoundAPIError } from '../../core/errors/sync-errors';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { getSyncFilePrefix } from '../../util/sync-file-prefix';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';
import { StateSnapshotService } from '../../backup/state-snapshot.service';

describe('FileBasedSyncAdapterService', () => {
  let service: FileBasedSyncAdapterService;
  let mockProvider: jasmine.SpyObj<SyncProviderServiceInterface<SyncProviderId>>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let adapter: OperationSyncCapable;

  const mockCfg: EncryptAndCompressCfg = {
    isEncrypt: false,
    isCompress: false,
  };

  const mockEncryptKey: string | undefined = undefined;

  const mockArchiveYoung: ArchiveModel = {
    task: {
      ids: ['archivedTask1'],
      entities: {
        archivedTask1: { id: 'archivedTask1', title: 'Archived 1' } as any,
      },
    },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  };

  const mockArchiveOld: ArchiveModel = {
    task: {
      ids: ['oldTask1'],
      entities: { oldTask1: { id: 'oldTask1', title: 'Old Archived' } as any },
    },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  };

  // Helper to add PFAPI prefix for mock file downloads
  const addPrefix = (data: unknown, version = 2): string => {
    const prefix = getSyncFilePrefix({
      isCompress: mockCfg.isCompress,
      isEncrypt: mockCfg.isEncrypt,
      modelVersion: version,
    });
    return prefix + JSON.stringify(data);
  };

  // Helper to parse prefixed data from uploads
  const parseWithPrefix = (dataStr: string): FileBasedSyncData => {
    const prefixEnd = dataStr.indexOf('__') + 2;
    const jsonStr = dataStr.slice(prefixEnd);
    return JSON.parse(jsonStr) as FileBasedSyncData;
  };

  const createMockSyncData = (
    overrides: Partial<FileBasedSyncData> = {},
  ): FileBasedSyncData => ({
    version: 2,
    syncVersion: 1,
    schemaVersion: 1,
    vectorClock: { client1: 1 },
    lastModified: Date.now(),
    clientId: 'client1',
    state: { tasks: [] },
    recentOps: [],
    ...overrides,
  });

  const createMockSyncOp = (
    overrides: Partial<{
      id: string;
      clientId: string;
      actionType: string;
      opType: string;
      entityType: string;
      entityId: string;
      vectorClock: Record<string, number>;
      timestamp: number;
      schemaVersion: number;
      payload: unknown;
    }> = {},
  ): SyncOperation => ({
    id: 'op-123',
    clientId: 'client1',
    actionType: '[Task] Add Task',
    opType: 'ADD' as const,
    entityType: 'TASK' as const,
    entityId: 'task-1',
    vectorClock: { client1: 2 },
    timestamp: Date.now(),
    schemaVersion: 1,
    payload: { title: 'Test Task' },
    ...overrides,
  });

  beforeEach(() => {
    mockArchiveDbAdapter = jasmine.createSpyObj('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
    ]);
    mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
      Promise.resolve(mockArchiveYoung),
    );
    mockArchiveDbAdapter.loadArchiveOld.and.returnValue(Promise.resolve(mockArchiveOld));
    mockArchiveDbAdapter.saveArchiveYoung.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchiveOld.and.returnValue(Promise.resolve());

    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockStateSnapshotService.getStateSnapshot.and.returnValue({
      tasks: [],
      projects: [],
    } as any);

    TestBed.configureTestingModule({
      providers: [
        FileBasedSyncAdapterService,
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
      ],
    });

    service = TestBed.inject(FileBasedSyncAdapterService);

    mockProvider = jasmine.createSpyObj('SyncProvider', [
      'downloadFile',
      'uploadFile',
      'removeFile',
      'getFileRev',
    ]);
    mockProvider.id = SyncProviderId.WebDAV;

    // Clear localStorage to prevent state leaking between tests
    localStorage.removeItem(
      FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
    );
    localStorage.removeItem(
      FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
    );
    localStorage.removeItem(
      FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
    );

    adapter = service.createAdapter(mockProvider, mockCfg, mockEncryptKey);
  });

  describe('createAdapter', () => {
    it('should create an adapter that supports operation sync', () => {
      expect(adapter.supportsOperationSync).toBe(true);
    });

    it('should create an adapter with all required methods', () => {
      expect(adapter.uploadOps).toBeDefined();
      expect(adapter.downloadOps).toBeDefined();
      expect(adapter.getLastServerSeq).toBeDefined();
      expect(adapter.setLastServerSeq).toBeDefined();
      expect(adapter.uploadSnapshot).toBeDefined();
      expect(adapter.deleteAllData).toBeDefined();
    });
  });

  describe('uploadOps', () => {
    it('should return empty results when no ops to upload and file exists', async () => {
      // Mock that a sync file already exists
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.uploadOps([], 'client1');

      expect(result.results).toEqual([]);
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('should create sync file with state even when no ops to upload and file does not exist', async () => {
      // Mock that no sync file exists yet
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      const result = await adapter.uploadOps([], 'client1');

      // Should still create the sync file with current state
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        jasmine.any(String),
        null,
        true,
      );
      expect(result.results).toEqual([]);
    });

    it('should create new sync file when none exists', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      const op = createMockSyncOp();
      const result = await adapter.uploadOps([op], 'client1');

      expect(result.results.length).toBe(1);
      expect(result.results[0].accepted).toBe(true);
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        jasmine.any(String),
        null,
        true,
      );
    });

    it('should handle version mismatch gracefully with piggybacking', async () => {
      // First, download to set expected version
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0); // Sets expected version to 1

      // Now configure for upload - upload will download again and expect version 1
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      const op1 = createMockSyncOp();
      await adapter.uploadOps([op1], 'client1'); // Expected=1, file=1, uploads OK -> expected becomes 2

      // Another client syncs, adding an op and incrementing version to 3 (we expect 2)
      const otherClientOp = createMockSyncOp({
        id: 'other-op',
        clientId: 'other-client',
      });
      const syncDataV3 = createMockSyncData({
        syncVersion: 3,
        recentOps: [otherClientOp].map((op) => ({
          id: op.id,
          c: op.clientId,
          a: op.actionType,
          o: 'CREATE',
          e: 'Task',
          ei: op.entityId || 'entity1',
          p: op.payload,
          v: op.vectorClock,
          t: op.timestamp,
          s: op.schemaVersion || 1,
        })),
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncDataV3), rev: 'rev-3' }),
      );

      // Our next upload should succeed and return piggybacked ops
      const op2 = createMockSyncOp({ id: 'op-456' });
      const result = await adapter.uploadOps([op2], 'client1');

      // Should succeed (not throw)
      expect(result.results.length).toBe(1);
      expect(result.results[0].accepted).toBe(true);

      // Should return the other client's op as piggybacked
      expect(result.newOps?.length).toBe(1);
      expect(result.newOps![0].op.id).toBe('other-op');
    });

    it('should create backup before uploading', async () => {
      // First download to set expected version
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0); // Sets expected version to 1

      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      const op = createMockSyncOp();
      await adapter.uploadOps([op], 'client1');

      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        jasmine.any(String),
        null,
        true,
      );
    });

    it('should continue even if backup fails', async () => {
      // First download to set expected version
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0); // Sets expected version to 1

      // First upload (backup) fails, second (main) succeeds
      let uploadCalls = 0;
      mockProvider.uploadFile.and.callFake(() => {
        uploadCalls++;
        if (uploadCalls === 1) {
          return Promise.reject(new Error('Backup failed'));
        }
        return Promise.resolve({ rev: 'rev-2' });
      });

      const op = createMockSyncOp();
      const result = await adapter.uploadOps([op], 'client1');

      // Should still succeed
      expect(result.results[0].accepted).toBe(true);
    });

    it('should merge vector clocks from all ops', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      let uploadedDataStr: string = '';
      mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
        uploadedDataStr = dataStr;
        return Promise.resolve({ rev: 'rev-1' });
      });

      const op1 = createMockSyncOp({
        id: 'op-1',
        vectorClock: { client1: 1, client2: 2 },
      });
      const op2 = createMockSyncOp({
        id: 'op-2',
        vectorClock: { client1: 3, client3: 1 },
      });

      await adapter.uploadOps([op1, op2], 'client1');

      const uploadedData = parseWithPrefix(uploadedDataStr);
      expect(uploadedData.vectorClock).toEqual({ client1: 3, client2: 2, client3: 1 });
    });
  });

  describe('downloadOps', () => {
    it('should return empty when no sync file exists', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      const result = await adapter.downloadOps(0);

      expect(result.ops).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.latestSeq).toBe(0);
    });

    it('should return ops from sync file', async () => {
      const syncData = createMockSyncData({
        recentOps: [
          {
            id: 'op-1',
            c: 'client1',
            a: 'HA', // short code for [Task Shared] addTask
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: { title: 'Task 1' },
          },
          {
            id: 'op-2',
            c: 'client2',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-2',
            v: { client2: 1 },
            t: Date.now(),
            s: 1,
            p: { title: 'Task 2' },
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0);

      expect(result.ops.length).toBe(2);
      expect(result.latestSeq).toBe(2);
    });

    it('should filter ops by excludeClient', async () => {
      const syncData = createMockSyncData({
        recentOps: [
          {
            id: 'op-1',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
          {
            id: 'op-2',
            c: 'client2',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-2',
            v: { client2: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0, 'client1');

      expect(result.ops.length).toBe(1);
      expect(result.ops[0].op.clientId).toBe('client2');
    });

    it('should return ALL ops (filtering by appliedOpIds happens in download service)', async () => {
      // NOTE: The file-based adapter no longer filters by processedOpIds.
      // It returns ALL ops from the file, and the download service filters
      // using appliedOpIds (from IndexedDB) as the source of truth.
      // This prevents sync failures when ops are downloaded but not applied.
      const syncData = createMockSyncData({
        recentOps: [
          {
            id: 'op-1',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
          {
            id: 'op-2',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-2',
            v: { client1: 2 },
            t: Date.now(),
            s: 1,
            p: {},
          },
          {
            id: 'op-3',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-3',
            v: { client1: 3 },
            t: Date.now(),
            s: 1,
            p: {},
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      // First download returns all 3 ops
      const result1 = await adapter.downloadOps(1);
      expect(result1.ops.length).toBe(3);

      // Subsequent download ALSO returns all 3 ops (no longer filtered by adapter)
      // The download service's appliedOpIds filter determines what's actually new
      const result2 = await adapter.downloadOps(1);
      expect(result2.ops.length).toBe(3);
    });

    it('should limit results and indicate hasMore', async () => {
      const manyOps = Array.from({ length: 10 }, (_, i) => ({
        id: `op-${i}`,
        c: 'client1',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i}`,
        v: { client1: i + 1 },
        t: Date.now(),
        s: 1,
        p: {},
      }));

      const syncData = createMockSyncData({ recentOps: manyOps });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0, undefined, 5);

      expect(result.ops.length).toBe(5);
      expect(result.hasMore).toBe(true);
    });

    it('should throw SyncDataCorruptedError for wrong file version', async () => {
      const badSyncData = createMockSyncData();
      (badSyncData as any).version = 1; // Wrong version
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(badSyncData), rev: 'rev-1' }),
      );

      await expectAsync(adapter.downloadOps(0)).toBeRejectedWith(
        jasmine.any(SyncDataCorruptedError),
      );
    });
  });

  describe('getLastServerSeq / setLastServerSeq', () => {
    it('should return 0 initially', async () => {
      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(0);
    });

    it('should persist and retrieve seq', async () => {
      await adapter.setLastServerSeq(42);
      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(42);
    });
  });

  describe('uploadSnapshot', () => {
    it('should create new sync file with state', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      let uploadedDataStr: string = '';
      mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
        uploadedDataStr = dataStr;
        return Promise.resolve({ rev: 'rev-1' });
      });

      const state = { tasks: [{ id: 't1', title: 'Test' }] };
      const vectorClock = { client1: 5 };

      const result = await adapter.uploadSnapshot(
        state,
        'client1',
        'initial',
        vectorClock,
        2,
      );

      expect(result.accepted).toBe(true);
      const uploadedData = parseWithPrefix(uploadedDataStr);
      expect(uploadedData.state).toEqual(state);
      expect(uploadedData.vectorClock).toEqual(vectorClock);
      expect(uploadedData.schemaVersion).toBe(2);
      expect(uploadedData.syncVersion).toBe(1);
      expect(uploadedData.recentOps).toEqual([]); // Fresh start
    });

    it('should backup existing file before snapshot upload', async () => {
      const existingData = createMockSyncData();
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(existingData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      await adapter.uploadSnapshot({}, 'client1', 'recovery', { client1: 1 }, 1);

      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        jasmine.any(String),
        null,
        true,
      );
    });

    it('should reset local seq counter after snapshot', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      // First set a seq value
      await adapter.setLastServerSeq(100);

      // Upload snapshot
      await adapter.uploadSnapshot({}, 'client1', 'initial', { client1: 1 }, 1);

      // Seq should be reset
      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(0);
    });
  });

  describe('deleteAllData', () => {
    it('should delete sync file and backup', async () => {
      mockProvider.removeFile.and.returnValue(Promise.resolve());

      const result = await adapter.deleteAllData();

      expect(result.success).toBe(true);
      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      );
      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
      );
      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
      );
    });

    it('should succeed even if files do not exist', async () => {
      mockProvider.removeFile.and.throwError(new Error('File not found'));

      const result = await adapter.deleteAllData();

      expect(result.success).toBe(true);
    });

    it('should reset local state after delete', async () => {
      mockProvider.removeFile.and.returnValue(Promise.resolve());

      // Set some state first
      await adapter.setLastServerSeq(50);

      await adapter.deleteAllData();

      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(0);
    });
  });

  describe('getCurrentSyncData', () => {
    it('should return sync data when file exists', async () => {
      const syncData = createMockSyncData();
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await service.getCurrentSyncData(
        mockProvider,
        mockCfg,
        mockEncryptKey,
      );

      expect(result).toBeDefined();
      expect(result?.version).toBe(2);
    });

    it('should return null when no file exists', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      const result = await service.getCurrentSyncData(
        mockProvider,
        mockCfg,
        mockEncryptKey,
      );

      expect(result).toBeNull();
    });
  });

  describe('wouldConflict', () => {
    it('should return true when versions differ', () => {
      // No expected version set yet (0)
      expect(service.wouldConflict('test-key', 5)).toBe(true);
    });

    it('should return false when versions match', async () => {
      // Set expected version by downloading
      const syncData = createMockSyncData({ syncVersion: 3 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      await adapter.downloadOps(0);

      const key = mockProvider.id;
      expect(service.wouldConflict(key, 3)).toBe(false);
    });
  });

  describe('archive handling', () => {
    describe('uploadOps', () => {
      it('should include archiveYoung and archiveOld in upload', async () => {
        mockProvider.downloadFile.and.throwError(
          new RemoteFileNotFoundAPIError('sync-data.json'),
        );

        let uploadedDataStr: string = '';
        mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
          uploadedDataStr = dataStr;
          return Promise.resolve({ rev: 'rev-1' });
        });

        const op = createMockSyncOp();
        await adapter.uploadOps([op], 'client1');

        const uploadedData = parseWithPrefix(uploadedDataStr);
        expect(uploadedData.archiveYoung).toEqual(mockArchiveYoung);
        expect(uploadedData.archiveOld).toEqual(mockArchiveOld);
        expect(mockArchiveDbAdapter.loadArchiveYoung).toHaveBeenCalled();
        expect(mockArchiveDbAdapter.loadArchiveOld).toHaveBeenCalled();
      });

      it('should handle undefined archive gracefully', async () => {
        mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(Promise.resolve(undefined));
        mockArchiveDbAdapter.loadArchiveOld.and.returnValue(Promise.resolve(undefined));

        mockProvider.downloadFile.and.throwError(
          new RemoteFileNotFoundAPIError('sync-data.json'),
        );

        let uploadedDataStr: string = '';
        mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
          uploadedDataStr = dataStr;
          return Promise.resolve({ rev: 'rev-1' });
        });

        const op = createMockSyncOp();
        await adapter.uploadOps([op], 'client1');

        const uploadedData = parseWithPrefix(uploadedDataStr);
        expect(uploadedData.archiveYoung).toBeUndefined();
        expect(uploadedData.archiveOld).toBeUndefined();
      });
    });

    describe('uploadSnapshot', () => {
      it('should include archive data in snapshot', async () => {
        mockProvider.downloadFile.and.throwError(
          new RemoteFileNotFoundAPIError('sync-data.json'),
        );

        let uploadedDataStr: string = '';
        mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
          uploadedDataStr = dataStr;
          return Promise.resolve({ rev: 'rev-1' });
        });

        await adapter.uploadSnapshot({}, 'client1', 'initial', { client1: 1 }, 1);

        const uploadedData = parseWithPrefix(uploadedDataStr);
        expect(uploadedData.archiveYoung).toEqual(mockArchiveYoung);
        expect(uploadedData.archiveOld).toEqual(mockArchiveOld);
      });
    });

    describe('downloadOps', () => {
      it('should write archive to IndexedDB on first download (sinceSeq=0)', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
          archiveOld: mockArchiveOld,
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(0);

        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
          mockArchiveYoung,
        );
        expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledWith(mockArchiveOld);
      });

      it('should NOT write archive on subsequent downloads (sinceSeq > 0)', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
          archiveOld: mockArchiveOld,
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(1); // Not first download

        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should handle missing archive gracefully (backward compatibility)', async () => {
        // Old sync file without archive fields
        const syncData = createMockSyncData();
        delete (syncData as any).archiveYoung;
        delete (syncData as any).archiveOld;

        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(0);

        // Should not attempt to save undefined archive
        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should handle partial archive (only archiveYoung)', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(0);

        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
          mockArchiveYoung,
        );
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });
    });
  });
});
