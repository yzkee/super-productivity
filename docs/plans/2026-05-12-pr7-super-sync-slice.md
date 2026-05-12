# PR 7 — SuperSync Slice (design doc)

> For Claude executing this: this is a **design doc for multi-review**, not a
> step-by-step implementation plan. Once the design choices below are
> ratified, rewrite as a TDD plan or execute in commits per the "Suggested
> commit shape" section.

**Goal.** Move the SuperSync provider (`super-sync.ts`,
`super-sync.model.ts`, and its co-located spec) into
`@sp/sync-providers`, behind the ports introduced for Dropbox + WebDAV
plus one new storage port and one new response-validator port. Leave
a thin app-side factory shim so `sync-providers.factory.ts` keeps
working unchanged. The four SuperSync-named app services
(`super-sync-status.service`, `super-sync-websocket.service`,
`super-sync-restore.service`, `supersync-encryption-toggle.service`)
stay app-side because they depend on Angular/NgRx wiring that doesn't
belong in the package.

**Status.** PR 5 has shipped slices 1-6 (scaffold, envelope types,
PKCE, native HTTP retry, error classes + Dropbox proper, WebDAV +
Nextcloud). This is slice 7 in the long-term plan, the second-to-last
provider lift. LocalFile remains as slice 8. See
`docs/long-term-plans/sync-core-extraction-plan.md` § "Remaining Slice
Plan" item 1 for surrounding context.

---

## What moves

### Source files

From `src/app/op-log/sync-providers/super-sync/` →
`packages/sync-providers/src/super-sync/`:

- `super-sync.ts` (692 lines) — provider class implementing
  `SyncProviderBase<SuperSync>`, `OperationSyncCapable<'superSyncOps'>`,
  `RestoreCapable`. Methods: `isReady`, `setPrivateCfg`,
  `clearAuthCredentials`, `uploadOps`, `downloadOps`,
  `getLastServerSeq`, `setLastServerSeq`, `uploadSnapshot`,
  `getRestorePoints`, `getStateAtSeq`, `getWebSocketParams`,
  `deleteAllData`, `getEncryptKey`. Private helpers: `_cfgOrError`,
  `_resolveBaseUrl`, `_getServerSeqKey`, `_checkHttpStatus`,
  `_extractServerErrorReason`, `_sanitizeToken`, `_getErrorMessage`,
  `_handleNativeRequestError`, `_fetchApi`, `_fetchApiCompressed`,
  `_fetchApiCompressedNative`, `_doWebFetch`, `_doNativeFetch`.
- `super-sync.model.ts` (17 lines) — `SuperSyncPrivateCfg` interface,
  `SUPER_SYNC_DEFAULT_BASE_URL` constant.
- `super-sync.spec.ts` (1553 lines, Jasmine → Vitest).

### Stays app-side

- `response-validators.ts` (130 lines) — imports
  `@sp/shared-schema`, which is banned in `packages/sync-providers/**`
  by ESLint. Becomes a `responseValidators` dep injected into the
  package class. See § "Response validators port" below.
- `response-validators.spec.ts` (288 lines) — stays with the
  validators.
- `src/app/op-log/sync/super-sync-status.service.ts` and its spec —
  NgRx-coupled status observable.
- `src/app/op-log/sync/super-sync-websocket.service.ts` and its spec
  — WebSocket connection + reconnection logic that touches NgRx
  state and uses Angular DI for `SuperSyncProvider`.
- `src/app/imex/sync/super-sync-restore.service.ts` and its spec —
  Restore-snapshot UI orchestration.
- `src/app/imex/sync/supersync-encryption-toggle.service.ts` and its
  spec — Encryption-toggle orchestration with dialog flows.
- `src/app/op-log/sync-providers/provider.const.ts`
  (`SyncProviderId.SuperSync`) — app keeps the enum for OAuth
  routing and config-UI dispatch; the package adds the string
  constant alongside.
- `src/app/op-log/sync-providers/sync-providers.factory.ts` — app
  composition. The `new SuperSyncProvider(extraPath)` line collapses
  to `createSuperSyncProvider(extraPath)`.

---

## Ports the package class needs

Five of these already exist (introduced by slices 5-6); two are new
to this slice.

