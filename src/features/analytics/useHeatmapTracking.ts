/**
 * useHeatmapTracking — leichte Click- + Scroll-Tracking-Schicht.
 *
 * Schreibt direkt in conversion_events (Anon-erlaubt via track_conversion_event_v2 RPC).
 * Trackt NUR Elemente, die `data-heatmap-id` tragen — sonst wird die Tabelle geflutet.
 *
 * Events:
 *   - heatmap_click        (mit x_pct/y_pct/element_id/cta_location)
 *   - heatmap_scroll_depth (in 25 %-Buckets, max einmal je Bucket pro Pageview)
 *
 * Cluster-/Quellen-Kennung landet IMMER in `metadata.source` (SSOT) —
 * niemals in `metadata.cluster`. Siehe `src/__tests__/funnel-source-ssot.test.ts`.
 */
import { useEffect } from "react";
import { trackFunnel, type FunnelEventType } from "@/lib/conversionTracking";

interface HeatmapMeta {
  source: string;
  page_path: string;
  cta_location?: string | null;
  element_id?: string | null;
  x_pct?: number;
  y_pct?: number;
  scroll_depth_pct?: number;
  viewport_w?: number;
  viewport_h?: number;
  ts?: string;
}

function track(eventType: FunnelEventType, meta: HeatmapMeta) {
  // fire-and-forget; Tracking darf nie UI blocken
  void trackFunnel(eventType, {
    metadata: { ...meta, ts: new Date().toISOString() },
    source_page: meta.page_path,
  });
}

export function useHeatmapTracking(opts?: { source?: string }) {
  const source = opts?.source ?? "global";

  useEffect(() => {
    if (typeof window === "undefined") return;
    let maxScroll = 0;
    let lastSentBucket = 0;

    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const tracked = target?.closest("[data-heatmap-id]") as HTMLElement | null;
      if (!tracked) return;
      track("heatmap_click", {
        source,
        page_path: window.location.pathname,
        element_id: tracked.dataset.heatmapId ?? null,
        cta_location: tracked.dataset.ctaLocation ?? null,
        x_pct: Math.round((e.clientX / window.innerWidth) * 100),
        y_pct: Math.round((e.clientY / window.innerHeight) * 100),
        viewport_w: window.innerWidth,
        viewport_h: window.innerHeight,
      });
    };

    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight =
        document.documentElement.scrollHeight - window.innerHeight;
      const depth =
        docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
      if (depth > maxScroll) maxScroll = depth;
      // 25 %-Buckets (25/50/75/100) — max 4 Events pro Pageview
      const bucket = Math.floor(maxScroll / 25) * 25;
      if (bucket > lastSentBucket && bucket >= 25) {
        lastSentBucket = bucket;
        track("heatmap_scroll_depth", {
          source,
          page_path: window.location.pathname,
          scroll_depth_pct: bucket,
          viewport_w: window.innerWidth,
          viewport_h: window.innerHeight,
        });
      }
    };

    window.addEventListener("click", onClick, true);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("scroll", onScroll);
    };
  }, [source]);
}
