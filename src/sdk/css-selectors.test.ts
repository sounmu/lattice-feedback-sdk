import { describe, expect, it } from 'vitest';
import { isVerbatimWithoutReplacements, rewriteCssNames, scanCssSelectors } from '@/sdk/css-selectors';

function renameTo(names: Record<string, string>) {
  return (name: string): string | undefined => names[name];
}

describe('names in stylesheet text', () => {
  it('leaves a color alone when an id spelled with the same letters has another name', () => {
    const css = '.button { color: #fff; border: 1px solid #fff } #fff { outline: 1px solid #fff }';

    expect(rewriteCssNames(css, renameTo({ fff: 'lattice-ref-1' })))
      .toBe('.button { color: #fff; border: 1px solid #fff } #lattice-ref-1 { outline: 1px solid #fff }');
    expect(scanCssSelectors('.button { color: #abc; background: #0f0f0f }').names.size).toBe(0);
  });

  it('renames ids in nested rules and selector functions, and fragment references in declarations', () => {
    const css = '@media (min-width: 1px) { .a:not(#row) > #row.x { filter: url(#row); clip-path: url("#row") } }';

    expect(rewriteCssNames(css, renameTo({ row: 'r1' })))
      .toBe('@media (min-width: 1px) { .a:not(#r1) > #r1.x { filter: url(#r1); clip-path: url("#r1") } }');
    expect([...scanCssSelectors('.a { filter: url(#blur) } #b{}').names].sort()).toEqual(['b', 'blur']);
    expect(rewriteCssNames('#row, .x > #row', renameTo({ row: 'r1' }))).toBe('#r1, .x > #r1');
  });

  it('does not read the condition of an at-rule, a string or a comment as a selector', () => {
    const css = '@supports (color: #abc) { a::after { content: "#abc {" } /* } */ #abc { color: red } }';

    expect(rewriteCssNames(css, renameTo({ abc: 'r1' })))
      .toBe('@supports (color: #abc) { a::after { content: "#abc {" } /* } */ #r1 { color: red } }');
    expect(rewriteCssNames('@scope (#abc) { img { color: #abc } }', renameTo({ abc: 'r1' })))
      .toBe('@scope (#r1) { img { color: #abc } }');
  });

  it('rewrites the value of an attribute selector the way the attribute itself is rewritten', () => {
    const css = 'a[href="#panel"] [aria-controls="one two"] [aria-controls~=one] [href="/panel"] [id^=one] [data-x="one"] [target="_blank"] { top: 0 }';

    expect(rewriteCssNames(css, renameTo({ panel: 'r1', one: 'r2', two: 'r3' })))
      .toBe('a[href="#r1"] [aria-controls="r2 r3"] [aria-controls~=r2] [href="/panel"] [id^=one] [data-x="one"] [target="_blank"] { top: 0 }');
    expect([...scanCssSelectors('a[href="#panel"] [aria-controls="one two"] [href="/x"] {}').names].sort()).toEqual(['one', 'panel', 'two']);
  });

  it.each([
    ['#row > .x[data-k="v"] { color: #fff; background: url("/a.png") }', true],
    ['a[href="#panel"], [aria-controls~=one] { top: 0 }', true],
    ['.a { filter: url( #blur ) }', false],
    ['.a { clip-path: url("#clip") } x::part(thumb) { top: 0 }', false],
  ])('reports %j as verbatim only when a rewrite without replacements returns it unchanged', (css, isVerbatim) => {
    expect(isVerbatimWithoutReplacements(css)).toBe(isVerbatim);
    if (isVerbatim) expect(rewriteCssNames(css, () => undefined)).toBe(css);
  });

  it('writes a fragment reference without the whitespace around it, which is why such a text is not verbatim', () => {
    expect(rewriteCssNames('.a { filter: url( #blur ) }', () => undefined)).toBe('.a { filter: url(#blur) }');
  });

  it('reads hexadecimal escapes in an id selector, with the space that ends them', () => {
    expect([...scanCssSelectors('#\\31 23 { color: red } #a\\:b\\62 c{}').names].sort()).toEqual(['123', 'a:bbc']);
    expect(rewriteCssNames('#\\31 23 { color: red } #\\31 23.x #\\000031 23{}', renameTo({ 123: 'r1' })))
      .toBe('#r1 { color: red } #r1.x #r1{}');
  });
});
