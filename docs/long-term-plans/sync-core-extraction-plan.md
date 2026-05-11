# `@sp/sync-core` Extraction Plan

> **Status: In progress - PR 1, PR 2 guardrails/logger adapter work, PR 3a
> vector-clock ownership, full-state op classification config, PR 3b pure
> helper slices, PR 4a port contracts, and the current PR 4b small
> orchestration/planning helper set are present on this branch. Remaining
> cleanup is targeted future `SyncLogger` routing for files as they move plus
> deciding whether PR 4c should extract any part of `OperationApplierService`.**

**Goal:** Carve the sync engine out of `src/app/op-log/` into a reusable,
framework-agnostic, **domain-agnostic** `@sp/sync-core` package, plus a sibling
`@sp/sync-providers` package for bundled provider implementations.

## Context

The sync frontend lives in `src/app/op-log/` (the older `src/app/pfapi/` is
legacy and out of scope). It already organizes itself by concern (`core`,
`sync`, `apply`, `capture`, `persistence`, `encryption`, `validation`, `util`,
`model`, `sync-providers`), but the boundary is convention-only: the engine
reaches into NgRx state, `core/entity-registry.ts` hardcodes imports from 15+
feature reducers, and providers and engine code intermix freely.

The eventual target is a **three-concern split**:

1. **Sync logic / engine** - operation orchestration, vector clocks, conflict
   resolution, persistence interfaces. Framework-agnostic and domain-agnostic.
2. **Configuration** - entity registry, model config, app-specific wiring,
   action-type enums, entity-type unions, repair payload shapes, provider lists.
   Lives in the app.
3. **Provider implementations** - SuperSync, Dropbox, WebDAV, LocalFile.
   Pluggable, and talking to the engine through stable interfaces.

## Domain Rule

Anything that names a Super Productivity domain object, enum value, or wire
convention belongs in the app, not in `@sp/sync-core`. The lib carries
`actionType` and `entityType` as plain `string`; the app narrows via
`Omit`-and-extend on top of the lib's generic `Operation`.

App-only forever:

- **`ActionType` enum** - host-app action catalog, not lib content.
- **`ENTITY_TYPES` / `EntityType` union** - TASK, PROJECT, TAG, METRIC, BOARD,
  etc. are SP's domain. Lib uses `string`; app narrows.
- **`SyncImportReason` union** - SP's specific import flows.
- **`RepairSummary`, `RepairPayload`** - SP's repair-output shape.
- **`WrappedFullStatePayload` + `extractFullStateFromPayload` +
  `assertValidFullStatePayload`** - the `appDataComplete` wrapper and the
  `['task','project','tag','globalConfig']` key-presence check are SP wire
  format.
- **`SyncProviderId`, `OAUTH_SYNC_PROVIDERS`, `REMOTE_FILE_CONTENT_PREFIX`,
  `PRIVATE_CFG_PREFIX`** - SP's bundled providers and SP-flavored storage
  prefixes.
- **`@sp/shared-schema`** - that package is SP-coupled today, so
  `@sp/sync-core` must not depend on it.

Where the lib needs host-specific enumerations, it exposes a factory or config
object and the app supplies values at composition time. The current LWW helper
factory is the model to follow.

## Recommendations From PR #7546 Review

These adjustments should happen before the extraction proceeds beyond the thin
first slice:

1. **Move boundary enforcement up.** Add ESLint/package-boundary checks in the
   next PR, not at the end. Once `packages/sync-core/` exists, accidental
   imports from Angular, NgRx, `src/app`, or `@sp/shared-schema` should fail
   immediately.
2. **Single-source vector-clock algorithms.** The client currently delegates
   comparison/merge/prune behavior to `@sp/shared-schema` for client/server
   parity. Before moving vector-clock code, pick one owner for
   compare/merge/prune and have the other package/server import or re-export it.
   Do not duplicate the algorithms.
3. **Treat full-state operation classification as configuration.** PR 1 keeps
   `OpType.SyncImport`, `OpType.BackupImport`, and `OpType.Repair` in the
   generic package for compatibility. Before the engine becomes reusable, make
   full-state operation classification configurable or explicitly document those
   op types as host-defined strings.
4. **Do not move `OperationApplierService` wholesale.** It currently coordinates
   NgRx bulk dispatch, hydration windows, archive side effects, and deferred
   local actions. Extract a small core replay contract/state machine first,
   leaving the Angular/SP choreography in the app until the port boundary has
   proven itself.
5. **Make logger metadata privacy-safe.** `CLAUDE.md` forbids logging user
   content into exportable logs. The `SyncLogger` port should make this explicit
   by accepting only safe, structured metadata and documenting that payloads/full
   entities must not be logged.
6. **Add package tests before moving algorithms.** `@sp/sync-core` can start
   with build-only checks, but PR 3a should first introduce the package test
   runner and then port algorithm specs.
7. **Keep provider extraction separate.** Do not let `@sp/sync-core` learn
   provider IDs, file prefixes, OAuth behavior, credential storage, or bundled
   provider lists.

## Current Branch Snapshot

