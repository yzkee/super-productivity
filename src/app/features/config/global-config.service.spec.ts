import { TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import { GlobalConfigService } from './global-config.service';
import { CONFIG_FEATURE_NAME } from './store/global-config.reducer';
import type { SyncConfig } from './global-config.model';

describe('GlobalConfigService', () => {
  it('should expose a sync-core config snapshot without private provider fields', async () => {
    const syncConfig = {
      ...DEFAULT_GLOBAL_CONFIG.sync,
      isEnabled: true,
      syncProvider: SyncProviderId.SuperSync,
      isEncryptionEnabled: true,
      isCompressionEnabled: true,
      isManualSyncOnly: true,
      syncInterval: 15,
      encryptKey: 'private-key',
    } as SyncConfig;

    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          initialState: {
            [CONFIG_FEATURE_NAME]: {
              ...DEFAULT_GLOBAL_CONFIG,
              sync: syncConfig,
            },
          },
        }),
      ],
    });

    const snapshot = await TestBed.inject(GlobalConfigService).getSyncConfig();

    expect(snapshot).toEqual({
      isEnabled: true,
      syncProvider: SyncProviderId.SuperSync,
      isEncryptionEnabled: true,
      isCompressionEnabled: true,
      isManualSyncOnly: true,
      syncInterval: 15,
    });
    expect('encryptKey' in snapshot).toBeFalse();
  });
});
