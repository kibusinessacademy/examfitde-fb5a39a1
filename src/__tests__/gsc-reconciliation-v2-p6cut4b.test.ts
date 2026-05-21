/**
 * P6 Cut 4b — GSC Reconciliation v2 contract.
 *
 * SSOT-Invarianten:
 *  1. admin_reconcile_gsc_urls existiert + ist admin-gated (anon refused).
 *  2. fn_classify_gsc_url_v2 + fn_path_in_sitemap sind service_role only
 *     (anon RPC-Call schlägt fehl).
 *  3. Die Klassifizierungs-Logik selbst wird in der Migration via psql-Smoke
 *     verifiziert (siehe Wave-Report); hier wird nur die Grant-Topologie
 *     gepinnt, um Drift zu fangen.
 */
import { describe, it, expect } from "vitest";
import { supabase } from "@/integrations/supabase/client";

describe("P6 Cut 4b — GSC Reconciliation v2", () => {
  it("admin_reconcile_gsc_urls verweigert anon-Zugriff", async () => {
    const { data, error } = await supabase.rpc("admin_reconcile_gsc_urls" as any, {
      _inputs: [{ path: "/", gsc_status: "indexed" }],
      _source: "vitest_anon_probe",
    });
    expect(error).toBeTruthy();
    expect(data).toBeNull();
  });

  it("fn_classify_gsc_url_v2 ist nicht für anon exponiert", async () => {
    const { error } = await supabase.rpc("fn_classify_gsc_url_v2" as any, {
      _path: "/",
      _gsc_status: "indexed",
    });
    expect(error).toBeTruthy();
  });

  it("fn_path_in_sitemap ist nicht für anon exponiert", async () => {
    const { error } = await supabase.rpc("fn_path_in_sitemap" as any, { _path: "/" });
    expect(error).toBeTruthy();
  });
});
