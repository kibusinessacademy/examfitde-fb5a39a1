import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * ScrollToTop — reset window scroll on every route change.
 *
 * Mounted once inside <BrowserRouter>. Without this, react-router
 * preserves the previous scroll position when navigating, which
 * makes deep landing pages appear "at the bottom" after clicking
 * a card from the homepage. We skip when:
 * - the navigation includes a `#hash` (in-page anchor)
 * - the navigation is a `replace` to the same pathname (avoids
 *   fighting in-page jumps)
 *
 * `behavior: 'instant'` is intentional — animated scroll on every
 * route change feels janky on mobile.
 */
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) return;
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, hash]);

  return null;
}
