import { IValidation } from 'typia';
import type { SyncFilePrefixInvalidPrefixDetails, SyncLogMeta } from '@sp/sync-core';
import {
  extractErrorMessage as extractGenericErrorMessage,
  toSyncLogError,
} from '@sp/sync-core';
import { FILE_BASED_SYNC_CONSTANTS } from '../../sync-providers/file-based/file-based-sync.types';
import { OP_LOG_SYNC_LOGGER } from '../sync-logger.adapter';

export const extractErrorMessage = (err: unknown): string | null => {
  const message = extractGenericErrorMessage(err);
  if (typeof message === 'string' && message.startsWith('Z_')) {
    return `Compression error: ${message.replace('Z_', '').replace(/_/g, ' ').toLowerCase()}`;
  }
  return message;
};

const isSafePrimitive = (
  value: unknown,
): value is string | number | boolean | null | undefined =>
  value === null ||
  value === undefined ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const getValueType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Error) return value.name || 'Error';
  return typeof value;
};

const getPrimitiveKeySummary = (value: unknown): string | undefined => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  try {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => isSafePrimitive(record[key]))
      .slice(0, 10);
    return keys.length > 0 ? keys.join(',') : undefined;
  } catch {
    return undefined;
  }
};

const getValidationErrors = (
  validationResult?: IValidation<unknown>,
): IValidation.IError[] | undefined => {
  if (
    validationResult &&
    typeof validationResult === 'object' &&
    'errors' in validationResult &&
    Array.isArray(validationResult.errors)
  ) {
    return validationResult.errors as IValidation.IError[];
  }
  return undefined;
};

const getValidationErrorPathSummary = (
  validationResult?: IValidation<unknown>,
): string | undefined => {
  const errors = getValidationErrors(validationResult);
  if (!errors) return undefined;

  const pathSummary = errors
    .slice(0, 3)
    .map((error) => error.path)
    .filter(Boolean)
    .join(', ');
  return pathSummary || undefined;
};

const buildAdditionalLogMeta = (
  errorName: string,
  additional: unknown[],
  extractedMessage: string | null,
): SyncLogMeta => {
  const firstAdditional = additional[0];
  const firstAdditionalError = toSyncLogError(firstAdditional);
  const firstAdditionalKeys = getPrimitiveKeySummary(firstAdditional);

  return {
    errorName,
    additionalCount: additional.length,
    firstAdditionalType: getValueType(firstAdditional),
    hasExtractedMessage: extractedMessage !== null,
    firstAdditionalKeys,
    firstAdditionalErrorName:
      firstAdditional instanceof Error ? firstAdditionalError.name : undefined,
    firstAdditionalErrorCode:
      firstAdditional instanceof Error ? firstAdditionalError.code : undefined,
  };
};

class AdditionalLogErrorBase<T = unknown[]> extends Error {
  additionalLog: T;

  constructor(...additional: unknown[]) {
    // Extract meaningful message from first argument, fall back to class name
    const extractedMessage = extractErrorMessage(additional[0]);
    super(extractedMessage ?? 'Unknown error');

    const errorName = new.target.name;

    if (additional.length > 0) {
      try {
        const firstAdditionalKeys = getPrimitiveKeySummary(additional[0]);
        const keySuffix = firstAdditionalKeys ? ` (${firstAdditionalKeys})` : '';
        OP_LOG_SYNC_LOGGER.log(`${errorName} additional error metadata${keySuffix}`, {
          ...buildAdditionalLogMeta(errorName, additional, extractedMessage),
        });
      } catch (e) {
        OP_LOG_SYNC_LOGGER.log(`${errorName} additional error metadata unavailable`, {
          errorName,
          additionalCount: additional.length,
          loggingErrorName: toSyncLogError(e).name,
        });
      }
    }
    this.additionalLog = additional as T;
  }
}

export class ImpossibleError extends Error {
  override name = ' ImpossibleError';
}

// --------------API ERRORS--------------
export class NoRevAPIError extends AdditionalLogErrorBase {
  override name = ' NoRevAPIError';
}

export class TooManyRequestsAPIError extends AdditionalLogErrorBase {
  override name = ' TooManyRequestsAPIError';
}

