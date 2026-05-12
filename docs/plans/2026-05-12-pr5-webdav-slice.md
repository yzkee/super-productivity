# PR 5 — WebDAV + Nextcloud Slice (design doc)

> For Claude executing this: this is a **design doc for multi-review**, not a
> step-by-step implementation plan. Once the design choices below are
> ratified, rewrite as a TDD plan or execute in commits per the "Suggested
> commit shape" section.

**Goal.** Move the WebDAV + Nextcloud providers
(`webdav-base-provider.ts` + `webdav-api.ts` + `webdav-xml-parser.ts` +
`webdav-http-adapter.ts` + `webdav.ts` + `nextcloud.ts` + their
constants/models/specs) into `@sp/sync-providers`, behind the ports
introduced for Dropbox plus one new port for the Capacitor-registered
WebDAV HTTP plugin. Leave thin app-side factory shims so
`sync-providers.factory.ts` keeps working unchanged.

**Status.** PR 5 has shipped slices 1-5 (scaffold, envelope types,
PKCE, native HTTP retry, error classes + Dropbox proper). This is
slice 6 in commit terms / "next slice" per the remaining-slice plan.
See `docs/long-term-plans/sync-core-extraction-plan.md` § "Remaining
Slice Plan" item 1 for surrounding context.

---

## What moves

### Source files

From `src/app/op-log/sync-providers/file-based/webdav/` →
`packages/sync-providers/src/file-based/webdav/`:

- `webdav-base-provider.ts` (175 lines) — abstract provider
- `webdav-api.ts` (545 lines) — file ops, hash-based conditional
  uploads, directory creation queue
- `webdav-xml-parser.ts` (211 lines) — PROPFIND multistatus parsing
- `webdav-http-adapter.ts` (220 lines) — platform-routed HTTP +
  status mapping. **The wrinkle for this slice.**
- `webdav.const.ts` (39 lines) — methods, headers, status codes
- `webdav.model.ts` (10 lines) — `WebdavPrivateCfg`
- `webdav.ts` (15 lines) — standard `Webdav` provider class
- `nextcloud.ts` (80 lines) — Nextcloud subclass + URL builder
- `nextcloud.model.ts` (8 lines) — `NextcloudPrivateCfg`
- All co-located `.spec.ts` files (Jasmine → Vitest)

### Stays app-side

- `src/app/op-log/sync-providers/file-based/webdav/capacitor-webdav-http/`
  — Capacitor plugin registration. The `registerPlugin<WebDavHttpPlugin>('WebDavHttp', { web: ... })`
  call must remain in the app because `@capacitor/core` is banned from
  the package.
- `src/app/op-log/sync-providers/sync-providers.factory.ts` — app
  composition, wires the new factories.
- Provider IDs (`SyncProviderId.WebDAV`, `SyncProviderId.Nextcloud`)
  in `provider.const.ts`. Package uses string constants.

---

## New port: `WebDavNativeHttpExecutor`

### Why a separate port from `NativeHttpExecutor`

WebDAV cannot reuse the existing `NativeHttpExecutor`
(`packages/sync-providers/src/http/native-http-retry.ts`) verbatim:

- `NativeHttpExecutor` is shaped around `CapacitorHttp.request`,
  which auto-parses JSON, mishandles XML responses on Android/Koofr
  (empty bodies), and breaks WebDAV semantics on iOS. The whole
  reason the `WebDavHttp` Capacitor plugin exists is to bypass
  `CapacitorHttp` for WebDAV.
- WebDAV methods include `PROPFIND`, `MKCOL`, `MOVE`, `COPY`,
  `LOCK`, `UNLOCK` (see `webdav.const.ts`). `NativeHttpExecutor`'s
  type signature doesn't constrain methods, so this isn't strictly
  a blocker — but a dedicated port makes the divergent transport
  explicit.
- The current adapter does not retry on its own. WebDAV servers
  return 423 Locked, 412 Precondition Failed, 207 Multi-Status —
  retry behavior is different from Dropbox's idempotent file API.
  Slice 4's `executeNativeRequestWithRetry` policy (2 attempts,
  1s/2s, transient network only) doesn't map cleanly.

### Proposed shape

