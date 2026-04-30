// SEO Audit Runner — deterministic checks per published page.
// Writes 1 row per page into seo_content_audits (UPSERT on (content_id, content_type)).
// Severity-Score 0..100 per dimension; overall_score weighted.
//
// Modes:
//   { mode: "single", content_id, content_type }         -> audit one page
//   { mode: "batch",  limit?: number = 25 }              -> audit oldest-not-audited or stale (>14d)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type AuditOutcome = {
  seo_score: number;
  intent_match_score: number;
  conversion_score: number;
  completeness_score: number;
  interlink_score: number;
  refresh_risk_score: number;
  overall_score: number;
  issues: any[];
  recommendations: any[];
  schema_recommendation: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const auth = req.headers.get("Authorization");
    if (!auth) return forbid(401, "unauthorized");
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) return forbid(401, "unauthorized");
    const { data: roles } = await supa.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin");
    if (!roles || roles.length === 0) return forbid(403, "forbidden_admin_only");

    const body = await req.json().catch(() => ({}));
    const mode = body.mode ?? "batch";

    let targets: Array<{ id: string; type: string }> = [];

    if (mode === "single") {
      if (!body.content_id || !body.content_type) return forbid(400, "content_id+content_type required");
      targets = [{ id: body.content_id, type: body.content_type }];
    } else {
      const limit = Math.min(Math.max(body.limit ?? 25, 1), 50);
      // pick stale or never-audited published seo_documents
      const { data: docs } = await supa
        .from("seo_documents")
        .select("id")
        .eq("status", "published")
        .limit(200);
      const ids = (docs ?? []).map((d: any) => d.id);
      if (ids.length === 0) {
        return ok({ audited: 0, message: "no published documents" });
      }
      const { data: prior } = await supa
        .from("seo_content_audits")
        .select("content_id, audited_at")
        .in("content_id", ids)
        .eq("content_type", "seo_document");
      const priorMap = new Map((prior ?? []).map((p: any) => [p.content_id, new Date(p.audited_at).getTime()]));
      const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
      const staleOrNew = ids
        .map((id: string) => ({ id, ts: priorMap.get(id) ?? 0 }))
        .filter((r: any) => r.ts < cutoff)
        .sort((a: any, b: any) => a.ts - b.ts)
        .slice(0, limit);
      targets = staleOrNew.map((r: any) => ({ id: r.id, type: "seo_document" }));
    }

    let audited = 0;
    const summaries: any[] = [];

    for (const t of targets) {
      const audit = await auditOne(supa, t.id, t.type);
      if (!audit) continue;
      const { error: upErr } = await supa.from("seo_content_audits").upsert({
        content_id: t.id,
        content_type: t.type,
        ...audit.outcome,
        content_url: audit.content_url,
        content_title: audit.content_title,
        audited_at: new Date().toISOString(),
      }, { onConflict: "content_id,content_type" });
      if (upErr) {
        console.error("audit upsert failed", t.id, upErr);
        continue;
      }
      audited++;
      summaries.push({
        content_id: t.id,
        title: audit.content_title,
        overall_score: audit.outcome.overall_score,
        critical_issues: audit.outcome.issues.filter((i: any) => i.severity === "critical").length,
      });
    }

    await supa.from("auto_heal_log").insert({
      action_type: "seo_audit_batch_run",
      target_id: null,
      target_type: "seo_content_audits",
      metadata: { mode, audited, caller: u.user.id, timestamp: new Date().toISOString() },
    });

    return ok({ audited, summaries });
  } catch (e) {
    console.error("seo-audit-run error", e);
    return forbid(500, e instanceof Error ? e.message : "unknown");
  }
});

