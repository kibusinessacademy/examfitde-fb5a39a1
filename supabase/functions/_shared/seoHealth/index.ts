/**
 * SEO.HEALTH.OS.1 — Pure deterministic SEO-Operator projector.
 * Read-only aggregation over existing SEO SSOT views.
 * Input: raw rows. Output: ranked operator signals.
 */

export const PROJECTOR_VERSION = "seo-health-os-1.0.0";

export interface ReadinessRow {
  package_id: string;
  package_title: string | null;
  track: string | null;
  seo_customer_safe: boolean | null;
  internal_link_ready: boolean | null;
  intent_pipeline_healthy: boolean | null;
  pillar_ready: boolean | null;
  spoke_ready: boolean | null;
  blog_ready: boolean | null;
  pillar_count: number | null;
  spoke_count: number | null;
  spoke_pending_count: number | null;
  blog_count: number | null;
  blog_pending_count: number | null;
  orphaned_pillar_count: number | null;
  thin_content_risk_count: number | null;
  internal_link_active_count: number | null;
  internal_link_suggested_count: number | null;
  reasons: unknown;
}

export interface BridgeRow {
  source_url: string | null;
  target_url: string | null;
  source_layer: string | null;
  target_layer: string | null;
  similarity_score: number | null;
  decision: string | null;
}

export interface OrphanRow {
  url: string;
  node_role: string | null;
  inbound_total: number | null;
  outbound_total: number | null;
  orphan_class: string | null;
}

export interface DeadEndRow {
  package_id: string;
  package_title: string | null;
  product_slug: string | null;
  is_seo_dead_end: boolean | null;
  blocking_reason: string | null;
  recommended_next_action: string | null;
  spokes_published: number | null;
  blog_published: number | null;
  links_active: number | null;
}

export interface CanonicalDriftRow {
  page_id: string;
  slug: string | null;
  package_id: string | null;
  drift_severity: string | null;
  canonical_check_status: string | null;
}

export interface ProjInputs {
  readiness: ReadinessRow[];
  bridge: BridgeRow[];
  orphans: OrphanRow[];
  dead_ends: DeadEndRow[];
  canonical: CanonicalDriftRow[];
  now_iso: string;
}

export type ActionCode =
  | "CANONICAL_DRIFT"
  | "DEAD_END_PACKAGE"
  | "BRIDGE_READY"
  | "BRIDGE_DUPLICATE"
  | "ORPHAN_NO_INBOUND"
  | "ORPHAN_NO_OUTBOUND"
  | "READINESS_GAP"
  | "THIN_CONTENT_RISK"
  | "PILLAR_ORPHANED";

export interface ActionItem {
  code: ActionCode;
  severity: "critical" | "high" | "medium" | "low";
  target: string;            // package_id, url, or slug
  metric: number;
  detail: string;
  recommendation: string;
  score: number;
}

export interface ReadinessGapBreakdown {
  package_id: string;
  package_title: string;
  missing: string[];          // gap codes
  thin_content: number;
  orphaned_pillars: number;
  pending_spokes: number;
  pending_blogs: number;
  suggested_unaccepted_links: number;
}

export interface Projection {
  generated_at: string;
  projector_version: string;
  totals: {
    packages_total: number;
    packages_customer_safe: number;
    packages_intent_healthy: number;
    packages_dead_end: number;
    canonical_drift_critical: number;
    bridge_candidates_total: number;
    bridge_ready_to_link: number;
    bridge_duplicates: number;
    orphans_total: number;
    orphans_no_inbound: number;
    orphans_no_outbound: number;
    suggested_links_unaccepted: number;
    customer_safe_rate: number;     // 0..1
  };
  action_queue: ActionItem[];
  readiness_gaps_top: ReadinessGapBreakdown[];
  bridge_layer_matrix: { source_layer: string; target_layer: string; ready: number; blocked_dupe: number }[];
  orphan_by_role: { node_role: string; no_inbound: number; no_outbound: number }[];
  dead_end_reasons: { reason: string; count: number; sample_package_id: string | null }[];
}