The branch already contains the first package boundary and part of the PR 2
groundwork:

- `packages/sync-core/` exists and is exposed through the `@sp/sync-core` path
  alias.
- `npm run sync-core:build` runs the package build, and `prepare` builds
  `sync-core`, `shared-schema`, then `plugin-api`.
- `eslint.config.js` applies `no-restricted-imports` and a dynamic-import ban to
  `packages/sync-core/**/*.ts`.
- The package currently exports operation primitives, apply types, LWW helper
  factory, full-state op-type helper factory, entity-key helpers,
  host-configured sync-file prefix helpers, generic error-message helpers,
  `SyncStateCorruptedError`, entity-registry contracts, and the privacy-aware
  logger port.
- The app registry now has `buildEntityRegistry()` and an `ENTITY_REGISTRY`
  injection token. Existing helper functions still read the app-side
  `ENTITY_CONFIGS` singleton for compatibility.

Current extraction state and remaining immediate debt:

- Full-state operation classification is now host-configured via
  `createFullStateOpTypeHelpers()`. The SP-facing
  `src/app/op-log/core/operation.types.ts` shim instantiates its own
  `FULL_STATE_OP_TYPES` and `isFullStateOpType`; the package root keeps
  deprecated SP compatibility exports for existing consumers. `OpType.SyncImport`,
  `OpType.BackupImport`, and `OpType.Repair` remain in `@sp/sync-core` only as
  host-defined compatibility strings.
- Vector-clock compare/merge/prune now lives in `@sp/sync-core`, with
  `@sp/shared-schema` re-exporting it for existing client/server imports.
- `SyncLogger` exists, but movable app code still mostly calls `OpLog` directly.
- `@sp/sync-core` has a Vitest package test runner and vector-clock tests.
- Generic gzip/base64 compression helpers now live in
  `packages/sync-core/src/compression.ts`. The app-facing
  `src/app/op-log/encryption/compression-handler.ts` shim preserves
  `CompressError` / `DecompressError` wrapping and the default `OpLog` logger
  adapter.
- PR 3b has generic conflict helpers in
  `packages/sync-core/src/conflict-resolution.ts`: deep equality, identical
  conflict detection, conflict-resolution suggestion, entity frontier
  construction, clock-corruption comparison adjustment, pure LWW conflict
  resolution planning, and local-DELETE-loses-to-remote-UPDATE payload
  extraction/merge helpers. It also owns pure LWW resolution partitioning:
  local/remote winner counts, remote-winner ops after host processing,
  local-winner remote ops, rejected-op id buckets, local-win op collection, and
  remote-winner affected entity-key calculation. The Angular
  `ConflictResolutionService` delegates to these helpers while keeping app
  orchestration, IndexedDB/apply flow, entity lookup, NgRx, dev-error wiring,
  app action-type ownership, fallback logging, and operation creation app-side.
- PR 3b also has the pure full-state import vector-clock decision helper in
  `packages/sync-core/src/sync-import-filter.ts`. The Angular
  `SyncImportFilterService` still owns full-state operation classification,
  latest import lookup from batch/store, IndexedDB access, conflict-dialog
  signaling, and logging.
- `sync-errors.ts` now routes constructor diagnostics for additional-log
  errors, JSON parse failures, and validation failures through the
  privacy-aware `SyncLogger` adapter with safe metadata only. The error classes
  still stay app-side because their recovery wording, provider diagnostics, and
  `additionalLog` UI/reporting behavior are SP-specific.
- PR 4a is present with `packages/sync-core/src/ports.ts`. The package now
  exports minimal contracts for operation application, action dispatch,
  remote-apply windows, deferred local action flushing, archive side effects,
  and operation-store persistence. The existing Angular services satisfy those
  contracts app-side.
- PR 4b's current small helper set is present: remote-apply crash-safety
  ordering, upload last-server-sequence planning, full-state snapshot upload
  follow-up partitioning, download gap/full-state/encryption planning, and
  file-snapshot hydration skip planning. Provider calls, encryption/decryption,
  IndexedDB reads, UI, diagnostics, and result assembly remain app-side.

Suggested next order:

1. Finish PR 2 documentation and verification.
2. Continue targeted `SyncLogger` routing for files as they become movable.
3. Treat the PR 3b pure conflict-resolution and sync-import slices as complete
   for this round.
4. Treat the current PR 4a/4b port and small-helper slices as complete for this
   round; only revisit `OperationApplierService` under PR 4c after more
   verification.
5. Continue logger/config cleanup before moving app error classes; prefix
   parsing/formatting, generic error-message extraction, and generic
   compression helpers now have package-side helpers with app-owned diagnostics.
6. Defer provider extraction until core boundaries and PR 4c are settled.

## PR 1 - Thin First Slice (#7546)

Stand up `packages/sync-core/` with pieces that are framework-agnostic and
mostly domain-agnostic. No behavior change. Establishes the import boundary and
the `@sp/sync-core` alias so later PRs work against a real package boundary.

### Goals

- Create `packages/sync-core/` mirroring the existing package shape.
- Move only generic primitives and helpers.
- Move only framework-agnostic code: no `@Injectable`, no `inject()`, no NgRx,
  no Angular Material.
