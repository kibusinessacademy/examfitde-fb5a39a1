/**
 * Regression guard: PathAwareLoadingFallback must NEVER render unescaped
 * user-controlled HTML from the URL slug.
 *
 * The component reads `/berufe/:slug` from the path and injects the slug into
 * a `dangerouslySetInnerHTML` shell. Without sanitisation this is a reflected
 * XSS sink. These tests pin the defensive behaviour:
 *
 *   1. Script/HTML metacharacters in the slug must not appear verbatim in the
 *      rendered DOM (they must be either stripped or HTML-escaped).
 *   2. No <script> element must ever be created from the slug.
 *   3. URL-encoded payloads must be decoded and then sanitised — not blindly
 *      passed through.
 *   4. Quote/attribute-break payloads must not escape the surrounding
 *      attribute or tag context.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PathAwareLoadingFallback } from '@/components/seo/PathAwareLoadingFallback';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PathAwareLoadingFallback />
    </MemoryRouter>,
  );
}

const XSS_PAYLOADS: Array<{ name: string; slug: string }> = [
  { name: 'inline script tag', slug: '<script>alert(1)</script>' },
  { name: 'img onerror', slug: '"><img src=x onerror=alert(1)>' },
  { name: 'svg onload', slug: '<svg/onload=alert(1)>' },
  { name: 'attribute break', slug: 'x" data-x="y' },
  { name: 'single-quote break', slug: "x' onmouseover='alert(1)" },
  { name: 'js url', slug: 'javascript:alert(1)' },
  { name: 'html entities', slug: '&lt;script&gt;alert(1)&lt;/script&gt;' },
  { name: 'iframe', slug: '<iframe src=javascript:alert(1)>' },
];

describe('PathAwareLoadingFallback — XSS regression guard', () => {
  for (const { name, slug } of XSS_PAYLOADS) {
    it(`neutralises payload: ${name}`, () => {
      const { container } = renderAt(`/berufe/${encodeURIComponent(slug)}`);

      // 1. No <script>, <iframe>, <svg> or <img> may be injected from the slug.
      expect(container.querySelectorAll('script').length).toBe(0);
      expect(container.querySelectorAll('iframe').length).toBe(0);
      expect(container.querySelectorAll('svg').length).toBe(0);
      expect(container.querySelectorAll('img').length).toBe(0);

      // 2. No element may carry an inline event handler attribute sourced
      //    from the slug.
      for (const el of Array.from(container.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
          expect(
            attr.name.startsWith('on'),
            `unexpected event handler attribute ${attr.name} on <${el.tagName}>`,
          ).toBe(false);
        }
      }

      // 3. Raw HTML metacharacters from the payload must not appear verbatim
      //    in the rendered HTML (must be stripped or escaped).
      const html = container.innerHTML;
      expect(html).not.toContain('<script');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('onerror=');
      expect(html).not.toContain('onload=');
      expect(html).not.toContain('onmouseover=');
      expect(html).not.toContain('javascript:');
    });
  }

  it('renders a safe, plain title for benign slugs', () => {
    const { container } = renderAt('/berufe/einzelhandelskaufmann-frau');
    const h1 = container.querySelector('h1');
    expect(h1?.textContent).toContain('einzelhandelskaufmann frau');
    expect(container.querySelectorAll('script').length).toBe(0);
  });

  it('handles malformed percent-encoding without crashing or leaking raw HTML', () => {
    const { container } = renderAt('/berufe/%E0%A4%A');
    expect(container.querySelectorAll('script').length).toBe(0);
    expect(container.innerHTML).not.toContain('<script');
  });
});
