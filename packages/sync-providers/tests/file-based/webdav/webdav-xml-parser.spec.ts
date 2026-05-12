import { describe, expect, it, vi } from 'vitest';
import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';
import {
  WebdavXmlParser,
  type FileMeta,
} from '../../../src/file-based/webdav/webdav-xml-parser';
import { RemoteFileNotFoundAPIError } from '../../../src/errors';

const makeLogger = (): SyncLogger & { critical: ReturnType<typeof vi.fn> } => ({
  ...NOOP_SYNC_LOGGER,
  critical: vi.fn(),
});

const sampleMultistatus = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/sync/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>sync</D:displayname>
        <D:getcontentlength>0</D:getcontentlength>
        <D:getlastmodified>Tue, 12 May 2026 09:00:00 GMT</D:getlastmodified>
        <D:getetag>"folder-etag"</D:getetag>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getcontenttype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/sync/file.txt</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>file.txt</D:displayname>
        <D:getcontentlength>42</D:getcontentlength>
        <D:getlastmodified>Tue, 12 May 2026 09:30:00 GMT</D:getlastmodified>
        <D:getetag>"file-etag"</D:getetag>
        <D:resourcetype/>
        <D:getcontenttype>text/plain</D:getcontenttype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

describe('WebdavXmlParser', () => {
  describe('PROPFIND_XML', () => {
    it('has the expected request body shape', () => {
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:propfind');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:displayname/>');
      expect(WebdavXmlParser.PROPFIND_XML).toContain('<D:resourcetype/>');
    });
  });

  describe('isHtmlResponse', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('detects <!doctype html prefix', () => {
      expect(parser.isHtmlResponse('<!DOCTYPE html><html></html>')).toBe(true);
    });
    it('detects <html prefix', () => {
      expect(parser.isHtmlResponse('   <html><body>x</body></html>')).toBe(true);
    });
    it('detects Nextcloud "There is nothing here" message', () => {
      expect(parser.isHtmlResponse('Server: There is nothing here, sorry')).toBe(true);
    });
    it('returns false for XML content', () => {
      expect(parser.isHtmlResponse('<?xml version="1.0"?><a/>')).toBe(false);
    });
  });

  describe('validateResponseContent', () => {
    it('does not throw for normal content', () => {
      const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);
      expect(() =>
        parser.validateResponseContent('regular file body', 'file.txt', 'download'),
      ).not.toThrow();
    });

    it('throws RemoteFileNotFoundAPIError for HTML error pages', () => {
      const logger = makeLogger();
      const parser = new WebdavXmlParser(logger);
      expect(() =>
        parser.validateResponseContent(
          '<!DOCTYPE html><html><body>login</body></html>',
          'file.txt',
          'download',
        ),
      ).toThrow(RemoteFileNotFoundAPIError);
      expect(logger.critical).toHaveBeenCalled();
      // Privacy invariant: log meta must not echo the response body.
      const [, meta] = logger.critical.mock.calls[0];
      expect(JSON.stringify(meta)).not.toContain('login');
      expect(meta).toEqual(
        expect.objectContaining({ contentLength: expect.any(Number) }),
      );
    });

    it('throws for content above the size cap', () => {
      const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);
      const huge = 'x'.repeat(101 * 1024 * 1024); // > 100MB
      expect(() => parser.validateResponseContent(huge, 'big', 'download')).toThrow(
        /Response too large/,
      );
    });
  });

  describe('parseMultiplePropsFromXml', () => {
    const parser = new WebdavXmlParser(NOOP_SYNC_LOGGER);

    it('skips the directory itself and returns child entries', () => {
      const result = parser.parseMultiplePropsFromXml(sampleMultistatus, '/sync/');
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('/sync/file.txt');
      expect(result[0].type).toBe('file');
    });

    it('parses file metadata (size, lastmod, contentType)', () => {
      const result = parser.parseMultiplePropsFromXml(sampleMultistatus, '/sync/');
      const file = result[0] as FileMeta;
      expect(file.size).toBe(42);
      expect(file.lastmod).toBe('Tue, 12 May 2026 09:30:00 GMT');
      expect(file.data['content-type']).toBe('text/plain');
      expect(file.basename).toBe('file.txt');
    });

    it('identifies directories via <collection/>', () => {
      const result = parser.parseMultiplePropsFromXml(
        sampleMultistatus,
        '/sync/file.txt',
      );
      // When querying a specific file, the directory entry is NOT skipped.
      const dir = result.find((f) => f.path === '/sync/');
      expect(dir?.type).toBe('directory');
    });

    it('returns empty array for invalid XML', () => {
      const logger = makeLogger();
      const parser2 = new WebdavXmlParser(logger);
      const result = parser2.parseMultiplePropsFromXml('not xml at all', '/sync/');
      expect(result).toEqual([]);
    });

    it('defaults size to 0 for malformed content-length', () => {
      const xml = sampleMultistatus.replace(
        '<D:getcontentlength>42',
        '<D:getcontentlength>abc',
      );
      const result = parser.parseMultiplePropsFromXml(xml, '/sync/');
      expect(result[0].size).toBe(0);
    });

    it('throws when XML exceeds size cap', () => {
      const parser2 = new WebdavXmlParser(NOOP_SYNC_LOGGER);
      const huge = 'x'.repeat(11 * 1024 * 1024); // > 10MB cap
      expect(() => parser2.parseMultiplePropsFromXml(huge, '/sync/')).toThrow(
        RemoteFileNotFoundAPIError,
      );
    });
  });

  describe('parseXmlResponseElement (privacy)', () => {
    it('logger meta on parsererror does not leak XML content', () => {
      const logger = makeLogger();
      const parser2 = new WebdavXmlParser(logger);
      // Invalid XML triggers the catch path
      parser2.parseMultiplePropsFromXml('<a><b>', '/');
      // Either parsererror was hit OR catch hit — both paths must NOT log raw content
      for (const [, meta] of logger.critical.mock.calls) {
        if (meta) {
          expect(JSON.stringify(meta)).not.toContain('<b>');
        }
      }
    });
  });
});