async function auditOne(supa: any, content_id: string, content_type: string) {
  if (content_type !== "seo_document") return null;
  const { data: doc } = await supa.from("seo_documents").select("*").eq("id", content_id).single();
  if (!doc) return null;

  const issues: any[] = [];
  const recommendations: any[] = [];

  // Meta-Title
  const titleLen = (doc.meta_title ?? doc.title ?? "").length;
  let seo_score = 100;
  if (titleLen === 0) { seo_score -= 30; issues.push({ severity: "critical", code: "META_TITLE_MISSING", message: "Meta-Title fehlt" }); recommendations.push({ code: "FIX_META_TITLE", hint: "Ergänze meta_title (50-60 Zeichen, mit Keyword)" }); }
  else if (titleLen < 30) { seo_score -= 10; issues.push({ severity: "high", code: "META_TITLE_SHORT", message: `Meta-Title nur ${titleLen} Zeichen` }); }
  else if (titleLen > 65) { seo_score -= 8; issues.push({ severity: "medium", code: "META_TITLE_LONG", message: `Meta-Title ${titleLen} Zeichen (>65)` }); }

  // Meta-Description
  const descLen = (doc.meta_description ?? "").length;
  if (descLen === 0) { seo_score -= 20; issues.push({ severity: "high", code: "META_DESC_MISSING", message: "Meta-Description fehlt" }); recommendations.push({ code: "FIX_META_DESC", hint: "120-160 Zeichen, CTA enthalten" }); }
  else if (descLen < 80) { seo_score -= 8; issues.push({ severity: "medium", code: "META_DESC_SHORT", message: `Meta-Desc nur ${descLen} Zeichen` }); }
  else if (descLen > 170) { seo_score -= 5; issues.push({ severity: "low", code: "META_DESC_LONG", message: `Meta-Desc ${descLen} Zeichen` }); }

  // Canonical
  if (!doc.canonical_url) { seo_score -= 5; issues.push({ severity: "low", code: "CANONICAL_MISSING", message: "Canonical fehlt" }); }

  // Content-Length
  const wordCount = ((doc.content_md ?? "").match(/\S+/g) ?? []).length;
  let completeness_score = 100;
  if (wordCount < 300) { completeness_score = 30; issues.push({ severity: "critical", code: "THIN_CONTENT", message: `Nur ${wordCount} Wörter` }); }
  else if (wordCount < 800) { completeness_score = 60; issues.push({ severity: "medium", code: "SHORT_CONTENT", message: `${wordCount} Wörter (Empfehlung: >1200)` }); }
  else if (wordCount < 1200) { completeness_score = 80; }

  // Internal Links
  const internalLinks = Array.isArray(doc.internal_links) ? doc.internal_links : [];
  let interlink_score = Math.min(100, internalLinks.length * 15);
  if (internalLinks.length === 0) { issues.push({ severity: "high", code: "NO_INTERNAL_LINKS", message: "Keine internen Links" }); recommendations.push({ code: "ADD_INTERNAL_LINKS", hint: "≥3 Links zu thematisch verwandten Pages" }); }
  else if (internalLinks.length < 3) { issues.push({ severity: "medium", code: "FEW_INTERNAL_LINKS", message: `Nur ${internalLinks.length} interne Links` }); }

  // Intent Match (heuristic via doc_type vs typical intent patterns)
  let intent_match_score = 70;
  const isCommercial = /preis|kaufen|paket|kurs|certificate|product/i.test(doc.slug ?? "");
  const isInformational = /was-ist|wie|warum|guide|anleitung|tipps/i.test(doc.slug ?? "");
  if (isCommercial && /faq|frage|how/i.test(doc.title ?? "")) {
    intent_match_score = 50;
    issues.push({ severity: "medium", code: "INTENT_MISMATCH", message: "Slug=commercial, Titel=informational" });
  } else if (isInformational || isCommercial) {
    intent_match_score = 90;
  }

  // Conversion Hooks (CTA-Patterns im Content)
  let conversion_score = 50;
  const md = doc.content_md ?? "";
  const ctaHits = (md.match(/\[.*?\]\(.*?(checkout|paket|kostenlos|test|quiz|jetzt).*?\)/gi) ?? []).length;
  if (ctaHits === 0) { conversion_score = 20; issues.push({ severity: "high", code: "NO_CTA", message: "Keine CTA-Links erkennbar" }); recommendations.push({ code: "ADD_CTA", hint: "Mindestens 1 Lead-Magnet- oder Paket-CTA" }); }
  else if (ctaHits >= 3) { conversion_score = 90; }
  else { conversion_score = 60 + ctaHits * 10; }

  // Refresh Risk: age + qc_score
  const ageDays = doc.published_at ? (Date.now() - new Date(doc.published_at).getTime()) / 86400000 : 0;
  let refresh_risk_score = 0;
  if (ageDays > 365) refresh_risk_score += 50;
  else if (ageDays > 180) refresh_risk_score += 30;
  else if (ageDays > 90) refresh_risk_score += 15;
  if ((doc.qc_score ?? 0) < 70) refresh_risk_score += 30;
  refresh_risk_score = Math.min(100, refresh_risk_score);

  // Schema recommendation
  let schema_recommendation: string | null = null;
  if (/faq/i.test(doc.slug)) schema_recommendation = "FAQPage";
  else if (/anleitung|guide|tutorial|how/i.test(doc.slug)) schema_recommendation = "HowTo";
  else if (doc.doc_type === "blog") schema_recommendation = "Article";
  else schema_recommendation = "WebPage";

  const overall_score = Math.round(
    seo_score * 0.25 +
    intent_match_score * 0.15 +
    conversion_score * 0.20 +
    completeness_score * 0.20 +
    interlink_score * 0.10 +
    (100 - refresh_risk_score) * 0.10,
  );

  return {
    content_url: "/" + doc.slug,
    content_title: doc.title,
    outcome: {
      seo_score: Math.max(0, seo_score),
      intent_match_score,
      conversion_score,
      completeness_score,
      interlink_score,
      refresh_risk_score,
      overall_score: Math.max(0, Math.min(100, overall_score)),
      issues,
      recommendations,
      schema_recommendation,
    } as AuditOutcome,
  };
}

function ok(body: any) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function forbid(status: number, msg: string) {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
