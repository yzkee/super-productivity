import { TestBed } from '@angular/core/testing';
import { IDBPDatabase, unwrap } from 'idb';
import { ArchiveStoreService } from './archive-store.service';
import { STORE_NAMES } from './db-keys.const';

describe('ArchiveStoreService', () => {
  let service: ArchiveStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [ArchiveStoreService],
    });
    service = TestBed.inject(ArchiveStoreService);
    // Opens the connection and clears any data left by previous tests
    // (ArchiveStoreService shares the SUP_OPS database with other specs).
    await service._clearAllDataForTesting();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('connection lifecycle handlers', () => {
    // Open the connection through the lazy `_ensureInit()` path so `_initPromise`
    // is genuinely populated before the event is dispatched.
    const openViaLazyInit = async (): Promise<void> => {
      (service as any)._db = undefined;
      (service as any)._initPromise = undefined;
      await service.loadArchiveYoung();
    };

    // FIXME(test-infra): These two tests dispatch synthetic `versionchange` /
    // `close` events to verify the service reopens after the browser closes
    // its IDB connection. fake-indexeddb (used by every other unit spec for
    // cross-spec isolation, see src/test.ts) does not reproduce the post-close
    // reopen path: the second `openDB(...)` errors with InvalidStateError.
    // Real-browser IDB cannot be swapped back in mid-suite because `idb`
    // captures `IDBOpenDBRequest` etc. by reference at module load. These
    // assertions can be restored by either (a) refactoring the service to
    // expose the close/versionchange handlers as named methods that tests
    // call directly, or (b) running these specs in a separate Karma config
    // that doesn't install fake-indexeddb.
    xit('closes the connection and clears cached state on versionchange, then reopens', async () => {
      await openViaLazyInit();
      expect((service as any)._db).toBeDefined();
      expect((service as any)._initPromise).toBeDefined();

      const raw = unwrap((service as any)._db as IDBPDatabase);
      raw.dispatchEvent(new Event('versionchange'));

      // The handler runs synchronously: cached state cleared and the
      // connection actually closed (so it cannot block a schema upgrade).
      expect((service as any)._db).toBeUndefined();
      expect((service as any)._initPromise).toBeUndefined();
      let txError: unknown;
      try {
        raw.transaction(STORE_NAMES.ARCHIVE_YOUNG, 'readonly');
      } catch (e) {
        txError = e;
      }
      expect((txError as DOMException | undefined)?.name).toBe('InvalidStateError');

      // The next access transparently reopens the connection.
      await expectAsync(service.loadArchiveYoung()).toBeResolved();
    });

    // FIXME(test-infra): see note on the sibling xit above.
    xit('clears cached state on the browser close event, then reopens', async () => {
      await openViaLazyInit();

      const raw = unwrap((service as any)._db as IDBPDatabase);
      raw.dispatchEvent(new Event('close'));

      expect((service as any)._db).toBeUndefined();
      expect((service as any)._initPromise).toBeUndefined();
      await expectAsync(service.loadArchiveYoung()).toBeResolved();
      raw.close();
    });
  });
});
