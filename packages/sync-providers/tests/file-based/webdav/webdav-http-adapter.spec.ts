import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';
import { WebDavHttpAdapter } from '../../../src/file-based/webdav/webdav-http-adapter';
import {
  AuthFailSPError,
  HttpNotOkAPIError,
  PotentialCorsError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
} from '../../../src/errors';
import type { NativeHttpExecutor } from '../../../src/http/native-http-retry';
import type { ProviderPlatformInfo } from '../../../src/platform/provider-platform-info';
import type { WebFetchFactory } from '../../../src/platform/web-fetch-factory';

const makeDeps = (overrides: {
  isNativePlatform?: boolean;
  fetchImpl?: typeof fetch;
  nativeHttp?: NativeHttpExecutor;
  logger?: SyncLogger;
}): {
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  nativeHttp: NativeHttpExecutor;
  logger: SyncLogger;
} => ({
  platformInfo: {
    isNativePlatform: overrides.isNativePlatform ?? false,
    isAndroidWebView: false,
    isIosNative: false,
  },
  webFetch: () => overrides.fetchImpl ?? (globalThis.fetch as typeof fetch),
  nativeHttp: overrides.nativeHttp ?? vi.fn(),
  logger: overrides.logger ?? NOOP_SYNC_LOGGER,
});

const okFetchResponse = (status = 200, body = 'ok'): Response =>
  new Response(body, { status });

describe('WebDavHttpAdapter', () => {
  describe('routing', () => {
    it('uses native executor when isNativePlatform', async () => {
      const nativeHttp = vi.fn().mockResolvedValue({
        status: 200,
        headers: { etag: 'x' },
        data: 'native-body',
      });
      const adapter = new WebDavHttpAdapter(
        makeDeps({ isNativePlatform: true, nativeHttp }),
      );

      const r = await adapter.request({
        url: 'https://dav.example.com/sync/file',
        method: 'GET',
      });

      expect(r.data).toBe('native-body');
      expect(nativeHttp).toHaveBeenCalledTimes(1);
      expect(nativeHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://dav.example.com/sync/file',
          method: 'GET',
          responseType: 'text',
        }),
      );
    });

    it('uses fetch when not native', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse(200, 'web-body'));
      const adapter = new WebDavHttpAdapter(
        makeDeps({
          isNativePlatform: false,
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      );

      const r = await adapter.request({
        url: 'https://dav.example.com/sync/file',
        method: 'PROPFIND',
        body: '<propfind/>',
      });

      expect(r.data).toBe('web-body');
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledWith(
        'https://dav.example.com/sync/file',
        expect.objectContaining({ method: 'PROPFIND', cache: 'no-store' }),
      );
    });
  });

  describe('status mapping', () => {
    it('throws AuthFailSPError on 401', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse(401, ''));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      await expect(
        adapter.request({ url: 'https://dav.example.com/x', method: 'GET' }),
      ).rejects.toBeInstanceOf(AuthFailSPError);
    });

    it('throws RemoteFileNotFoundAPIError on 404', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse(404, ''));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      await expect(
        adapter.request({ url: 'https://dav.example.com/x', method: 'GET' }),
      ).rejects.toBeInstanceOf(RemoteFileNotFoundAPIError);
    });

    it('throws TooManyRequestsAPIError on 429', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse(429, ''));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      await expect(
        adapter.request({ url: 'https://dav.example.com/x', method: 'GET' }),
      ).rejects.toBeInstanceOf(TooManyRequestsAPIError);
    });

    it('throws HttpNotOkAPIError on generic 5xx', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse(500, 'boom'));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      await expect(
        adapter.request({ url: 'https://dav.example.com/x', method: 'GET' }),
      ).rejects.toBeInstanceOf(HttpNotOkAPIError);
    });

    it('lets 304 Not Modified pass through (native path)', async () => {
      // Use the native path: Node's Response constructor rejects 304, but the
      // native executor produces its response shape directly.
      const nativeHttp = vi.fn().mockResolvedValue({
        status: 304,
        headers: {},
        data: '',
      });
      const adapter = new WebDavHttpAdapter(
        makeDeps({ isNativePlatform: true, nativeHttp }),
      );
      const r = await adapter.request({
        url: 'https://dav.example.com/x',
        method: 'GET',
      });
      expect(r.status).toBe(304);
    });
  });

  describe('CORS heuristic (tightened)', () => {
    it('throws PotentialCorsError only when message mentions "cors"', async () => {
      const fetchImpl = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch: cors policy denied'));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      await expect(
        adapter.request({ url: 'https://dav.example.com/x', method: 'GET' }),
      ).rejects.toBeInstanceOf(PotentialCorsError);
    });

    it('does NOT treat plain "Failed to fetch" as CORS (was the false positive)', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch }),
      );
      // Tightened: a plain network failure now bubbles up as HttpNotOkAPIError
      // (via the outer catch), not as PotentialCorsError.
      await expect(
        adapter.request({ url: 'https://dav.example.com/x', method: 'GET' }),
      ).rejects.toBeInstanceOf(HttpNotOkAPIError);
    });
  });

  describe('privacy', () => {
    let loggedMessages: Array<{ msg: string; meta?: unknown }>;
    let logger: SyncLogger;

    beforeEach(() => {
      loggedMessages = [];
      logger = {
        ...NOOP_SYNC_LOGGER,
        normal: (msg, meta) => loggedMessages.push({ msg, meta }),
        critical: (msg, meta) => loggedMessages.push({ msg, meta }),
      };
    });

    it('scrubs the URL to host+pathname in normal request logs', async () => {
      const fetchImpl = vi.fn().mockResolvedValue(okFetchResponse(200, 'ok'));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch, logger }),
      );

      await adapter.request({
        url: 'https://user:pass@dav.example.com/sync/file?token=secret',
        method: 'GET',
      });

      // urlPathOnly strips userinfo, query, fragment
      const meta = loggedMessages[0]?.meta as { url?: string };
      expect(meta?.url).toBe('dav.example.com/sync/file');
      expect(JSON.stringify(loggedMessages)).not.toContain('secret');
      expect(JSON.stringify(loggedMessages)).not.toContain('user:pass');
    });

    it('logs structured errorMeta on unexpected error (no raw Error)', async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new Error('boom-url-leak'));
      const adapter = new WebDavHttpAdapter(
        makeDeps({ fetchImpl: fetchImpl as unknown as typeof fetch, logger }),
      );

      await expect(
        adapter.request({
          url: 'https://dav.example.com/sync/file',
          method: 'GET',
        }),
      ).rejects.toBeInstanceOf(HttpNotOkAPIError);

      const errorLog = loggedMessages.find((l) => l.msg.includes('error'));
      expect(errorLog).toBeTruthy();
      // No raw error object in meta — only safe primitives
      expect(JSON.stringify(errorLog?.meta)).not.toContain('boom-url-leak');
      expect(errorLog?.meta).toEqual(
        expect.objectContaining({
          errorName: 'Error',
          url: 'dav.example.com/sync/file',
        }),
      );
    });
  });
});
