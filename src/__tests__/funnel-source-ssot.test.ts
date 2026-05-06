/**
 * Funnel Source SSOT
 * --------------------------------------------------------------
 * Garantiert, dass Cluster-/Quellen-Identifier IMMER unter
 * `metadata.source` landen — niemals unter `metadata.cluster`.
 *
 * Bridge-Auswertungen (Loop A) joinen lead_magnet_view → quiz_started
 * → checkout_complete über metadata->>'source'. Drift = kaputter Funnel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// supabase client mocken — wir wollen nur die RPC-Args beobachten
const rpcSpy = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: any[]) => rpcSpy(...args) },
}));

import { trackFunnel } from "@/lib/conversionTracking";
import { emitFunnelEvent } from "@/lib/funnelEvents";

describe("Funnel SSOT — metadata.source statt metadata.cluster", () => {
  beforeEach(() => rpcSpy.mockClear());

  it("emitFunnelEvent legt 'source' in metadata, niemals 'cluster'", async () => {
    await emitFunnelEvent("LEAD_MAGNET_VIEW", {
      source: "aevo_cluster",
      package_id: "00000000-0000-0000-0000-000000000000",
      cta_location: "mid",
    });
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    const [, args] = rpcSpy.mock.calls[0];
    expect(args.p_metadata.source).toBe("aevo_cluster");
    expect(args.p_metadata.cluster).toBeUndefined();
  });

  it("trackFunnel cta_clicked schreibt source in metadata", async () => {
    await trackFunnel("cta_clicked", {
      metadata: {
        source: "wfw_cluster",
        cta_location: "hero",
        element_id: "quiz_cta",
      },
    });
    const [, args] = rpcSpy.mock.calls[0];
    expect(args.p_event_type).toBe("cta_clicked");
    expect(args.p_metadata.source).toBe("wfw_cluster");
    expect(args.p_metadata).not.toHaveProperty("cluster");
  });

  it("Heatmap-Events erzwingen source-Feld in der Payload", async () => {
    await trackFunnel("heatmap_click", {
      metadata: {
        source: "site",
        page_path: "/wissen/test",
        element_id: "quiz_cta",
        cta_location: "mid",
      },
    });
    const [, args] = rpcSpy.mock.calls[0];
    expect(args.p_metadata.source).toBeTruthy();
    expect(args.p_metadata.cluster).toBeUndefined();
  });
});