- Keep existing `src/app/op-log/` call sites working through stubs at the
  original paths.
- Keep `ActionType`, provider constants, full-state payload wrappers, repair
  payload shapes, and import reasons app-side.
- Avoid behavior changes.

### Current Contents

Source: `packages/sync-core/src/`. All exports come through `index.ts`.

**Operation primitives** (`operation.types.ts`):

- `OpType` enum.
- `Operation` with `actionType: string` and `entityType: string`.
- `OperationLogEntry`, `EntityConflict`, `ConflictResult`, `EntityChange`,
  `MultiEntityPayload`.
- `VectorClock = Record<string, number>`.
- `isMultiEntityPayload`, `extractActionPayload`.

**Full-state op-type helper factory** (`full-state-op-types.ts`):

- `createFullStateOpTypeHelpers<TOpType>(fullStateOpTypes)` returns the
  host-owned `FULL_STATE_OP_TYPES` set and `isFullStateOpType` predicate.
- The package keeps deprecated SP compatibility exports for
  `FULL_STATE_OP_TYPES` / `isFullStateOpType`, but reusable hosts should
  instantiate their own helper instead of using those defaults.

**LWW factory** (`lww-update-action-types.ts`):

- `createLwwUpdateActionTypeHelpers<TEntityType>(entityTypes)` returns
  `LWW_UPDATE_ACTION_TYPES`, `isLwwUpdateActionType`, `getLwwEntityType`, and
  `toLwwUpdateActionType`.
- The app instantiates it once with `ENTITY_TYPES`.

**Apply types** (`apply.types.ts`):

- `ApplyOperationsResult`, `ApplyOperationsOptions` over the lib's generic
  `Operation`.

**Utilities**:

- `toEntityKey`, `parseEntityKey`.
- `SyncStateCorruptedError`.

### App Stubs

Each previously-public symbol path keeps working via thin shims:

- `src/app/op-log/core/operation.types.ts` re-exports generic symbols and
  redeclares SP-narrowed `Operation`, `OperationLogEntry`, `EntityChange`,
  `EntityConflict`, `ConflictResult`, and `MultiEntityPayload`. It also
  instantiates `createFullStateOpTypeHelpers()` with SP's full-state op strings.
- `src/app/op-log/core/types/apply.types.ts` redeclares app-narrowed apply
  result/options types.
- `src/app/op-log/core/lww-update-action-types.ts` instantiates the LWW helper
  factory with `ENTITY_TYPES`.
- `src/app/op-log/core/sync-state-corrupted.error.ts` re-exports from the
  package.
- `src/app/op-log/util/entity-key.util.ts` delegates to the package while
  preserving the app's `EntityType`-narrowed API.
- `src/app/op-log/core/action-types.enum.ts` stays full source in the app.
- `src/app/op-log/sync-providers/provider.const.ts` stays full source in the app.

### PR 1 Follow-Ups Before Merge

- Update the PR description if it still says `action-types.enum.ts` or
  `provider.const.ts` moved into `@sp/sync-core`; the code correctly keeps them
  app-side.
- Fix comments that imply `sync-core` depends on `shared-schema`. The build may
  run after `shared-schema`, but the package dependency direction must remain
  absent.
- Resolved in follow-up: `FULL_STATE_OP_TYPES` is now app-configured via
  `createFullStateOpTypeHelpers()`.

### Verification

1. `cd packages/sync-core && npx tsup` - package builds clean.
2. `npx tsc -p src/tsconfig.app.json --noEmit` - app type-checks.
3. `npm run checkFile` on every touched `.ts` file.
4. `npm test` or scoped op-log specs.
5. App boot plus manual sync smoke: sync round-trip, conflict round-trip,
   encryption toggle.
6. SuperSync E2E when the branch is ready for merge.
7. Boundary check returns nothing:

   ```bash
   grep -r "from '@angular\\|from '@ngrx\\|from '@sp/shared-schema\\|src/app" packages/sync-core/src/
   ```

---

## PR 2 - Boundary Guardrails, Entity Registry Types, Logger Port

This replaces the original late ESLint PR. Boundary guardrails should land
immediately after the package exists.

### Goals

1. **Add package boundary enforcement.** Lint `packages/sync-core/**` and reject
   imports from Angular, NgRx, `src/app`, and `@sp/shared-schema`.
2. **Entity registry as config.** Move abstract registry types into
   `@sp/sync-core`; keep SP feature imports and registry construction in the app.
3. **Logger port.** Define a privacy-aware `SyncLogger` interface in
   `@sp/sync-core` so moveable files can drop direct `OpLog` imports.

### Current State

Already present:

- `eslint.config.js` has a `packages/sync-core/**/*.ts` override that rejects
  Angular, NgRx, `src/app`, `@sp/shared-schema`, relative `shared-schema`
  imports, and dynamic imports.
- `packages/sync-core/src/entity-registry.types.ts` defines structural
  `EntityConfig` / `EntityRegistry` contracts and helper predicates.
