// PRODUCT.HEALTH.OS.1 — Admin-only product health projector (read-only).
// Aggregates pricing/sellable/catalog SSOT views into an operator projection.
import { requireAdmin, handleCors, json } from "../_shared/adminGuard.ts";
import {
  project,
  type DeliverableRow,
  type GapAuditRow,
  type MergeCandidateRow,
  type StripeSyncPreviewRow,
  type CatalogDiagnosticRow,
  type TeaserQualityRow,
} from "../_shared/productHealth/index.ts";

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const ctx = await requireAdmin(req);
  if (ctx instanceof Response) return ctx;
  const sb = ctx.sb;

  const [delivRes, gapsRes, mergeRes, syncRes, catalogRes, teaserRes] = await Promise.all([
    sb.from("v_sellable_and_deliverable").select(
      "course_package_id,curriculum_id,product_id,package_status,is_published,delivery_ready,delivery_blocking_reasons,product_public,has_stripe_price,is_sellable_and_deliverable",
    ),
    sb.from("v_pricing_gap_audit").select(
      "package_id,package_title,product_id,product_status,product_visibility,active_price_count,active_stripe_price_count,gap_type",
    ),
    sb.from("v_pricing_merge_candidates").select(
      "certification_id,canonical_product_id,duplicate_product_id,canonical_title,duplicate_title,duplicate_slug",
    ),
    sb.from("v_stripe_price_sync_preview").select(
      "product_id,product_title,amount_cents,current_stripe_price_id,suggested_stripe_price_id,suggested_tier_label,action_needed,reason",
    ),
    sb.from("v_admin_catalog_diagnostics").select(
      "beruf_id,title,package_id,is_sellable,has_published_course,has_active_product,has_stripe_price,block_reason,lesson_count,lesson_ready_count,teaser_is_real_usp",
    ),
    sb.from("v_admin_catalog_teaser_quality").select(
      "category,entries,with_real_usp,with_fallback_only,pct_real_usp",
    ),
  ]);

  if (delivRes.error) return json({ error: "deliverable_failed", detail: delivRes.error.message }, 500);

  const projection = project({
    deliverable: (delivRes.data ?? []) as DeliverableRow[],
    gaps: (gapsRes.data ?? []) as GapAuditRow[],
    merges: (mergeRes.data ?? []) as MergeCandidateRow[],
    stripe_sync: (syncRes.data ?? []) as StripeSyncPreviewRow[],
    catalog: (catalogRes.data ?? []) as CatalogDiagnosticRow[],
    teaser: (teaserRes.data ?? []) as TeaserQualityRow[],
    now_iso: new Date().toISOString(),
  });

  return json({ ok: true, projection });
});
