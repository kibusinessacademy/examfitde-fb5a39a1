/**
 * PRODUCT.HEALTH.OS.1 — Pure deterministic Product-Operator projector.
 * Read-only aggregation over existing Product/Pricing SSOT views.
 * Input: raw rows. Output: ranked operator signals.
 *
 * Architecture freeze: no new tables, no triggers, no cron. Read-only projection.
 */

export const PROJECTOR_VERSION = "product-health-os-1.0.0";

// --- Inputs -----------------------------------------------------------------

export interface DeliverableRow {
  course_package_id: string;
  curriculum_id: string | null;
  product_id: string | null;
  package_status: string | null;
  is_published: boolean | null;
  delivery_ready: boolean | null;
  delivery_blocking_reasons: unknown;
  product_public: boolean | null;
  has_stripe_price: boolean | null;
  is_sellable_and_deliverable: boolean | null;
}

export interface GapAuditRow {
  package_id: string;
  package_title: string | null;
  product_id: string | null;
  product_status: string | null;
  product_visibility: string | null;
  active_price_count: number | null;
  active_stripe_price_count: number | null;
  gap_type: string | null; // OK | STRIPE_PRICE_ID_MISSING | ...
}

export interface MergeCandidateRow {
  certification_id: string | null;
  canonical_product_id: string | null;
  duplicate_product_id: string | null;
  canonical_title: string | null;
  duplicate_title: string | null;
  duplicate_slug: string | null;
}

export interface StripeSyncPreviewRow {
  product_id: string;
  product_title: string | null;
  amount_cents: number | null;
  current_stripe_price_id: string | null;
  suggested_stripe_price_id: string | null;
  suggested_tier_label: string | null;
  action_needed: string | null; // noop_already_synced | manual_review_needed | sync_required
  reason: string | null;
}

export interface CatalogDiagnosticRow {
  beruf_id: string | null;
  title: string | null;
  package_id: string | null;
  is_sellable: boolean | null;
  has_published_course: boolean | null;
  has_active_product: boolean | null;
  has_stripe_price: boolean | null;
  block_reason: string | null;
  lesson_count: number | null;
  lesson_ready_count: number | null;
  teaser_is_real_usp: boolean | null;
}

export interface TeaserQualityRow {
  category: string | null;
  entries: number | null;
  with_real_usp: number | null;
  with_fallback_only: number | null;
  pct_real_usp: number | null;
}

export interface ProjInputs {
  deliverable: DeliverableRow[];
  gaps: GapAuditRow[];
  merges: MergeCandidateRow[];
  stripe_sync: StripeSyncPreviewRow[];
  catalog: CatalogDiagnosticRow[];
  teaser: TeaserQualityRow[];
  now_iso: string;
}

// --- Outputs ----------------------------------------------------------------

export type ActionCode =
  | "PUBLIC_BUT_UNDELIVERABLE"   // taking money, can't deliver — SHIPPING BLOCKER
  | "DUPLICATE_PRODUCT"          // two products per certification
  | "STRIPE_PRICE_MISSING"       // product active but stripe_price_id null
  | "STRIPE_MANUAL_REVIEW"       // tier mismatch / forced overrides
  | "PRIVATE_BUT_PRICED"         // priced + deliverable but not public → revenue left on table
  | "NO_PRICE"                   // no stripe price at all
  | "COURSE_NOT_PUBLISHED"       // catalog: product active but course not published
  | "LESSONS_GAP_UNKNOWN"        // missing lesson_ready signal
  | "TEASER_FALLBACK_HEAVY";     // category dominated by fallback USPs

export type Severity = "critical" | "high" | "medium" | "low";

export interface ActionItem {
  code: ActionCode;
  severity: Severity;
  target: string;
  metric: number;
  detail: string;
  recommendation: string;
  score: number;
}

export interface DriftRow {
  package_id: string;
  product_id: string | null;
  classification:
    | "PUBLIC_BUT_UNDELIVERABLE"
    | "PRIVATE_BUT_PRICED"
    | "NO_PRICE"
    | "MISSING_STRIPE_PRICE_ID"
    | "OK";
  signals: string[];
}