```ts
// packages/sync-providers/src/http/webdav-native-http.ts
export interface WebDavNativeHttpRequest {
  readonly url: string;
  readonly method: string; // includes PROPFIND, MKCOL, etc.
  readonly headers?: Readonly<Record<string, string>>;
  readonly data?: string | null;
}

export interface WebDavNativeHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly data: string; // always string, never parsed
}

export type WebDavNativeHttpExecutor = (
  req: WebDavNativeHttpRequest,
) => Promise<WebDavNativeHttpResponse>;
```

Callable type (matching the `WebFetchFactory` precedent from slice 5)
rather than `interface { request(): ... }`. One method, no state, no
reason for a class.

### App-side wiring

In `src/app/op-log/sync-providers/file-based/webdav/capacitor-webdav-http/`,
add an `APP_WEBDAV_NATIVE_HTTP` factory that returns:

```ts
export const APP_WEBDAV_NATIVE_HTTP: WebDavNativeHttpExecutor = async (req) => {
  const r = await WebDavHttp.request({
    url: req.url,
    method: req.method,
    headers: req.headers,
    data: req.data,
  });
  return {
    status: r.status,
    headers: r.headers ?? {},
    data: r.data ?? '',
  };
};
```

The plugin's `web: () => import('./web').then(...)` fallback already
covers browsers; on Electron the same fallback works because
`Capacitor.isNativePlatform()` is `false`. The factory shim decides
whether to call the executor (`isNativePlatform`) or `fetch` directly,
mirroring the existing adapter behavior.

Package-side `WebDavHttpAdapter` becomes:

```ts
constructor(
  private readonly deps: {
    readonly platformInfo: ProviderPlatformInfo;
    readonly webFetch: WebFetchFactory;
    readonly nativeHttp: WebDavNativeHttpExecutor;
    readonly logger: SyncLogger;
  },
) {}
```

(Naming TBD — see open question 1 below.)

### Inline `registerPlugin` duplication

`webdav-http-adapter.ts` lines 13-31 currently registers `WebDavHttp`
inline, **and** `capacitor-webdav-http/index.ts` registers it again
with the same plugin name. Capacitor's `registerPlugin` is idempotent
by name, so this works today but is dead duplication. The slice
should drop the inline registration in the adapter and keep only the
subfolder's registration, which the app-side
`APP_WEBDAV_NATIVE_HTTP` factory will reference.

---

## Other moves

### `md5HashSync` → `hash-wasm`

`webdav-api.ts:14, 28` is the only non-spec consumer of
`md5HashSync` (`src/app/util/md5-hash.ts`, which wraps `spark-md5`).
`local-file-sync-base.ts:178` uses `md5HashPromise` — out of scope
this slice but track it for the LocalFile slice.

`hash-wasm` is already a package runtime dep (used by PKCE on
non-WebCrypto platforms — `packages/sync-providers/src/pkce.ts`).
It provides `md5(data)` returning a hex `Promise<string>`. Two
choices:

1. **Async hash in the package.** Switch
   `WebdavApi._computeContentHash` to `async` and adopt `hash-wasm`'s
   `md5`. All call sites already `await` the API; the change
   ripples through `getFileRev`, `uploadFile`, hash-based
   conditional upload. Pro: drops the `spark-md5` dep at the package
   boundary; aligns with the existing `hash-wasm` usage. Con: API
   shape change touches ~5 spec call sites.
2. **Sync hash via injected port.** Add an `Md5HashSync` port
   alongside the other deps; the app injects `spark-md5` wrapper,
   the package stays sync. Pro: minimal call-site churn. Con: yet
   another port, and `hash-wasm`'s `md5` is async-only.

**Recommendation: option 1.** Async ripples are mechanical, and
removing `spark-md5` from the package surface is worth it. (Open
question 2 — see below.)

### `errorMeta` / `urlPathOnly` promotion

Currently in
`packages/sync-providers/src/file-based/dropbox/dropbox-api.ts:88-104`.
Move to `packages/sync-providers/src/log/error-meta.ts` so WebDAV
can adopt them without copy-paste. This is the heads-up flagged at
the end of the Fifth Slice summary. Should land as **PR 6a** before
or alongside the WebDAV move.

