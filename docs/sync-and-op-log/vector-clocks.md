# Vector Clocks Architecture

## 1. Overview

Vector clocks track **causality** — "did this client know about that operation?" — rather than wall-clock time, which can drift between devices. They are the foundation of conflict detection and SYNC_IMPORT filtering in Super Productivity's sync system.

### Core Type

```typescript
interface VectorClock {
  [clientId: string]: number;
}
```

Each entry maps a client ID to a monotonically increasing counter. A clock with `{A: 5, B: 3}` means "this state includes A's first 5 operations and B's first 3 operations".

### Constants

| Constant                | Value | Purpose                           |
| ----------------------- | ----- | --------------------------------- |
| `MAX_VECTOR_CLOCK_SIZE` | 10    | Maximum entries in a pruned clock |

---

## 2. Core Operations

All four operations are implemented in `packages/shared-schema/src/vector-clock.ts` (shared between client and server). The client wraps them with null-handling in `src/app/core/util/vector-clock.ts`.

### Create

```typescript
initializeVectorClock(clientId) → { [clientId]: 0 }
```

### Increment

```typescript
incrementVectorClock(clock, clientId) → { ...clock, [clientId]: clock[clientId] + 1 }
```

Throws on overflow (approaching `MAX_SAFE_INTEGER`). The only recovery is a `SYNC_IMPORT` to reset clocks.

### Compare

```typescript
compareVectorClocks(a, b) → EQUAL | LESS_THAN | GREATER_THAN | CONCURRENT
```

