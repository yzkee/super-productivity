# PFAPI Elimination - Current Status

## Goal

Delete the entire `src/app/pfapi/` directory (~83 files, 2.0 MB) by moving necessary code into sync/ or core/, removing the legacy abstraction layer.

## Completed Phases

### Phase 1: Delete Dead Code ✅

- Deleted empty migration system
- Deleted custom Observable/Event system
- Deleted PFAPI migration service

### Phase 2: Refactor ClientIdService ✅

- Modified `src/app/core/util/client-id.service.ts` to use direct IndexedDB
- Removed PfapiService dependency

### Phase 3: Move Sync Providers ✅

- Created `src/app/sync/providers/` structure
- Moved SuperSync, Dropbox, WebDAV, LocalFile providers
- Moved encryption/compression utilities
- Created `sync-exports.ts` barrel for backward compatibility

### Phase 4: Transform PfapiService → SyncService ✅

- Renamed to `src/app/sync/sync.service.ts`
- Added direct methods to replace `pf.*` accessors:
  - `sync()`, `clearDatabase()`, `loadGlobalConfig()`
  - `getSyncProviderById()`, `setPrivateCfgForSyncProvider()`
  - `forceUploadLocalState()`, `forceDownloadRemoteState()`
  - `isSyncInProgress` getter

### Phase 5: Move Validation & Config ✅

- Moved validation/repair files to `src/app/sync/validation/`
- Moved model config to `src/app/sync/model-config.ts`
- Moved types to `src/app/sync/sync.types.ts`

### Phase 6: Delete PFAPI Core ✅

- Deleted entire `src/app/pfapi/` directory
- Fixed task-archive.service.ts to use ArchiveDbAdapter
- Fixed time-tracking.service.ts to use ArchiveDbAdapter
- Fixed user-profile.service.ts
- Fixed file-imex.component.ts

## Phase 7: In Progress - Fix Remaining `pf.*` References

### Files Still Needing Fixes

These files still have `pf.*` references that need to be replaced with direct service methods:

1. **`src/app/imex/sync/sync-wrapper.service.ts`**

   - `pf.metaModel.setVectorClockFromBridge()`
   - `pf.metaModel.load()`
   - `pf.ev.emit('syncStatusChange')`

2. **`src/app/imex/sync/sync-config.service.ts`**

   - `pf.getSyncProviderById()`
   - `pf.getActiveSyncProvider()`

3. **`src/app/imex/sync/sync-safety-backup.service.ts`**

   - Multiple `pf.*` calls

4. **`src/app/imex/sync/dropbox/store/dropbox.effects.ts`**

   - `currentProviderPrivateCfg$` observable type issues

5. **`src/app/imex/sync/super-sync-restore.service.ts`**

   - `pf.getActiveSyncProvider()`

6. **`src/app/imex/sync/encryption-password-change.service.ts`**

   - `pf.getActiveSyncProvider()`

7. **Op-log files** (various `pf.*` references)
   - `operation-log-hydrator.service.ts`
   - Others in `src/app/op-log/`

### Missing Error Exports

Add to `src/app/sync/sync-exports.ts`:

- `CanNotMigrateMajorDownError`
- `LockPresentError`
- `NoRemoteModelFile`
- `PotentialCorsError`
- `RevMismatchForModelError`
- `SyncInvalidTimeValuesError`

### Type Issues

- `currentProviderPrivateCfg$` observable returns `{}` type instead of proper provider config type
- Need to fix typing in `sync.service.ts` or create proper type union

## Next Steps

1. Run `ng build --no-watch --configuration=development` to get current error list
2. Fix each file's `pf.*` references by:
   - Using existing PfapiService methods where available
   - Adding new methods to PfapiService if needed
   - For `pf.ev.emit()` calls, use RxJS Subject emissions
3. Add missing error class exports to `sync-exports.ts`
4. Fix type issues with observable returns
5. Run full test suite: `npm test`, `npm run e2e:supersync`, `npm run e2e:webdav`

## Key Design Decisions

1. **No backward compat for old PFAPI format** - Users on old format need fresh sync
2. **Preserve OAuth tokens** - Use SAME DB name (`pf`) and key format (`PRIVATE_CFG__<id>`)
3. **Preserve client ID** - Use SAME DB name (`pf`) and key (`CLIENT_ID`)
4. **Keep legacy PBKDF2 decryption** - For reading old encrypted data
5. **Use ArchiveDbAdapter** - For direct archive persistence (not through pfapiService.m)

## Files Already Fixed

- `src/app/features/time-tracking/task-archive.service.ts` - Uses ArchiveDbAdapter
- `src/app/features/time-tracking/time-tracking.service.ts` - Uses ArchiveDbAdapter
- `src/app/features/user-profile/user-profile.service.ts` - Direct service methods
- `src/app/imex/file-imex/file-imex.component.ts` - loadCompleteBackup(true)
- `src/app/imex/local-backup/local-backup.service.ts` - getAllSyncModelDataFromStore()

## Commands to Run

```bash
# Check current build errors
ng build --no-watch --configuration=development

# Check individual file
npm run checkFile <filepath>

# Run tests
npm test
npm run e2e:supersync
npm run e2e:webdav
npm run e2e
```
