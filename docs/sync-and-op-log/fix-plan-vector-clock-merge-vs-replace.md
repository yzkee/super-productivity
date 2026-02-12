# Fix Plan: Vector Clock Merge-vs-Replace on Remote SYNC_IMPORT

## Bug Summary

When a client with an established vector clock (10+ entries) receives a remote
SYNC_IMPORT/BACKUP_IMPORT with a fresh clock (e.g., `{B_sUq7: 1}`),
`mergeRemoteOpClocks()` **merges** the import's clock into the old clock instead
of **replacing** it. This causes new ops to carry the old bloated clock, which
gets pruned by the server, dropping the import's entry. Other clients then see
these ops as CONCURRENT with the import and discard them.

## Root Cause Chain

1. `mergeRemoteOpClocks()` in `operation-log-store.service.ts:1307` always starts
   from `const mergedClock = { ...currentClock }` (the old clock) and merges on top
2. Result: old 10 entries + `B_sUq7:1` = 11 entries
3. Client creates new ops with 11-entry clock (no client-side pruning)
4. Server prunes to MAX_VECTOR_CLOCK_SIZE (10), dropping `B_sUq7:1` (lowest counter)
5. `SyncImportFilterService` on the importing client compares: op missing `B_sUq7` vs
   import `{B_sUq7:1}` → CONCURRENT → discarded
6. `isLikelyPruningArtifact` returns false because import clock has only 1 entry (< MAX)

## Fix

In `mergeRemoteOpClocks()` (`operation-log-store.service.ts`), when a full-state
op (SYNC_IMPORT / BACKUP_IMPORT / REPAIR) is among the ops being merged, **replace**
the local clock with the full-state op's clock instead of merging into the existing clock.

### Implementation

Modify `mergeRemoteOpClocks()` around line 1322:

```typescript
// Current (buggy):
const mergedClock = { ...currentClock };

// Fixed:
// If any op is a full-state operation, use its clock as the base (clean slate).
// Full-state ops replace the entire application state — old clock entries are
// irrelevant and cause bloat that leads to server-side pruning dropping the
// import's entry.
const fullStateOp = ops.find(
  (op) =>
    op.opType === OpType.SyncImport ||
    op.opType === OpType.BackupImport ||
    op.opType === OpType.Repair,
);
const mergedClock = fullStateOp ? { ...fullStateOp.vectorClock } : { ...currentClock };
```

Then merge remaining ops' clocks on top (the existing loop is fine — it will
merge any post-import ops in the same batch, and merging the full-state op's own
clock is a harmless no-op since it's already the base).

### Existing test to update

The test at `operation-log-store.service.spec.ts` line ~2099:
"should merge SYNC_IMPORT clock correctly (critical for filtering)"
currently expects `{clientA: 1, clientB: 5}` (merge behavior). Update to expect
`{clientA: 1}` (replace behavior).

Similarly, "should correctly merge clock from SYNC_IMPORT with complex existing clock"
at line ~2249 expects merged result. Update to expect only the import's clock entries.

### Files to modify

| File                                                             | Change                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/app/op-log/persistence/operation-log-store.service.ts`      | Modify `mergeRemoteOpClocks()` to replace clock for full-state ops |
| `src/app/op-log/persistence/operation-log-store.service.spec.ts` | Update existing SYNC_IMPORT merge tests to expect replace behavior |

### Failing tests that should pass after fix

| File                                  | Test                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `operation-log-store.service.spec.ts` | "should REPLACE (not merge) vector clock when receiving a full-state BACKUP_IMPORT"                                  |
| `operation-log-store.service.spec.ts` | "should ensure ops created after receiving BACKUP_IMPORT survive server-side pruning and remain GREATER_THAN import" |
| `import-sync.integration.spec.ts`     | "should reset vector clock when receiving SYNC_IMPORT, not merge into old clock"                                     |
| `import-sync.integration.spec.ts`     | "should produce post-import ops that are GREATER_THAN the import, not CONCURRENT"                                    |

### Risk assessment

**Confidence: 95%** this is the correct fix.

**Low risk**: The change only affects the code path where a full-state op is
received. Normal op merging is unchanged. Full-state ops are rare (only on
import/repair) and represent an explicit clean-slate reset.

**Edge case**: If the batch contains regular ops alongside the full-state op,
they will be merged on top of the full-state op's clock. This is correct because
post-import ops already have the import's client in their clocks.