### Already-introduced ports (reuse)

1. **`SyncLogger` (`@sp/sync-core`)** — replaces every `SyncLog.*`
   call. The app injects `OP_LOG_SYNC_LOGGER`.
2. **`ProviderPlatformInfo` (`@sp/sync-providers`)** — replaces
   `Capacitor.isNativePlatform() || IS_ANDROID_WEB_VIEW` at
   `super-sync.ts:82`. `isNativePlatform` is already the union
   (Capacitor native + Android WebView shim), so the package can read
   `deps.platformInfo.isNativePlatform` directly. The app injects
   `APP_PROVIDER_PLATFORM_INFO`.
3. **`NativeHttpExecutor` (`@sp/sync-providers`)** — backs
   `executeNativeRequestWithRetry`. Package imports the helper
   directly from the same package; the executor is injected via
   `deps.nativeHttpExecutor`. The app injects
   `(cfg) => CapacitorHttp.request(cfg)` (mirrors the Dropbox factory).
4. **`SyncCredentialStorePort` (`@sp/sync-providers`)** — replaces
   `new SyncCredentialStore(SyncProviderId.SuperSync)` at
   `super-sync.ts:73`. App injects a `SyncCredentialStore` instance.
5. **`WebFetchFactory` (`@sp/sync-providers`)** — **maybe optional**
   for SuperSync. The current web path uses `fetch` directly
   (`super-sync.ts:578`), which works on web and Electron without the
   iOS late-patching workaround that Dropbox needs (Dropbox uses the
   factory because iOS Capacitor patches `window.fetch` asynchronously
   and the provider is constructed before the patch lands). SuperSync
   is constructed at the same point in the lifecycle, so safer to
   adopt `WebFetchFactory` for consistency even if no current call
   site demonstrates the bug. **Recommendation: adopt it.** Open
   question 1 below.

### New ports (this slice)

6. **`SuperSyncResponseValidators` (new)** — see § "Response
   validators port" below.
7. **`SuperSyncStorage` (new, narrow)** — see § "Storage port for
   `lastServerSeq`" below.

---

## Response validators port

`super-sync.ts` calls six validators today:

```ts
import {
  validateOpUploadResponse,
  validateOpDownloadResponse,
  validateSnapshotUploadResponse,
  validateRestorePointsResponse,
  validateRestoreSnapshotResponse,
  validateDeleteAllDataResponse,
} from './response-validators';
```