const PRIORITY: Record<ActionCode, number> = {
  CANONICAL_DRIFT: 100,
  DEAD_END_PACKAGE: 90,
  READINESS_GAP: 85,
  ORPHAN_NO_INBOUND: 75,
  BRIDGE_READY: 70,
  PILLAR_ORPHANED: 65,
  THIN_CONTENT_RISK: 55,
  BRIDGE_DUPLICATE: 40,
  ORPHAN_NO_OUTBOUND: 35,
};

const SEV_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 } as const;

function gapCodes(r: ReadinessRow): string[] {
  const g: string[] = [];
  if (r.seo_customer_safe === false) g.push("not_customer_safe");
  if (r.pillar_ready === false) g.push("pillar_missing");
  if (r.spoke_ready === false) g.push("spoke_pending");
  if (r.blog_ready === false) g.push("blog_pending");
  if (r.internal_link_ready === false) g.push("links_missing");
  if (r.intent_pipeline_healthy === false) g.push("intent_unhealthy");
  if ((r.thin_content_risk_count ?? 0) > 0) g.push("thin_content");
  if ((r.orphaned_pillar_count ?? 0) > 0) g.push("orphan_pillar");
  return g;
}

export function buildActionQueue(p: {
  readiness: ReadinessRow[];
  bridge: BridgeRow[];
  orphans: OrphanRow[];
  dead_ends: DeadEndRow[];
  canonical: CanonicalDriftRow[];
}): ActionItem[] {
  const items: ActionItem[] = [];

  // CANONICAL_DRIFT — anything HIGH/CRITICAL is top severity
  for (const c of p.canonical) {
    const sev = c.drift_severity;
    if (sev === "CRITICAL" || sev === "HIGH" || sev === "MEDIUM") {
      items.push({
        code: "CANONICAL_DRIFT",
        severity: sev === "CRITICAL" ? "critical" : sev === "HIGH" ? "high" : "medium",
        target: c.slug ?? c.page_id,
        metric: 1,
        detail: `Canonical-Drift (${sev}) auf ${c.slug ?? c.page_id}`,
        recommendation: "Canonical-URL gegen SSOT prüfen + Re-Render triggern",
        score: 0,
      });
    }
  }

  // DEAD_END_PACKAGE
  for (const d of p.dead_ends) {
    if (d.is_seo_dead_end !== true) continue;
    items.push({
      code: "DEAD_END_PACKAGE",
      severity: "high",
      target: d.package_id,
      metric: (d.spokes_published ?? 0) + (d.blog_published ?? 0),
      detail: `${d.package_title ?? d.package_id}: ${d.blocking_reason ?? "blocked"} (${d.spokes_published ?? 0} Spokes, ${d.blog_published ?? 0} Blogs)`,
      recommendation: d.recommended_next_action ?? "Spokes/Blogs publishen oder Pillar reaktivieren",
      score: 0,
    });
  }

  // READINESS_GAP — packages with gaps but not full dead-ends
  const deadIds = new Set(p.dead_ends.filter((d) => d.is_seo_dead_end).map((d) => d.package_id));
  for (const r of p.readiness) {
    if (deadIds.has(r.package_id)) continue;
    const gaps = gapCodes(r);
    if (gaps.length === 0) continue;
    const sev: ActionItem["severity"] =
      gaps.length >= 4 ? "high" : gaps.length >= 2 ? "medium" : "low";
    items.push({
      code: "READINESS_GAP",
      severity: sev,
      target: r.package_id,
      metric: gaps.length,
      detail: `${r.package_title ?? r.package_id}: ${gaps.length} Lücken (${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? "…" : ""})`,
      recommendation: gaps.includes("not_customer_safe")
        ? "Customer-Safe-Block schließen (Pillars/Spokes/Blogs + Links)"
        : "Pending Artefakte publishen / Links akzeptieren",
      score: 0,
    });
  }

  // PILLAR_ORPHANED — pillars without spokes attached
  for (const r of p.readiness) {
    const orph = r.orphaned_pillar_count ?? 0;
    if (orph > 0) {
      items.push({
        code: "PILLAR_ORPHANED",
        severity: orph >= 3 ? "high" : "medium",
        target: r.package_id,
        metric: orph,
        detail: `${orph} Pillar(s) ohne Spokes in ${r.package_title ?? r.package_id}`,
        recommendation: "Spokes generieren oder Pillar deaktivieren",
        score: 0,
      });
    }
  }

  // THIN_CONTENT_RISK
  for (const r of p.readiness) {
    const thin = r.thin_content_risk_count ?? 0;
    if (thin > 0) {
      items.push({
        code: "THIN_CONTENT_RISK",
        severity: thin >= 5 ? "high" : "medium",
        target: r.package_id,
        metric: thin,
        detail: `${thin} dünne Inhalte in ${r.package_title ?? r.package_id}`,
        recommendation: "Inhalte anreichern oder noindex setzen",
        score: 0,
      });
    }
  }

  // ORPHAN — group already aggregated upstream; surface individual ones
  for (const o of p.orphans) {
    if (o.orphan_class === "no_inbound") {
      items.push({
        code: "ORPHAN_NO_INBOUND",
        severity: "high",
        target: o.url,
        metric: o.outbound_total ?? 0,
        detail: `${o.node_role ?? "node"} ohne eingehende Links: ${o.url}`,
        recommendation: "Inbound-Links aus Pillar/Spoke setzen",
        score: 0,
      });
    } else if (o.orphan_class === "no_outbound") {
      items.push({
        code: "ORPHAN_NO_OUTBOUND",
        severity: "medium",
        target: o.url,
        metric: o.inbound_total ?? 0,
        detail: `${o.node_role ?? "node"} ohne ausgehende Links: ${o.url}`,
        recommendation: "Outbound-Bridge-Links aktivieren",
        score: 0,
      });
    }
  }

  // BRIDGE_READY — aggregate by layer pair
  const readyMap = new Map<string, { count: number; sample: string }>();
  const dupeMap = new Map<string, { count: number; sample: string }>();
  for (const b of p.bridge) {
    const key = `${b.source_layer ?? "?"}→${b.target_layer ?? "?"}`;
    const targetSample = b.target_url ?? "";
    if (b.decision === "READY") {
      const cur = readyMap.get(key) ?? { count: 0, sample: targetSample };
      cur.count++;
      readyMap.set(key, cur);
    } else if (b.decision === "BLOCKED_DUPLICATE_EXISTING") {
      const cur = dupeMap.get(key) ?? { count: 0, sample: targetSample };
      cur.count++;
      dupeMap.set(key, cur);
    }
  }
  for (const [layer, v] of readyMap) {
    if (v.count >= 3) {
      items.push({
        code: "BRIDGE_READY",
        severity: v.count >= 50 ? "high" : v.count >= 20 ? "medium" : "low",
        target: layer,
        metric: v.count,
        detail: `${v.count} Bridge-Links bereit für ${layer}`,
        recommendation: "Bridge-Worker triggern: setzt interne Links aus Kandidaten",
        score: 0,
      });
    }
  }
  for (const [layer, v] of dupeMap) {
    if (v.count >= 10) {
      items.push({
        code: "BRIDGE_DUPLICATE",
        severity: v.count >= 50 ? "medium" : "low",
        target: layer,
        metric: v.count,
        detail: `${v.count} duplizierte Bridge-Kandidaten in ${layer} (existierende Links)`,
        recommendation: "Dedupe-Job auf v_seo_bridge_candidates_v1 ausführen",
        score: 0,
      });
    }
  }

  // Score & sort
  for (const it of items) {
    it.score = PRIORITY[it.code] * SEV_WEIGHT[it.severity];
  }
  return items.sort((a, b) => b.score - a.score).slice(0, 30);
}