- `src/app/op-log/core/entity-registry.ts` builds the SP registry app-side,
  re-exports the core contracts, and provides `ENTITY_REGISTRY`.
- `SINGLETON_ENTITY_ID` remains app-side, which is correct while singleton
  entity IDs are still an SP replay convention.
- `packages/sync-core/src/sync-logger.ts` defines `SyncLogger`,
  `NOOP_SYNC_LOGGER`, `SyncLogMeta`, `SyncLogError`, and `toSyncLogError()`.
- `packages/sync-core/src/sync-file-prefix.ts` defines
  `createSyncFilePrefixHelpers()`. The app shim supplies
  `REMOTE_FILE_CONTENT_PREFIX` and `InvalidFilePrefixError`, keeping SP storage
  constants and diagnostics app-side while moving the generic parsing/formatting
  logic behind a config boundary.
- `packages/sync-core/src/error.util.ts` defines `extractErrorMessage()` for
  generic thrown-value message extraction. The app error module re-exports it
  for compatibility while keeping SP/provider-specific error classes app-side.
- `src/app/op-log/core/errors/sync-errors.ts` now sends constructor diagnostics
  through `SyncLogger` instead of direct raw `OpLog` calls. Logs retain IDs,
  counts, paths, error names, and key summaries, but not validation payloads,
  raw provider responses, JSON samples, or wrapped error messages.
- `src/app/op-log/core/sync-logger.adapter.ts` wires `SyncLogger` to `OpLog`
  via the app-side `SYNC_LOGGER` injection token and the
  `OP_LOG_SYNC_LOGGER` direct adapter.
- `EncryptAndCompressHandlerService` now accepts a `SyncLogger` constructor
  argument and uses the app adapter by default, proving the direct-constructor
  path for package-level classes without changing sync behavior.
- `op-log/encryption/compression-handler.ts` now routes compression failures
  through `SyncLogger` + `toSyncLogError()` and logs only safe length metadata.
- A deliberate bad-import check was run with a temporary
  `packages/sync-core/src/__boundary-check__.ts` importing `@angular/core`;
  `npm run lint:file -- packages/sync-core/src/__boundary-check__.ts` failed on
  `no-restricted-imports`, proving the boundary rule is active.

Remaining PR 2 follow-up:

- Keep the compatibility `ENTITY_CONFIGS` singleton until the port-contract PR,
  unless a small consumer migration is deliberately included as proof.
- Continue routing only files being moved or made movable through `SyncLogger`;
  do not do a broad `OpLog` refactor.
- Keep external PR text aligned with this document if the branch is split for
  review.

### Boundary Enforcement

- `eslint.config.js` already lints `packages/sync-core/**`.
- The package override already has `no-restricted-imports` for:
  - `@angular/*`
  - `@ngrx/*`
  - `@sp/shared-schema`
  - `src/app/*` and relative app imports such as `../../src/app/*`
- Keep package exceptions explicit for packages that cannot yet be linted.
- Add the same rule for `packages/sync-providers/**` once that package exists.
- The rule was proved with a temporary `@angular/core` import under
  `packages/sync-core/src/`; scoped lint failed as expected with
  `no-restricted-imports`, and the file was removed.

### Entity Registry Types

Define `EntityConfig` / `EntityRegistry` types in
`@sp/sync-core/src/entity-registry.types.ts`, but make the shape reflect the
current registry, not a simplified example.

Required storage patterns:

```ts
type EntityStoragePattern = 'adapter' | 'singleton' | 'map' | 'array' | 'virtual';
```

Guidelines:

- Registry keys are `string`; the app narrows them to `EntityType`.
- Selectors are structural function types; the package must not import NgRx
  selector types.
- Adapter support is structural, not `@ngrx/entity`-typed. Include only the
  methods actually consumed by op-log code.
- Include `payloadKey`, `featureName`, `mapKey`, and `arrayKey` if current
  consumers need them.
- Keep `SINGLETON_ENTITY_ID` generic if it remains engine-relevant; otherwise
  keep it in the app.

App-side state:

- `src/app/op-log/core/entity-registry.ts` already exposes
  `buildEntityRegistry()`.
- `ENTITY_REGISTRY` already exists as an app injection token.
- `ENTITY_CONFIGS` and helper functions still read a singleton registry for
  compatibility. Keep that until services are deliberately ported to injected
  registry dependencies, or migrate one low-risk consumer in PR 2 to prove the
  token works.
- Keep all feature reducer/selector imports in the app.

### Logger Port

Define `SyncLogger` in the lib:

```ts
export type SyncLogMeta = Record<string, string | number | boolean | null | undefined>;

export interface SyncLogError {
  name: string;
  code?: string | number;
}

export interface SyncLogger {
  log(message: string, meta?: SyncLogMeta): void;
  error(message: string, error?: SyncLogError, meta?: SyncLogMeta): void;
  err(message: string, error?: SyncLogError, meta?: SyncLogMeta): void;
  normal(message: string, meta?: SyncLogMeta): void;
  verbose(message: string, meta?: SyncLogMeta): void;
  info(message: string, meta?: SyncLogMeta): void;
  warn(message: string, meta?: SyncLogMeta): void;
  critical(message: string, meta?: SyncLogMeta): void;
  debug(message: string, meta?: SyncLogMeta): void;
}
```