Each takes `unknown` and returns the typed response (or throws
`InvalidDataSPError`). The validators use Zod-like `safeParse` against
schemas from `@sp/shared-schema` (`SuperSyncUploadOpsResponseSchema`,
`SuperSyncDownloadOpsResponseSchema`, etc.). The package can't import
`@sp/shared-schema` — that's a domain-coupled package banned by both
sync-core and sync-providers ESLint boundaries (justified in the
long-term plan's "Domain Rule" section).

### Why not move the schemas?

- Duplicating the schemas in `@sp/sync-providers` risks client/server
  drift, which the shared-schema package exists to prevent.
- Carving SuperSync schemas into a separate `@sp/super-sync-protocol`
  package is significant scope creep and would still need
  shared-schema for cross-cutting types.
- Relaxing the boundary to allow `@sp/shared-schema` in
  `@sp/sync-providers` violates the architectural rule that provider
  packages stay host-agnostic and reusable across hosts.

### Port shape

```ts
// packages/sync-providers/src/super-sync/response-validators.ts
import type {
  OpUploadResponse,
  SuperSyncOpDownloadResponse,
  SnapshotUploadResponse,
  RestorePointsResponse,
  RestoreSnapshotResponse,
} from '../provider.types';

export interface SuperSyncResponseValidators {
  validateOpUpload(data: unknown): OpUploadResponse;
  validateOpDownload(data: unknown): SuperSyncOpDownloadResponse;
  validateSnapshotUpload(data: unknown): SnapshotUploadResponse;
  validateRestorePoints(data: unknown): RestorePointsResponse;
  validateRestoreSnapshot(data: unknown): RestoreSnapshotResponse;
  validateDeleteAllData(data: unknown): { success: boolean };
}
```

Renaming `validateOpUploadResponse` → `validateOpUpload` etc. is
optional; the original names work, just verbose. Pick the form the
naming consensus prefers.

App-side `response-validators.ts` and its spec stay where they are;
they implement the port and are injected via `deps.responseValidators`.
The validators throw `InvalidDataSPError` (already a package error
class from PR 5a) — the package class catches nothing here, so the
error identity preservation just works via the re-export shim.

### `RestorePointType` narrowing

`provider.interface.ts:67` defines
`RestorePointType = 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR'` and
uses it to specialize `OperationSyncCapable`, `RestoreCapable`,
`RestorePoint`, `RestorePointsResponse`. The package types
(`provider.types.ts:144-197`) are generic on
`TRestorePointType extends string = string`. SuperSync's package
class can specialize on the app's narrow union by accepting it as a
type parameter, or stay generic and let the app shim narrow at the
boundary. Open question 2 below.

---

## Storage port for `lastServerSeq`

Three `localStorage` call sites in `super-sync.ts`:

- L183: `localStorage.getItem(key)` in `getLastServerSeq()`
- L189: `localStorage.setItem(key, String(seq))` in `setLastServerSeq()`
- L351: `localStorage.removeItem(key)` in `deleteAllData()`

The `_getServerSeqKey()` helper hashes
`${baseUrl}|${accessToken}` so different users on the same server get
separate sequence tracking. The cached key is invalidated in
`setPrivateCfg()` (L88) and never read off-thread, so caching is safe.

### Why a port

- The package's Vitest environment is Node by default; Node has no
  global `localStorage`. The WebDAV slice didn't need this because
  WebDAV's rev tracking lives in the encrypted file content, not in
  client-local storage.
- Direct `localStorage` access in a reusable provider package is a
  host-coupling smell — different hosts may want IndexedDB, an
  in-memory store, or a platform secure-storage API.

### Port shape — option A: narrow

```ts
export interface SuperSyncStorage {
  /** Returns null if the key is unset. */
  getLastServerSeq(key: string): number | null;
  setLastServerSeq(key: string, value: number): void;
  removeLastServerSeq(key: string): void;
}
```

Methods sync because `localStorage` is sync; if a host needs async,
they can return `Promise<...>` and the provider can `await` (though
that ripples). Three methods, no leakage of the storage backend.

### Port shape — option B: generic key-value

```ts
export interface KeyValueStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
```

Matches `localStorage`'s shape exactly; trivial Node test-double
(`{ map: new Map(), getItem: (k) => this.map.get(k) ?? null, … }`). The
package handles the `parseInt(stored, 10)` conversion itself, which
keeps the port host-agnostic.

**Recommendation: option B.** Three reasons:

1. Smaller port surface — the package owns the int conversion +
   the prefix constant (`super_sync_last_server_seq_`), keeping the
   storage adapter dumb.
2. Reusable for LocalFile slice if it needs key-value state.
3. Trivially backed by `localStorage` in the app
   (`{ getItem: (k) => localStorage.getItem(k), … }`) — no naming
   asymmetry.

Open question 3 below.

### App wiring

```ts
// In createSuperSyncProvider:
const APP_LOCAL_STORAGE: KeyValueStoragePort = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
};
```

Three lines, no Angular dependency. Could also be promoted into a
shared `src/app/util/local-storage-port.ts` if the LocalFile slice
adopts the same port.

---

## `isTransientNetworkError` — promote, port, or duplicate?

Two implementations exist today:

- **App-side broad-pattern version** at
  `src/app/op-log/sync/sync-error-utils.ts:96` — regex-pattern matching
  on the lowercased message string. Looks for `failed to fetch`,
  `network error`, `timeout`, `econnrefused`, etc., plus HTTP 500/502/
  503/504 status numbers. Two consumers:
  - `super-sync.ts:28` (the file moving in this slice).
  - `operation-log-upload.service.ts:31, 166` — uses it on a
    server-returned `result.error` string to decide whether to retry
    an upload (app-side service, not moving).
- **Package version** at
  `packages/sync-providers/src/http/native-http-retry.ts:136` —
  native-error-code-aware: checks `error.code === 'NSURLErrorDomain'`
  (iOS), `error.code === 'SocketTimeoutException' | 'UnknownHostException'
| 'ConnectException'` (Android), with a narrower message-string
  fallback. Designed specifically for the retry helper's catch-site.

The two have **different semantic surfaces**: the app version matches
broad textual patterns including HTTP status numbers and server
phrases ("transaction rolled back", "service unavailable"); the
package version matches native-platform error-code identifiers plus
a narrower English message fallback. They're not interchangeable.

### Options

1. **Promote the broad-pattern version into the package**, named
   `isTransientErrorMessage` (operates on string), keep the existing
   `isTransientNetworkError` (operates on `unknown`, checks `.code`).
   App `sync-error-utils.ts:96` re-exports the package version.
   `operation-log-upload.service.ts` keeps importing from
   `sync-error-utils`. SuperSync (in the package) imports
   `isTransientErrorMessage` directly.
2. **Inject as a predicate port** — `deps.isTransientError: (error:
unknown) => boolean`. App supplies the broad-pattern implementation.
   Pro: keeps the package free of duplicate string matching. Con:
   adds an eighth port for a one-call-site use, and the implementation
   is small enough that direct import is cleaner.
3. **Use the package's existing `isTransientNetworkError`** at the
   SuperSync call site. **Behavior change.** SuperSync would lose
   pattern matches for HTTP status numbers (500-504) and server
   phrases, gain native-error-code matches. Probably wouldn't
   regress anything in practice (SuperSync's native path goes
   through `executeNativeRequestWithRetry` which already uses the
   native-aware version), but it's a behavior change in a refactor
   slice.

**Recommendation: option 1.** Promotion is mechanical, two consumers
become one stable import path, no behavior change. Open question 4
below.

---

## Compression — direct `@sp/sync-core` import

`super-sync.ts:22-25` imports:

```ts
import {
  compressWithGzip,
  compressWithGzipToString,
} from '../../encryption/compression-handler';
```

`encryption/compression-handler.ts` is a thin shim around `@sp/sync-core`'s
`compressWithGzipCore` / `compressWithGzipToStringCore` that wraps any
thrown error in app-side `CompressError` (and `DecompressError` for
the inverse, though SuperSync doesn't decompress).

### Audit: does anyone catch `CompressError` from SuperSync's call sites?

Grep across `src/`:

```
$ grep -rn "CompressError\|DecompressError" src/ --include="*.ts"
```

`CompressError` appears in:

- `core/errors/sync-errors.ts` (definition + re-export shim)
- `encryption/compression-handler.ts` (factory call site)
- `encryption/compression-handler.spec.ts` (tests of the shim itself)

**No catch sites around SuperSync's compression call paths.** The
compression result is consumed by `_fetchApiCompressed` /
`_fetchApiCompressedNative` which let any thrown error bubble up
through `_doWebFetch` / `_doNativeFetch`'s generic `catch (error)`
clauses. No `instanceof CompressError` gate downstream.

### Recommendation

Import `compressWithGzip` and `compressWithGzipToString` directly
from `@sp/sync-core` in the package version. Drop the
`CompressError` wrapping for SuperSync's path — generic `Error`
propagation is observationally equivalent.

The app-side `compression-handler.ts` shim stays in place because it
still wraps `EncryptAndCompressHandlerService` and the
`compression-handler.spec.ts` tests cover the wrapping behavior for
that service's path. SuperSync just stops being one of its
consumers.

### Logger handling

The sync-core helpers take a `{ logger?: SyncLogger }` option. The
package's SuperSync class passes `this._deps.logger`, so failure
messages flow through the injected logger with the same privacy
contract.

---

## Provider ID constants

Add to the package alongside `PROVIDER_ID_DROPBOX` / `PROVIDER_ID_WEBDAV`:

```ts
export const PROVIDER_ID_SUPER_SYNC = 'SuperSync' as const;
```

Replace `SyncProviderId.SuperSync` reads inside the package with this
constant. App-side `super-sync.ts` factory shim uses the same type-
level `AssertSuperSyncId` conditional pattern as Dropbox:

```ts
type AssertSuperSyncId = SyncProviderId.SuperSync extends typeof PROVIDER_ID_SUPER_SYNC
  ? true
  : never;
```

so renames or drift fails at compile time without `as unknown as`
double-casts at runtime.

---

## Privacy sweep checklist

Same A1/A3/B3.x audit shape as the Dropbox and WebDAV slices, plus
SuperSync-specific sites surfaced from the file.

- **A1 — raw response bodies in logs.** SuperSync's structured logs
  use safe primitives (`opsCount`, `clientId`, `path`,
  `durationMs`, etc.); none directly logs raw `r.data` or
  `response.body`. But two sites embed the response body into a
  thrown `Error.message`:
  - `_doNativeFetch:646-648` builds
    `\`SuperSync API error: \${response.status} - \${errorData}\``where`errorData = JSON.stringify(response.data)`. The
`response.data`for sync endpoints contains user task/project
payloads on download, and server rejection details (which may
embed IDs/titles) on upload error responses. **Privacy
regression.** Use a fixed`\`HTTP \${response.status} \${response.statusText ?? ''}\``form, or strip via`urlPathOnly` — though the body is not a URL,
    so a fixed status-only message is the right call.
  - `_doWebFetch:582` similarly: `\`SuperSync API error: \${response.status}
    \${response.statusText} - \${errorText}\``. Same fix.
- **A3 — `SyncLog.error(..., e)` raw-error catches.**
  - `:265-269` logs raw `compressedPayload[0]` / `compressedPayload[1]`
    bytes when gzip magic mismatch is detected. Diagnostic, not user
    content — but verify the surrounding `Array.from(...slice(0, 10))`
    log line at `:263` doesn't ever embed payload content (it logs
    the first 10 _bytes_ of _compressed_ output, which is the gzip
    header — fine).
  - `_handleNativeRequestError` already extracts `errorMessage` as a
    string and logs via structured meta. Audit: the `errorMessage`
    can carry the response body if it was embedded earlier via the
    Error-throw sites above. Fixed by the A1 fix.
  - `_doWebFetch` catch at `:614-619` logs `error: (error as Error).message`
    — same A1 dependency.
- **B3.2 — `baseUrl` leak via URLs.** All log call sites use
  `path` (relative) consistently. The only exception: thrown
  `Error.message` (A1 again). After A1 fix, no leak.
- **B3.3 — `responseData` in error fields.** `AuthFailSPError` at
  `:412-413` is constructed with `(reason || ..., body)`. The
  `body` parameter on `AuthFailSPError` was scrubbed in PR 5b's
  Dropbox slice — verify it's still a "header-safe" arg or use
  `toSyncLogError(body)` to redact. (PR 5b dropped `responseData`
  retention from `AuthFailSPError` — re-read the package's class
  definition to confirm what gets stored.)
- **B3.4 — response shape leak via `Error.message`.** Covered by A1
  fix.
- **`_sanitizeToken` is not a log/error redaction utility.** It
  strips non-printable ASCII characters from the access token before
  setting the `Authorization` header — a UX fix for users who paste
  zero-width spaces. The original token is **not** sanitized in
  storage. This is fine, but confirms the package version doesn't
  accidentally "redact" the token by log-printing the sanitized
  form.

### New B3.5 — gzip diagnostic logging

`super-sync.ts:259-263` logs the first 10 bytes of compressed output
as hex when a magic-byte mismatch is detected. This is the gzip
header (`1f 8b 08 ...`), which is invariant — no user content. Keep
this diagnostic as is; pin it as a documented diagnostic boundary so
future changes don't accidentally widen it to log compressed body
content.

### Privacy invariants pinned

- **No response body in thrown `Error.message`.** Document on the
  package class JSDoc.
- **No response body in error class constructors.** Re-verify
  `AuthFailSPError` and `HttpNotOkAPIError` invariants survive the
  move.
- **No user content in `SyncLog` meta.** SuperSync already follows
  this; pin as comment.

---

## Spec migration scope

`super-sync.spec.ts` is 1553 lines, ~2× `dropbox-api.spec.ts` and
~3× `webdav-api.spec.ts`. The WebDAV slice's consensus decision was
to keep monolithic, with the reasoning that "splitting during
Jasmine→Vitest migration conflates two changes and balloons review
diff."

Top-level `describe` blocks (per `grep -n 'describe('`):

```
SuperSyncProvider                  L41
  properties                       L99
  isReady                          L117
  setPrivateCfg                    L155
  config loading                   L192
  getWebSocketParams               L228
  uploadOps                        L263
  downloadOps                      L368
  getLastServerSeq                 L453
  setLastServerSeq                 L484
  error handling                   L497
  authentication error handling    L579
  upload response with rejected ops L720
  server URL key generation        L888
  uploadSnapshot                   L977
  Native platform branching logic  L1210
  Request timeout handling         L1350
  Performance logging              L1419
  getEncryptKey                    L1477
```

Natural split lines if we did split:

- `super-sync-core.spec.ts` — properties, isReady, setPrivateCfg,
  config loading, getWebSocketParams, getLastServerSeq,
  setLastServerSeq, server URL key generation, getEncryptKey
  (~600 lines)
- `super-sync-ops.spec.ts` — uploadOps, downloadOps, upload response
  with rejected ops, uploadSnapshot (~750 lines)
- `super-sync-fetch.spec.ts` — error handling, authentication error
  handling, native platform branching logic, request timeout
  handling, performance logging (~600 lines)

### Recommendation

**Keep monolithic for the move, defer split to a follow-up.** Reasons:

1. WebDAV slice precedent (monolithic at 853 lines worked fine).
2. The Jasmine→Vitest conversion is itself a high-risk one-to-one
   port (`jasmine.SpyObj` → `vi.Mocked<…>`, `spyOn(...).and.returnValue`
   → `vi.spyOn(...).mockReturnValue`, `jasmine.Spy` → `vi.Mock`,
   etc.). Splitting concurrently would obscure conversion mistakes.
3. A future split commit can read cleanly against an already-green
   monolithic Vitest file.

Open question 5 below in case reviewers prefer the split now.

### Native-platform spec un-skip

`super-sync.spec.ts:1202-1303` currently uses a
`TestableSuperSyncProvider` subclass override pattern to swap the
`isNativePlatform` getter — same Jasmine workaround that the Dropbox
slice replaced. Under Vitest with the injected `platformInfo` +
`nativeHttpExecutor` mocks, this subclass goes away (mirrors Dropbox
slice un-skip). Spec count delta TBD on execution.

---

## Suggested commit shape

Following the Dropbox 5a/5b and WebDAV 6a/6b precedent: helper
promotion first, then the bulk move.

1. **`refactor(sync-providers): promote isTransientErrorMessage helper`**
   (PR 7a). Move the broad-pattern `isTransientNetworkError` from
   `src/app/op-log/sync/sync-error-utils.ts:96` into
   `packages/sync-providers/src/http/transient-error-message.ts`
   under the name `isTransientErrorMessage` (so it doesn't collide
   with the package's existing native-code-aware
   `isTransientNetworkError`). Re-export `isTransientErrorMessage`
   from the package barrel. App `sync-error-utils.ts` becomes a
   re-export shim under the original name for
   `operation-log-upload.service.ts` and the moving SuperSync
   import. No behavior change.
2. **`refactor(sync-providers): move SuperSync provider into package`**
   (PR 7b). The bulk move. `super-sync.ts`, `super-sync.model.ts`,
   and `super-sync.spec.ts` move into
   `packages/sync-providers/src/super-sync/`. Convert spec to
   Vitest. Add `PROVIDER_ID_SUPER_SYNC` constant. Replace
   `localStorage` direct access with the new `KeyValueStoragePort`.
   Add `SuperSyncResponseValidators` port. Switch compression to
   direct `@sp/sync-core` import. Apply privacy sweep findings
   inline. App-side `super-sync.ts` shrinks to a
   `createSuperSyncProvider(extraPath?: string)` factory function
   wiring `OP_LOG_SYNC_LOGGER`, `APP_PROVIDER_PLATFORM_INFO`,
   `APP_WEB_FETCH`, `SyncCredentialStore`, `CapacitorHttp.request`,
   `localStorage`, and the app's `response-validators` module into
   `SuperSyncDeps`. Delete `TestableSuperSyncProvider` subclass from
   the spec.

Each commit ships independently green: package tests + lint after
each. PR 7b is the big one (~3 source files moved, ~1550 LOC of
spec converted); split further if review feedback wants finer
bisects (e.g. into "port wiring + factory shim" + "file move +
spec conversion" — but this hurts bisectability for the bulk move,
which is already one logical change).

---

## Open questions for multi-review

1. **Adopt `WebFetchFactory` for SuperSync?** The current web path
   uses `fetch` directly. Dropbox adopted the factory specifically
   for iOS Capacitor's async-fetch-patching issue, which SuperSync
   may or may not hit at construction time. Adopt for consistency
   or defer? Architecture reviewer.
2. **`RestorePointType` narrowing.** Should the package `SuperSync`
   class be generic on `TRestorePointType extends string`, or
   specialize to the app's narrow union (would require the package
   to re-export a `SuperSyncRestorePointType` constant or accept
   the union as a type parameter)? Alternatives reviewer.
