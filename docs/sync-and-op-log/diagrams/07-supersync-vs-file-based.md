# SuperSync vs File-Based Sync Comparison

**Last Updated:** January 2026
**Status:** Implemented

This document compares the two sync provider architectures: SuperSync (server-based) and File-Based (WebDAV/Dropbox/LocalFile).

## High-Level Architecture Comparison

```mermaid
flowchart TB
    subgraph Client["Client Application"]
        NgRx["NgRx Store"]
        OpLog["Operation Log<br/>(SUP_OPS IndexedDB)"]
        SyncService["OperationLogSyncService"]
    end

    subgraph SuperSyncPath["SuperSync Path"]
        SSAdapter["SuperSyncProvider"]
        SSApi["REST API"]
        SSPG["PostgreSQL"]
    end

    subgraph FileBasedPath["File-Based Path"]
        FBAdapter["FileBasedSyncAdapter"]

        subgraph Providers["File Providers"]
            WebDAV["WebDAV"]
            Dropbox["Dropbox"]
            LocalFile["LocalFile"]
        end

        SyncFile["sync-data.json"]
    end

    NgRx --> OpLog
    OpLog --> SyncService

    SyncService --> SSAdapter
    SyncService --> FBAdapter

    SSAdapter --> SSApi
    SSApi --> SSPG

    FBAdapter --> WebDAV
    FBAdapter --> Dropbox
    FBAdapter --> LocalFile

    WebDAV --> SyncFile
    Dropbox --> SyncFile
    LocalFile --> SyncFile

    style SuperSyncPath fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style FileBasedPath fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style Client fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## Feature Comparison

| Feature                | SuperSync                 | File-Based                        |
| ---------------------- | ------------------------- | --------------------------------- |
| **Storage**            | PostgreSQL database       | Single JSON file                  |
| **Operations**         | Stored individually       | Buffered (last 200)               |
| **State Snapshot**     | Not stored (derived)      | Included in sync file             |
| **Archive Data**       | Via operation replay      | Embedded in sync file             |
| **Conflict Detection** | Server sequence numbers   | syncVersion counter               |
| **Gap Detection**      | Server validates sequence | Client-side via lastSeq           |
| **Concurrency**        | Server handles locks      | Optimistic locking + piggybacking |
| **Bandwidth**          | Delta ops only            | Full state + recent ops           |
| **Late Joiners**       | Full replay from server   | State snapshot in file            |

## Data Storage Comparison

```mermaid
flowchart TB
    subgraph SuperSync["SuperSync Storage"]
        direction TB
        PG["PostgreSQL Database"]

        subgraph Tables["Tables"]
            OpsTable["operations<br/>━━━━━━━━━━━━━━━<br/>id, client_id, seq<br/>action_type, payload<br/>vector_clock, timestamp"]
            ClientsTable["clients<br/>━━━━━━━━━━━━━━━<br/>client_id, last_seq<br/>created_at"]
        end

        PG --> Tables
    end

    subgraph FileBased["File-Based Storage"]
        direction TB
        SyncFile["sync-data.json"]

        subgraph Contents["Contents"]
            Meta["Metadata<br/>━━━━━━━━━━━━━━━<br/>version, syncVersion<br/>lastModified, checksum"]
            State["State Snapshot<br/>━━━━━━━━━━━━━━━<br/>Full AppDataComplete"]
            Archive["Archive Data<br/>━━━━━━━━━━━━━━━<br/>archiveYoung, archiveOld"]
            RecentOps["Recent Ops (200)<br/>━━━━━━━━━━━━━━━<br/>CompactOperation[]"]
        end

        SyncFile --> Contents
    end

    style SuperSync fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style FileBased fill:#fff3e0,stroke:#e65100,stroke-width:2px
```

## Sync Flow Comparison

### Download Flow

```mermaid
sequenceDiagram
    participant Client
    participant SS as SuperSync Server
    participant FB as File Provider

    rect rgb(227, 242, 253)
        Note over Client,SS: SuperSync Download
        Client->>SS: GET /ops?since={lastSeq}
        SS->>SS: Query ops WHERE seq > lastSeq
        SS-->>Client: {ops: [...], lastSeq: N}
        Note over Client: Only receives new ops<br/>Bandwidth efficient
    end

    rect rgb(255, 243, 224)
        Note over Client,FB: File-Based Download
        Client->>FB: downloadFile("sync-data.json")
        FB-->>Client: {state, recentOps, syncVersion}
        Client->>Client: Filter ops by lastProcessedSeq
        Note over Client: Downloads full file<br/>Filters locally
    end