Also provide `NOOP_SYNC_LOGGER` for tests and package defaults, plus
`toSyncLogError(error: unknown)` so adapters can preserve safe error identity
without passing arbitrary error objects into exportable logs.

Keep both `error()` and `err()` initially because current movable code uses both
`OpLog` spellings. If a follow-up PR normalizes calls to one spelling, do that
explicitly in the same PR instead of silently shrinking the port surface.

Privacy rule: logger metadata must not include full entities, operation payloads,
task titles, note text, raw provider responses, credentials, or encryption
material. IDs, counts, op IDs, action strings, entity types, and error names are
acceptable.

App-side follow-up:

- The app adapter lives in `src/app/op-log/core/sync-logger.adapter.ts` and
  satisfies `SyncLogger` by forwarding only the safe port arguments to `OpLog`.
- Angular services should inject `SYNC_LOGGER`; package-level pure functions and
  classes should receive a `SyncLogger` constructor/function argument.
- Convert only files being moved or made movable; a broad `OpLog` refactor is
  unnecessary and risks changing log behavior.

Initial candidate-file audit:

- `op-log/encryption/encrypt-and-compress-handler.service.ts`: safe prefix and
  flag metadata now goes through `SyncLogger`.
- `op-log/encryption/compression-handler.ts`: routes failures through
  `SyncLogger` and preserves only safe counts such as input length. The generic
  stream/base64 implementation now lives in `@sp/sync-core`; the app file is a
  compatibility shim that keeps SP error classes and the default `OpLog`
  adapter app-side.
- `op-log/core/errors/sync-errors.ts`: constructor diagnostics now route through
  `SyncLogger` with safe metadata only. Generic `extractErrorMessage()` lives in
  the package, but the error classes remain app-side because recovery messages,
  provider diagnostics, and `additionalLog` UI/reporting behavior are still
  SP-specific.
- `op-log/util/sync-file-prefix.ts`: now delegates to the package helper with
  app-supplied prefix and error construction. The app-facing shim should remain
  until consumers are deliberately switched to injected/configured helpers.

### What This Unlocks

After this PR, files blocked only by `OpLog` can move without creating a package
dependency on app logging:

- `op-log/encryption/`
- `op-log/core/errors/sync-errors.ts`
- `op-log/util/sync-file-prefix.ts`

### Verification

- `npm run lint` proves package boundary rules are active.
- Add and revert one deliberately-bad package import to prove the rule fails.
- `npm run sync-core:build` proves the new exported contracts build.
- `npm test` for registry-related specs.
- App boot + sync round-trip.
- Manual log export flow: sync/encryption events still appear and do not expose
  user content.

---

## PR 3a - Vector-Clock Ownership and Package Test Harness

Do this before moving more algorithms. Vector-clock parity is load-bearing for
sync correctness.

Status: implemented on this branch.

### Goals

1. Pick the single source of truth for vector-clock compare/merge/prune logic.
2. Add a package test runner for `@sp/sync-core`.
3. Port existing vector-clock tests before changing call sites.

### Preferred Direction

Decide the dependency direction before PR 3a moves code. The preferred outcome
is that `@sp/sync-core` owns generic vector-clock algorithms:

- `compareVectorClocks`
- `mergeVectorClocks`
- `limitVectorClockSize`
- `MAX_VECTOR_CLOCK_SIZE`
- validation/sanitization helpers if they are shared by client/server

This is acceptable only if current server/shared consumers can depend on
`@sp/sync-core` without creating a bad package direction or build cycle. In that
case, update build order so `sync-core` is available before those consumers, or
make the server consume `@sp/sync-core` directly.

If that dependency direction is awkward, create a tiny leaf package such as
`@sp/vector-clock` and have both `@sp/sync-core` and server/shared code consume
it. Do not make `@sp/sync-core` depend on `@sp/shared-schema`; the important
constraint is one implementation, not two copies.

### Current Locations

- Generic compare/merge/prune and `MAX_VECTOR_CLOCK_SIZE` live in
  `packages/sync-core/src/vector-clock.ts`.
- `packages/shared-schema/src/vector-clock.ts` is a compatibility re-export from
  `@sp/sync-core`.
- The client wrapper lives in `src/app/core/util/vector-clock.ts`; it adds
  null/undefined handling, sanitization, logging, and pruning notifications.
- Server sanitization and sync types live in
  `packages/super-sync-server/src/sync/sync.types.ts`; server conflict detection
  and storage pruning consume the shared algorithms.
- Existing vector-clock package tests live in
  `packages/sync-core/tests/vector-clock.spec.ts`. `shared-schema` keeps its
  existing compatibility coverage through the re-export.

PR 3a moved the algorithms and tests in one commit set to avoid client/server
drift.

### Test Harness

Implemented using the same Vitest shape as `packages/shared-schema`:

- `packages/sync-core/vitest.config.ts` with Node environment and
  `tests/**/*.spec.ts`.