3. **Storage port — narrow `SuperSyncStorage` or generic
   `KeyValueStoragePort`?** Option A (narrow, 3 methods explicit) or
   B (generic, mirrors `localStorage`)? Simplicity reviewer.
4. **`isTransientNetworkError` — promotion, port, or use existing?**
   Three options laid out above. Performance + alternatives reviewers.
5. **Spec migration — monolithic or three-way split now?** WebDAV
   slice picked monolithic; this slice's spec is ~1.8× WebDAV's.
   Simplicity reviewer.
6. **Compression — direct sync-core import vs port.** Recommendation
   is direct import. Architecture reviewer to confirm no `CompressError`
   `instanceof` checks exist that would regress.
7. **Privacy A1 fix — fixed status message or scrubbed body?** Two
   thrown-Error sites (`_doNativeFetch:646-648` and `_doWebFetch:582`)
   embed response body in `Error.message`. Replace with fixed
   `\`HTTP \${status} \${statusText}\``, or keep some body content
   for debuggability and scrub via a custom truncate-and-redact
   helper? Security + simplicity reviewers.
8. **Factory shape — `createSuperSyncProvider(extraPath?: string)`
   or `createSuperSyncProvider()`?** SuperSync currently ignores
   `basePath` (constructor comment at L72 explicitly notes "basePath
   is ignored - SuperSync uses operation-based sync only"). Match
   the Dropbox/WebDAV factory signature for consistency, or drop the
   parameter? Alternatives reviewer.

---

## Verification gates

Before merging:

- `npm run sync-providers:test` — package specs green (expect ~+60-70
  new vitest specs after Jasmine port).
- `npm run sync-providers:build` — package builds. **Bundle size
  watch:** the handover estimates CJS goes from 75.77 KB to ~110+ KB
  with the 692-line SuperSync class. If it crosses a threshold a
  reviewer flags, raise it but don't address in this slice — tiered
  barrel split (`@sp/sync-providers/super-sync`,
  `/dropbox`, `/webdav`) is the established deferred item from the
  WebDAV slice.
- `npm run lint` — boundary lint clean.
- Targeted app specs:
  `super-sync-status.service.spec.ts`,
  `super-sync-websocket.service.spec.ts`,
  `super-sync-restore.service.spec.ts`,
  `supersync-encryption-toggle.service.spec.ts`,
  `response-validators.spec.ts`,
  `sync-wrapper.service.spec.ts`,
  `operation-log-upload.service.spec.ts` (to verify the
  `isTransientNetworkError` re-export shim path).
- Full `npm test` (two timezone variants per the WebDAV slice
  protocol).
- Full E2E (Playwright + SuperSync docker-compose per
  `e2e/CLAUDE.md`).
- Manual SuperSync round-trip:
  - Snapshot upload (initial, recovery, migration reasons).
  - Op upload (compressed payload, native vs web path).
  - Op download (paginated, with `excludeClient`, with `limit`).
  - Restore points fetch.
  - `getStateAtSeq` snapshot restore.
  - Encryption toggle flow (when `isEncryptionEnabled`, `getEncryptKey`
    returns the key; when disabled, returns `undefined`).
  - Auth failure path (401/403 → `AuthFailSPError`).
  - Server URL switching (account migration invalidates cached
    `lastServerSeq` key — verify `_cachedServerSeqKey` reset on
    `setPrivateCfg`).
  - Native-platform path on Android via WebView (binary body
    corruption — verify base64 gzip path still works).
  - iOS native (CapacitorHttp `_fetchApiCompressedNative` path).
- WebSocket reconnection smoke test (out of scope this slice, but
  verify `getWebSocketParams` still returns the right
  `{ baseUrl, accessToken }` shape).

---

## Not in scope this slice

- LocalFile provider move (slice 8).
- WebSocket service move (`super-sync-websocket.service.ts` stays
  app-side — NgRx-coupled and not relevant to the provider boundary).
- Status service move (`super-sync-status.service.ts` stays
  app-side).
- Restore service move (`super-sync-restore.service.ts` stays
  app-side — UI orchestration).
- Encryption toggle service move
  (`supersync-encryption-toggle.service.ts` stays app-side).
- Per-package barrel split
  (`@sp/sync-providers/super-sync`, etc.) — deferred to PR 7
  polish.
- `md5HashPromise` consumer migration in
  `local-file-sync-base.ts:178` — LocalFile slice.
- Removal of the legacy `SyncProviderId.SuperSync` enum value —
  app keeps the enum for OAuth routing and config-UI dispatch; the
  package adds the string constant alongside.
- `compression-handler.ts`'s app-side shim (still wraps
  `EncryptAndCompressHandlerService`; only SuperSync's call site
  moves to direct `@sp/sync-core` import).
