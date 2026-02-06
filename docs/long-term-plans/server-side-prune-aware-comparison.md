# Plan: Server-Side Prune-Aware Vector Clock Comparison

> **STATUS: PROPOSED**
>
> Short-term improvement to eliminate false CONCURRENT verdicts caused by client-side vector clock pruning.

---

## Problem

When a client creates a replacement operation (via `SupersededOperationResolverService`), the vector clock is pruned to `MAX_VECTOR_CLOCK_SIZE=10` entries. If the server's entity clock contains client IDs that were pruned from the operation's clock, `compareVectorClocks` may return `CONCURRENT` instead of `GREATER_THAN`, causing the server to reject the operation.

The current fix (commit `f9be1c8500`) mitigates this by preserving entity clock IDs during client-side pruning. But it only works when the entity clock has fewer unique IDs than `MAX_VECTOR_CLOCK_SIZE - 1` (reserving one slot for `currentClientId`). For entities touched by 10+ distinct clients, the problem persists.

## Root Cause

The comparison in `compareVectorClocks` (`packages/shared-schema/src/vector-clock.ts:62-113`) treats both sides symmetrically -- it doesn't know which clock is authoritative and which might be pruned. On the server, however, we always know: the **entity clock is authoritative** (stored unpruned), and the **incoming op clock may be pruned**.

## Approach

**Store full (unpruned) entity clocks on the server. When comparing an incoming op's clock against an entity's clock, use an asymmetric comparison that accounts for the op clock being pruned.**

The key insight: the server should never compare two pruned clocks against each other. It should always compare the client's (possibly pruned) clock against its own authoritative (unpruned) entity clock.

### Industry Precedent

This is a variant of what Riak does with Dotted Version Vectors: the server maintains the authoritative version state, and client-provided context is treated as potentially incomplete. The difference is that Riak uses server-scoped actors (vnodes) while we keep client-scoped actors but compensate on the comparison side.

## Changes

### 1. Store full entity clocks on the server

**File:** `packages/super-sync-server/prisma/schema.prisma`

Add a new model (or extend existing) to store the merged entity clock per user+entity:

```prisma
model EntityClock {
  id         String      @id @default(uuid())
  userId     String
  entityType String
  entityId   String
  clock      Json        // Full unpruned VectorClock
  updatedAt  DateTime    @updatedAt

  @@unique([userId, entityType, entityId])
  @@index([userId, entityType, entityId])
}
```

Currently, the server finds the entity's latest clock by querying the most recent `Operation` for that entity (`sync.service.ts:detectConflictForEntity`). The stored operation's clock is already pruned (the server prunes incoming clocks via `validation.service.ts`). This means the server is comparing a pruned op clock against a pruned entity clock -- the worst case.

With `EntityClock`, the server maintains a **merged, unpruned** clock per entity that accumulates all client IDs that have ever modified that entity.

### 2. Update entity clocks on operation acceptance

**File:** `packages/super-sync-server/src/sync/sync.service.ts`

When an operation is accepted (passes conflict check and gets a sequence number):

```typescript
// After accepting the operation, merge its clock into the entity's stored clock
const existingEntityClock = await this.getEntityClock(userId, entityType, entityId);
const mergedClock = mergeVectorClocks(existingEntityClock ?? {}, op.vectorClock);
await this.upsertEntityClock(userId, entityType, entityId, mergedClock);
```

The entity clock grows unboundedly on the server (not pruned), but this is acceptable:

- Server storage is cheap compared to client bandwidth
- Typical entities are touched by 1-5 clients, rarely more than 20
- A 20-entry JSON object is ~200 bytes

### 3. Use entity clock for conflict detection

**File:** `packages/super-sync-server/src/sync/sync.service.ts` (`detectConflictForEntity`)

Replace the current approach (find latest op, compare clocks) with:

```typescript
async detectConflictForEntity(
  userId: string,
  entityType: string,
  entityId: string,
  incomingClock: VectorClock,
  incomingClientId: string,
): Promise<ConflictResult> {
  const entityClock = await this.getEntityClock(userId, entityType, entityId);

  if (!entityClock) {
    // First operation for this entity -- no conflict possible
    return { hasConflict: false };
  }

  // Asymmetric comparison: entity clock is authoritative (full),
  // incoming clock may be pruned
  const result = compareVectorClocksAsymmetric(entityClock, incomingClock);

  if (result === 'LESS_THAN' || result === 'EQUAL') {
    // Incoming clock dominates or matches -- accept
    return { hasConflict: false };
  }

  // CONCURRENT or GREATER_THAN (entity is ahead) -- reject
  return { hasConflict: true, reason: result, existingClock: entityClock };
}
```

### 4. Add asymmetric comparison function