- `test` and `test:watch` scripts in `packages/sync-core/package.json`.
- `vitest` as a `packages/sync-core` dev dependency.
- Root `sync-core:test` next to
  `sync-core:build`.
- `packages/shared-schema/tests/vector-clock.spec.ts` ported to
  `packages/sync-core/tests/vector-clock.spec.ts`.

### Server Build Fallout

Because `@sp/shared-schema` now depends on `@sp/sync-core`, all places that
currently copy, install, build, or pack only `shared-schema` must include
`sync-core` first:

- `packages/shared-schema/package.json` depends on `@sp/sync-core`.
- `package.json` and `packages/build-packages.js` build `sync-core` before
  `shared-schema`.
- `packages/super-sync-server/Dockerfile`.
- `packages/super-sync-server/Dockerfile.test`.
- Any CI workflow that installs only `packages/shared-schema` and
  `packages/super-sync-server`.

Keep `@sp/shared-schema` available to the server for schema/version/entity-type
contracts until those are separately decoupled.

### Migration Notes

- Preserve client null/undefined wrapper behavior exactly.
- Preserve `MAX_VECTOR_CLOCK_SIZE = 20`.
- Preserve server ordering: conflict detection first, pruning before storage.
- Replace the RxJS prune `Subject` with a callback/event hook at the package
  boundary.
- Route logging through `SyncLogger`.

### Verification

- `npm run sync-core:build`.
- `npm run sync-core:test` once the root script exists.
- `cd packages/shared-schema && npm test` if shared-schema keeps re-exporting or
  wrapping the moved algorithms.
- `cd packages/super-sync-server && npm test` for server parity.
- `npm run test:file src/app/core/util/vector-clock.spec.ts` for client wrapper
  behavior.
- Docker verification for the changed server image paths:
  `docker build -f packages/super-sync-server/Dockerfile.test .` at minimum, and
  `docker build -f packages/super-sync-server/Dockerfile .` before merge when
  image-build time is acceptable.
- Keep app wrapper specs for null/undefined handling, logging, sanitization, and
  import compatibility.
- Boundary grep stays empty for `packages/sync-core/src/`.

---

## PR 3b - Pure Algorithmic Core

Move framework-agnostic, stateless sync algorithms. These should only need typed
inputs and the logger port.

### Current State

- `deepEqual`, `isIdenticalConflict`, `suggestConflictResolution`,
  `buildEntityFrontier`, `adjustForClockCorruption`, and
  `planLwwConflictResolutions` live in `@sp/sync-core` with package-level
  Vitest coverage.
- `classifyOpAgainstSyncImport` lives in `@sp/sync-core` and owns only the
  vector-clock keep/invalidate decision for an op against the latest full-state
  import. It returns the raw comparison plus a reason so app logging stays
  unchanged.
- Local DELETE losing to remote UPDATE conversion now delegates to
  `extractEntityFromPayload`, `extractUpdateChanges`, and
  `convertLocalDeleteRemoteUpdatesToLww` in `@sp/sync-core`. The app supplies
  payload-key resolution, LWW action-type conversion, singleton-id handling,
  and fallback warning logging.
- `ConflictResolutionService` keeps compatibility wrappers/call sites and
  passes the app `SyncLogger` adapter into package helpers. It also supplies
  the app-owned archive action predicate to LWW planning and creates
  archive/local-win operations app-side.
- Pure remote/local operation partitioning now lives in `@sp/sync-core`;
  NgRx state lookup and operation creation stay in the app.
- `SyncImportFilterService` still owns full-state op detection, latest import
  selection from current batch/local store, IndexedDB access, local unsynced
  import detection, and all `OpLog` messages.
- Generic gzip/base64 compression helpers live in `@sp/sync-core` with
  package-level Vitest coverage. The app shim keeps `CompressError`,
  `DecompressError`, truncated-file recovery wording, and `OpLog` adapter
  defaults app-side.

### What Moves

- Conflict detection and LWW resolution algorithms from
  `op-log/sync/conflict-resolution.service.ts`.
- Filtering/partitioning helpers that operate on `OperationLogEntry[]`.
- Pure op merge helpers currently scattered across `remote-ops-processing.service.ts`
  and `operation-log-sync.service.ts`.
- Pure operation payload validation from `op-log/validation/`, as long as it
  does not import app schemas or NgRx selectors.
- Remaining encryption utilities once their app diagnostics and runtime
  dependencies are split. Generic compression is already package-side behind the
  `SyncLogger` port and host error factories.
- `sync-errors.ts` and `sync-file-prefix.ts` if they are generic after
  logger/config cleanup.

### What Stays App-Side

- Anything that calls `Store.dispatch()` or `Store.select()`.
- `OperationLogStoreService` and IndexedDB implementation details.
- UI services: dialogs, snacks, Angular Material.
- Effects, meta-reducers, and `LOCAL_ACTIONS` wiring.
- App schema validation tied to SP model shape.
- Full-state payload wrappers and SP repair payloads.

### Verification