- The performance reviewer's `getElementsByTagNameNS('*', name)`
  one-pass-childNodes-scan suggestion from the WebDAV slice —
  unrelated to SuperSync; tracked for a separate perf pass.

---

## Risks for the slice

- **Spec migration scope.** 1553 lines of Jasmine → Vitest is the
  largest single conversion in this PR series. Conversion mistakes
  could mask behavior regressions. Mitigations: spec-by-spec
  one-to-one porting, run package tests after each `describe`-block
  conversion if possible, no semantic changes during conversion
  (defer any "while we're here" simplifications).
- **Response shape coupling.** `response-validators.ts` stays
  app-side because of the `@sp/shared-schema` boundary. If a future
  schema change introduces a new field, both the package's response
  type (in `provider.types.ts`) and the app's validator (via
  `@sp/shared-schema`) need to update in lockstep. The port shape
  forces this contract to be explicit at the boundary.
- **Native compressed-body path.** Three CapacitorHttp call sites
  (`super-sync.ts:127, 229, 533`) route through
  `executeNativeRequestWithRetry` to dodge Android WebView's binary-
  body corruption and iOS WebKit's response-body bugs.
  `NativeHttpExecutor`'s `data: string` argument is the base64-gzip
  payload — verify the response shape (Capacitor returns
  base64-encoded binary on some platforms; the validators expect
  JSON-decoded objects) is correctly decoded. The current code
  already handles this via `response.data as T`, but verify the
  port adapter wires `CapacitorHttp.request` such that JSON-decoded
  bodies reach the validator.
