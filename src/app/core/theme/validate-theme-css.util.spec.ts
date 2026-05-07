import { MAX_THEME_CSS_SIZE, validateThemeCss } from './validate-theme-css.util';

describe('validateThemeCss', () => {
  it('accepts CSS without any url() or @import', () => {
    const result = validateThemeCss(':root { --bg: #111; }');
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts in-document url(#fragment) references', () => {
    const result = validateThemeCss('rect { fill: url(#myGradient); }');
    expect(result.isValid).toBe(true);
  });

  it('rejects http url(...)', () => {
    const result = validateThemeCss('a { background: url(http://e.com/x.png); }');
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/remote/);
  });

  it('rejects https url(...)', () => {
    const result = validateThemeCss('a { background: url("https://e.com/x.png"); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects protocol-relative url(...)', () => {
    const result = validateThemeCss('a { background: url(//e.com/x.png); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects @import "..." with absolute URL', () => {
    const result = validateThemeCss('@import "https://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  it('rejects @import url(...) with absolute URL', () => {
    const result = validateThemeCss('@import url("http://evil/x.css");');
    expect(result.isValid).toBe(false);
  });

  it('rejects relative url(...) (no bundled assets in v1)', () => {
    const result = validateThemeCss('a { background: url("./assets/x.png"); }');
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/bundled assets/);
  });

  it('rejects data: URIs', () => {
    const result = validateThemeCss(
      'a { background: url("data:image/png;base64,abc"); }',
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/data:/);
  });

  it('ignores commented-out url(...) lines', () => {
    const result = validateThemeCss('/* a { background: url(http://e.com); } */');
    expect(result.isValid).toBe(true);
  });

  it('rejects CSS exceeding the size cap', () => {
    const big = 'a {} '.repeat(MAX_THEME_CSS_SIZE);
    const result = validateThemeCss(big);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/too large/);
  });

  it('records line numbers in error messages', () => {
    const css = ':root {}\n\na { background: url(https://evil/x); }';
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/Line 3/);
  });

  // --- CSS escape bypass tests (C1) ---

  it('rejects \\75rl(...) — `url` with escaped first char', () => {
    const result = validateThemeCss('a { background: \\75rl(http://e.com/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects u\\72l(...) — `url` with escaped middle char', () => {
    const result = validateThemeCss('a { background: u\\72l(https://e.com/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects \\55RL(...) — uppercase mixed-case escapes', () => {
    const result = validateThemeCss('a { background: \\55RL(https://e.com/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects @\\69mport "http://x" — escaped @import', () => {
    const result = validateThemeCss('@\\69mport "http://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  it('rejects url("https\\3a //evil/x") — escaped colon inside url', () => {
    const result = validateThemeCss('a { background: url("https\\3a //evil/x"); }');
    expect(result.isValid).toBe(false);
  });

  it('does not crash on benign escapes like content: "\\41"', () => {
    const result = validateThemeCss('a::before { content: "\\41"; }');
    expect(result.isValid).toBe(true);
  });

  // --- Comment-stripper string-literal bypass tests (C2) ---

  it('does not strip /* and */ tokens that appear inside string literals', () => {
    // A naive comment stripper would treat `/*` inside the string as the
    // start of a comment, skip past `*/` (also inside the string), and miss
    // the malicious `url()` further down.
    const css = `a::before { content: "/*"; } a { background: url(http://evil) } a::after { content: "*/"; }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/remote/);
  });

  it('handles escaped quote inside a string when stripping comments', () => {
    const css = `a::before { content: "say \\"hi\\""; } a { background: url(http://evil) }`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
  });

  // --- Comment-collapse-to-whitespace bypass tests ---

  it('rejects @import with a comment between the keyword and the URL', () => {
    // A naive stripper that deletes comments entirely turns this into
    // `@import"http://evil/x.css"` which the `@import\s+` regex misses.
    // Comments must collapse to a single space per CSS spec.
    const result = validateThemeCss('@import/**/"http://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  it('rejects @import with a comment after escape-encoded keyword', () => {
    const result = validateThemeCss('@\\69mport/**/"http://evil/x.css";');
    expect(result.isValid).toBe(false);
  });

  // --- url-token comment-bypass tests ---

  it('does not treat /* inside an unquoted url() as a comment opener', () => {
    // Naive stripper would open a "comment" at `/*` inside the first
    // url(...) and consume to the next `*/` (or to EOF) — eating the
    // malicious url(http://evil) entirely. With url-token-aware stripping
    // both URLs survive into the regex pass and are rejected (the first as
    // relative, the second as remote).
    const css = `a{background:url(/*)} b{background:url(http://evil/x)}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => /remote/.test(e) && /evil/.test(e))).toBe(true);
  });

  it('rejects unterminated /* (no closing comment) as malformed CSS', () => {
    // An unterminated comment + a remote url() is the simplest variant of
    // the swallow-to-EOF attack.
    const result = validateThemeCss('/* unterminated url(http://evil/x)');
    expect(result.isValid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/unterminated/i);
  });

  it('rejects escape-encoded url keyword that hides the url-token', () => {
    // Decode-before-strip means `u\72l(` is `url(` before the stripper sees
    // it, so the stripper enters url-mode and doesn't fall for /* inside.
    const css = `a{background:u\\72l(/*)} b{background:url(http://evil/x)}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
  });

  // --- src() function bypass tests (CSS Fonts L4) ---

  it('rejects src(<remote>) in @font-face — modern CSS Fonts L4 form', () => {
    const css = `@font-face{font-family:x;src:src("https://evil.example/track");}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/remote/);
  });

  it('rejects bare src(<remote>) outside @font-face', () => {
    const result = validateThemeCss('a { background: src(http://evil/x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects relative src(<path>) (no bundled assets in v1)', () => {
    const result = validateThemeCss(
      `@font-face{font-family:x;src:src("./fonts/x.woff2");}`,
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/bundled assets/);
  });

  it('rejects escape-encoded src keyword', () => {
    // `\72\63` decodes to `r` + `c` after decodeCssEscapes, so `s\72\63(`
    // becomes `src(` and the src() regex catches it. (Using `\72c` won't
    // work — the hex matcher is greedy and parses `72c` as one codepoint.)
    const css = `@font-face{font-family:x;src:s\\72\\63("https://evil/x");}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
  });

  it('does not match the `src:` property keyword (only the src() function)', () => {
    // The regex requires `(`, not `:`. A traditional @font-face that uses
    // url() (already rejected by the url scan as remote) should not be
    // double-flagged by the src scan.
    const css = `@font-face{font-family:x;src:url(http://evil/x);}`;
    const result = validateThemeCss(css);
    expect(result.isValid).toBe(false);
    // Only one error from the url scan, not one each from url and src.
    expect(result.errors.length).toBe(1);
  });

  // --- image-set() function bypass tests (CSS Images L4) ---

  it('rejects image-set("<remote>") — string form', () => {
    const result = validateThemeCss(
      'a { background: image-set("https://evil.example/track.png" 1x); }',
    );
    expect(result.isValid).toBe(false);
    expect(result.errors[0]).toMatch(/remote/);
  });

  it('rejects bare image-set(<remote> 1x)', () => {
    const result = validateThemeCss('a { background: image-set(http://evil/x 1x); }');
    expect(result.isValid).toBe(false);
  });

  it('rejects image-set(url(<remote>) 1x) — inner url() is also caught', () => {
    // The inner url() is caught by the url() scan; this test locks in the
    // coverage so a future regex change can't silently drop it.
    const result = validateThemeCss(
      'a { background: image-set(url(http://evil/x) 1x); }',
    );
    expect(result.isValid).toBe(false);
  });

  it('accepts image-set(linear-gradient(...)) with no URL', () => {
    // `linear-gradient(...)` is a CSS image function — no fetchable URL
    // and no inner url()/src(), so the scan should not flag it.
    const result = validateThemeCss(
      'a { background: image-set(linear-gradient(red, blue) 1x); }',
    );
    expect(result.isValid).toBe(true);
  });
});