export interface Projection {
  generated_at: string;
  projector_version: string;
  totals: {
    packages_total: number;
    sellable_and_deliverable: number;
    public_but_undeliverable: number;
    private_but_priced: number;
    no_price: number;
    missing_stripe_price_id: number;
    duplicate_products: number;
    stripe_manual_review: number;
    course_not_published: number;
    lessons_gap_unknown: number;
    sellable_rate: number;        // 0..1
    public_conversion_rate: number; // public / sellable
  };
  action_queue: ActionItem[];
  drift_top: DriftRow[];                      // most actionable per-package summary
  duplicate_clusters: { certification_id: string | null; canonical: string | null; duplicates: string[] }[];
  teaser_quality_alerts: TeaserQualityRow[];  // pct_real_usp < 0.6
  block_reason_breakdown: { reason: string; count: number }[];
}

// --- Heuristics -------------------------------------------------------------

const PRIORITY: Record<ActionCode, number> = {
  PUBLIC_BUT_UNDELIVERABLE: 110, // taking money for broken product — top of stack
  DUPLICATE_PRODUCT: 95,         // breaks SSOT, confuses Stripe + SEO
  STRIPE_PRICE_MISSING: 90,      // active product without price = silent revenue loss
  STRIPE_MANUAL_REVIEW: 80,
  PRIVATE_BUT_PRICED: 70,        // ready to ship but hidden — flip visibility
  COURSE_NOT_PUBLISHED: 60,
  NO_PRICE: 55,
  LESSONS_GAP_UNKNOWN: 40,
  TEASER_FALLBACK_HEAVY: 35,
};

const SEV_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 } as const;

export function classifyDrift(d: DeliverableRow): DriftRow {
  const signals: string[] = [];
  if (d.product_public === true && d.delivery_ready === false) {
    signals.push("public_but_undeliverable");
    return {
      package_id: d.course_package_id,
      product_id: d.product_id,
      classification: "PUBLIC_BUT_UNDELIVERABLE",
      signals,
    };
  }
  if (d.has_stripe_price === false) {
    signals.push("no_stripe_price");
    return {
      package_id: d.course_package_id,
      product_id: d.product_id,
      classification: "NO_PRICE",
      signals,
    };
  }
  if (d.product_public === false && d.has_stripe_price === true) {
    signals.push("not_public");
    if (d.delivery_ready !== false) signals.push("delivery_ready_or_unknown");
    return {
      package_id: d.course_package_id,
      product_id: d.product_id,
      classification: "PRIVATE_BUT_PRICED",
      signals,
    };
  }
  return {
    package_id: d.course_package_id,
    product_id: d.product_id,
    classification: "OK",
    signals,
  };
}