- Package test suite for moved algorithms.
- Full app `npm test` for integration through stubs.
- Boundary grep stays empty.
- Manual sync round-trip, encryption toggle, and conflict scenario.

---

## PR 4a - Port Contracts Only

Introduce orchestration ports without moving the orchestrators yet. This reduces
the risk of the later service moves.

Status: implemented for the current branch slice. `@sp/sync-core` exports the
first minimal port contracts, and these app services now explicitly satisfy
them:

- `OperationApplierService` implements `OperationApplyPort<Operation>` and uses
  `ActionDispatchPort<SyncActionLike>` for its NgRx dispatch seam.
- `HydrationStateService` implements `RemoteApplyWindowPort`.
- `OperationLogEffects` implements `DeferredLocalActionsPort`.
- `ArchiveOperationHandler` implements `ArchiveSideEffectPort<PersistentAction>`.
- `OperationLogStoreService` implements
  `OperationStorePort<Operation, OperationLogEntry>`.

This is contract-only: NgRx dispatch, hydration windows, archive IndexedDB
handling, and deferred local action processing remain app-side.

App-side adapter specs now exercise the first port set through the sync-core
types:

- `OperationApplyPort` and `ActionDispatchPort` coverage in
  `operation-applier.service.spec.ts`, including action/meta identity, bulk
  operation reference preservation, dispatch-yield-before-archive ordering,
  remote cooldown/end-window/deferred flush ordering, and local hydration
  close-window/deferred flush behavior.
- `RemoteApplyWindowPort` coverage in `hydration-state.service.spec.ts`.
- `ArchiveSideEffectPort` coverage in
  `archive-operation-handler.service.spec.ts`.
- `DeferredLocalActionsPort` coverage in `operation-log.effects.spec.ts`.
- `OperationStorePort` coverage in `operation-log-store.service.spec.ts`.

### Ports

- `OperationStorePort` - abstract over op-log persistence. Method names use
  `Operation` / `OperationLogEntry` only.
- `ActionDispatchPort` - abstract over dispatching replay actions. Takes generic
  action objects and must preserve `meta` exactly.
- `RemoteApplyWindowPort` - abstracts `HydrationStateService` behavior: start
  remote apply, end remote apply, post-sync cooldown.
- `DeferredLocalActionsPort` - abstracts
  `OperationLogEffects.processDeferredActions()`.
- `ArchiveSideEffectPort` - abstracts archive-specific IndexedDB handling for
  remote operations.
- `ConflictUiPort` - app dialog/snack adapter. Reasons are strings at the
  package boundary.
- `SyncConfigPort` - app adapter around NgRx config selectors. Provider IDs are
  strings at the package boundary.
- `RepairPort` only if truly needed, and with generic shapes.

### Why Split This Out

`OperationApplierService` is not just replay logic. It currently coordinates:

- bulk NgRx dispatch,
- the required event-loop yield after dispatch,
- remote apply windows and cooldowns,
- archive side effects,
- `remoteArchiveDataApplied`,
- deferred local action processing.

Those behaviors should first be represented as ports and tested while the
service remains app-side.

### Verification

- Adapter specs prove app services satisfy the ports.
- Existing app sync specs still pass.
- Add contract tests for action `meta` preservation and bulk-dispatch yield
  behavior.

---

## PR 4b - Move Small Orchestration Units Behind Ports

Move only orchestration code whose dependencies are already represented by ports
and whose behavior can be tested without Angular.

Status: implemented for the current branch slice. `@sp/sync-core` now exports
`applyRemoteOperations()` plus the narrow `RemoteOperationApplyStorePort`.
`RemoteOpsProcessingService.applyNonConflictingOps()` delegates the generic
remote-apply crash-safety ordering to that coordinator:

1. append incoming remote ops as pending while atomically skipping duplicates;
2. apply only newly appended ops through `OperationApplyPort`;
3. mark applied seqs;
4. merge applied remote vector clocks;
5. clear older full-state ops after a newer applied full-state op lands;
6. mark the failed op and remaining unapplied ops as failed on partial apply
   errors.

The Angular service still owns app diagnostics, validation/session latching,
snack notifications, conflict detection, NgRx dispatch construction, and the
IndexedDB implementation.

The package also owns small upload-planning helpers used by
`OperationLogUploadService`:

- `planRegularOpsAfterFullStateUpload()` partitions regular ops into
  already-covered-by-snapshot vs still-needs-upload buckets after a full-state
  snapshot upload.
- `planUploadLastServerSeqUpdate()` keeps last-server-sequence persistence
  monotonic while preserving the "has more piggyback" follow-up download
  behavior.

Provider calls, encryption/decryption, snapshot upload, error handling, app
logging, and persistence remain app-side.

Download-side planning is also limited to pure decisions:

- `planDownloadGapReset()` allows one gap reset per download session.
- `planDownloadFullStateUpload()` decides when an empty remote needs a
  full-state upload and when the app should query synced-op history.
- `planDownloadedDataEncryptionState()` derives the "server has only
  unencrypted data" flag.
- `planSnapshotHydration()` decides when a file-based snapshot can be skipped
  because the local vector clock already equals or dominates the snapshot clock.