### Provider ID constants

Add to the package alongside `PROVIDER_ID_DROPBOX`:

```ts
export const PROVIDER_ID_WEBDAV = 'WebDAV' as const;
export const PROVIDER_ID_NEXTCLOUD = 'Nextcloud' as const;
```

Replace `SyncProviderId.WebDAV` / `SyncProviderId.Nextcloud` reads
inside the package with these. The app composes
`SyncProviderId.WebDAV === PROVIDER_ID_WEBDAV` at type level via the
same `AssertWebdavId` / `AssertNextcloudId` conditional type pattern
used for Dropbox.

### Nextcloud's `as unknown as` casts

`nextcloud.ts:19, 25` and `nextcloud.ts:46, 77` use
`SyncProviderId.Nextcloud as unknown as SyncProviderId.WebDAV`
because `WebdavBaseProvider` is generic on `T extends
SyncProviderId.WebDAV`. After the move, the package's generic
parameter becomes `T extends typeof PROVIDER_ID_WEBDAV`, but
Nextcloud's id is `PROVIDER_ID_NEXTCLOUD`. The double-cast is
load-bearing for credential separation today.

Two options here:

1. **Keep the double-cast pattern in the package.** Direct port,
   preserves runtime behavior, but the package's strict tsconfig
   already bans `as unknown as` in two places — verify whether the
   lint rule passes.
2. **Widen the generic** to `T extends typeof PROVIDER_ID_WEBDAV |
typeof PROVIDER_ID_NEXTCLOUD` and drop the casts. Better typed,
   one extra union member. Probably the right call.

**Recommendation: option 2.** (Open question 3.)

---

## Privacy sweep checklist

Apply the same A1/A3/B3.x audit that ran during the Dropbox slice:

- **A1 — raw response bodies in logs.** Grep
  `SyncLog.(critical|error|warn|log).*r\.data\|response\.data` in
  webdav files. Replace with structured `toSyncLogError(e)` + curated
  `SyncLogMeta`.
- **A3 — `SyncLog.critical(..., e)` raw-error logs.** Every
  catch-site needs `toSyncLogError(e)` instead. Initial grep target:
  `webdav-api.ts`, `webdav-base-provider.ts`, `webdav-http-adapter.ts`.
- **B3.1 — bearer-token / `Authorization` header leaks.** Already
  fixed by PR 5a's `TooManyRequestsAPIError` narrowing. Re-verify the
  webdav-http-adapter catch path doesn't construct
  `HttpNotOkAPIError(response, body)` with anything containing the
  `Authorization` header. (Spot check: `_checkHttpStatus` passes
  `body` for the generic non-2xx case — confirm `body` never
  contains the request header echo.)
- **B3.2 — `basePath` leaked into error paths.** WebDAV's
  `_buildFullPath(cfg.baseUrl, dirPath)` is used as the URL **and**
  in error construction. Audit: any error class receiving the full
  URL should receive the relative `targetPath` (or
  host-scrubbed URL). `RemoteFileNotFoundAPIError(url)` at
  webdav-http-adapter.ts:162 is the prime suspect.
- **B3.3 — `responseData` carried in error fields.** Audit error
  constructors for raw response payload fields, mirroring the
  Dropbox `AuthFailSPError` fix.

Add the privacy sweep findings to the slice's PR description so the
multi-review has the same checklist material the Dropbox slice had.

---

## Suggested commit shape

Three commits:

1. **`refactor(sync-providers): promote shared log helpers`** —
   Move `errorMeta(e, extra)` and `urlPathOnly(url)` from
   `dropbox-api.ts` into `packages/sync-providers/src/log/error-meta.ts`.
   Re-export from the package barrel; update Dropbox imports. No
   behavior change.
2. **`refactor(sync-providers): add WebDavNativeHttpExecutor port`** —
   Introduce the port type in
   `packages/sync-providers/src/http/webdav-native-http.ts`. Add the
   app-side `APP_WEBDAV_NATIVE_HTTP` factory wired to the existing
   `capacitor-webdav-http/` plugin registration. No provider move
   yet; this commit exists in isolation so the port surface gets its
   own review focus.
