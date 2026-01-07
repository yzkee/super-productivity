import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { SyncSafetyBackupService, SyncSafetyBackup } from './sync-safety-backup.service';
import { BackupService } from '../../op-log/backup/backup.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';

describe('SyncSafetyBackupService', () => {
  let service: SyncSafetyBackupService;
  let mockBackupService: jasmine.SpyObj<BackupService>;
  let mockLegacyPfDbService: jasmine.SpyObj<LegacyPfDbService>;
  let originalConfirm: typeof window.confirm;

  beforeEach(() => {
    // Save original confirm
    originalConfirm = window.confirm;

    mockLegacyPfDbService = jasmine.createSpyObj('LegacyPfDbService', ['load', 'save']);
    mockLegacyPfDbService.load.and.returnValue(Promise.resolve([]));
    mockLegacyPfDbService.save.and.returnValue(Promise.resolve());

    mockBackupService = jasmine.createSpyObj('BackupService', [
      'loadCompleteBackup',
      'importCompleteBackup',
    ]);
    mockBackupService.loadCompleteBackup.and.returnValue(
      Promise.resolve({
        project: { entities: {} },
        task: { entities: {} },
      } as any),
    );

    TestBed.configureTestingModule({
      providers: [
        SyncSafetyBackupService,
        { provide: BackupService, useValue: mockBackupService },
        { provide: LegacyPfDbService, useValue: mockLegacyPfDbService },
      ],
    });

    service = TestBed.inject(SyncSafetyBackupService);
  });

  afterEach(() => {
    // Restore original confirm
    window.confirm = originalConfirm;
  });

  describe('service instantiation', () => {
    it('should instantiate without errors', () => {
      expect(service).toBeTruthy();
    });

    it('should use BackupService and LegacyPfDbService for operations', async () => {
      // Multiple operations should use the injected services
      await service.getBackups();
      await service.getBackups();

      // Both calls use the same mocked db.load
      expect(mockLegacyPfDbService.load).toHaveBeenCalledTimes(2);
    });
  });

  describe('createBackup', () => {
    beforeEach(fakeAsync(() => {
      tick(1); // Process constructor setTimeout
      discardPeriodicTasks();
    }));

    it('should create a manual backup', async () => {
      await service.createBackup();

      expect(mockBackupService.loadCompleteBackup).toHaveBeenCalled();
      expect(mockLegacyPfDbService.save).toHaveBeenCalled();
    });

    it('should set lastChangedModelId to null in backup', async () => {
      await service.createBackup();

      const saveCall = mockLegacyPfDbService.save.calls.mostRecent();
      const savedBackups = saveCall.args[1] as SyncSafetyBackup[];

      expect(savedBackups.length).toBeGreaterThan(0);
      // lastChangedModelId is no longer available without metaModel, so it's null
      expect(savedBackups[0].lastChangedModelId).toBeNull();
      expect(savedBackups[0].reason).toBe('MANUAL');
    });

    it('should emit backupsChanged$ after creating backup', async () => {
      let emitted = false;
      service.backupsChanged$.subscribe(() => {
        emitted = true;
      });

      await service.createBackup();

      expect(emitted).toBe(true);
    });

    it('should preserve existing todayBackup when adding new backup with full recent slots', async () => {
      // This tests the fix for the bug where todayBackup was incorrectly overwritten
      const todayStart = new Date(
        new Date().getFullYear(),
        new Date().getMonth(),
        new Date().getDate(),
      ).getTime();

      // Create 3 existing backups from today:
      // - 2 in recent slots
      // - 1 in todayBackup slot (this should be preserved)
      const existingBackups: SyncSafetyBackup[] = [
        {
          id: 'recent-1',
          timestamp: todayStart + 3600000,
          data: {} as any,
          reason: 'MANUAL',
        }, // recent slot 1
        {
          id: 'recent-2',
          timestamp: todayStart + 1800000,
          data: {} as any,
          reason: 'MANUAL',
        }, // recent slot 2
        {
          id: 'today-first',
          timestamp: todayStart + 900000,
          data: {} as any,
          reason: 'MANUAL',
        }, // today slot (first backup of today)
      ];
      mockLegacyPfDbService.load.and.returnValue(Promise.resolve(existingBackups));

      await service.createBackup();

      const saveCall = mockLegacyPfDbService.save.calls.mostRecent();
      const savedBackups = saveCall.args[1] as SyncSafetyBackup[];

      // Should have max 4 slots: 2 recent + 1 today + (optionally 1 before today)
      expect(savedBackups.length).toBeLessThanOrEqual(4);

      // The 'today-first' backup should still be present (the fix ensures it's not overwritten)
      const todayFirstStillPresent = savedBackups.some((b) => b.id === 'today-first');
      expect(todayFirstStillPresent).toBe(true);
    });
  });

  describe('getBackups', () => {
    beforeEach(fakeAsync(() => {
      tick(1); // Process constructor setTimeout
      discardPeriodicTasks();
    }));

    it('should return empty array when no backups exist', async () => {
      mockLegacyPfDbService.load.and.returnValue(Promise.resolve(null));

      const backups = await service.getBackups();

      expect(backups).toEqual([]);
    });

    it('should return empty array when db returns non-array', async () => {
      mockLegacyPfDbService.load.and.returnValue(Promise.resolve({ invalid: 'data' }));

      const backups = await service.getBackups();

      expect(backups).toEqual([]);
    });

    it('should filter out invalid backups', async () => {
      mockLegacyPfDbService.load.and.returnValue(
        Promise.resolve([
          { id: 'valid-1', timestamp: Date.now(), data: {}, reason: 'MANUAL' },
          { id: '', timestamp: Date.now(), data: {}, reason: 'MANUAL' }, // invalid - empty id
          { id: 'EMPTY', timestamp: Date.now(), data: {}, reason: 'MANUAL' }, // invalid - EMPTY id
          null, // invalid - null
          { timestamp: Date.now() }, // invalid - no id
        ]),
      );

      const backups = await service.getBackups();

      expect(backups.length).toBe(1);
      expect(backups[0].id).toBe('valid-1');
    });

    it('should sort backups by timestamp descending', async () => {
      const now = Date.now();
      mockLegacyPfDbService.load.and.returnValue(
        Promise.resolve([
          { id: 'old', timestamp: now - 10000, data: {}, reason: 'MANUAL' },
          { id: 'newest', timestamp: now, data: {}, reason: 'MANUAL' },
          { id: 'middle', timestamp: now - 5000, data: {}, reason: 'MANUAL' },
        ]),
      );

      const backups = await service.getBackups();

      expect(backups[0].id).toBe('newest');
      expect(backups[1].id).toBe('middle');
      expect(backups[2].id).toBe('old');
    });

    it('should regenerate duplicate IDs', async () => {
      mockLegacyPfDbService.load.and.returnValue(
        Promise.resolve([
          { id: 'duplicate', timestamp: Date.now(), data: {}, reason: 'MANUAL' },
          { id: 'duplicate', timestamp: Date.now() - 1000, data: {}, reason: 'MANUAL' },
        ]),
      );

      const backups = await service.getBackups();

      // Both backups should be returned with unique IDs
      expect(backups.length).toBe(2);
      expect(backups[0].id).not.toBe(backups[1].id);
    });

    it('should return empty array on load error', async () => {
      mockLegacyPfDbService.load.and.returnValue(
        Promise.reject(new Error('Load failed')),
      );

      const backups = await service.getBackups();

      expect(backups).toEqual([]);
    });
  });

  describe('deleteBackup', () => {
    beforeEach(fakeAsync(() => {
      tick(1); // Process constructor setTimeout
      discardPeriodicTasks();
    }));

    it('should remove backup by id', async () => {
      const existingBackups: SyncSafetyBackup[] = [
        { id: 'backup-1', timestamp: Date.now(), data: {} as any, reason: 'MANUAL' },
        {
          id: 'backup-2',
          timestamp: Date.now() - 1000,
          data: {} as any,
          reason: 'MANUAL',
        },
      ];
      mockLegacyPfDbService.load.and.returnValue(Promise.resolve(existingBackups));

      await service.deleteBackup('backup-1');

      const saveCall = mockLegacyPfDbService.save.calls.mostRecent();
      const savedBackups = saveCall.args[1] as SyncSafetyBackup[];

      expect(savedBackups.length).toBe(1);
      expect(savedBackups[0].id).toBe('backup-2');
    });

    it('should emit backupsChanged$ after deleting', async () => {
      mockLegacyPfDbService.load.and.returnValue(Promise.resolve([]));

      let emitted = false;
      service.backupsChanged$.subscribe(() => {
        emitted = true;
      });

      await service.deleteBackup('any-id');

      expect(emitted).toBe(true);
    });
  });

  describe('clearAllBackups', () => {
    beforeEach(fakeAsync(() => {
      tick(1); // Process constructor setTimeout
      discardPeriodicTasks();
    }));

    it('should save empty array', async () => {
      await service.clearAllBackups();

      expect(mockLegacyPfDbService.save).toHaveBeenCalledWith('SYNC_SAFETY_BACKUPS', []);
    });

    it('should emit backupsChanged$', async () => {
      let emitted = false;
      service.backupsChanged$.subscribe(() => {
        emitted = true;
      });

      await service.clearAllBackups();

      expect(emitted).toBe(true);
    });
  });

  describe('restoreBackup', () => {
    beforeEach(fakeAsync(() => {
      tick(1); // Process constructor setTimeout
      discardPeriodicTasks();
    }));

    it('should throw error when backup not found', async () => {
      mockLegacyPfDbService.load.and.returnValue(Promise.resolve([]));

      await expectAsync(service.restoreBackup('non-existent')).toBeRejectedWithError(
        'Backup with ID non-existent not found',
      );
    });

    it('should not restore when user cancels confirmation', async () => {
      const backupData = { project: {} };
      mockLegacyPfDbService.load.and.returnValue(
        Promise.resolve([
          { id: 'backup-1', timestamp: Date.now(), data: backupData, reason: 'MANUAL' },
        ]),
      );

      // Replace window.confirm with mock
      window.confirm = jasmine.createSpy('confirm').and.returnValue(false);

      await service.restoreBackup('backup-1');

      expect(mockBackupService.importCompleteBackup).not.toHaveBeenCalled();
    });

    it('should restore when user confirms', async () => {
      const backupData = { project: {}, task: {} };
      mockLegacyPfDbService.load.and.returnValue(
        Promise.resolve([
          { id: 'backup-1', timestamp: Date.now(), data: backupData, reason: 'MANUAL' },
        ]),
      );

      // Replace window.confirm with mock
      window.confirm = jasmine.createSpy('confirm').and.returnValue(true);

      await service.restoreBackup('backup-1');

      expect(mockBackupService.importCompleteBackup).toHaveBeenCalledWith(
        backupData as any,
        false, // isSkipLegacyWarnings
        true, // isSkipReload
        true, // isForceConflict
      );
    });

    it('should throw error when restore fails', async () => {
      mockLegacyPfDbService.load.and.returnValue(
        Promise.resolve([
          { id: 'backup-1', timestamp: Date.now(), data: {}, reason: 'MANUAL' },
        ]),
      );

      // Replace window.confirm with mock
      window.confirm = jasmine.createSpy('confirm').and.returnValue(true);
      mockBackupService.importCompleteBackup.and.returnValue(
        Promise.reject(new Error('Import failed')),
      );

      await expectAsync(service.restoreBackup('backup-1')).toBeRejectedWithError(
        'Failed to restore backup: Error: Import failed',
      );
    });
  });

  describe('createBackupBeforeUpdate', () => {
    beforeEach(fakeAsync(() => {
      tick(1); // Process constructor setTimeout
      discardPeriodicTasks();
    }));

    it('should create backup with BEFORE_UPDATE_LOCAL reason and modelsToUpdate', async () => {
      const modelsToUpdate = ['task', 'project'];
      await service.createBackupBeforeUpdate(modelsToUpdate);

      expect(mockBackupService.loadCompleteBackup).toHaveBeenCalled();
      expect(mockLegacyPfDbService.save).toHaveBeenCalled();

      const saveCall = mockLegacyPfDbService.save.calls.mostRecent();
      const savedBackups = saveCall.args[1] as SyncSafetyBackup[];

      expect(savedBackups.length).toBeGreaterThan(0);
      expect(savedBackups[0].reason).toBe('BEFORE_UPDATE_LOCAL');
      expect(savedBackups[0].modelsToUpdate).toEqual(['task', 'project']);
    });
  });
});
