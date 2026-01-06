// Barrel export for sync module - replaces pfapi/api
// This provides backward compatibility for existing imports

// Types from sync.types.ts
export {
  ValidationResult,
  EncryptAndCompressCfg,
  ModelBase,
  ModelCfg,
  ModelCfgs,
  AllModelData,
  AllSyncModels,
  SyncProviderPrivateCfgBase,
  LocalFileSyncPrivateCfg,
  SyncProviderPrivateCfg,
  PrivateCfgByProviderId,
  RevMap,
  ConflictData,
  CompleteBackup,
  CurrentProviderPrivateCfg,
} from './sync.types';

// Enums and constants from provider.const.ts
export {
  SyncProviderId,
  SyncStatus,
  ConflictReason,
  REMOTE_FILE_CONTENT_PREFIX,
  PRIVATE_CFG_PREFIX,
} from './providers/provider.const';

// Error classes
export {
  ImpossibleError,
  DecryptError,
  DecryptNoPasswordError,
  DataRepairNotPossibleError,
  BackupImportFailedError,
  WebCryptoNotAvailableError,
  RemoteFileNotFoundAPIError,
  MissingCredentialsSPError,
  AuthFailSPError,
  NoSyncProviderSetError,
  SyncAlreadyInProgressError,
  CanNotMigrateMajorDownError,
  LockPresentError,
  NoRemoteModelFile,
  PotentialCorsError,
  RevMismatchForModelError,
  SyncInvalidTimeValuesError,
} from './errors/sync-errors';

// Provider interface
export { SyncProviderServiceInterface } from './providers/provider.interface';

// Providers
export { Dropbox } from './providers/dropbox/dropbox';
export { DropboxPrivateCfg } from './providers/dropbox/dropbox';

// VectorClock from core
export { VectorClock } from '../core/util/vector-clock';

// Legacy type stubs for backward compatibility
export type ModelCfgToModelCtrl<T> = T;
