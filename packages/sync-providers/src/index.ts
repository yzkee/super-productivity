export type {
  CredentialChangeHandler,
  SyncCredentialStorePort,
} from './credential-store-port';
export {
  AdditionalLogErrorBase,
  AuthFailSPError,
  EmptyRemoteBodySPError,
  extractErrorMessage,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  MissingRefreshTokenAPIError,
  NoRevAPIError,
  PotentialCorsError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
  UploadRevToMatchMismatchAPIError,
} from './errors';
export { FILE_BASED_SYNC_CONSTANTS } from './file-based-sync-data';
export type { FileBasedSyncData, SyncFileCompactOp } from './file-based-sync-data';
export type { FileAdapter } from './file-adapter';
export { generateCodeChallenge, generateCodeVerifier, generatePKCECodes } from './pkce';
export type {
  GenerateCodeChallengeOptions,
  GenerateCodeVerifierOptions,
  GeneratePkceCodesOptions,
  PkceCrypto,
  PkceSha256,
} from './pkce';
export {
  executeNativeRequestWithRetry,
  isTransientNetworkError,
} from './http/native-http-retry';
export type {
  ExecuteNativeRequestOptions,
  NativeHttpExecutor,
  NativeHttpRequestConfig,
  NativeHttpResponse,
} from './http/native-http-retry';
export { errorMeta, urlPathOnly } from './log/error-meta';
export type { ProviderPlatformInfo } from './platform/provider-platform-info';
export type { WebFetchFactory } from './platform/web-fetch-factory';
export {
  Dropbox,
  PROVIDER_ID_DROPBOX,
  type DropboxCfg,
  type DropboxDeps,
  type DropboxPrivateCfg,
} from './file-based/dropbox/dropbox';
export type { DropboxFileMetadata } from './file-based/dropbox/dropbox.model';
export {
  isFileSyncProvider,
  type FileDownloadResponse,
  type FileRevResponse,
  type FileSnapshotOpDownloadResponse,
  type FileSyncProvider,
  type OpDownloadResponse,
  type OpDownloadResponseBase,
  type OpDownloadResponseForMode,
  type OperationSyncCapable,
  type OperationSyncProviderMode,
  type OpUploadResponse,
  type OpUploadResult,
  type ProviderId,
  type RestoreCapable,
  type RestorePoint,
  type RestorePointsResponse,
  type RestoreSnapshotResponse,
  type ServerSyncOperation,
  type SnapshotUploadResponse,
  type SuperSyncOpDownloadResponse,
  type SyncOperation,
  type SyncProviderAuthHelper,
  type SyncProviderBase,
} from './provider.types';