```

### Upload Flow

```mermaid
sequenceDiagram
    participant Client
    participant SS as SuperSync Server
    participant FB as File Provider

    rect rgb(227, 242, 253)
        Note over Client,SS: SuperSync Upload
        Client->>SS: POST /ops {ops: [...], lastKnownSeq}
        SS->>SS: Validate sequence continuity
        alt Gap detected
            SS-->>Client: 409 Conflict + missing ops
        else No gap
            SS->>SS: Insert ops, assign seq numbers
            SS-->>Client: 200 OK {assignedSeqs}
        end
    end

    rect rgb(255, 243, 224)
        Note over Client,FB: File-Based Upload
        Client->>FB: downloadFile (get current state)
        FB-->>Client: {syncVersion: N, recentOps}
        Client->>Client: Merge local ops + file ops
        Client->>Client: Find piggybacked ops
        Client->>Client: Set syncVersion = N+1
        Client->>FB: uploadFile(merged data)
        FB-->>Client: Success
        Note over Client: Returns piggybacked ops<br/>for immediate processing
    end
```

## Conflict Handling Comparison

```mermaid
flowchart TB
    subgraph SuperSync["SuperSync Conflict Handling"]
        SS1["Client uploads ops"]
        SS2{"Server checks<br/>sequence gap?"}
        SS3["Gap: Return 409<br/>+ missing ops"]
        SS4["No gap: Accept ops"]
        SS5["Client downloads<br/>missing ops"]
        SS6["LWW resolution<br/>on client"]

        SS1 --> SS2
        SS2 -->|Yes| SS3
        SS2 -->|No| SS4
        SS3 --> SS5
        SS5 --> SS6
    end

    subgraph FileBased["File-Based Conflict Handling"]
        FB1["Client downloads file"]
        FB2{"syncVersion<br/>changed?"}
        FB3["Version match:<br/>Clean upload"]
        FB4["Version changed:<br/>Piggybacking"]
        FB5["Merge all ops"]
        FB6["Upload merged file"]
        FB7["Return piggybacked ops"]
        FB8["LWW resolution<br/>on client"]

        FB1 --> FB2
        FB2 -->|No| FB3
        FB2 -->|Yes| FB4
        FB4 --> FB5
        FB5 --> FB6
        FB6 --> FB7
        FB7 --> FB8
    end

    style SuperSync fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style FileBased fill:#fff3e0,stroke:#e65100,stroke-width:2px
```

## When to Use Each

```mermaid
flowchart TD
    Start["Choose Sync Provider"] --> Q1{Need real-time<br/>multi-device sync?}

    Q1 -->|Yes| Q2{Have SuperSync<br/>account?}
    Q1 -->|No| FileBased

    Q2 -->|Yes| SuperSync
    Q2 -->|No| Q3{Have cloud<br/>storage?}

    Q3 -->|WebDAV/Dropbox| FileBased
    Q3 -->|No| LocalFile

    SuperSync["SuperSync<br/>━━━━━━━━━━━━━━━<br/>• Real-time sync<br/>• Efficient bandwidth<br/>• Server-managed gaps<br/>• Best for active teams"]

    FileBased["File-Based Sync<br/>━━━━━━━━━━━━━━━<br/>• Uses existing storage<br/>• No additional account<br/>• Self-hosted option<br/>• Good for individuals"]

    LocalFile["Local File<br/>━━━━━━━━━━━━━━━<br/>• Manual sync<br/>• Full control<br/>• Backup purposes"]

    style SuperSync fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    style FileBased fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style LocalFile fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px
```

## Implementation Details

### Shared Infrastructure

Both providers implement `OperationSyncCapable` interface and use:

| Component                   | Purpose                               |
| --------------------------- | ------------------------------------- |
| `OperationLogSyncService`   | Orchestrates sync timing and triggers |
| `ConflictResolutionService` | LWW resolution for concurrent edits   |
| `VectorClockService`        | Causality tracking for all operations |
| `OperationApplierService`   | Applies remote ops to NgRx state      |
| `ArchiveOperationHandler`   | Handles archive side effects          |

### Provider-Specific Components

| SuperSync                       | File-Based                       |
| ------------------------------- | -------------------------------- |
| `SuperSyncProvider`             | `FileBasedSyncAdapter`           |
| REST API client                 | File provider abstraction        |
| Server-side sequence management | Client-side syncVersion tracking |
| Gap detection via HTTP 409      | Piggybacking on version mismatch |

## Key Files

| File                                                 | Purpose                           |
| ---------------------------------------------------- | --------------------------------- |
| `src/app/op-log/sync-providers/super-sync/`          | SuperSync provider implementation |
| `src/app/op-log/sync-providers/file-based/`          | File-based adapter and types      |
| `src/app/op-log/sync/operation-log-sync.service.ts`  | Shared sync orchestration         |
| `src/app/op-log/sync/conflict-resolution.service.ts` | LWW conflict resolution           |
