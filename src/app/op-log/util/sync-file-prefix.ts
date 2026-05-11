import { createSyncFilePrefixHelpers } from '@sp/sync-core';
import type { SyncFilePrefixParams, SyncFilePrefixParamsOutput } from '@sp/sync-core';
import { REMOTE_FILE_CONTENT_PREFIX } from '../sync-providers/provider.const';
import { InvalidFilePrefixError } from '../core/errors/sync-errors';

export type { SyncFilePrefixParams, SyncFilePrefixParamsOutput };

const syncFilePrefixHelpers = createSyncFilePrefixHelpers({
  prefix: REMOTE_FILE_CONTENT_PREFIX,
  createInvalidPrefixError: (details): Error => new InvalidFilePrefixError(details),
});

export const getSyncFilePrefix = syncFilePrefixHelpers.getSyncFilePrefix;

export const extractSyncFileStateFromPrefix =
  syncFilePrefixHelpers.extractSyncFileStateFromPrefix;