3. **`refactor(sync-providers): move WebDAV provider into package`** —
   The bulk move. Files listed above. Convert specs to Vitest.
   Replace `SyncProviderId.WebDAV` / `.Nextcloud` with package
   constants. Switch `md5HashSync` to `hash-wasm`. Apply the
   privacy sweep findings inline. Replace the
   `WebdavBaseProvider`'s direct `WebDavHttpAdapter` instantiation
   with constructor-injected deps. App-side
   `webdav.ts` / `nextcloud.ts` shrink to
   `createWebdavProvider(deps)` / `createNextcloudProvider(deps)`
   factory functions called from `sync-providers.factory.ts`. Drop
   the inline `registerPlugin` from the moved adapter (the
   subfolder registration is canonical).

Each commit ships independently green: package tests + lint after
each. The third commit is the big one (~12 source files, ~5 spec
files, ~1500 LOC); split further if review feedback wants finer
bisects.

---

## Open questions for multi-review

1. **Port naming.** `WebDavNativeHttpExecutor` is consistent with
   `NativeHttpExecutor` but verbose. Alternatives:
   `WebDavHttpTransport`, `WebDavRequestExecutor`. Architecture
   reviewer to pick.
2. **`md5HashSync` strategy.** Async via `hash-wasm` (option 1
   above) vs sync via injected port (option 2). Performance
   reviewer to weigh in — hashing a 1-2 MB sync file ~10x per
   upload could matter.
3. **Nextcloud generic parameter.** Keep `as unknown as` casts or
   widen the package generic to a union. Simplicity reviewer to
   call.
4. **Inline `registerPlugin` cleanup.** Drop in this slice or defer
   to a follow-up. Alternatives reviewer to flag scope creep.
5. **CORS detection heuristic.** `webdav-http-adapter.ts:180-219`
   uses a string-match heuristic on `error.message`. The
   "ambiguous network error" log path also leaks the raw error.
   Should the slice tighten this (use structured meta only) or
   defer? Security reviewer to flag.
6. **`WebDavHttpAdapter` retry policy.** Currently no retries.
   Should the slice add the same 2-attempt / 1s+2s policy that
   Dropbox uses, or preserve "no retry" behavior? Performance +
   alternatives reviewers to call.
7. **Test infrastructure for native-routed specs.** Dropbox slice
   un-skipped 33 native specs under Vitest using the injected
   executor mock. WebDAV's specs currently use a `TestableWebDavHttpAdapter`
   subclass override pattern (similar to Dropbox pre-slice 5).
   Plan to delete that and inject `platformInfo` + `nativeHttp`
   mocks instead — confirm spec count delta.
8. **Spec migration scope.** `webdav-api.spec.ts` is 853 lines.
   Worth splitting into a few smaller files during the move, or
   keep monolithic to minimize review diff? Simplicity reviewer.

---

## Verification gates

Before merging:

- `npm run sync-providers:test` — package specs green
- `npm run sync-providers:build` — package builds, expect bundle
  growth (~+15-20 KB ESM)
- `npm run lint` — boundary lint clean
- Targeted app specs: `webdav-base-provider.spec.ts`,
  `webdav-api.spec.ts`, `webdav-http-adapter.spec.ts`,
  `webdav-xml-parser.spec.ts`, `sync-wrapper.spec.ts`,
  `file-based-sync-adapter.spec.ts`, identity spec
- Full `npm test`
- Full E2E
- Manual round-trip: WebDAV against a real Nextcloud, hash-based
  conditional upload (PUT with `If-Match` rev), 412 conflict path,
  401 reauth path, 404 fresh-client bootstrap

---

## Not in scope this slice

- SuperSync provider move (slice 7)
- LocalFile provider move (slice 8)
- `md5HashPromise` consumer migration in
  `local-file-sync-base.ts` — out of scope until LocalFile slice
- Per-package barrel split
  (`@sp/sync-providers/dropbox`, `/webdav`, ...) — deferred to
  PR 7 polish; the single barrel is still fine bundle-size-wise
- Removal of the legacy `SyncProviderId.WebDAV` /
  `.Nextcloud` enum values — app keeps the enum for OAuth routing
  and config-UI dispatch; the package only adds the string
  constants alongside