export function buildReadinessGaps(rs: ReadinessRow[]): ReadinessGapBreakdown[] {
  return rs
    .map((r) => {
      const missing = gapCodes(r);
      return {
        package_id: r.package_id,
        package_title: r.package_title ?? r.package_id,
        missing,
        thin_content: r.thin_content_risk_count ?? 0,
        orphaned_pillars: r.orphaned_pillar_count ?? 0,
        pending_spokes: r.spoke_pending_count ?? 0,
        pending_blogs: r.blog_pending_count ?? 0,
        suggested_unaccepted_links: r.internal_link_suggested_count ?? 0,
      };
    })
    .filter((g) => g.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length)
    .slice(0, 20);
}

export function buildBridgeMatrix(rows: BridgeRow[]): Projection["bridge_layer_matrix"] {
  const map = new Map<string, { source_layer: string; target_layer: string; ready: number; blocked_dupe: number }>();
  for (const r of rows) {
    const sl = r.source_layer ?? "?";
    const tl = r.target_layer ?? "?";
    const key = `${sl}>${tl}`;
    const cur = map.get(key) ?? { source_layer: sl, target_layer: tl, ready: 0, blocked_dupe: 0 };
    if (r.decision === "READY") cur.ready++;
    else if (r.decision === "BLOCKED_DUPLICATE_EXISTING") cur.blocked_dupe++;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.ready - a.ready);
}