export function buildActionQueue(p: Omit<ProjInputs, "now_iso">): ActionItem[] {
  const items: ActionItem[] = [];

  // PUBLIC_BUT_UNDELIVERABLE — critical per row
  for (const d of p.deliverable) {
    if (d.product_public === true && d.delivery_ready === false) {
      items.push({
        code: "PUBLIC_BUT_UNDELIVERABLE",
        severity: "critical",
        target: d.course_package_id,
        metric: 1,
        detail: `Paket ${d.course_package_id} ist öffentlich + bepreist, aber delivery_ready=false`,
        recommendation: "Sofort visibility=private oder Curriculum/Lessons fertigstellen",
        score: 0,
      });
    }
  }

  // DUPLICATE_PRODUCT — one item per duplicate
  for (const m of p.merges) {
    items.push({
      code: "DUPLICATE_PRODUCT",
      severity: "high",
      target: m.duplicate_product_id ?? m.certification_id ?? "unknown",
      metric: 1,
      detail: `Duplicate "${m.duplicate_title ?? m.duplicate_slug ?? m.duplicate_product_id}" vs canonical "${m.canonical_title ?? m.canonical_product_id}"`,
      recommendation: "Merge auf canonical_product_id, duplicate archivieren, Stripe-Price umhängen",
      score: 0,
    });
  }

  // STRIPE_PRICE_MISSING via gap audit
  for (const g of p.gaps) {
    if (g.gap_type === "STRIPE_PRICE_ID_MISSING") {
      items.push({
        code: "STRIPE_PRICE_MISSING",
        severity: "high",
        target: g.package_id,
        metric: g.active_price_count ?? 0,
        detail: `${g.package_title ?? g.package_id}: ${g.active_price_count ?? 0} aktive Preise, 0 Stripe-Refs`,
        recommendation: "stripe-sync-product Edge Function triggern (idempotent)",
        score: 0,
      });
    }
  }

  // STRIPE_MANUAL_REVIEW via sync preview
  for (const s of p.stripe_sync) {
    if (s.action_needed === "manual_review_needed") {
      items.push({
        code: "STRIPE_MANUAL_REVIEW",
        severity: "medium",
        target: s.product_id,
        metric: s.amount_cents ?? 0,
        detail: `${s.product_title ?? s.product_id}: ${s.reason ?? "tier/price mismatch"}`,
        recommendation: "Pricing-Tier manuell prüfen, dann sync_required setzen",
        score: 0,
      });
    }
  }

  // PRIVATE_BUT_PRICED — bulk aggregate (don't spam queue with hundreds)
  const privatePriced = p.deliverable.filter(
    (d) => d.product_public === false && d.has_stripe_price === true,
  );
  if (privatePriced.length > 0) {
    items.push({
      code: "PRIVATE_BUT_PRICED",
      severity: privatePriced.length >= 50 ? "high" : "medium",
      target: `${privatePriced.length} Pakete`,
      metric: privatePriced.length,
      detail: `${privatePriced.length} Pakete haben Stripe-Preis aber product.visibility ≠ public`,
      recommendation: "Bulk-Promotion: visibility=public sobald delivery_ready=true",
      score: 0,
    });
  }

  // NO_PRICE — aggregate
  const noPrice = p.deliverable.filter((d) => d.has_stripe_price === false);
  if (noPrice.length > 0) {
    items.push({
      code: "NO_PRICE",
      severity: noPrice.length >= 20 ? "high" : "medium",
      target: `${noPrice.length} Pakete`,
      metric: noPrice.length,
      detail: `${noPrice.length} Pakete ohne Stripe-Preis`,
      recommendation: "Pricing-Backfill + stripe-sync-product ausführen",
      score: 0,
    });
  }

  // COURSE_NOT_PUBLISHED via catalog
  const cnp = p.catalog.filter((c) => c.block_reason === "course_not_published");
  if (cnp.length > 0) {
    items.push({
      code: "COURSE_NOT_PUBLISHED",
      severity: cnp.length >= 50 ? "high" : "medium",
      target: `${cnp.length} Berufe`,
      metric: cnp.length,
      detail: `${cnp.length} Berufe mit aktivem Produkt aber Kurs unveröffentlicht`,
      recommendation: "publish_course (oder enqueue_done_reaudit) für Kandidaten",
      score: 0,
    });
  }

  // LESSONS_GAP_UNKNOWN
  const lgu = p.catalog.filter((c) => c.block_reason === "lessons_gap_unknown");
  if (lgu.length > 0) {
    items.push({
      code: "LESSONS_GAP_UNKNOWN",
      severity: "low",
      target: `${lgu.length} Berufe`,
      metric: lgu.length,
      detail: `${lgu.length} Berufe ohne lesson_ready Signal`,
      recommendation: "lesson_readiness reaudit nachziehen",
      score: 0,
    });
  }

  // TEASER_FALLBACK_HEAVY — categories where pct_real_usp < 0.6
  for (const t of p.teaser) {
    if ((t.pct_real_usp ?? 1) < 0.6 && (t.entries ?? 0) >= 5) {
      items.push({
        code: "TEASER_FALLBACK_HEAVY",
        severity: (t.pct_real_usp ?? 1) < 0.3 ? "medium" : "low",
        target: t.category ?? "unknown",
        metric: Math.round((t.pct_real_usp ?? 0) * 100),
        detail: `Kategorie "${t.category}": nur ${Math.round((t.pct_real_usp ?? 0) * 100)}% echte USP-Teaser (${t.entries} Einträge)`,
        recommendation: "USP-Generator für Kategorie laufen lassen",
        score: 0,
      });
    }
  }

  for (const it of items) {
    it.score = PRIORITY[it.code] * SEV_WEIGHT[it.severity];
  }
  return items.sort((a, b) => b.score - a.score).slice(0, 50);
}

