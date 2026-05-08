import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { gtmPageView } from "@/lib/gtm";

/**
 * Fires `spa_pageview` to GTM dataLayer on every route change.
 * Mount once near the app root inside <BrowserRouter>.
 */
export function useGtmPageView(): void {
  const location = useLocation();

  useEffect(() => {
    // Defer one tick so document.title (set by react-helmet-async) is current
    const id = window.setTimeout(() => {
      gtmPageView(location.pathname + location.search);
    }, 0);
    return () => window.clearTimeout(id);
  }, [location.pathname, location.search]);
}
