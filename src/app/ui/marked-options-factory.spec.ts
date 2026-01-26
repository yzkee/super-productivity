import { markedOptionsFactory } from './marked-options-factory';

describe('markedOptionsFactory', () => {
  let options: ReturnType<typeof markedOptionsFactory>;

  beforeEach(() => {
    options = markedOptionsFactory();
  });

  it('should return a MarkedOptions object', () => {
    expect(options).toBeDefined();
    expect(options.renderer).toBeDefined();
    expect(options.gfm).toBe(true);
  });

  describe('checkbox renderer', () => {
    it('should render unchecked checkbox with material icon', () => {
      const result = options.renderer!.checkbox({ checked: false } as any);
      expect(result).toContain('check_box_outline_blank');
      expect(result).toContain('class="checkbox material-icons"');
    });

    it('should render checked checkbox with material icon', () => {
      const result = options.renderer!.checkbox({ checked: true } as any);
      expect(result).toContain('check_box');
      expect(result).not.toContain('check_box_outline_blank');
      expect(result).toContain('class="checkbox material-icons"');
    });
  });

  describe('listitem renderer', () => {
    it('should render regular list item without checkbox', () => {
      const result = options.renderer!.listitem({
        text: 'Regular item',
        task: false,
        checked: undefined,
      } as any);
      expect(result).toBe('<li>Regular item</li>');
      expect(result).not.toContain('checkbox-wrapper');
    });

    it('should render unchecked task list item with checkbox', () => {
      const result = options.renderer!.listitem({
        text: 'Task item',
        task: true,
        checked: false,
      } as any);
      expect(result).toContain('checkbox-wrapper');
      expect(result).toContain('undone');
      expect(result).toContain('check_box_outline_blank');
      expect(result).toContain('Task item');
      expect(result).toContain('</span> Task item');
    });

    it('should render checked task list item with checkbox', () => {
      const result = options.renderer!.listitem({
        text: 'Completed task',
        task: true,
        checked: true,
      } as any);
      expect(result).toContain('checkbox-wrapper');
      expect(result).toContain('done');
      expect(result).not.toContain('undone');
      expect(result).toContain('check_box');
      expect(result).not.toContain('check_box_outline_blank');
      expect(result).toContain('Completed task');
      expect(result).toContain('</span> Completed task');
    });

    it('should handle undefined checked value as unchecked', () => {
      const result = options.renderer!.listitem({
        text: 'Task with undefined checked',
        task: true,
        checked: undefined,
      } as any);
      expect(result).toContain('checkbox-wrapper');
      expect(result).toContain('undone');
      expect(result).toContain('check_box_outline_blank');
    });

    it('should have space between checkbox and text for proper visual separation', () => {
      const result = options.renderer!.listitem({
        text: 'Spaced item',
        task: true,
        checked: false,
      } as any);
      expect(result).toMatch(/<\/span> Spaced item<\/li>/);
    });
  });

  describe('link renderer', () => {
    it('should render link with target="_blank"', () => {
      // In marked v17, the link renderer receives tokens that need to be parsed
      // We need to bind a mock parser context
      const mockParser = {
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      };
      const linkRenderer = options.renderer!.link.bind({ parser: mockParser });

      const result = linkRenderer({
        href: 'http://example.com',
        title: 'Example',
        tokens: [{ type: 'text', raw: 'Click here', text: 'Click here' }],
      } as any);
      expect(result).toContain('target="_blank"');
      expect(result).toContain('href="http://example.com"');
      expect(result).toContain('title="Example"');
      expect(result).toContain('Click here');
    });

    it('should handle empty title', () => {
      const mockParser = {
        parseInline: (tokens: any[]) =>
          tokens.map((t: any) => t.raw || t.text || '').join(''),
      };
      const linkRenderer = options.renderer!.link.bind({ parser: mockParser });

      const result = linkRenderer({
        href: 'http://example.com',
        title: null,
        tokens: [{ type: 'text', raw: 'Link', text: 'Link' }],
      } as any);
      expect(result).toContain('title=""');
    });
  });

  // Note: URL auto-linking is handled automatically by marked v17 with gfm: true.
  // We intentionally do NOT override renderer.text for this - the lexer converts
  // URLs to link tokens before they reach the text renderer.
});