**File:** `packages/shared-schema/src/vector-clock.ts`

```typescript
/**
 * Asymmetric vector clock comparison for server-side use.
 *
 * `authoritative` is the full, unpruned entity clock maintained by the server.
 * `candidate` is the incoming op's clock, which may have been pruned.
 *
 * Missing keys in `candidate` that exist in `authoritative` are treated as
 * "pruned away" (value 0) ONLY IF `candidate` is at MAX_VECTOR_CLOCK_SIZE.
 * If `candidate` is below MAX, missing keys genuinely mean "never seen".
 */
export const compareVectorClocksAsymmetric = (
  authoritative: VectorClock,
  candidate: VectorClock,
): VectorClockComparison => {
  const candidateKeys = Object.keys(candidate);
  const candidatePossiblyPruned = candidateKeys.length >= MAX_VECTOR_CLOCK_SIZE;

  const allKeys = new Set([...Object.keys(authoritative), ...candidateKeys]);

  let authGreater = false;
  let candGreater = false;

  for (const key of allKeys) {
    const authVal = authoritative[key] ?? 0;
    const candVal = candidate[key] ?? 0;

    if (authVal > candVal) {
      if (candidatePossiblyPruned && candVal === 0) {
        // Candidate is missing this key but may have pruned it.
        // If candidate dominates on all keys it DOES have, this missing
        // key was likely pruned. We skip it -- don't count as authGreater.
        continue;
      }
      authGreater = true;
    }
    if (candVal > authVal) {
      candGreater = true;
    }
  }

  if (authGreater && candGreater) return 'CONCURRENT';
  if (authGreater) return 'GREATER_THAN'; // Entity is ahead
  if (candGreater) return 'LESS_THAN'; // Candidate dominates (accept)
  return 'EQUAL';
};
```

**Correctness note:** The `continue` for missing keys in a pruned candidate is safe because:

- If the candidate truly saw that client's value (and pruned it), skipping is correct -- the candidate dominates
- If the candidate never saw that client's value (shouldn't happen -- the candidate should have it from the merge), treating it as pruned is optimistic but avoids the sync loop
- The risk of false acceptance (treating a genuinely CONCURRENT op as GREATER_THAN) is low: it requires a pruned client to have modified the entity between the candidate's last read and the upload, which is a narrow race window

### 5. Migration: backfill entity clocks

For existing deployments, entity clocks need to be backfilled from existing operations:

```sql
-- For each (userId, entityType, entityId), find all operations
-- and merge their vector clocks into an EntityClock row.
-- This can be done as a background migration.
INSERT INTO "EntityClock" ("id", "userId", "entityType", "entityId", "clock", "updatedAt")
SELECT
  gen_random_uuid(),
  "userId",
  "entityType",
  "entityId",
  -- JSON merge of all vector clocks for this entity (application-level)
  merged_clock,
  NOW()
FROM (
  SELECT "userId", "entityType", "entityId"
  FROM "Operation"
  GROUP BY "userId", "entityType", "entityId"
) entities;
```

The actual clock merging needs application-level logic (JSON merge with max per key). This should be a one-time migration script, not raw SQL.

**Fallback during migration:** If no `EntityClock` row exists for an entity, fall back to the current behavior (find latest operation's clock).

## Risks

| Risk                                                   | Severity | Mitigation                                                           |
| ------------------------------------------------------ | -------- | -------------------------------------------------------------------- |
| False acceptance (pruned key was genuinely concurrent) | Low      | Narrow race window; LWW resolution handles it if it happens          |
| Entity clock table grows large                         | Low      | One row per entity per user; entities are bounded by user's data     |
| Migration backfill is slow for large deployments       | Medium   | Run as background job; fallback to current behavior during migration |
| Asymmetric comparison must stay in sync with symmetric | Medium   | Both import from shared module; add integration tests                |

## Verification

1. Unit tests for `compareVectorClocksAsymmetric` covering:
   - Unpruned candidate vs authoritative (same as symmetric)
   - Pruned candidate missing authoritative keys (should accept, not CONCURRENT)
   - Genuinely concurrent modification (different keys higher on each side)
   - Candidate below MAX with missing keys (should be CONCURRENT, not accepted)
2. Integration test: simulate the sync loop scenario end-to-end
3. Existing `compareVectorClocks` tests continue passing (symmetric comparison unchanged)

## Relationship to Other Plans

- **Prerequisite:** None (can be implemented independently)
- **Superseded by:** [Server-Side Entity Versioning](./server-side-entity-versioning.md) makes this comparison logic secondary, but it remains useful as a fallback for offline scenarios
- **Related:** Current client-side fix (commit `f9be1c8500`) remains as defense-in-depth
