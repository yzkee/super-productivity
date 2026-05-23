import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import {
  MAX_PLUGIN_DATA_SIZE,
  MIN_PLUGIN_PERSIST_INTERVAL_MS,
} from './plugin-persistence.model';
import { upsertPluginUserData, deletePluginUserData } from './store/plugin.actions';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';
import { COMPRESS_THRESHOLD, SENTINEL, encodeForPersist } from './util/plugin-data-codec';

/**
 * Drain enough microtasks for the per-plugin commit chain to settle. The
 * chain is `Promise.resolve().catch().then(() => _encodeAndDispatch())` plus
 * one `await` inside _encodeAndDispatch — three turns max — but a few extra
 * yields are free and survive any future chain tweak.
 */
const drainAsync = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('PluginUserPersistenceService', () => {
  let service: PluginUserPersistenceService;
  let store: MockStore;
  let dispatchSpy: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PluginUserPersistenceService,
        provideMockStore({
          selectors: [{ selector: selectPluginUserDataFeatureState, value: [] }],
        }),
      ],
    });

    store = TestBed.inject(MockStore);
    service = TestBed.inject(PluginUserPersistenceService);
    dispatchSpy = spyOn(store, 'dispatch').and.callThrough();
  });

  afterEach(() => {
    store.resetSelectors();
  });

  describe('persistPluginUserData', () => {
    it('should dispatch upsertPluginUserData with the raw input (below codec threshold)', async () => {
      const pluginId = 'test-plugin';
      const data = 'test data';
      await service.persistPluginUserData(pluginId, data);

      expect(dispatchSpy).toHaveBeenCalledWith(
        upsertPluginUserData({ pluginUserData: { id: pluginId, data } }),
      );
    });

    it('should dispatch compressed data when the payload is above the codec threshold', async () => {
      const pluginId = 'test-plugin';
      // ~2 KB of repetitive JSON — well above the 1 KB threshold, gzips small.
      const data = JSON.stringify({
        items: Array.from({ length: 40 }, (_, i) => ({
          id: i,
          name: `repeating-value-${i % 3}`,
        })),
      });
      expect(data.length).toBeGreaterThan(COMPRESS_THRESHOLD);

      await service.persistPluginUserData(pluginId, data);

      const dispatched = dispatchSpy.calls.mostRecent().args[0] as ReturnType<
        typeof upsertPluginUserData
      >;
      expect(dispatched.type).toBe(upsertPluginUserData.type);
      const stored = dispatched.pluginUserData.data;
      expect(stored.startsWith(SENTINEL)).toBe(true);
      expect(stored.length).toBeLessThan(data.length);
    });

    it('should throw error when data exceeds MAX_PLUGIN_DATA_SIZE', () => {
      const pluginId = 'test-plugin';
      const largeData = 'x'.repeat(MAX_PLUGIN_DATA_SIZE + 1000);

      // Size check is synchronous: throws before any async work begins.
      expect(() => service.persistPluginUserData(pluginId, largeData)).toThrowError(
        /Plugin data exceeds maximum size/,
      );
      expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('should coalesce a rapid second call instead of dropping it', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        const pluginId = 'test-plugin';

        await service.persistPluginUserData(pluginId, 'first');
        expect(dispatchSpy).toHaveBeenCalledTimes(1);

        // A call inside the rate-limit window must not throw and must not be
        // dropped — it is held until the window opens.
        expect(() => service.persistPluginUserData(pluginId, 'second')).not.toThrow();
        expect(dispatchSpy).toHaveBeenCalledTimes(1);

        jasmine.clock().tick(MIN_PLUGIN_PERSIST_INTERVAL_MS);
        // setTimeout fires → _flushPendingData → _commit kicks off async
        // compress+dispatch. Drain microtasks to let it settle.
        await drainAsync();
        expect(dispatchSpy).toHaveBeenCalledTimes(2);
        expect(dispatchSpy).toHaveBeenCalledWith(
          upsertPluginUserData({
            pluginUserData: { id: pluginId, data: 'second' },
          }),
        );
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should keep only the most recent of several coalesced calls', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        const pluginId = 'test-plugin';

        await service.persistPluginUserData(pluginId, 'v1');
        service.persistPluginUserData(pluginId, 'v2'); // coalesced
        service.persistPluginUserData(pluginId, 'v3'); // coalesced, replaces v2
        expect(dispatchSpy).toHaveBeenCalledTimes(1);

        jasmine.clock().tick(MIN_PLUGIN_PERSIST_INTERVAL_MS);
        await drainAsync();
        expect(dispatchSpy).toHaveBeenCalledTimes(2);
        expect(dispatchSpy).toHaveBeenCalledWith(
          upsertPluginUserData({ pluginUserData: { id: pluginId, data: 'v3' } }),
        );
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should allow different plugins to persist data without rate limiting each other', async () => {
      const plugin1 = 'plugin-1';
      const plugin2 = 'plugin-2';
      const data = 'test data';

      await Promise.all([
        service.persistPluginUserData(plugin1, data),
        service.persistPluginUserData(plugin2, data),
      ]);

      expect(dispatchSpy).toHaveBeenCalledTimes(2);
    });

    it('should accept data at exactly MAX_PLUGIN_DATA_SIZE', () => {
      const pluginId = 'test-plugin';
      const exactLimitData = 'x'.repeat(MAX_PLUGIN_DATA_SIZE - 10);

      // The sync size check is what we care about here; the async commit
      // races with test teardown but is harmless.
      expect(() => service.persistPluginUserData(pluginId, exactLimitData)).not.toThrow();
    });
  });

  describe('loadPluginUserData', () => {
    it('should decompress and return data for an existing plugin', async () => {
      const pluginId = 'test-plugin';
      const original = JSON.stringify({
        items: Array.from({ length: 40 }, (_, i) => ({
          id: i,
          name: `repeating-value-${i % 3}`,
        })),
      });
      const stored = await encodeForPersist(original);
      expect(stored.startsWith(SENTINEL)).toBe(true);

      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: pluginId, data: stored },
      ]);

      const result = await service.loadPluginUserData(pluginId);
      expect(result).toBe(original);
    });

    it('should pass through legacy uncompressed data', async () => {
      const pluginId = 'test-plugin';
      const legacy = 'stored data';

      store.overrideSelector(selectPluginUserDataFeatureState, [
        { id: pluginId, data: legacy },
      ]);

      const result = await service.loadPluginUserData(pluginId);
      expect(result).toBe(legacy);
    });

    it('should return null for non-existent plugin', async () => {
      store.overrideSelector(selectPluginUserDataFeatureState, []);

      const result = await service.loadPluginUserData('non-existent');

      expect(result).toBeNull();
    });

    it('should return a pending coalesced write before it is committed', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        const pluginId = 'test-plugin';
        store.overrideSelector(selectPluginUserDataFeatureState, [
          { id: pluginId, data: 'committed' },
        ]);

        await service.persistPluginUserData(pluginId, 'committed');
        service.persistPluginUserData(pluginId, 'pending'); // coalesced

        const result = await service.loadPluginUserData(pluginId);
        expect(result).toBe('pending');
      } finally {
        jasmine.clock().uninstall();
      }
    });
  });

  describe('removePluginUserData', () => {
    it('should dispatch deletePluginUserData action', () => {
      const pluginId = 'test-plugin';

      service.removePluginUserData(pluginId);

      expect(dispatchSpy).toHaveBeenCalledWith(deletePluginUserData({ pluginId }));
    });

    it('should cancel a pending coalesced write', async () => {
      const baseTime = Date.now();
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(baseTime));
      try {
        const pluginId = 'test-plugin';
        await service.persistPluginUserData(pluginId, 'first');
        service.persistPluginUserData(pluginId, 'pending'); // coalesced

        service.removePluginUserData(pluginId);
        dispatchSpy.calls.reset();

        jasmine.clock().tick(MIN_PLUGIN_PERSIST_INTERVAL_MS * 2);
        await drainAsync();
        expect(dispatchSpy).not.toHaveBeenCalled();
      } finally {
        jasmine.clock().uninstall();
      }
    });

    it('should not resurrect data when removed during an in-flight commit', async () => {
      const pluginId = 'test-plugin';
      // A payload above the codec threshold forces async compression, so
      // the commit's dispatch happens after at least one microtask turn —
      // wide enough for a synchronous remove to land in between.
      const data = 'x'.repeat(COMPRESS_THRESHOLD + 100);

      const persistPromise = service.persistPluginUserData(pluginId, data);

      // remove() runs synchronously while compression is still pending.
      service.removePluginUserData(pluginId);

      await persistPromise;
      await drainAsync();

      const upsertCalls = dispatchSpy.calls
        .allArgs()
        .filter(([action]) => action.type === upsertPluginUserData.type);
      const deleteCalls = dispatchSpy.calls
        .allArgs()
        .filter(([action]) => action.type === deletePluginUserData.type);
      expect(upsertCalls.length).toBe(0);
      expect(deleteCalls.length).toBe(1);
    });
  });
});