Provider pagination, snapshot handling, decryption, clock drift warnings,
IndexedDB reads, and result assembly remain app-side.

### Candidate Moves

- Upload batching/retry logic from `OperationLogUploadService` if provider and
  store access are ported.
- Remote op processing state machine if applying, marking, and validation are all
  ports.
- Pure parts of download/upload decision logic.

### Keep App-Side Until Proven Safe

- The Angular `OperationApplierService` shell.
- `bulkApplyOperations` action and meta-reducer wiring.
- `HydrationStateService` implementation.
- `ArchiveOperationHandler` implementation.
- Effects using `inject(LOCAL_ACTIONS)`.
- UI-coupled conflict/import/download services.

### Verification

- Package orchestration tests.
- App adapter tests.
- Full app unit tests.
- SuperSync scenarios focused on concurrency, fresh-client bootstrap, server
  migration, and import conflicts.

---

## PR 4c - Revisit `OperationApplierService`

Only after 4a/4b are stable, decide whether any part of
`OperationApplierService` belongs in `@sp/sync-core`.

Acceptable extraction:

- a small generic replay coordinator that calls ports in a strict order;
- contract tests for yielding, failure reporting, archive side-effect ordering,
  and deferred-action flush timing.

Likely app-side permanently:

- NgRx action construction and `bulkApplyOperations`,
- Angular `Injector` usage,
- `remoteArchiveDataApplied`,
- hydration-state implementation,
- archive handler implementation.

Hard requirements from `CLAUDE.md`:

- remote operations must not trigger normal effects;
- selector-based effects must remain guarded by the sync window;
- bulk dispatch must yield after the dispatch;
- remote archive side effects must still run;
- deferred local actions must be processed after remote apply finishes.

---

## PR 5 - Lift Providers Into `@sp/sync-providers`

Pull bundled providers out of `src/app/op-log/sync-providers/` so engine,
providers, and app wiring each live in their own package.

### What Moves

- `op-log/sync-providers/super-sync/`
- `op-log/sync-providers/file-based/dropbox/`
- `op-log/sync-providers/file-based/webdav/` including Nextcloud-specific code
- `op-log/sync-providers/file-based/local-file/`, with Electron APIs behind an
  app-provided port
- provider registry/factory logic that does not read NgRx state directly

### What Stays App-Side

- `SyncProviderId` and bundled provider lists.
- Credential-store Angular service implementation.
- OAuth callback routing.
- Provider config UI/dialogs.
- Electron bridge implementation.
- Any code reading `selectSyncConfig` directly.

### Provider Package Rules

- Provider IDs inside the package are string constants, not the app's
  `SyncProviderId` enum.
- Credential storage is an interface.
- HTTP should use `fetch` or an injected HTTP port, not Angular `HttpClient`.
- Provider package must not import `@sp/sync-core` internals beyond public
  ports/types.

### Verification

- Per-provider unit specs.
- E2E sync round-trip per provider: Dropbox, WebDAV, LocalFile, SuperSync.
- Fresh-client bootstrap for file-based providers.
- Electron-gated LocalFile path smoke test.

---

## PR 6 - Final Boundary Hardening

This is now a final audit rather than the first boundary rule.

### Goals

- Extend the boundary rules to `packages/sync-providers/**`.
- Audit package manifests for accidental runtime deps.
- Audit public exports for SP names and app-only concepts.
- Add a small architecture note that explains the package boundaries and allowed
  dependency direction.

### Verification

- `npm run lint`.
- Boundary grep for both packages.
- Package builds from a clean install.
- Full app unit tests and selected sync E2E.

---

## Summary Timeline

| PR     | Scope                                                      | Risk        | Notes                                  |
| ------ | ---------------------------------------------------------- | ----------- | -------------------------------------- |
| **1**  | Stand up `@sp/sync-core` with generic primitives and stubs | Low         | Present on branch                      |
| **2**  | Boundary lint, registry types, privacy-aware logger port   | Medium      | Groundwork present; finish follow-ups  |
| **3a** | Vector-clock ownership and package test harness            | Medium      | Present on branch                      |
| **3b** | Pure algorithmic core                                      | Medium      | No Angular/NgRx/IndexedDB              |
| **4a** | Port contracts only                                        | Medium      | Current slice present                  |
| **4b** | Move small orchestration units behind ports                | High        | Current slice present                  |
| **4c** | Revisit `OperationApplierService` extraction               | High        | Extract only if the boundary is proven |
| **5**  | Lift providers into `@sp/sync-providers`                   | Medium-High | Provider deps stay out of core         |
| **6**  | Final boundary hardening and architecture note             | Low         | Audit and lock down                    |

After the final PR, `@sp/sync-core` should be the domain-agnostic sync engine
and abstractions, `@sp/sync-providers` should contain bundled provider
implementations, and `src/app/op-log/` should contain SP-specific wiring: NgRx
adapters, dialog ports, entity-registry composition, `ActionType`, `EntityType`,
`SyncImportReason`, `SyncProviderId`, repair shapes, and full-state wire format.
