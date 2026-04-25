import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { trackFunnel } from "@/lib/conversionTracking";

/**
 * Auto-fires `pricing_view` when the user lands on a pricing-related route.
 * Mount once near the app root.
 */
export function useTrackPageView() {
  const location = useLocation();

  useEffect(() => {
    const p = location.pathname.toLowerCase();
    const isPricing =
      p === "/pricing" ||
      p.startsWith("/pricing/") ||
      p.includes("/preise") ||
      p.includes("/checkout");
    if (isPricing) {
      trackFunnel("pricing_view", { metadata: { path: location.pathname } });
    }
  }, [location.pathname]);
}
