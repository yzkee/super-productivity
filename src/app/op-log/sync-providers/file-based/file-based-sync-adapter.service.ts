import { inject, Injectable } from '@angular/core';
import { SyncProviderId } from '../provider.const';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  SyncOperation,
  OpUploadResponse,
  OpDownloadResponse,
  ServerSyncOperation,
  SnapshotUploadResponse,
} from '../provider.interface';
import { EncryptAndCompressHandlerService } from '../../encryption/encrypt-and-compress-handler.service';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { CompactOperation } from '../../../core/persistence/operation-log/compact/compact-operation.types';
import {
  encodeOperation,
  decodeOperation,
} from '../../../core/persistence/operation-log/compact/operation-codec.service';
import {
  Operation,
  VectorClock,
  ActionType,
  OpType,
  EntityType,
} from '../../core/operation.types';
import {
  FileBasedSyncData,
  FILE_BASED_SYNC_CONSTANTS,
  SyncDataCorruptedError,
} from './file-based-sync.types';
import { OpLog } from '../../../core/log';
import {
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import { mergeVectorClocks } from '../../../core/util/vector-clock';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';

/**
 * Adapter that enables file-based sync providers (WebDAV, Dropbox, LocalFile)
 * to support operation-log sync.
 *
 * ## Architecture
 * This adapter wraps a file-based provider and implements `OperationSyncCapable`,
 * allowing the unified sync system to work with file storage instead of APIs.
 *
 * ## Single File Approach
 * All sync data is stored in `sync-data.json`:
 * - Full state snapshot (for bootstrapping and recovery)
 * - Recent operations (for conflict detection and merging)
 * - Vector clock (for causality tracking)
 * - syncVersion counter (for optimistic locking)
 *
 * ## Conflict Resolution
 * Unlike PFAPI's model-level conflicts, this approach enables entity-level
 * conflict resolution using the operations in `recentOps`. When two clients
 * modify different entities, both changes are preserved.
 *
 * ## Content-Based Optimistic Locking
 * Instead of relying on server ETags (which vary by WebDAV implementation),
 * we use a `syncVersion` counter inside the file itself. On upload:
 * 1. Download current file to get syncVersion
 * 2. If syncVersion !== expected, conflict detected → merge and retry
 * 3. If match, increment syncVersion and upload
 *
 * @see FileBasedSyncData for the file schema
 */
@Injectable({ providedIn: 'root' })
export class FileBasedSyncAdapterService {
  private _encryptAndCompressHandler = new EncryptAndCompressHandlerService();
  private _archiveDbAdapter = inject(ArchiveDbAdapter);
  private _stateSnapshotService = inject(StateSnapshotService);

  /** Expected sync version for optimistic locking, keyed by provider+user */
  private _expectedSyncVersions = new Map<string, number>();

  /** Local sequence counters (simulates server seq for file-based) */
  private _localSeqCounters = new Map<string, number>();

  /** Set of processed operation IDs per provider - prevents missing ops when array is trimmed */
  private _processedOpIds = new Map<string, Set<string>>();

  /** Cache for downloaded sync data within a sync cycle (avoids redundant downloads) */
  private _syncCycleCache = new Map<
    string,
    {
      data: FileBasedSyncData;
      rev: string;
      timestamp: number;
    }
  >();

  /** Cache TTL - 30 seconds (sync cycle should complete within this) */
  private readonly _CACHE_TTL_MS = 30_000;

  /** Tracks whether we've loaded persisted state from localStorage */
  private _persistedStateLoaded = false;

  /**
   * Loads persisted sync state from localStorage if not already loaded.
   * This is called automatically before any sync operation.
   */
  private _loadPersistedState(): void {
    if (this._persistedStateLoaded) {
      return;
    }

    try {
      // Load expected sync versions
      const syncVersionsJson = localStorage.getItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
      );
      if (syncVersionsJson) {
        const parsed = JSON.parse(syncVersionsJson);
        this._expectedSyncVersions = new Map(Object.entries(parsed));
      }

      // Load local seq counters
      const seqCountersJson = localStorage.getItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
      );
      if (seqCountersJson) {
        const parsed = JSON.parse(seqCountersJson);
        this._localSeqCounters = new Map(Object.entries(parsed));
      }

      // Load processed op IDs
      const processedOpsJson = localStorage.getItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
      );
      if (processedOpsJson) {
        const parsed = JSON.parse(processedOpsJson);
        for (const [key, ids] of Object.entries(parsed)) {
          this._processedOpIds.set(key, new Set(ids as string[]));
        }
      }

      this._persistedStateLoaded = true;
    } catch (e) {
      OpLog.warn('FileBasedSyncAdapter: Failed to load persisted sync state', e);
      this._persistedStateLoaded = true; // Prevent infinite retry
    }
  }

  /**
   * Persists sync state to localStorage for recovery after app restart.
   */
  private _persistState(): void {
    try {
      // Persist expected sync versions
      const syncVersionsObj = Object.fromEntries(this._expectedSyncVersions);
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
        JSON.stringify(syncVersionsObj),
      );

      // Persist local seq counters
      const seqCountersObj = Object.fromEntries(this._localSeqCounters);
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
        JSON.stringify(seqCountersObj),
      );

      // Persist processed op IDs (convert Sets to arrays)
      const processedOpsObj: Record<string, string[]> = {};
      for (const [key, ids] of this._processedOpIds) {
        // Limit to MAX_RECENT_OPS to prevent unbounded growth
        const idsArray = Array.from(ids);
        processedOpsObj[key] = idsArray.slice(-FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);
      }
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
        JSON.stringify(processedOpsObj),
      );
    } catch (e) {
      OpLog.warn('FileBasedSyncAdapter: Failed to persist sync state', e);
    }
  }

  /**
   * Marks an operation as processed for a provider.
   */
  private _markOpProcessed(providerKey: string, opId: string): void {
    let processedSet = this._processedOpIds.get(providerKey);
    if (!processedSet) {
      processedSet = new Set();
      this._processedOpIds.set(providerKey, processedSet);
    }
    processedSet.add(opId);

    // Trim to prevent unbounded growth (keep most recent MAX_RECENT_OPS)
    if (processedSet.size > FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS * 2) {
      const idsArray = Array.from(processedSet);
      const trimmedIds = idsArray.slice(-FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS);
      this._processedOpIds.set(providerKey, new Set(trimmedIds));
    }
  }

  /**
   * Checks if an operation has been processed for a provider.
   */
  private _isOpProcessed(providerKey: string, opId: string): boolean {
    return this._processedOpIds.get(providerKey)?.has(opId) ?? false;
  }

  /**
   * Gets cached sync data if available and not expired.
   */
  private _getCachedSyncData(
    providerKey: string,
  ): { data: FileBasedSyncData; rev: string } | null {
    const cached = this._syncCycleCache.get(providerKey);
    if (!cached) return null;

    // Check TTL
    if (Date.now() - cached.timestamp > this._CACHE_TTL_MS) {
      this._syncCycleCache.delete(providerKey);
      return null;
    }

    return { data: cached.data, rev: cached.rev };
  }

  /**
   * Caches sync data with its revision for reuse within the sync cycle.
   */
  private _setCachedSyncData(
    providerKey: string,
    data: FileBasedSyncData,
    rev: string,
  ): void {
    this._syncCycleCache.set(providerKey, {
      data,
      rev,
      timestamp: Date.now(),
    });
  }

  /**
   * Clears cached sync data (e.g., after successful upload).
   */
  private _clearCachedSyncData(providerKey: string): void {
    this._syncCycleCache.delete(providerKey);
  }

  /**
   * Creates an OperationSyncCapable adapter for a file-based provider.
   *
   * @param provider - The underlying file provider (WebDAV, Dropbox, etc.)
   * @param encryptAndCompressCfg - Encryption/compression settings
   * @param encryptKey - Optional encryption key
   * @returns Object implementing OperationSyncCapable interface
   */
  createAdapter(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    encryptAndCompressCfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): OperationSyncCapable {
    // Load persisted state before creating adapter
    this._loadPersistedState();

    const providerKey = this._getProviderKey(provider);

    return {
      supportsOperationSync: true,

      uploadOps: async (
        ops: SyncOperation[],
        clientId: string,
        lastKnownServerSeq?: number,
      ): Promise<OpUploadResponse> => {
        return this._uploadOps(
          provider,
          encryptAndCompressCfg,
          encryptKey,
          ops,
          clientId,
          lastKnownServerSeq,
        );
      },

      downloadOps: async (
        sinceSeq: number,
        excludeClient?: string,
        limit?: number,
      ): Promise<OpDownloadResponse> => {
        return this._downloadOps(
          provider,
          encryptAndCompressCfg,
          encryptKey,
          sinceSeq,
          excludeClient,
          limit,
        );
      },

      getLastServerSeq: async (): Promise<number> => {
        this._loadPersistedState();
        return this._localSeqCounters.get(providerKey) || 0;
      },

      setLastServerSeq: async (seq: number): Promise<void> => {
        this._localSeqCounters.set(providerKey, seq);
        this._persistState();
      },

      uploadSnapshot: async (
        state: unknown,
        clientId: string,
        reason: 'initial' | 'recovery' | 'migration',
        vectorClock: Record<string, number>,
        schemaVersion: number,
        isPayloadEncrypted?: boolean,
      ): Promise<SnapshotUploadResponse> => {
        return this._uploadSnapshot(
          provider,
          encryptAndCompressCfg,
          encryptKey,
          state,
          clientId,
          reason,
          vectorClock,
          schemaVersion,
        );
      },

      deleteAllData: async (): Promise<{ success: boolean }> => {
        return this._deleteAllData(provider);
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UPLOAD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _uploadOps(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    ops: SyncOperation[],
    clientId: string,
    lastKnownServerSeq?: number,
  ): Promise<OpUploadResponse> {
    const providerKey = this._getProviderKey(provider);

    // Step 1: Get current sync data (from cache or download)
    // The cache is populated by _downloadOps() to avoid redundant downloads
    let currentData: FileBasedSyncData | null = null;
    let currentSyncVersion = 0;
    let fileExists = true;
    let revToMatch: string | null = null;

    // Try to use cached data from _downloadOps() first
    const cached = this._getCachedSyncData(providerKey);
    if (cached) {
      currentData = cached.data;
      currentSyncVersion = cached.data.syncVersion;
      revToMatch = cached.rev;
      OpLog.normal('FileBasedSyncAdapter: Using cached sync data (saved 1 download)');
    } else {
      // Fallback: download if no cache
      try {
        const result = await this._downloadSyncFile(provider, cfg, encryptKey);
        currentData = result.data;
        currentSyncVersion = result.data.syncVersion;
        revToMatch = result.rev;
      } catch (e) {
        if (!(e instanceof RemoteFileNotFoundAPIError)) {
          throw e;
        }
        // No file exists yet - this is first sync
        fileExists = false;
        OpLog.normal('FileBasedSyncAdapter: No existing sync file, creating new');
      }
    }

    // If no ops to upload AND file already exists, just return current state
    // But if no file exists, we need to create one even with 0 ops
    if (ops.length === 0 && fileExists) {
      OpLog.normal('FileBasedSyncAdapter: No ops to upload, file already exists');
      const currentSeq = this._localSeqCounters.get(providerKey) || 0;
      return {
        results: [],
        latestSeq: currentSeq,
      };
    }

    OpLog.normal(
      `FileBasedSyncAdapter: Uploading ${ops.length} ops for client ${clientId}${!fileExists ? ' (creating initial sync file)' : ''}`,
    );

    // Step 2: Handle version mismatch (another client synced since our last download)
    // Instead of throwing an error, we proceed with the merge - our ops will be combined
    // with the remote ops, and any new remote ops will be returned as piggybacked.
    const expectedVersion = this._expectedSyncVersions.get(providerKey) || 0;
    if (currentData && currentSyncVersion !== expectedVersion) {
      OpLog.normal(
        `FileBasedSyncAdapter: Version changed (expected ${expectedVersion}, got ${currentSyncVersion}). ` +
          `Merging and piggybacking.`,
      );
      // Update expected version to reflect reality - this isn't a true conflict,
      // just a case where another client synced between our downloads.
    }

    // Step 3: Merge operations into sync data
    const compactOps = ops.map((op) => this._syncOpToCompact(op));
    const newSyncVersion = currentSyncVersion + 1;

    // Build merged vector clock
    let mergedClock: VectorClock = currentData?.vectorClock || {};
    for (const op of ops) {
      mergedClock = mergeVectorClocks(mergedClock, op.vectorClock);
    }

    // Merge recentOps - add new ops, trim to limit
    const existingOps = currentData?.recentOps || [];
    const mergedOps = [...existingOps, ...compactOps].slice(
      -FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS,
    );

    // Load archive data from IndexedDB to include in sync file
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    // Get current state from NgRx store - this keeps the snapshot up-to-date
    const currentState = await this._stateSnapshotService.getStateSnapshot();

    const newData: FileBasedSyncData = {
      version: FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      syncVersion: newSyncVersion,
      schemaVersion: ops[0]?.schemaVersion || currentData?.schemaVersion || 1,
      vectorClock: mergedClock,
      lastModified: Date.now(),
      clientId,
      state: currentState,
      archiveYoung,
      archiveOld,
      recentOps: mergedOps,
    };

    // Step 4: Upload new sync file with ETag-based conditional upload
    // Uses revToMatch to detect if another client uploaded between our download and upload
    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      newData,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );

    try {
      await provider.uploadFile(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        uploadData,
        revToMatch, // Conditional upload - will fail if rev changed
        false, // Don't force overwrite - let server detect conflict via ETag
      );
    } catch (e) {
      if (e instanceof UploadRevToMatchMismatchAPIError) {
        // Another client uploaded between our download and upload - retry once
        OpLog.normal(
          'FileBasedSyncAdapter: Rev mismatch detected, re-downloading and retrying...',
        );

        // Re-download fresh data
        const { data: freshData, rev: freshRev } = await this._downloadSyncFile(
          provider,
          cfg,
          encryptKey,
        );

        // Re-merge operations with fresh data
        const freshExistingOps = freshData.recentOps || [];
        const freshMergedOps = [...freshExistingOps, ...compactOps].slice(
          -FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS,
        );

        // Update merged clock with fresh data
        let freshMergedClock = freshData.vectorClock || {};
        for (const op of ops) {
          freshMergedClock = mergeVectorClocks(freshMergedClock, op.vectorClock);
        }

        const freshNewData: FileBasedSyncData = {
          ...newData,
          syncVersion: freshData.syncVersion + 1,
          vectorClock: freshMergedClock,
          recentOps: freshMergedOps,
          lastModified: Date.now(),
        };

        const freshUploadData =
          await this._encryptAndCompressHandler.compressAndEncryptData(
            cfg,
            encryptKey,
            freshNewData,
            FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
          );

        // Retry upload with fresh rev
        await provider.uploadFile(
          FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
          freshUploadData,
          freshRev,
          false,
        );

        // Update newSyncVersion for the return value
        newData.syncVersion = freshNewData.syncVersion;

        OpLog.normal('FileBasedSyncAdapter: Retry upload successful');
      } else {
        throw e;
      }
    }

    // Clear cache after successful upload (data is now stale)
    this._clearCachedSyncData(providerKey);

    // Step 5: Update expected sync version for next upload
    this._expectedSyncVersions.set(providerKey, newData.syncVersion);

    // Calculate latestSeq from actual merged ops count
    const latestSeq = mergedOps.length;

    // Step 7: Find piggybacked ops (ops from other clients we haven't processed yet)
    // This is critical for file-based sync: without piggybacking, the upload service
    // would call setLastServerSeq(latestSeq), advancing our counter before we've
    // actually processed ops from other clients.
    //
    // IMPORTANT: We use operation IDs instead of array indices to track processed ops.
    // Array indices shift when the recentOps array is trimmed, causing ops to be missed.
    // Operation IDs are stable identifiers that persist across array modifications.
    const newOps: ServerSyncOperation[] = [];
    existingOps.forEach((compactOp, index) => {
      // Use operation ID to check if we've already processed this op
      // Also exclude our own ops (we don't need to piggyback our own changes)
      if (!this._isOpProcessed(providerKey, compactOp.id) && compactOp.c !== clientId) {
        newOps.push({
          serverSeq: index + 1, // Synthetic seq for compatibility (not used for tracking)
          op: this._compactToSyncOp(compactOp),
          receivedAt: compactOp.t,
        });
      }
    });

    // Mark piggybacked ops as processed to prevent duplicates on retry.
    // This is critical: if the caller fails after receiving piggybacked ops but before
    // processing them, the next upload won't return the same ops again.
    for (const serverOp of newOps) {
      this._markOpProcessed(providerKey, serverOp.op.id);
    }

    // Mark our uploaded ops as processed (prevent processing them as piggybacked later)
    for (const op of ops) {
      this._markOpProcessed(providerKey, op.id);
    }

    OpLog.normal(
      `FileBasedSyncAdapter: Upload complete (syncVersion=${newData.syncVersion}, latestSeq=${latestSeq}, piggybacked=${newOps.length})`,
    );

    // Persist state after successful upload
    this._persistState();

    // Calculate serverSeq for each uploaded op based on their position in merged array
    // The uploaded ops are at the END of mergedOps
    const startingSeq = latestSeq - ops.length;

    return {
      results: ops.map((op, i) => ({
        opId: op.id,
        accepted: true,
        serverSeq: startingSeq + i + 1,
      })),
      latestSeq,
      newOps: newOps.length > 0 ? newOps : undefined,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DOWNLOAD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  private async _downloadOps(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
  ): Promise<OpDownloadResponse> {
    const providerKey = this._getProviderKey(provider);

    let syncData: FileBasedSyncData;
    let rev: string;
    try {
      const result = await this._downloadSyncFile(provider, cfg, encryptKey);
      syncData = result.data;
      rev = result.rev;
      // Cache data + rev for use in _uploadOps() (avoids redundant download)
      this._setCachedSyncData(providerKey, syncData, rev);
    } catch (e) {
      if (e instanceof RemoteFileNotFoundAPIError) {
        // No sync file yet - return empty
        return {
          ops: [],
          hasMore: false,
          latestSeq: 0,
        };
      }
      throw e;
    }

    // Update expected version for next upload
    this._expectedSyncVersions.set(providerKey, syncData.syncVersion);

    // Filter ops using operation IDs instead of synthetic seq numbers.
    // Synthetic seq numbers based on array indices shift when the array is trimmed,
    // causing ops to be missed. Operation IDs are stable identifiers.
    //
    // Note: sinceSeq === 0 indicates a fresh download request (e.g., forceFromSeq0),
    // in which case we should return ALL ops regardless of whether we've seen them.
    const isForceFromZero = sinceSeq === 0;
    const filteredOps: ServerSyncOperation[] = [];

    // NOTE: We no longer filter using _processedOpIds here.
    // The download service filters using appliedOpIds (from IndexedDB), which is
    // the source of truth for what's actually applied. _processedOpIds was getting
    // out of sync because ops could be "downloaded" but not applied (e.g., due to
    // interrupted sync, app crash, or filtering by appliedOpIds in the download service).
    //
    // By returning ALL ops from the file, we let the download service's appliedOpIds
    // filter decide what's truly new. This may download more data but ensures correctness.

    OpLog.verbose(
      `FileBasedSyncAdapter: Returning all ${syncData.recentOps.length} ops from file (filtering by appliedOpIds happens in download service)`,
    );

    syncData.recentOps.forEach((compactOp, index) => {
      // Filter by client if specified (excludeClient is for upload deduplication)
      if (excludeClient && compactOp.c === excludeClient) {
        return;
      }

      filteredOps.push({
        serverSeq: index + 1, // Synthetic seq for compatibility (not used for tracking)
        op: this._compactToSyncOp(compactOp),
        receivedAt: compactOp.t,
      });
    });

    // Apply limit
    const limitedOps = filteredOps.slice(0, limit);
    const hasMore = filteredOps.length > limit;

    // Calculate latestSeq for the response (total ops count for reference)
    const latestSeq = syncData.recentOps.length;

    OpLog.normal(
      `FileBasedSyncAdapter: Downloaded ${limitedOps.length} ops (new/total: ${filteredOps.length}/${latestSeq})`,
    );

    // Mark downloaded ops as processed (unless it's a force-from-zero request,
    // where the caller is expected to process and then call setLastServerSeq)
    if (!isForceFromZero) {
      for (const serverOp of limitedOps) {
        this._markOpProcessed(providerKey, serverOp.op.id);
      }
      this._persistState();
    }

    // Write archive to IndexedDB if present (for late-joiners who missed archive ops)
    // Only write on first download (sinceSeq === 0) to avoid overwriting local changes
    if (isForceFromZero) {
      if (syncData.archiveYoung) {
        await this._archiveDbAdapter.saveArchiveYoung(syncData.archiveYoung);
        OpLog.normal('FileBasedSyncAdapter: Wrote archiveYoung to IndexedDB');
      }
      if (syncData.archiveOld) {
        await this._archiveDbAdapter.saveArchiveOld(syncData.archiveOld);
        OpLog.normal('FileBasedSyncAdapter: Wrote archiveOld to IndexedDB');
      }
    }

    return {
      ops: limitedOps,
      hasMore,
      latestSeq,
      snapshotVectorClock: syncData.vectorClock,
      // Include full state snapshot for fresh downloads (sinceSeq === 0)
      // This allows new clients to bootstrap with complete state, not just recent ops
      ...(isForceFromZero && syncData.state ? { snapshotState: syncData.state } : {}),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SNAPSHOT UPLOAD
  // ═══════════════════════════════════════════════════════════════════════════

  private async _uploadSnapshot(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
    state: unknown,
    clientId: string,
    reason: 'initial' | 'recovery' | 'migration',
    vectorClock: Record<string, number>,
    schemaVersion: number,
  ): Promise<SnapshotUploadResponse> {
    const providerKey = this._getProviderKey(provider);

    OpLog.normal(`FileBasedSyncAdapter: Uploading snapshot (reason=${reason})`);

    // For snapshots, we start fresh with syncVersion = 1
    const newSyncVersion = 1;

    // Load archive data from IndexedDB to include in snapshot
    const archiveYoung = await this._archiveDbAdapter.loadArchiveYoung();
    const archiveOld = await this._archiveDbAdapter.loadArchiveOld();

    const syncData: FileBasedSyncData = {
      version: FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
      syncVersion: newSyncVersion,
      schemaVersion,
      vectorClock,
      lastModified: Date.now(),
      clientId,
      state,
      archiveYoung,
      archiveOld,
      recentOps: [], // Fresh start - no recent ops
    };

    // Upload snapshot (no backup - snapshots replace state completely)
    const uploadData = await this._encryptAndCompressHandler.compressAndEncryptData(
      cfg,
      encryptKey,
      syncData,
      FILE_BASED_SYNC_CONSTANTS.FILE_VERSION,
    );
    await provider.uploadFile(
      FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      uploadData,
      null,
      true,
    );

    // Reset local state
    this._expectedSyncVersions.set(providerKey, newSyncVersion);
    this._localSeqCounters.set(providerKey, 0);

    OpLog.normal('FileBasedSyncAdapter: Snapshot upload complete');

    return {
      accepted: true,
      serverSeq: 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETE ALL DATA
  // ═══════════════════════════════════════════════════════════════════════════

  private async _deleteAllData(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): Promise<{ success: boolean }> {
    const providerKey = this._getProviderKey(provider);

    OpLog.normal('FileBasedSyncAdapter: Deleting all sync data');

    try {
      // Delete main sync file
      try {
        await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
      } catch {
        // File might not exist
      }

      // Delete backup file
      try {
        await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE);
      } catch {
        // File might not exist
      }

      // Delete migration lock if exists
      try {
        await provider.removeFile(FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE);
      } catch {
        // File might not exist
      }

      // Reset local state
      this._expectedSyncVersions.delete(providerKey);
      this._localSeqCounters.delete(providerKey);

      return { success: true };
    } catch (e) {
      OpLog.err('FileBasedSyncAdapter: Failed to delete all data', e);
      return { success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Downloads and decrypts the sync file.
   * @returns The sync data and its revision (ETag) for conditional upload
   */
  private async _downloadSyncFile(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<{ data: FileBasedSyncData; rev: string }> {
    const response = await provider.downloadFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
    const data =
      await this._encryptAndCompressHandler.decompressAndDecryptData<FileBasedSyncData>(
        cfg,
        encryptKey,
        response.dataStr,
      );

    // Validate file version
    if (data.version !== FILE_BASED_SYNC_CONSTANTS.FILE_VERSION) {
      throw new SyncDataCorruptedError(
        `Unsupported file version: ${data.version} (expected ${FILE_BASED_SYNC_CONSTANTS.FILE_VERSION})`,
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      );
    }

    return { data, rev: response.rev };
  }

  /**
   * Gets a unique key for a provider (for storing per-provider state).
   */
  private _getProviderKey(
    provider: SyncProviderServiceInterface<SyncProviderId>,
  ): string {
    return `${provider.id}`;
  }

  /**
   * Converts a SyncOperation to CompactOperation format.
   */
  private _syncOpToCompact(op: SyncOperation): CompactOperation {
    // Create a full Operation from SyncOperation, then encode.
    // Type assertions are needed because SyncOperation uses string types for
    // actionType/opType/entityType (for JSON serialization compatibility),
    // while Operation uses the specific enum/union types.
    const fullOp: Operation = {
      id: op.id,
      actionType: op.actionType as ActionType,
      opType: op.opType as OpType,
      entityType: op.entityType as EntityType,
      entityId: op.entityId,
      entityIds: op.entityIds,
      payload: op.payload,
      clientId: op.clientId,
      vectorClock: op.vectorClock,
      timestamp: op.timestamp,
      schemaVersion: op.schemaVersion,
    };
    return encodeOperation(fullOp);
  }

  /**
   * Converts a CompactOperation to SyncOperation format.
   */
  private _compactToSyncOp(compact: CompactOperation): SyncOperation {
    const fullOp = decodeOperation(compact);
    return {
      id: fullOp.id,
      clientId: fullOp.clientId,
      actionType: fullOp.actionType,
      opType: fullOp.opType,
      entityType: fullOp.entityType,
      entityId: fullOp.entityId,
      entityIds: fullOp.entityIds,
      payload: fullOp.payload,
      vectorClock: fullOp.vectorClock,
      timestamp: fullOp.timestamp,
      schemaVersion: fullOp.schemaVersion,
    };
  }

  /**
   * Gets the current sync data for merging (used by external conflict resolution).
   */
  async getCurrentSyncData(
    provider: SyncProviderServiceInterface<SyncProviderId>,
    cfg: EncryptAndCompressCfg,
    encryptKey: string | undefined,
  ): Promise<FileBasedSyncData | null> {
    try {
      const { data } = await this._downloadSyncFile(provider, cfg, encryptKey);
      return data;
    } catch (e) {
      if (e instanceof RemoteFileNotFoundAPIError) {
        return null;
      }
      throw e;
    }
  }

  /**
   * Checks if a sync version conflict would occur with the given expected version.
   */
  wouldConflict(providerKey: string, currentSyncVersion: number): boolean {
    const expected = this._expectedSyncVersions.get(providerKey) || 0;
    return currentSyncVersion !== expected;
  }
}