export class NoEtagAPIError extends AdditionalLogErrorBase {
  override name = ' NoEtagAPIError';
}

export class FileExistsAPIError extends Error {
  override name = ' FileExistsAPIError';
}

export class RemoteFileNotFoundAPIError extends AdditionalLogErrorBase {
  override name = ' RemoteFileNotFoundAPIError';
}

export class MissingRefreshTokenAPIError extends Error {
  override name = ' MissingRefreshTokenAPIError';
}

export class FileHashCreationAPIError extends AdditionalLogErrorBase {
  override name = ' FileHashCreationAPIError';
}

export class UploadRevToMatchMismatchAPIError extends AdditionalLogErrorBase {
  override name = ' UploadRevToMatchMismatchAP';
}

// export class CannotCreateFolderAPIError extends AdditionalLogErrorBase {
//   override name = 'CannotCreateFolderAPIError';
// }

export class HttpNotOkAPIError extends AdditionalLogErrorBase {
  override name = ' HttpNotOkAPIError';
  response: Response;
  body?: string;

  constructor(response: Response, body?: string) {
    super(response, body);
    this.response = response;
    this.body = body;
    const statusText = response.statusText || 'Unknown Status';

    // Parse body to extract meaningful error information
    let errorDetail = '';
    if (body) {
      const safeBody =
        typeof body === 'string'
          ? body
          : body !== undefined
            ? (() => {
                try {
                  return JSON.stringify(body);
                } catch (e) {
                  return String(body);
                }
              })()
            : '';

      // Try to extract meaningful error from XML/HTML responses
      errorDetail = this._extractErrorFromBody(safeBody);
    }

    const bodyText = errorDetail ? ` - ${errorDetail}` : '';
    this.message = `HTTP ${response.status} ${statusText}${bodyText}`;
  }

  private _extractErrorFromBody(body: string): string {
    if (!body) return '';

    // Limit body length for error messages
    const maxBodyLength = 300;

    // Try to extract error from Nextcloud/WebDAV XML responses
    // Look for <s:message> or <d:error> tags
    const nextcloudMessageMatch = body.match(/<s:message[^>]*>(.*?)<\/s:message>/i);
    if (nextcloudMessageMatch && nextcloudMessageMatch[1]) {
      return nextcloudMessageMatch[1].trim().substring(0, maxBodyLength);
    }

    const webdavErrorMatch = body.match(/<d:error[^>]*>(.*?)<\/d:error>/i);
    if (webdavErrorMatch && webdavErrorMatch[1]) {
      return webdavErrorMatch[1].trim().substring(0, maxBodyLength);
    }

    // Look for HTML title tags (often contain error descriptions)
    const titleMatch = body.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      const title = titleMatch[1].trim();
      // Avoid generic titles
      if (title && !title.match(/^(error|404|403|500)$/i)) {
        return title.substring(0, maxBodyLength);
      }
    }

    // Try to extract JSON error
    try {
      const jsonMatch = body.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.error) {
          return String(parsed.error).substring(0, maxBodyLength);
        }
        if (parsed.message) {
          return String(parsed.message).substring(0, maxBodyLength);
        }
      }
    } catch (e) {
      // Not JSON, continue
    }

    // Strip script and style tags with their content
    // Apply repeatedly to handle nested/crafted inputs like <scri<script>pt>
    let cleanBody = body;
    let previousBody: string;
    do {
      previousBody = cleanBody;
      cleanBody = cleanBody
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gim, '')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gim, '')
        .replace(/<script\b/gim, '')
        .replace(/<style\b/gim, '');
    } while (cleanBody !== previousBody);

    // Strip HTML tags for plain text
    const withoutTags = cleanBody
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Return the first meaningful chunk of text
    return withoutTags.substring(0, maxBodyLength);
  }
}

// NOTE: we can't know for sure without complicating things
export class PotentialCorsError extends AdditionalLogErrorBase {
  override name = 'PotentialCorsError';
  url: string;

  constructor(url: string, ...args: unknown[]) {
    super(
      `Cross-Origin Request Blocked: The request to ${url} was blocked by CORS policy`,
      ...args,
    );
    this.url = url;
  }
}

