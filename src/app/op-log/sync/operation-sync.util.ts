import { ActionType, Operation } from '../core/operation.types';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  SyncOperation,
} from '../../sync/providers/provider.interface';
import { SyncProviderId } from '../../sync/providers/provider.const';
import { FileBasedOperationSyncCapable } from './providers/file-based/file-based-sync.types';

/**
 * Type guard to check if a provider supports operation-based sync (API sync).
 * This is for providers like SuperSync that have a dedicated API endpoint.
 */
export const isOperationSyncCapable = (
  provider: SyncProviderServiceInterface<SyncProviderId>,
): provider is SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable => {
  return (
    'supportsOperationSync' in provider &&
    (provider as unknown as OperationSyncCapable).supportsOperationSync === true
  );
};

/**
 * Type guard to check if a provider supports file-based operation sync.
 * This is for providers like WebDAV, Dropbox, LocalFile that use file storage.
 */
export const isFileBasedOperationSyncCapable = (
  provider: SyncProviderServiceInterface<SyncProviderId>,
): provider is SyncProviderServiceInterface<SyncProviderId> &
  FileBasedOperationSyncCapable => {
  return (
    'supportsFileBasedOperationSync' in provider &&
    (provider as unknown as FileBasedOperationSyncCapable)
      .supportsFileBasedOperationSync === true
  );
};

/**
 * Convert a SyncOperation (from API response) to an Operation (local format).
 */
export const syncOpToOperation = (syncOp: SyncOperation): Operation => {
  return {
    id: syncOp.id,
    clientId: syncOp.clientId,
    actionType: syncOp.actionType as ActionType,
    opType: syncOp.opType as Operation['opType'],
    entityType: syncOp.entityType as Operation['entityType'],
    entityId: syncOp.entityId,
    entityIds: syncOp.entityIds,
    payload: syncOp.payload,
    vectorClock: syncOp.vectorClock,
    timestamp: syncOp.timestamp,
    schemaVersion: syncOp.schemaVersion,
  };
};