export function buildDriftTop(rows: DeliverableRow[]): DriftRow[] {
  const drift = rows.map(classifyDrift).filter((d) => d.classification !== "OK");
  // Order: PUBLIC_BUT_UNDELIVERABLE > NO_PRICE > PRIVATE_BUT_PRICED
  const order: Record<DriftRow["classification"], number> = {
    PUBLIC_BUT_UNDELIVERABLE: 0,
    MISSING_STRIPE_PRICE_ID: 1,
    NO_PRICE: 2,
    PRIVATE_BUT_PRICED: 3,
    OK: 9,
  };
  return drift.sort((a, b) => order[a.classification] - order[b.classification]).slice(0, 50);
}

export function buildDuplicateClusters(rows: MergeCandidateRow[]): Projection["duplicate_clusters"] {
  const map = new Map<string, { canonical: string | null; duplicates: Set<string> }>();
  for (const r of rows) {
    const key = r.certification_id ?? r.canonical_product_id ?? "unknown";
    const cur = map.get(key) ?? { canonical: r.canonical_product_id, duplicates: new Set<string>() };
    if (r.duplicate_product_id) cur.duplicates.add(r.duplicate_product_id);
    map.set(key, cur);
  }
  return Array.from(map.entries()).map(([certification_id, v]) => ({
    certification_id,
    canonical: v.canonical,
    duplicates: Array.from(v.duplicates),
  }));
}

export function buildBlockReasons(rows: CatalogDiagnosticRow[]): Projection["block_reason_breakdown"] {
  const map = new Map<string, number>();
  for (const r of rows) {
    const reason = r.block_reason ?? "unspecified";
    map.set(reason, (map.get(reason) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export function project(inputs: ProjInputs): Projection {
  const d = inputs.deliverable;
  const total = d.length;
  const sellable = d.filter((x) => x.is_sellable_and_deliverable === true).length;
  const pubUndeliv = d.filter((x) => x.product_public === true && x.delivery_ready === false).length;
  const privPriced = d.filter((x) => x.product_public === false && x.has_stripe_price === true).length;
  const noPrice = d.filter((x) => x.has_stripe_price === false).length;
  const missingStripe = inputs.gaps.filter((g) => g.gap_type === "STRIPE_PRICE_ID_MISSING").length;
  const duplicates = inputs.merges.length;
  const manualReview = inputs.stripe_sync.filter((s) => s.action_needed === "manual_review_needed").length;
  const cnp = inputs.catalog.filter((c) => c.block_reason === "course_not_published").length;
  const lgu = inputs.catalog.filter((c) => c.block_reason === "lessons_gap_unknown").length;
  const publicCount = d.filter((x) => x.product_public === true).length;

  return {
    generated_at: inputs.now_iso,
    projector_version: PROJECTOR_VERSION,
    totals: {
      packages_total: total,
      sellable_and_deliverable: sellable,
      public_but_undeliverable: pubUndeliv,
      private_but_priced: privPriced,
      no_price: noPrice,
      missing_stripe_price_id: missingStripe,
      duplicate_products: duplicates,
      stripe_manual_review: manualReview,
      course_not_published: cnp,
      lessons_gap_unknown: lgu,
      sellable_rate: total > 0 ? Math.round((sellable / total) * 1000) / 1000 : 0,
      public_conversion_rate: sellable > 0 ? Math.round((publicCount / sellable) * 1000) / 1000 : 0,
    },
    action_queue: buildActionQueue(inputs),
    drift_top: buildDriftTop(d),
    duplicate_clusters: buildDuplicateClusters(inputs.merges),
    teaser_quality_alerts: inputs.teaser.filter(
      (t) => (t.pct_real_usp ?? 1) < 0.6 && (t.entries ?? 0) >= 5,
    ),
    block_reason_breakdown: buildBlockReasons(inputs.catalog),
  };
}
