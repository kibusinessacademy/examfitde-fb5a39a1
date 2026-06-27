// SEO.HEALTH.OS.1 — Admin-only SEO health projector (read-only).
// Reads existing SEO SSOT views, runs Pure projector, returns JSON. No writes.
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";
import {
  project,
  type ReadinessRow,
  type BridgeRow,
  type OrphanRow,
  type DeadEndRow,
  type CanonicalDriftRow,
} from "../_shared/seoHealth/index.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  const [readinessRes, bridgeRes, orphanRes, deadRes, canonRes] = await Promise.all([
    sb.from("v_package_seo_readiness_v1").select(
      "package_id,package_title,track,seo_customer_safe,internal_link_ready,intent_pipeline_healthy,pillar_ready,spoke_ready,blog_ready,pillar_count,spoke_count,spoke_pending_count,blog_count,blog_pending_count,orphaned_pillar_count,thin_content_risk_count,internal_link_active_count,internal_link_suggested_count,reasons",
    ),
    sb.from("v_seo_bridge_candidates_v1").select(
      "source_url,target_url,source_layer,target_layer,similarity_score,decision",
    ).limit(2000),
    sb.from("v_seo_orphan_analysis").select("url,node_role,inbound_total,outbound_total,orphan_class").limit(500),
    sb.from("v_seo_dead_end_coverage").select(
      "package_id,package_title,product_slug,is_seo_dead_end,blocking_reason,recommended_next_action,spokes_published,blog_published,links_active",
    ),
    sb.from("v_seo_canonical_drift").select(
      "page_id,slug,package_id,drift_severity,canonical_check_status",
    ).limit(1500),
  ]);

  if (readinessRes.error) return json({ error: "readiness_failed", detail: readinessRes.error.message }, 500);

  const projection = project({
    readiness: (readinessRes.data ?? []) as ReadinessRow[],
    bridge: (bridgeRes.data ?? []) as BridgeRow[],
    orphans: (orphanRes.data ?? []) as OrphanRow[],
    dead_ends: (deadRes.data ?? []) as DeadEndRow[],
    canonical: (canonRes.data ?? []) as CanonicalDriftRow[],
    now_iso: new Date().toISOString(),
  });

  return json({ ok: true, projection });
});