// --------------SYNC PROVIDER ERRORS--------------

export class MissingCredentialsSPError extends Error {
  override name = 'MissingCredentialsSPError';
}

export class AuthFailSPError extends AdditionalLogErrorBase {
  override name = 'AuthFailSPError';
}

export class InvalidDataSPError extends AdditionalLogErrorBase {
  override name = 'InvalidDataSPError';
}

export class EmptyRemoteBodySPError extends InvalidDataSPError {
  override name = 'EmptyRemoteBodySPError';
}

// --------------OTHER SYNC ERRORS--------------
export class NoSyncProviderSetError extends Error {
  override name = 'NoSyncProviderSetError';
}

/**
 * Thrown when file-based sync detects local unsynced changes that would be
 * lost if remote snapshot is applied. Caught by SyncWrapperService to show
 * conflict resolution dialog.
 */
export class LocalDataConflictError extends Error {
  override name = 'LocalDataConflictError';

  constructor(
    public readonly unsyncedCount: number,
    public readonly remoteSnapshotState: Record<string, unknown>,
    public readonly remoteVectorClock?: Record<string, number>,
  ) {
    super(`Local data conflict: ${unsyncedCount} unsynced changes would be lost`);
  }
}

export class SyncAlreadyInProgressError extends Error {
  override name = 'SyncAlreadyInProgressError';

  constructor() {
    super('Sync already in progress');
  }
}

export class LockAcquisitionTimeoutError extends Error {
  override name = 'LockAcquisitionTimeoutError';

