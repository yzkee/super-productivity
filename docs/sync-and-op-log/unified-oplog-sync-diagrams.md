# Unified Op-Log Sync Architecture Diagrams

**Status:** Implemented (Phase 4 Testing Complete)
**Related:** [Implementation Plan](../ai/file-based-oplog-sync-implementation-plan.md)

This document contains Mermaid diagrams explaining the unified operation-log sync architecture for file-based providers (WebDAV, Dropbox, LocalFile).

## Table of Contents

1. [Remote Storage Structure](#1-remote-storage-structure) - What gets stored on providers
2. [Architecture Overview](#2-architecture-overview) - System components and flow
3. [TypeScript Types](#3-typescript-types) - Data structure definitions
4. [Sync Flow](#4-sync-flow-content-based-optimistic-locking) - Upload/download sequence
5. [Conflict Resolution](#5-conflict-resolution-two-clients-syncing-simultaneously) - How conflicts are handled
6. [Migration Flow](#6-migration-flow-pfapi-to-op-log) - PFAPI to op-log migration
7. [Archive Data Flow](#7-archive-data-flow-via-op-log) - How archive operations sync
8. [FlushYoungToOld](#8-flushyoungtoold-operation) - Archive compaction
9. [Complete System Flow](#9-complete-system-flow) - End-to-end overview

---

## 1. Remote Storage Structure

Shows what data is stored on file-based sync providers (WebDAV, Dropbox, LocalFile).

```mermaid
flowchart TB
    subgraph Remote["Remote Storage (WebDAV/Dropbox/LocalFile)"]
        subgraph Folder["/superProductivity/"]
            SyncFile["sync-data.json<br/>━━━━━━━━━━━━━━━━━━━<br/>Encrypted + Compressed"]
            BackupFile["sync-data.json.bak<br/>━━━━━━━━━━━━━━━━━━━<br/>Previous version"]
        end
    end

    subgraph Contents["sync-data.json Contents"]
        direction TB
        Meta["📋 Metadata<br/>• version: 2<br/>• syncVersion: N (locking)<br/>• schemaVersion<br/>• lastModified<br/>• checksum"]

        VClock["🕐 Vector Clock<br/>• {clientA: 42, clientB: 17}<br/>• Tracks causality"]

        State["📦 State Snapshot<br/>━━━━━━━━━━━━━━━━━━━<br/>• tasks: TaskState<br/>• projects: ProjectState<br/>• tags: TagState<br/>• notes: NoteState<br/>• globalConfig<br/>• issueProviders<br/>• planner<br/>• simpleCounters<br/>• taskRepeatCfg"]

        Archive["📁 Archive Data<br/>━━━━━━━━━━━━━━━━━━━<br/>• archiveYoung: ArchiveModel<br/>• archiveOld: ArchiveModel<br/>━━━━━━━━━━━━━━━━━━━<br/>Ensures late-joiners get<br/>full archive history"]

        Ops["📝 Recent Operations (last 200)<br/>━━━━━━━━━━━━━━━━━━━<br/>• id, clientId, actionType<br/>• opType, entityType, entityId<br/>• payload, vectorClock<br/>• timestamp<br/>━━━━━━━━━━━━━━━━━━━<br/>Used for conflict detection"]
    end

    SyncFile --> Contents
    SyncFile -.->|"Replaced on<br/>successful upload"| BackupFile

    style SyncFile fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style State fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style Archive fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    style Ops fill:#e1f5fe,stroke:#01579b,stroke-width:2px
```

**Why single file instead of separate snapshot + ops files?**

| Single File (chosen)           | Two Files (considered)         |
| ------------------------------ | ------------------------------ |
| ✅ Atomic: all or nothing      | ❌ Partial upload risk         |
| ✅ One version to track        | ❌ Version coordination        |
| ✅ Simple conflict resolution  | ❌ Two places to handle        |
| ✅ Easy recovery               | ❌ Inconsistent state possible |
| ❌ Upload full state each time | ✅ Often just ops              |

The bandwidth cost is acceptable: state compresses well (~90%), and sync is infrequent.

---

## 2. Architecture Overview

Shows how `FileBasedSyncAdapter` integrates into the existing op-log system, implementing `OperationSyncCapable` using file operations.

```mermaid
flowchart TB
    subgraph Client["Client Application"]
        NgRx["NgRx Store<br/>(Runtime State)"]
        OpLogEffects["OperationLogEffects"]
        OpLogStore["SUP_OPS IndexedDB<br/>(ops + state_cache)"]

        subgraph SyncServices["Sync Services"]
            SyncService["OperationLogSyncService"]
            ConflictRes["ConflictResolutionService"]
            VectorClock["VectorClockService"]
        end

        subgraph ProviderLayer["Provider Abstraction"]
            FileAdapter["FileBasedSyncAdapter<br/>(implements OperationSyncCapable)"]
            SuperSync["SuperSyncProvider<br/>(existing API-based)"]

            subgraph FileProviders["File Providers"]
                WebDAV["WebDAV"]
                Dropbox["Dropbox"]
                LocalFile["LocalFile"]
            end
        end
    end

    subgraph RemoteStorage["Remote Storage"]
        SyncFile["sync-data.json<br/>━━━━━━━━━━━━━━━<br/>• syncVersion<br/>• state snapshot<br/>• recentOps (200)<br/>• vectorClock"]
        Backup["sync-data.json.bak"]
    end

    NgRx --> OpLogEffects
    OpLogEffects --> OpLogStore
    OpLogStore --> SyncService
    SyncService --> ConflictRes
    SyncService --> VectorClock

    SyncService --> FileAdapter
    SyncService --> SuperSync

    FileAdapter --> WebDAV
    FileAdapter --> Dropbox
    FileAdapter --> LocalFile

    WebDAV --> SyncFile
    Dropbox --> SyncFile
    LocalFile --> SyncFile
    SyncFile -.-> Backup

    style FileAdapter fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    style SyncFile fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style OpLogStore fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

---

## 3. TypeScript Types

The TypeScript interfaces for the sync data structures.

```mermaid
classDiagram
    class FileBasedSyncData {
        +number version = 2
        +number syncVersion
        +number schemaVersion
        +VectorClock vectorClock
        +number lastSeq
        +number lastModified
        +AppDataComplete state
        +ArchiveModel archiveYoung
        +ArchiveModel archiveOld
        +CompactOperation[] recentOps
        +string checksum
    }

    class AppDataComplete {
        +TaskState task
        +ProjectState project
        +TagState tag
        +GlobalConfigState globalConfig
        +NoteState note
        +IssueProviderState issueProvider
        +PlannerState planner
        +SimpleCounterState simpleCounter
        +TaskRepeatCfgState taskRepeatCfg
    }

    class ArchiveModel {
        +TaskArchive task
        +TimeTrackingState timeTracking
        +number lastTimeTrackingFlush
    }

    class CompactOperation {
        +string id
        +string clientId
        +string actionType
        +OpType opType
        +EntityType entityType
        +string entityId
        +unknown payload
        +VectorClock vectorClock
        +number timestamp
    }

    class VectorClock {
        +Record~string, number~ clocks
    }

    FileBasedSyncData --> AppDataComplete : state
    FileBasedSyncData --> ArchiveModel : archiveYoung?
    FileBasedSyncData --> ArchiveModel : archiveOld?
    FileBasedSyncData --> CompactOperation : recentOps[0..200]
    FileBasedSyncData --> VectorClock : vectorClock
    CompactOperation --> VectorClock : vectorClock
```

**Key files:**

- Types: `src/app/op-log/sync/providers/file-based/file-based-sync.types.ts`
- Adapter: `src/app/op-log/sync/providers/file-based/file-based-sync-adapter.service.ts`

---

## 4. Sync Flow (Content-Based Optimistic Locking with Piggybacking)

```mermaid
sequenceDiagram
    participant Client as Client App
    participant Adapter as FileBasedSyncAdapter
    participant Provider as File Provider
    participant Remote as sync-data.json

    Note over Client,Remote: ═══ DOWNLOAD FLOW ═══

    Client->>Adapter: downloadOps(sinceSeq, clientId)
    Adapter->>Provider: downloadFile("sync-data.json")
    Provider->>Remote: GET
    Remote-->>Provider: {data, rev}
    Provider-->>Adapter: SyncData (syncVersion=N)

    Adapter->>Adapter: Update _expectedSyncVersion = N
    Adapter->>Adapter: Filter ops by sinceSeq
    Adapter-->>Client: OpDownloadResponse

    Client->>Client: Apply remote ops to NgRx
    Client->>Client: setLastServerSeq(latestSeq)

    Note over Client,Remote: ═══ UPLOAD FLOW (with Piggybacking) ═══

    Client->>Adapter: uploadOps(ops, clientId, lastKnownSeq)
    Adapter->>Provider: downloadFile("sync-data.json")
    Provider->>Remote: GET
    Remote-->>Provider: {data, rev}
    Provider-->>Adapter: Current syncVersion=M

    alt syncVersion matches expected (M=N)
        Note over Adapter: No other client synced
    else syncVersion changed (M>N)
        Note over Adapter: Another client synced!<br/>Will piggyback their ops
    end

    Adapter->>Adapter: Merge local ops into recentOps
    Adapter->>Adapter: Update vectorClock
    Adapter->>Adapter: Trim recentOps to 200
    Adapter->>Adapter: Set syncVersion = M+1
    Adapter->>Adapter: Find piggybacked ops<br/>(ops from other clients we haven't seen)

    Adapter->>Provider: uploadFile("sync-data.json.bak", currentData)
    Adapter->>Provider: uploadFile("sync-data.json", newData)
    Provider->>Remote: PUT
    Remote-->>Provider: Success

    Adapter-->>Client: Success + piggybacked ops (newOps)

    alt Has piggybacked ops
        Client->>Client: Process piggybacked ops
        Client->>Client: setLastServerSeq(latestSeq)
    end
```

**Key Insight: Piggybacking**

Instead of throwing an error on version mismatch, the adapter:

1. Merges local ops with whatever is in the file
2. Returns ops from other clients as `newOps` (piggybacked)
3. The upload service processes these before updating `lastServerSeq`

This ensures no ops are missed, even when clients sync concurrently.

---

## 5. Conflict Resolution (Two Clients Syncing Simultaneously)

```mermaid
sequenceDiagram
    participant A as Client A
    participant B as Client B
    participant File as sync-data.json<br/>(syncVersion: 5)

    Note over A,File: Initial: syncVersion=5, both clients synced

    rect rgb(232, 245, 233)
        Note over A,B: Both make offline changes
        A->>A: Create Task X
        A->>A: expectedSyncVersion = 5
        B->>B: Update Task Y
        B->>B: expectedSyncVersion = 5
    end

    Note over A,File: Race condition begins

    A->>File: Upload starts (downloads file, sees v=5)
    B->>File: Upload starts (downloads file, sees v=5)

    A->>A: Merge ops [TaskX], set syncVersion=6
    A->>File: Upload sync-data.json (v=6)
    Note over A,File: A wins the race ✓
    File-->>A: Success
    A->>A: expectedSyncVersion = 6

    B->>B: Merge ops [TaskY]
    Note over B: Downloads file again for upload...
    B->>File: Download (sees syncVersion=6!)
    Note over B,File: Version changed!<br/>Expected 5, found 6

    rect rgb(225, 245, 254)
        Note over B: Piggybacking (not retry!)
        B->>B: Find piggybacked ops from file<br/>(A's TaskX op, seq > lastProcessedSeq)
        B->>B: Merge [TaskX, TaskY] into recentOps
        B->>B: Set syncVersion = 7
        B->>File: Upload sync-data.json (v=7)
        File-->>B: Success ✓

        B->>B: Return piggybacked=[TaskX]
        B->>B: Process TaskX op → apply to NgRx
        B->>B: setLastServerSeq(latestSeq)
    end

    Note over A,File: A syncs B's TaskY on next sync
    A->>File: Download (sinceSeq=6)
    File-->>A: ops=[TaskY]
    A->>A: Apply TaskY → both clients have both tasks
```

**How Piggybacking Resolves Conflicts:**

| Step                         | What Happens                                                |
| ---------------------------- | ----------------------------------------------------------- |
| 1. Version mismatch detected | B expected v=5, found v=6                                   |
| 2. No retry needed           | B proceeds with merge anyway                                |
| 3. Find piggybacked ops      | Ops in file with seq > lastProcessedSeq, from other clients |
| 4. Merge and upload          | B's ops + file's ops → new file                             |
| 5. Return piggybacked        | Upload response includes A's ops                            |
| 6. Process piggybacked       | Upload service applies them before advancing lastServerSeq  |

**LWW (Last-Write-Wins) for Same Entity:**

If both A and B modified the same task, the piggybacked ops flow through `ConflictResolutionService` which uses vector clocks and timestamps to determine the winner.

---

## 6. Migration Flow (PFAPI to Op-Log)

```mermaid
flowchart TB
    Start["App starts with<br/>new version"]

    CheckRemote{"Check remote<br/>storage"}

    subgraph Detection["Detection Phase"]
        HasPfapi{"Has PFAPI files?<br/>(meta.json, task.json, etc.)"}
        HasOpLog{"Has sync-data.json?"}
        IsEmpty{"Remote empty?"}
    end

    subgraph MigrationPath["Migration Path"]
        AcquireLock["Write migration.lock<br/>(clientId:timestamp)"]
        CheckLock{"Lock exists<br/>from other client?"}
        StaleLock{"Lock > 5 min old?"}
        WaitRetry["Wait & retry"]

        DownloadPfapi["Download all PFAPI<br/>model files"]
        AssembleState["Assemble into<br/>AppDataComplete"]
        CreateImport["Create SYNC_IMPORT<br/>operation"]
        BuildSync["Build sync-data.json"]
        UploadSync["Upload sync-data.json"]
        BackupPfapi["Rename PFAPI files<br/>to .migrated"]
        ReleaseLock["Delete migration.lock"]
    end

    subgraph FreshPath["Fresh Start Path"]
        LocalState["Get local NgRx state"]
        CreateInitial["Build initial<br/>sync-data.json"]
        UploadInitial["Upload sync-data.json"]
    end

    subgraph AlreadyMigrated["Already Migrated"]
        NormalSync["Continue normal<br/>op-log sync"]
    end

    Start --> CheckRemote
    CheckRemote --> HasPfapi
    CheckRemote --> HasOpLog
    CheckRemote --> IsEmpty

    HasOpLog -->|Yes| NormalSync
    HasPfapi -->|Yes| AcquireLock
    IsEmpty -->|Yes| LocalState

    AcquireLock --> CheckLock
    CheckLock -->|Yes| StaleLock
    CheckLock -->|No| DownloadPfapi
    StaleLock -->|Yes| DownloadPfapi
    StaleLock -->|No| WaitRetry
    WaitRetry --> AcquireLock

    DownloadPfapi --> AssembleState
    AssembleState --> CreateImport
    CreateImport --> BuildSync
    BuildSync --> UploadSync
    UploadSync --> BackupPfapi
    BackupPfapi --> ReleaseLock
    ReleaseLock --> NormalSync

    LocalState --> CreateInitial
    CreateInitial --> UploadInitial
    UploadInitial --> NormalSync

    style AcquireLock fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style CreateImport fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
    style NormalSync fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
```

---

## 7. Archive Data Flow via Op-Log

Archive operations sync via the operation log. `ArchiveOperationHandler` writes archive data to IndexedDB on both local and remote clients.

```mermaid
sequenceDiagram
    participant User as User
    participant Store as NgRx Store
    participant LocalHandler as ArchiveOperationHandler<br/>(LOCAL_ACTIONS)
    participant Archive as Archive IndexedDB
    participant OpLog as SUP_OPS
    participant Sync as sync-data.json
    participant Remote as Remote Client
    participant RemoteHandler as ArchiveOperationHandler<br/>(via OperationApplier)

    Note over User,RemoteHandler: ═══ LOCAL CLIENT ═══

    User->>Store: Archive completed tasks
    Store->>Store: Dispatch moveToArchive

    par State update
        Store->>Store: Reducer removes from active
    and Archive write (local)
        Store->>LocalHandler: LOCAL_ACTIONS stream
        LocalHandler->>Archive: Write to archiveYoung
    and Operation capture
        Store->>OpLog: Append moveToArchive op
    end

    Note over User,RemoteHandler: ═══ SYNC ═══

    OpLog->>Sync: Upload ops

    Note over User,RemoteHandler: ═══ REMOTE CLIENT ═══

    Remote->>Sync: Download ops
    Remote->>Remote: OperationApplierService
    Remote->>Store: Dispatch moveToArchive<br/>(isRemote: true)

    Note right of Store: LOCAL_ACTIONS filtered<br/>(effect skipped)

    Remote->>RemoteHandler: Explicit call
    RemoteHandler->>Archive: Write to archiveYoung
```

---

## 8. FlushYoungToOld Operation

The `flushYoungToOld` operation moves old tasks from `archiveYoung` to `archiveOld`. Using the same timestamp ensures deterministic results on all clients.

```mermaid
flowchart LR
    subgraph Local["Local Client"]
        Trigger["Trigger:<br/>lastFlush > 14 days"]
        Action["Dispatch flushYoungToOld<br/>(timestamp: T)"]
        LocalSort["sortTimeTracking...<br/>(cutoff: T - 21 days)"]
        LocalYoung["archiveYoung"]
        LocalOld["archiveOld"]
    end

    subgraph Sync["Sync"]
        SyncFile["sync-data.json"]
    end

    subgraph Remote["Remote Client"]
        RemoteApply["Apply flushYoungToOld"]
        RemoteSort["sortTimeTracking...<br/>(same cutoff!)"]
        RemoteYoung["archiveYoung"]
        RemoteOld["archiveOld"]
    end

    Trigger --> Action
    Action --> LocalSort
    LocalSort --> LocalYoung
    LocalSort --> LocalOld
    Action --> SyncFile
    SyncFile --> RemoteApply
    RemoteApply --> RemoteSort
    RemoteSort --> RemoteYoung
    RemoteSort --> RemoteOld

    Note["Using same timestamp<br/>= deterministic results"]

    style Note fill:#fff9c4,stroke:#f57f17
```

---

## 9. Complete System Flow

```mermaid
flowchart TB
    subgraph UserActions["User Actions"]
        Create["Create"]
        Update["Update"]
        Delete["Delete"]
        Archive["Archive"]
    end

    subgraph StateLayer["State Management"]
        NgRx["NgRx Store"]
        Reducers["Reducers"]
        MetaReducers["Meta-Reducers"]
    end

    subgraph OpLogLayer["Operation Log"]
        Capture["Capture<br/>(meta-reducer)"]
        OpStore["SUP_OPS<br/>IndexedDB"]
        VectorClock["Vector Clock"]
    end

    subgraph SyncLayer["Sync Layer"]
        SyncOrch["OperationLogSyncService"]

        subgraph Adapters["Adapters"]
            FileAdapter["FileBasedSyncAdapter"]
            ApiAdapter["SuperSync API"]
        end

        ConflictRes["Conflict Resolution<br/>(LWW)"]
    end

    subgraph Providers["Providers"]
        WD["WebDAV"]
        DB["Dropbox"]
        LF["LocalFile"]
        SS["SuperSync Server"]
    end

    subgraph Storage["Remote Storage"]
        SyncFile["sync-data.json"]
        ServerDB["PostgreSQL"]
    end

    UserActions --> NgRx
    NgRx --> Reducers
    Reducers --> MetaReducers
    MetaReducers --> Capture
    Capture --> OpStore
    Capture --> VectorClock

    OpStore --> SyncOrch
    VectorClock --> SyncOrch
    SyncOrch --> FileAdapter
    SyncOrch --> ApiAdapter
    SyncOrch --> ConflictRes

    FileAdapter --> WD
    FileAdapter --> DB
    FileAdapter --> LF
    ApiAdapter --> SS

    WD --> SyncFile
    DB --> SyncFile
    LF --> SyncFile
    SS --> ServerDB

    style SyncFile fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style FileAdapter fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    style OpStore fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

---

## Key Points

1. **Single Sync File**: All data in `sync-data.json` - state snapshot + recent ops + vector clock
2. **Content-Based Versioning**: `syncVersion` counter detects conflicts without server ETags
3. **Piggybacking on Upload**: Version mismatch doesn't throw - ops from other clients are returned as `newOps`
4. **Sequence Counter Separation**:
   - `_expectedSyncVersions`: Tracks file's syncVersion (for version mismatch detection)
   - `_localSeqCounters`: Tracks ops we've processed (updated via `setLastServerSeq`)
5. **Archive via Op-Log**: Archive operations sync; `ArchiveOperationHandler` writes data
6. **Migration Lock**: Prevents concurrent PFAPI → op-log migration
7. **Deterministic Replay**: Same operation + same timestamp = same result everywhere

## Implementation Files

| File                                      | Purpose                        |
| ----------------------------------------- | ------------------------------ |
| `file-based-sync-adapter.service.ts`      | Main adapter (~600 LOC)        |
| `file-based-sync.types.ts`                | TypeScript types and constants |
| `pfapi-migration.service.ts`              | PFAPI → op-log migration       |
| `file-based-sync-adapter.service.spec.ts` | 26 unit tests                  |