export function buildOrphanByRole(rows: OrphanRow[]): Projection["orphan_by_role"] {
  const map = new Map<string, { no_inbound: number; no_outbound: number }>();
  for (const r of rows) {
    const role = r.node_role ?? "unknown";
    const cur = map.get(role) ?? { no_inbound: 0, no_outbound: 0 };
    if (r.orphan_class === "no_inbound") cur.no_inbound++;
    else if (r.orphan_class === "no_outbound") cur.no_outbound++;
    map.set(role, cur);
  }
  return Array.from(map.entries())
    .map(([node_role, v]) => ({ node_role, ...v }))
    .sort((a, b) => (b.no_inbound + b.no_outbound) - (a.no_inbound + a.no_outbound));
}

export function buildDeadEndReasons(rows: DeadEndRow[]): Projection["dead_end_reasons"] {
  const map = new Map<string, { count: number; sample: string | null }>();
  for (const r of rows) {
    if (!r.is_seo_dead_end) continue;
    const reason = r.blocking_reason ?? "unspecified";
    const cur = map.get(reason) ?? { count: 0, sample: r.package_id };
    cur.count++;
    map.set(reason, cur);
  }
  return Array.from(map.entries())
    .map(([reason, v]) => ({ reason, count: v.count, sample_package_id: v.sample }))
    .sort((a, b) => b.count - a.count);
}

export function project(inputs: ProjInputs): Projection {
  const readiness = inputs.readiness;
  const totalsReadiness = {
    total: readiness.length,
    safe: readiness.filter((r) => r.seo_customer_safe === true).length,
    intent: readiness.filter((r) => r.intent_pipeline_healthy === true).length,
    suggestedLinks: readiness.reduce((a, r) => a + (r.internal_link_suggested_count ?? 0), 0),
  };
  const deadCount = inputs.dead_ends.filter((d) => d.is_seo_dead_end === true).length;
  const driftCrit = inputs.canonical.filter((c) =>
    c.drift_severity === "CRITICAL" || c.drift_severity === "HIGH"
  ).length;
  const bridgeReady = inputs.bridge.filter((b) => b.decision === "READY").length;
  const bridgeDupes = inputs.bridge.filter((b) => b.decision === "BLOCKED_DUPLICATE_EXISTING").length;
  const orphansNoIn = inputs.orphans.filter((o) => o.orphan_class === "no_inbound").length;
  const orphansNoOut = inputs.orphans.filter((o) => o.orphan_class === "no_outbound").length;

  return {
    generated_at: inputs.now_iso,
    projector_version: PROJECTOR_VERSION,
    totals: {
      packages_total: totalsReadiness.total,
      packages_customer_safe: totalsReadiness.safe,
      packages_intent_healthy: totalsReadiness.intent,
      packages_dead_end: deadCount,
      canonical_drift_critical: driftCrit,
      bridge_candidates_total: inputs.bridge.length,
      bridge_ready_to_link: bridgeReady,
      bridge_duplicates: bridgeDupes,
      orphans_total: inputs.orphans.length,
      orphans_no_inbound: orphansNoIn,
      orphans_no_outbound: orphansNoOut,
      suggested_links_unaccepted: totalsReadiness.suggestedLinks,
      customer_safe_rate:
        totalsReadiness.total > 0
          ? Math.round((totalsReadiness.safe / totalsReadiness.total) * 1000) / 1000
          : 0,
    },
    action_queue: buildActionQueue(inputs),
    readiness_gaps_top: buildReadinessGaps(readiness),
    bridge_layer_matrix: buildBridgeMatrix(inputs.bridge),
    orphan_by_role: buildOrphanByRole(inputs.orphans),
    dead_end_reasons: buildDeadEndReasons(inputs.dead_ends),
  };
}