  constructor(
    public readonly lockName: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Timed out waiting ${timeoutMs}ms to acquire lock "${lockName}". ` +
        `A previous lock holder may have crashed or stalled.`,
    );
  }
}

export class RevMismatchForModelError extends AdditionalLogErrorBase<string> {
  override name = 'RevMismatchForModelError';
}

export class UnknownSyncStateError extends Error {
  override name = 'UnknownSyncStateError';
}

export class SyncInvalidTimeValuesError extends AdditionalLogErrorBase {
  override name = 'SyncInvalidTimeValuesError';
}

export class RevMapModelMismatchErrorOnDownload extends AdditionalLogErrorBase {
  override name = 'RevMapModelMismatchErrorOnDownload';
}

export class RevMapModelMismatchErrorOnUpload extends AdditionalLogErrorBase {
  override name = 'RevMapModelMismatchErrorOnUpload';
}

export class NoRemoteModelFile extends AdditionalLogErrorBase<string> {
  override name = 'NoRemoteModelFile';
}

export class NoRemoteMetaFile extends Error {
  override name = 'NoRemoteMetaFile';
}

export class RemoteFileChangedUnexpectedly extends AdditionalLogErrorBase {
  override name = 'RemoteFileChangedUnexpectedly';
}

// --------------LOCKFILE ERRORS--------------
export class LockPresentError extends Error {
  override name = 'LockPresentError';
}

export class LockFromLocalClientPresentError extends Error {
  override name = 'LockFromLocalClientPresentError';
}

// -----ENCRYPTION & COMPRESSION----
export class DecryptNoPasswordError extends AdditionalLogErrorBase {
  override name = 'DecryptNoPasswordError';
}

export class DecryptError extends AdditionalLogErrorBase {
  override name = 'DecryptError';
}

export class CompressError extends AdditionalLogErrorBase {
  override name = 'CompressError';
}

export class DecompressError extends AdditionalLogErrorBase {
  override name = 'DecompressError';

  constructor(...additional: unknown[]) {
    super(...additional);
    this.message = buildDecompressErrorMessage(this.message);
  }
}

/**
 * Translates opaque browser DecompressionStream errors (e.g. WHATWG's
 * "compressed Input was truncated") into actionable recovery guidance.
 * Truncation of the remote sync file is unrecoverable from the client — the
 * user must delete the corrupt file on the remote before sync can recover.
 *
 * NOTE: rawMessage here has already passed through extractErrorMessage, which
 * rewrites zlib Z_* codes to "compression error: <code>" (spaces, not
 * underscores), so this heuristic matches the post-normalization form.
 */
const buildDecompressErrorMessage = (rawMessage: string): string => {
  const lower = rawMessage.toLowerCase();
  const looksTruncated =
    lower.includes('truncat') ||
    lower.includes('unexpected end') ||
    lower.includes('buf error');
  if (looksTruncated) {
    return (
      `Remote sync file appears corrupted (compressed data is truncated). ` +
      `To recover, delete the ${FILE_BASED_SYNC_CONSTANTS.SYNC_FILE} file on ` +
      `your sync server, then trigger a sync from the device with your latest data.`
    );
  }
  return `Failed to decompress sync data: ${rawMessage}`;
};

export class JsonParseError extends Error {
  override name = 'JsonParseError';
  position?: number;
  dataSample?: string;

  constructor(originalError: unknown, dataStr?: string) {
    // Extract position from SyntaxError message (e.g., "...at position 80999")
    const positionMatch =
      originalError instanceof Error
        ? originalError.message.match(/position\s+(\d+)/i)
        : null;
    const position = positionMatch ? parseInt(positionMatch[1], 10) : undefined;

    // Create human-readable message
    const positionInfo = position !== undefined ? ` at position ${position}` : '';
    const message = `Failed to parse JSON data${positionInfo}. The sync data may be corrupted or incomplete.`;

    super(message);
    this.position = position;

    // Extract a sample of the data around the error position for debugging
    if (dataStr && position !== undefined) {
      const start = Math.max(0, position - 50);
      const end = Math.min(dataStr.length, position + 50);
      this.dataSample = `...${dataStr.substring(start, end)}...`;
    }

    OP_LOG_SYNC_LOGGER.err('JsonParseError', toSyncLogError(originalError), {
      position: this.position,
      dataLength: dataStr?.length,
      hasDataSample: this.dataSample !== undefined,
    });
  }
}

// --------------MODEL AND DB ERRORS--------------
export class ClientIdNotFoundError extends Error {
  override name = 'ClientIdNotFoundError';
}

export class DBNotInitializedError extends Error {
  override name = 'DBNotInitializedError';
}

export class InvalidMetaError extends AdditionalLogErrorBase {
  override name = 'InvalidMetaError';
}

export class MetaNotReadyError extends AdditionalLogErrorBase {
  override name = 'MetaNotReadyError';
}

export class InvalidRevMapError extends AdditionalLogErrorBase {
  override name = 'InvalidRevMapError';
}

export class ModelIdWithoutCtrlError extends AdditionalLogErrorBase {
  override name = 'ModelIdWithoutCtrlError';
}

export class ModelMigrationError extends AdditionalLogErrorBase {
  override name = 'ModelMigrationError';
}

export class CanNotMigrateMajorDownError extends AdditionalLogErrorBase {
  override name = 'CanNotMigrateMajorDownError';
}

export class ModelRepairError extends AdditionalLogErrorBase {
  override name = 'ModelRepairError';
}

export class InvalidModelCfgError extends AdditionalLogErrorBase {
  override name = 'InvalidModelCfgError';
}

export class InvalidSyncProviderError extends Error {
  override name = 'InvalidSyncProviderError';
}

export class ModelValidationError extends Error {
  override name = 'ModelValidationError';
  additionalLog?: string;

  constructor(params: {
    id: string;
    data: unknown;
    validationResult?: IValidation<unknown>;
    e?: unknown;
  }) {
    super('ModelValidationError');
    OP_LOG_SYNC_LOGGER.log('ModelValidationError', {
      id: params.id,
      hasValidationResult: params.validationResult !== undefined,
      validationErrorCount: getValidationErrors(params.validationResult)?.length,
      validationPathSummary: getValidationErrorPathSummary(params.validationResult),
      hasAdditionalError: params.e !== undefined,
      additionalErrorName:
        params.e !== undefined ? toSyncLogError(params.e).name : undefined,
    });

    if (params.validationResult) {
      try {
        const errors = getValidationErrors(params.validationResult);
        if (errors) {
          const str = JSON.stringify(errors);
          this.additionalLog = `Model: ${params.id}, Errors: ${str.substring(0, 400)}`;
        }
      } catch (e) {
        OP_LOG_SYNC_LOGGER.err(
          'Error stringifying validation errors',
          toSyncLogError(e),
          { id: params.id },
        );
      }
    }
  }
}

export class DataValidationFailedError extends Error {
  override name = 'DataValidationFailedError';
  additionalLog?: string;

  constructor(validationResult: IValidation<unknown>) {
    const errorSummary = DataValidationFailedError._buildErrorSummary(validationResult);
    super(errorSummary);
    OP_LOG_SYNC_LOGGER.log('DataValidationFailedError', {
      validationErrorCount: getValidationErrors(validationResult)?.length,
      validationPathSummary: getValidationErrorPathSummary(validationResult),
    });

    try {
      const errors = getValidationErrors(validationResult);
      if (errors) {
        const str = JSON.stringify(errors);
        this.additionalLog = str.substring(0, 400);
      }
    } catch (e) {
      OP_LOG_SYNC_LOGGER.err('Failed to stringify validation errors', toSyncLogError(e));
    }
  }

  private static _buildErrorSummary(validationResult: IValidation<unknown>): string {
    try {
      const errors = getValidationErrors(validationResult);
      if (errors) {
        const paths = errors
          .slice(0, 3)
          .map((e) => e.path)
          .join(', ');
        const suffix = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';
        return `Validation failed at: ${paths}${suffix}`;
      }
    } catch {
      // Fall through to default message
    }
    return 'Data validation failed';
  }
}

export class ModelVersionToImportNewerThanLocalError extends AdditionalLogErrorBase {
  override name = 'ModelVersionToImportNewerThanLoca';
}

// --------------OTHER--------------

export class InvalidFilePrefixError extends AdditionalLogErrorBase {
  override name = 'InvalidFilePrefixError';

  constructor(details: SyncFilePrefixInvalidPrefixDetails) {
    super({
      message: `Invalid sync file prefix. Expected prefix "${details.expectedPrefix}".`,
      expectedPrefix: details.expectedPrefix,
      endSeparator: details.endSeparator,
      inputLength: details.inputLength,
    });
  }
}

export class DataRepairNotPossibleError extends AdditionalLogErrorBase {
  override name = 'DataRepairNotPossibleError';
}

export class NoRepairFunctionProvidedError extends Error {
  override name = 'NoRepairFunctionProvidedError';
}

export class NoValidateFunctionProvidedError extends Error {
  override name = 'NoValidateFunctionProvidedError';
}

export class BackupImportFailedError extends AdditionalLogErrorBase {
  override name = 'BackupImportFailedError';
}

export class WebCryptoNotAvailableError extends Error {
  override name = 'WebCryptoNotAvailableError';
}

/**
 * Thrown when IndexedDB storage quota is exceeded during operation log write.
 * Callers should handle by running compaction or prompting user to clear data.
 */
export class StorageQuotaExceededError extends Error {
  override name = 'StorageQuotaExceededError';

  constructor() {
    super('Operation log storage quota exceeded');
  }
}

/**
 * Thrown when sync data is incompatible with the expected format version.
 * This can occur when the remote file was written by a different (older or newer)
 * version of the app. Force-uploading is unsafe in this case because the remote
 * may be in a newer format.
 */
export class SyncDataCorruptedError extends Error {
  override name = 'SyncDataCorruptedError';

  constructor(
    message: string,
    public readonly filePath: string,
  ) {
    super(`Sync data incompatible at ${filePath}: ${message}`);
  }
}

/**
 * Thrown when the remote sync provider has legacy pfapi files (__meta_) but no
 * sync-data.json. This means a v16.x client is still writing to the same provider
 * using the old per-file format. Cross-version sync is not supported — both devices
 * must run the same app version for sync to work.
 */
export class LegacySyncFormatDetectedError extends Error {
  override name = 'LegacySyncFormatDetectedError';

  constructor() {
    super(
      'Sync format mismatch: the remote storage was last written by an older app version ' +
        '(v16.x or earlier) that uses a different sync format. Please update all your ' +
        'devices to the same app version so they use the same sync format.',
    );
  }
}