Standard vector clock comparison with a **pruning-aware mode** (see [Section 6](#6-pruning-aware-comparison)).

### Merge

```typescript
mergeVectorClocks(a, b) → { [key]: max(a[key], b[key]) for all keys in a ∪ b }
```

Creates a new clock that dominates both inputs.

---

## 3. Where Vector Clocks Live

### Per-Operation Clock

Every `Operation` carries a `vectorClock` field — the global clock state at the time the operation was created. This is the primary mechanism for causality tracking.

### Global Clock Store

Stored in IndexedDB (`SUP_OPS` database, `vector_clock` object store) as a `VectorClockEntry`:

```typescript
interface VectorClockEntry {
  clock: VectorClock; // Current global clock
  lastUpdate: number; // Timestamp of last update
  protectedClientIds?: string[]; // IDs to preserve during pruning
}
```

The global clock is the **single source of truth** for the client's current causal knowledge. It is updated atomically with operation writes (single IndexedDB transaction).

### Snapshot Clock

The `state_cache` stores a `vectorClock` representing the clock at compaction time. This serves as a baseline for entities that haven't been modified since the last snapshot.

### Entity Frontier

Per-entity latest clocks, computed on demand by `VectorClockService.getEntityFrontier()`. Built by scanning operations after the snapshot. Used for fine-grained conflict detection.

---

## 4. Vector Clock Lifecycle (Normal Operations)

### Step 1: Local Operation Created

In `operation-log.effects.ts`:

1. `VectorClockService.getCurrentVectorClock()` reads the global clock from the `vector_clock` store
2. `incrementVectorClock(currentClock, clientId)` creates a new clock with the client's counter incremented
3. The operation is created with this **full, unpruned** clock
4. `appendWithVectorClockUpdate(op, 'local')` writes the operation AND updates the global clock in a **single atomic IndexedDB transaction**

**Key invariant: Normal operations carry full (unpruned) vector clocks. No client-side pruning happens during capture.**

### Step 2: Upload to Server

In `sync.service.ts` (`processOperation`):

1. `ValidationService.validateOp()` sanitizes the clock (DoS cap at 5×MAX = 50 entries) but does **NOT** prune
2. `detectConflict()` compares the **full unpruned** incoming clock against the existing entity clock
3. If accepted: `limitVectorClockSize(clock, [clientId])` prunes to MAX before storage, preserving only the uploading client's ID
4. The pruned clock is stored in the database

### Step 3: Download by Other Clients

In `operation-log-store.service.ts` (`mergeRemoteOpClocks`):

1. Each downloaded operation's clock is merged into the local global clock
2. For full-state operations (SYNC_IMPORT/BACKUP_IMPORT/REPAIR), the global clock is **replaced** (not merged) with the import's clock, then remaining ops are merged on top
3. The local clock inherits new entries but doesn't lose existing ones

### Key Insight

Normal operations are **NEVER** pruned client-side. The server prunes **after** comparison but **before** storage. This asymmetry is critical — see [Section 7](#7-conflict-detection--resolution-server-upload) for why.

---

## 5. Pruning

### Why Pruning Exists

Clocks grow with each new client. Without bounds, a user who has used 20+ devices would have clocks with 20+ entries, wasting storage and bandwidth. Pruning limits clocks to `MAX_VECTOR_CLOCK_SIZE` (10) entries.

### The `limitVectorClockSize` Algorithm

```
Input: clock, preserveClientIds[]
If entries ≤ MAX: return clock unchanged
Otherwise:
  1. Add entries from preserveClientIds first (capped at MAX)
  2. Fill remaining slots with highest-counter entries (sorted descending)
  3. Return clock with exactly MAX entries
```

Implemented in `packages/shared-schema/src/vector-clock.ts`. The client wrapper in `src/app/core/util/vector-clock.ts` adds logging and combines `currentClientId` + `protectedClientIds` into the `preserveClientIds` array.

### When Pruning Happens (Exhaustive List)

| Location                                        | When                                            | What's Preserved                  |
| ----------------------------------------------- | ----------------------------------------------- | --------------------------------- |
| **Server** `processOperation()`                 | After conflict detection, before storage        | Uploading client's ID only        |
| **Server** `getOpsSinceWithSeq()`               | Aggregating snapshot vector clock               | Requesting client + import client |
| **Client** `SyncHydrationService`               | Creating SYNC_IMPORT during conflict resolution | Current client only               |
| **Client** `ServerMigrationService`             | Creating SYNC_IMPORT during migration           | Current client only               |
| **Client** `RepairOperationService`             | Creating REPAIR operation                       | Current client only               |
| **Client** `SyncImportFilterService`            | Normalizing import clock for comparison         | Import client only                |
| **Client** normal op capture                    | **NEVER**                                       | N/A                               |
| **Client** `SupersededOperationResolverService` | **NEVER** (conflict resolution)                 | N/A                               |

### The Pruning Asymmetry

The server preserves only the uploading client's ID when pruning. The creating client may have preserved additional IDs (via `protectedClientIds`). This means:

- Server-stored ops may be missing entries that the creating client preserved locally
- Other clients downloading these ops see pruned clocks
- This is why pruning-aware comparison and `isLikelyPruningArtifact` exist

---

## 6. Pruning-Aware Comparison

When **both** clocks have **exactly** `MAX_VECTOR_CLOCK_SIZE` entries (using `===`, not `>=`), they may have been pruned by different clients.

### Algorithm

1. Compute shared keys (present in both clocks)
2. If no shared keys → `CONCURRENT` (completely independent client populations)
3. Compare only shared keys to determine aGreater / bGreater
4. If both sides have greater values on shared keys → `CONCURRENT`
5. If the winning side's opponent has non-shared keys → `CONCURRENT` (conservative: the non-shared keys might represent unknown causal history)
6. If shared keys are equal but either side has non-shared keys → `CONCURRENT` (not `EQUAL`)
7. Otherwise, return the result from shared-key comparison

### Why `===` MAX and Not `>=` MAX

A clock with **more** than MAX entries was never pruned (it's a fresh clock from conflict resolution). Using `>=` would incorrectly activate pruning-aware mode for unpruned clocks, potentially returning `CONCURRENT` when `GREATER_THAN` is correct.

### Known Limitation

A clock that naturally grew to exactly MAX entries (without pruning) is indistinguishable from a pruned clock. This is accepted because it requires exactly 10 active clients — unlikely for a personal productivity app.

---

## 7. Conflict Detection & Resolution (Server Upload)

### Server-Side Flow

1. Server finds the latest operation for the same entity (`findFirst` by `entityType + entityId`, ordered by `serverSeq desc`)
2. Compares incoming clock vs existing clock using the **full unpruned** incoming clock
3. Possible outcomes:
   - `GREATER_THAN` → **accept** (incoming op causally succeeds existing)
   - `EQUAL` + same client → **accept** (retry of same operation)
   - `EQUAL` + different client → **reject** (suspicious clock reuse)
   - `CONCURRENT` → **reject** (true conflict)
   - `LESS_THAN` → **reject** (superseded)
4. If accepted: prune clock, then store

### Client-Side Resolution

When the server rejects an operation:

1. Client receives rejection with `existingClock`
2. `SupersededOperationResolverService.resolveSupersededLocalOps()`:
   - Merges the global clock + all superseded ops' clocks + snapshot clock + extra clocks from force download
   - Calls `mergeAndIncrementClocks()` — **no client-side pruning!**
   - Creates new LWW Update ops with the merged clock
3. Re-uploads → server compares the full merged clock (which now has MAX+1 entries or more) → `GREATER_THAN` → accept
4. Server prunes the merged clock before storage

### Critical Invariant: Server Must Prune AFTER Comparison

**The bug (discovered Feb 2026):** When the server pruned before comparison:

```
1. Entity clock on server: {A:5, B:3, C:7, D:2, E:4, F:1, G:6, H:8, I:3, J:2} (10 entries = MAX)
2. Client K merges all + its own ID → 11 entries
3. Server prunes K's clock, drops one entry (e.g., F) → 10 entries
4. Both clocks at MAX → pruning-aware mode → F is a "b-only" key → CONCURRENT
5. Server rejects → client re-merges → server prunes → rejects again → INFINITE LOOP
```

It is **mathematically impossible** to build a dominating clock with MAX entries when the entity clock already has MAX entries and the client's ID isn't among them (requires MAX+1 entries to dominate).

**The fix:**

```
ValidationService.validateOp()    → sanitize clock (DoS cap at 5×MAX=50), NO pruning
SyncService.detectConflict()      → compare using FULL unpruned clock (11 entries vs 10)
                                    → bOnlyCount = 0 → GREATER_THAN ✓
SyncService.processOperation()    → limitVectorClockSize() → prune to MAX before storage
```

**Safety net:** `RejectedOpsHandlerService` tracks resolution attempts per entity. After `MAX_CONCURRENT_RESOLUTION_ATTEMPTS` (3) failures, ops are permanently rejected.

---

## 8. SYNC_IMPORT / BACKUP_IMPORT / REPAIR Handling

### The Core Rule: Clean Slate Semantics

An import is an explicit user action to restore **all clients** to a specific state. Operations without knowledge of the import are **dropped**:

| Comparison     | Meaning                                | Action   |
| -------------- | -------------------------------------- | -------- |
| `GREATER_THAN` | Op created after seeing import         | **Keep** |
| `EQUAL`        | Same causal history as import          | **Keep** |
| `CONCURRENT`   | Op created without knowledge of import | **Drop** |
| `LESS_THAN`    | Op is dominated by import              | **Drop** |

`CONCURRENT` ops are dropped even from unknown clients. This ensures a true "restore to point in time" semantic.

### How Import Clocks Are Created

| Source                               | Method                   | Clock Construction                                                                       |
| ------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------- |
| `BACKUP_IMPORT` (clean slate)        | `SyncHydrationService`   | Fresh clock `{newClientId: 1}` — small, no pruning issues                                |
| Server migration                     | `ServerMigrationService` | Merge all local op clocks + global clock → increment → prune to MAX                      |
| Sync hydration (conflict resolution) | `SyncHydrationService`   | Merge local clock + state cache clock + remote snapshot clock → increment → prune to MAX |
| Auto-repair                          | `RepairOperationService` | Get current global clock → increment → prune to MAX                                      |

### Full-State Operations Skip Server Conflict Detection

In `detectConflict()`, operations with `opType` of `SYNC_IMPORT`, `BACKUP_IMPORT`, or `REPAIR` return `{ hasConflict: false }` immediately. These operations replace entire state and don't operate on individual entities.

### The `SyncImportFilterService` Algorithm

Implemented in `src/app/op-log/sync/sync-import-filter.service.ts`:

1. **Find the latest full-state op** — check current batch AND local store (via `getLatestFullStateOpEntry()`), keep the one with the latest UUIDv7 ID
2. **Normalize import clock**: if > MAX entries, prune it (using `limitVectorClockSize(clock, importClientId, [])`) to match what the server stored
3. For each non-full-state operation in the batch:
   - Compare `op.vectorClock` vs normalized import clock
   - `GREATER_THAN` or `EQUAL` → **keep**
   - `CONCURRENT` + `isLikelyPruningArtifact()` → **keep** (defense layer #4)
   - `CONCURRENT` + same client as import + higher counter → **keep** (defense layer #4b)
   - Otherwise → **filter**

---

## 9. Defense Layers Against Pruning Artifacts

Four distinct mechanisms, each protecting against a different failure mode. All are necessary — they cannot be collapsed.

| #   | Mechanism                          | Where                              | Protects Against                                            | Failure Without It                                                                         |
| --- | ---------------------------------- | ---------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | **Protected client IDs**           | Client (operation capture)         | Client-side pruning removing import entries from future ops | Future ops lose import entries → frequent false CONCURRENT with import                     |
| 2   | **Server prunes after comparison** | Server (`processOperation`)        | Infinite rejection loops during conflict resolution         | Client builds MAX+1 clock → server prunes → CONCURRENT → reject → re-merge → infinite loop |
| 3   | **Pruning-aware comparison**       | Shared (`compareVectorClocks`)     | False GREATER_THAN/LESS_THAN from missing pruned keys       | Silent data loss or unnecessary rejection when both clocks are at MAX                      |
| 4   | **`isLikelyPruningArtifact`**      | Client (`SyncImportFilterService`) | False CONCURRENT for new post-import clients                | New client born after import has ops incorrectly filtered → data loss                      |
| 4b  | **Same-client check**              | Client (`SyncImportFilterService`) | False CONCURRENT for import client's own post-import ops    | Import client's subsequent ops incorrectly filtered → data loss                            |

---

## 10. Protected Client IDs

### What They Are

A list of client IDs stored alongside the global clock in `VectorClockEntry.protectedClientIds`. These IDs are preserved by `limitVectorClockSize()` during any client-side pruning.

### Purpose

Prevent `limitVectorClockSize` from pruning entries that belong to the latest full-state operation's clock. Without this, low-counter entries from the import clock (like `{importClient: 1}`) would be pruned from future operation clocks, causing those operations to appear `CONCURRENT` with the import instead of `GREATER_THAN`.

### Lifecycle

1. Full-state op applied → `selectProtectedClientIds(op.vectorClock)` selects the top `MAX - 1` entries by counter value (leaving room for `currentClientId`)
2. `setProtectedClientIds()` stores them in the `vector_clock` object store
3. Future calls to `limitVectorClockSize(clock, currentClientId, protectedClientIds)` preserve these IDs
4. Next full-state op replaces the protected IDs

### Important Properties

- `setVectorClock()` and `mergeRemoteOpClocks()` **preserve** existing `protectedClientIds` when updating the clock
- `appendWithVectorClockUpdate()` also **preserves** existing `protectedClientIds`
- Protected IDs are **client-local** — the server doesn't know about them and prunes without regard to them

### Migration

`_migrateProtectedClientIdsIfNeeded()` runs during hydration for existing data:

1. Finds latest full-state op in the ops log
2. Calls `selectProtectedClientIds(op.vectorClock)` to get what SHOULD be protected
3. Compares against existing protected IDs
4. Updates if any required IDs are missing

---

## 11. Key Scenarios (Step-by-Step Traces)

### Scenario 1: Two-Client Sync (No Conflicts)

```
Initial state: Client A and B both know about each other
  A's global clock: {A: 3, B: 2}
  B's global clock: {A: 3, B: 2}

Step 1: A creates a task
  A increments: {A: 4, B: 2}
  Op carries clock: {A: 4, B: 2}
  A's global clock updated to: {A: 4, B: 2}

Step 2: A uploads
  Server compares op clock {A: 4, B: 2} vs latest entity clock (none) → no conflict
  Server stores op (no pruning needed, 2 entries < MAX)

Step 3: B downloads
  B receives op with clock {A: 4, B: 2}
  B merges into global clock: max({A: 3, B: 2}, {A: 4, B: 2}) = {A: 4, B: 2}

Step 4: B creates a task
  B increments: {A: 4, B: 3}
  B's global clock updated to: {A: 4, B: 3}
```

### Scenario 2: Concurrent Modification (Conflict Resolution)

```
Starting state: Both clients synced
  A's clock: {A: 3, B: 2}    B's clock: {A: 3, B: 2}

Step 1: Both modify the same task offline
  A creates op: {A: 4, B: 2}
  B creates op: {A: 3, B: 3}

Step 2: A uploads first → server accepts (no prior op for this entity)
  Server stores: {A: 4, B: 2}

Step 3: B uploads
  Server compares: {A: 3, B: 3} vs {A: 4, B: 2}
  A=3 < 4 (b greater), B=3 > 2 (a greater) → CONCURRENT → reject
  Server returns existingClock: {A: 4, B: 2}

Step 4: B resolves
  SupersededOperationResolverService merges:
    globalClock={A: 3, B: 3} + existingClock={A: 4, B: 2} + opClock={A: 3, B: 3}
    merged = {A: 4, B: 3}, incremented = {A: 4, B: 4}
  Creates new LWW Update op with clock {A: 4, B: 4}
  NO client-side pruning

Step 5: B re-uploads
  Server compares: {A: 4, B: 4} vs {A: 4, B: 2} → GREATER_THAN → accept
  Server stores (pruned if needed, but only 2 entries here)
```

### Scenario 3: SYNC_IMPORT with Small Clock (Clean Slate)

```
Step 1: Client A does BACKUP_IMPORT (full data restore)
  Creates SYNC_IMPORT op with clock: {A: 1}
  Uploads to server

Step 2: Client B has been working offline
  B's pending ops have clocks like: {A: 3, B: 5}

Step 3: B downloads, receives the SYNC_IMPORT
  SyncImportFilterService compares each of B's pending ops:
    {A: 3, B: 5} vs {A: 1} → B has A=3 > 1 (a greater), but A has no B entry
    In standard mode: {A: 3, B: 5} GREATER_THAN {A: 1} → keep

  Wait — this seems wrong? No: B's ops have knowledge of A:3, which is > A:1.
  They ARE causally after the import's creation. Whether their content is wanted
  depends on the use case. The clean slate semantics are enforced by:
  - The import clock being small ({A: 1})
  - B's ops were created AFTER seeing A:3, but the import was created fresh

  Actually, if B was truly offline and never saw A's state:
    B's clock: {B: 5} (never saw A)
    Compare: {B: 5} vs {A: 1} → CONCURRENT → filtered ✓

  If B had previously synced with A:
    B's clock: {A: 3, B: 5}
    Compare: {A: 3, B: 5} vs {A: 1} → GREATER_THAN → kept ✓
    This is correct: B's ops were created with knowledge beyond the import point
```

### Scenario 4: SYNC_IMPORT with MAX-Sized Clock (Pruning Artifact)

```
Setup: 10+ clients exist, import clock has MAX entries
  Import clock: {A:5, B:3, C:7, D:2, E:4, F:1, G:6, H:8, I:3, J:2} (10 = MAX)

Step 1: New client K joins after the import
  K inherits import's clock and adds its own: 11 entries
  K creates op, uploads to server
  Server prunes K's stored clock to 10, dropping F (lowest counter):
    {A:5, B:3, C:7, D:2, E:4, G:6, H:8, I:3, J:2, K:1}

Step 2: Client L downloads K's op and runs SyncImportFilterService
  Compare: {A:5, B:3, C:7, D:2, E:4, G:6, H:8, I:3, J:2, K:1} vs {A:5, B:3, C:7, D:2, E:4, F:1, G:6, H:8, I:3, J:2}
  Both at MAX → pruning-aware mode
  Shared keys: A,B,C,D,E,G,H,I,J (9 keys)
  Non-shared: K (a-only), F (b-only)
  Shared key values are equal → but non-shared keys exist → CONCURRENT

Step 3: isLikelyPruningArtifact check
  1. K's clientId NOT in import clock → ✓ (new client)
  2. Import clock has MAX entries → ✓
  3. Shared keys exist (9) → ✓
  4. All shared keys: op >= import → ✓ (all equal)
  Result: pruning artifact → KEEP op ✓
```

### Scenario 5: Same Client Continues After SYNC_IMPORT

```
Step 1: Client A creates SYNC_IMPORT with MAX-sized clock
  Import clock: {A:10, B:5, C:7, D:2, E:4, F:1, G:6, H:8, I:3, J:2}

Step 2: Client A continues working, clock evolves
  After many ops and pruning, A's clock may have different entries pruned:
    Op clock: {A:15, B:5, C:7, D:2, E:4, G:6, H:8, I:3, J:2, K:1}
    (F was pruned, K was added from a downloaded op)

Step 3: Another client compares this op against the import
  Both at MAX → pruning-aware → shared keys equal or op greater, F is b-only → CONCURRENT

Step 4: Same-client check
  op.clientId === import.clientId === "A"
  op.vectorClock["A"] = 15 > import["A"] = 10
  A's counter is higher → this is definitely a post-import op from the same client → KEEP ✓

  This is not a heuristic — same-client counter comparison is definitive because
  counters are monotonically increasing. A cannot create ops concurrent with its
  own import.
```

---

## 12. Invariants

Rules that must hold for the system to be correct. Use these to verify implementations and tests.

1. **Normal ops carry full (unpruned) vector clocks.** No pruning in `operation-log.effects.ts`.

2. **Server prunes AFTER comparison, BEFORE storage.** `processOperation()` calls `limitVectorClockSize()` after `detectConflict()` succeeds.

3. **Client does NOT prune during conflict resolution.** `SupersededOperationResolverService` sends full merged clocks; the server prunes after accepting.

4. **Protected client IDs are preserved across all VectorClockEntry updates.** `setVectorClock()`, `mergeRemoteOpClocks()`, and `appendWithVectorClockUpdate()` all read and re-write `protectedClientIds`.

5. **`compareVectorClocks` produces identical results on client and server.** Both import from `@sp/shared-schema`. The client wrapper only adds null handling.

6. **Import clock normalization: if > MAX entries, prune before comparing with other ops.** `SyncImportFilterService` normalizes the import clock to match what the server stored.

7. **Full-state ops skip conflict detection on server.** `detectConflict()` returns `{ hasConflict: false }` for SYNC_IMPORT, BACKUP_IMPORT, and REPAIR.

8. **CONCURRENT ops are FILTERED (not kept) against SYNC_IMPORT.** Clean slate semantics — this is the explicit, correct behavior.

9. **Global clock is REPLACED (not merged) on remote SYNC_IMPORT.** `mergeRemoteOpClocks()` starts from the import's clock as the base, then merges remaining ops on top. This prevents clock bloat.

10. **DoS cap is NOT pruning.** `sanitizeVectorClock()` rejects clocks with > 5×MAX entries entirely — it doesn't prune them down. This is a validation gate, not a size reduction.

---

## 13. Key Files Reference

| Concept                                                                          | File(s)                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Core algorithms (compare, merge, prune)                                          | `packages/shared-schema/src/vector-clock.ts`                                 |
| Client wrappers (null handling, logging, validation, `selectProtectedClientIds`) | `src/app/core/util/vector-clock.ts`                                          |
| Global clock management, entity frontier                                         | `src/app/op-log/sync/vector-clock.service.ts`                                |
| Operation capture (no pruning, atomic clock update)                              | `src/app/op-log/capture/operation-log.effects.ts`                            |
| Clock persistence, protected IDs storage                                         | `src/app/op-log/persistence/operation-log-store.service.ts`                  |
| Import filtering + `isLikelyPruningArtifact` + same-client check                 | `src/app/op-log/sync/sync-import-filter.service.ts`                          |
| Conflict resolution (no pruning, merges clocks)                                  | `src/app/op-log/sync/superseded-operation-resolver.service.ts`               |
| Conflict resolution (LWW logic, `mergeAndIncrementClocks`)                       | `src/app/op-log/sync/conflict-resolution.service.ts`                         |
| SYNC_IMPORT creation (sync hydration)                                            | `src/app/op-log/persistence/sync-hydration.service.ts`                       |
| SYNC_IMPORT creation (server migration)                                          | `src/app/op-log/sync/server-migration.service.ts`                            |
| REPAIR creation                                                                  | `src/app/op-log/validation/repair-operation.service.ts`                      |
| Protected ID migration                                                           | `src/app/op-log/persistence/operation-log-hydrator.service.ts`               |
| Server: conflict detection + prune after comparison                              | `packages/super-sync-server/src/sync/sync.service.ts`                        |
| Server: DoS cap (sanitize, no pruning)                                           | `packages/super-sync-server/src/sync/services/validation.service.ts`         |
| Server: snapshot clock pruning during download optimization                      | `packages/super-sync-server/src/sync/services/operation-download.service.ts` |
