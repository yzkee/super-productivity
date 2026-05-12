import type { SyncLogger } from '@sp/sync-core';
import type { ProviderPlatformInfo } from '../../platform/provider-platform-info';
import type { WebFetchFactory } from '../../platform/web-fetch-factory';
import type { NativeHttpExecutor } from '../../http/native-http-retry';
import {
  AuthFailSPError,
  HttpNotOkAPIError,
  PotentialCorsError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
} from '../../errors';
import { errorMeta, urlPathOnly } from '../../log/error-meta';
import { WebDavHttpStatus } from './webdav.const';

export interface WebDavHttpRequest {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
}

export interface WebDavHttpResponse {
  status: number;
  headers: Record<string, string>;
  data: string;
}

export interface WebDavHttpAdapterDeps {
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  /**
   * Native HTTP path for WebDAV. On Capacitor platforms this is wired to the
   * app-side `WebDavHttp` plugin (which bypasses `CapacitorHttp`'s JSON
   * auto-parse / empty-body bugs on Android/iOS). On web/Electron it can
   * point at the same `fetch`-wrapping executor; the adapter selects the
   * native path only when `platformInfo.isNativePlatform` is true.
   */
  nativeHttp: NativeHttpExecutor;
  logger: SyncLogger;
}

export class WebDavHttpAdapter {
  private static readonly L = 'WebDavHttpAdapter';

  constructor(private readonly _deps: WebDavHttpAdapterDeps) {}

  async request(options: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    const scrubbedUrl = urlPathOnly(options.url);

    try {
      let response: WebDavHttpResponse;

      if (this._deps.platformInfo.isNativePlatform) {
        // On native platforms (Android + iOS), use the injected WebDavHttp
        // executor. This bypasses CapacitorHttp which has issues with WebDAV
        // responses (empty bodies on Android/Koofr, broken JSON auto-parsing
        // on iOS).
        this._deps.logger.normal(`${WebDavHttpAdapter.L}.request() native`, {
          method: options.method,
          url: scrubbedUrl,
          bodyChars: options.body != null ? options.body.length : 0,
        });
        const nativeResp = await this._deps.nativeHttp({
          url: options.url,
          method: options.method,
          headers: options.headers ?? {},
          data: options.body ?? undefined,
          responseType: 'text',
        });
        response = {
          status: nativeResp.status,
          headers: nativeResp.headers ?? {},
          data: typeof nativeResp.data === 'string' ? nativeResp.data : '',
        };
      } else {
        this._deps.logger.normal(`${WebDavHttpAdapter.L}.request() fetch`, {
          method: options.method,
          url: scrubbedUrl,
          bodyChars: options.body != null ? options.body.length : 0,
        });
        try {
          const fetchImpl = this._deps.webFetch();
          const fetchResponse = await fetchImpl(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.body,
            // Disable HTTP caching to ensure we get fresh metadata for sync operations
            cache: 'no-store',
          });

          response = await this._convertFetchResponse(fetchResponse);
        } catch (fetchError) {
          // Tightened heuristic: only treat as CORS when the error explicitly
          // says so. The previous broad "Failed to fetch" / "network request
          // failed" matching also fired for plain offline / DNS errors and
          // leaked the raw error message (which embeds the URL on Firefox).
          if (
            fetchError instanceof TypeError &&
            fetchError.message.toLowerCase().includes('cors')
          ) {
            throw new PotentialCorsError(scrubbedUrl);
          }
          throw fetchError;
        }
      }

      // Check for common HTTP errors
      this._checkHttpStatus(response.status, scrubbedUrl, response.data);

      return response;
    } catch (e) {
      if (
        e instanceof AuthFailSPError ||
        e instanceof PotentialCorsError ||
        e instanceof HttpNotOkAPIError ||
        e instanceof RemoteFileNotFoundAPIError ||
        e instanceof TooManyRequestsAPIError
      ) {
        throw e;
      }

      this._deps.logger.critical(
        `${WebDavHttpAdapter.L}.request() error`,
        errorMeta(e, { url: scrubbedUrl, method: options.method }),
      );
      // Create a fake Response object for the error
      const errorResponse = new Response(`HTTP error for ${scrubbedUrl}`, {
        status: WebDavHttpStatus.INTERNAL_SERVER_ERROR,
      });
      throw new HttpNotOkAPIError(errorResponse);
    }
  }

  private async _convertFetchResponse(response: Response): Promise<WebDavHttpResponse> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      headers,
      data: await response.text(),
    };
  }

  private _checkHttpStatus(status: number, scrubbedUrl: string, body?: string): void {
    if (status === WebDavHttpStatus.NOT_MODIFIED) {
      // 304 Not Modified is not an error - let it pass through
      return;
    }

    if (status === WebDavHttpStatus.UNAUTHORIZED) {
      throw new AuthFailSPError();
    }

    if (status === WebDavHttpStatus.NOT_FOUND) {
      throw new RemoteFileNotFoundAPIError(scrubbedUrl);
    }

    if (status === WebDavHttpStatus.TOO_MANY_REQUESTS) {
      throw new TooManyRequestsAPIError({ status });
    }

    if (status < 200 || status >= 300) {
      // Create a fake Response object for the error
      // Ensure status is valid (200-599) for Response constructor
      const safeStatus = status >= 200 && status <= 599 ? status : 500;
      const errorResponse = new Response(`HTTP ${status} for ${scrubbedUrl}`, {
        status: safeStatus,
      });
      // body retained for HttpNotOkAPIError.detail (UI surfacing) but the
      // WebDAV catch-site below logs only safe SyncLogMeta primitives.
      throw new HttpNotOkAPIError(errorResponse, body);
    }
  }
}