- **Bundle size growth.** Per the handover, the package CJS bundle
  is likely to push past 110 KB with the 692-line class. Reviewer
  may flag — tiered barrel split is the documented remediation but
  out of scope this slice.
- **WebSocket integration boundary.** `SuperSyncWebSocketService`
  is app-side and reads from `SuperSyncProvider.getWebSocketParams()`.
  Audit the boundary — anything that needs to cross the package
  boundary should be a port, not a direct import. Currently
  `getWebSocketParams` returns plain
  `{ baseUrl: string; accessToken: string } | null` which is fine
  (no `SuperSyncProvider`-typed leakage).
- **OAuth / SP-account auth.** SuperSync's auth is SP-specific
  (JWT-based, custom server, not OAuth like Dropbox). The
  `FileSyncProvider.getAuthHelper` interface is not implemented by
  SuperSync — SuperSync auth is handled out-of-band via the
  jwt-login flow. Confirm no other consumers call
  `provider.getAuthHelper?.()` on a `SuperSyncProvider` instance and
  expect a value. If they do, the slice should expose a
  `getAuthHelper` returning a SuperSync-specific helper, but a
  grep across `src/` suggests this is not the case.

---

## Multi-review consensus

> _(To be filled in after parallel-reviewer pass. Follow the WebDAV
> slice template: gather decisions revised by review, decisions
> affirmed, new blockers, simplicity-driven scope reductions, and
> any minority dissents recorded explicitly.)_
