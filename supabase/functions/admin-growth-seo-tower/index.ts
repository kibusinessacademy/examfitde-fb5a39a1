import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type SB = ReturnType<typeof createClient>;

async function assertAdmin(sb: SB, userId: string) {
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error || !data) throw new Error("FORBIDDEN");
}

/* ── Safe helpers (fail-soft) ── */
async function safeCount(sb: SB, table: string, filters?: Record<string, unknown>): Promise<number> {
  try {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        q = q.eq(k, v);
      }
    }
    const { count } = await q;
    return count ?? 0;
  } catch { return 0; }
}

async function safeFrom(sb: SB, table: string, select = "*", opts?: {
  filters?: Record<string, unknown>;
  order?: string;
  ascending?: boolean;
  limit?: number;
}): Promise<any[]> {
  try {
    let q = sb.from(table).select(select);
    if (opts?.filters) {
      for (const [k, v] of Object.entries(opts.filters)) {
        q = q.eq(k, v);
      }
    }
    if (opts?.order) q = q.order(opts.order, { ascending: opts.ascending ?? false });
    if (opts?.limit) q = q.limit(opts.limit);
    const { data } = await q;
    return data ?? [];
  } catch { return []; }
}

/* ── SEO Health Score Calculator ── */
async function computeSeoHealth(sb: SB) {
  // Content pages
  const pages = await safeFrom(sb, "content_pages", "id, status, meta_title, meta_description, slug, title, noindex, updated_at");
  const publishedPages = pages.filter(p => p.status === "published");
  const draftPages = pages.filter(p => p.status === "draft");
  const reviewPages = pages.filter(p => p.status === "review");

  // SEO gaps in published pages
  const missingMetaTitle = publishedPages.filter(p => !p.meta_title || p.meta_title.length === 0);
  const longMetaTitle = publishedPages.filter(p => p.meta_title && p.meta_title.length > 60);
  const missingMetaDesc = publishedPages.filter(p => !p.meta_description || p.meta_description.length === 0);
  const longMetaDesc = publishedPages.filter(p => p.meta_description && p.meta_description.length > 160);
  const noindexPages = publishedPages.filter(p => p.noindex);

  // Blog posts
  const blogs = await safeFrom(sb, "blog_posts", "id, status, meta_title, meta_description, slug, title, tags, noindex, updated_at, published_at");
  const publishedBlogs = blogs.filter(b => b.status === "published");
  const draftBlogs = blogs.filter(b => b.status === "draft");
  const blogsMissingMeta = publishedBlogs.filter(b => !b.meta_title || !b.meta_description);
  const blogsMissingTags = publishedBlogs.filter(b => !b.tags || b.tags.length === 0);

  // Redirects
  const redirects = await safeFrom(sb, "seo_redirects", "id, from_path, to_path, is_active, status_code");
  const activeRedirects = redirects.filter(r => r.is_active);
  const brokenRedirects = redirects.filter(r => !r.to_path || r.to_path.trim() === "");

  // Backlinks
  const backlinks = await safeFrom(sb, "backlinks", "id, status, domain_authority, source_url");
  const activeBacklinks = backlinks.filter(b => b.status === "active");
  const highDABacklinks = activeBacklinks.filter(b => (b.domain_authority ?? 0) >= 40);

  // SEO Settings coverage
  const seoSettings = await safeFrom(sb, "seo_settings", "id, page_type, meta_title, meta_description, structured_data");
  const settingsWithSchema = seoSettings.filter(s => s.structured_data);

  // Calculate health score (0-100)
  const totalPublished = publishedPages.length + publishedBlogs.length;
  const metaCoverage = totalPublished > 0
    ? ((totalPublished - missingMetaTitle.length - blogsMissingMeta.length) / totalPublished) * 100
    : 100;
  const descCoverage = totalPublished > 0
    ? ((totalPublished - missingMetaDesc.length - blogsMissingMeta.filter(b => !b.meta_description).length) / totalPublished) * 100
    : 100;
  const healthScore = Math.round((metaCoverage * 0.4 + descCoverage * 0.4 + Math.min(100, highDABacklinks.length * 10) * 0.2));

  return {
    health_score: healthScore,
    pages: {
      total: pages.length,
      published: publishedPages.length,
      draft: draftPages.length,
      review: reviewPages.length,
    },
    blogs: {
      total: blogs.length,
      published: publishedBlogs.length,
      draft: draftBlogs.length,
      missing_meta: blogsMissingMeta.length,
      missing_tags: blogsMissingTags.length,
    },
    seo_gaps: {
      missing_meta_title: missingMetaTitle.map(p => ({ id: p.id, title: p.title, slug: p.slug })),
      long_meta_title: longMetaTitle.map(p => ({ id: p.id, title: p.title, length: p.meta_title?.length })),
      missing_meta_desc: missingMetaDesc.map(p => ({ id: p.id, title: p.title, slug: p.slug })),
      long_meta_desc: longMetaDesc.map(p => ({ id: p.id, title: p.title, length: p.meta_description?.length })),
      noindex_published: noindexPages.map(p => ({ id: p.id, title: p.title })),
    },
    redirects: {
      total: redirects.length,
      active: activeRedirects.length,
      broken: brokenRedirects.length,
    },
    backlinks: {
      total: backlinks.length,
      active: activeBacklinks.length,
      high_da: highDABacklinks.length,
    },
    schema_coverage: {
      total_settings: seoSettings.length,
      with_structured_data: settingsWithSchema.length,
    },
  };
}

/* ── Growth Intelligence ── */
async function computeGrowthIntel(sb: SB) {
  // Churn predictions
  const churnPredictions = await safeFrom(sb, "churn_predictions", "id, user_id, risk_score, risk_level, recommended_action, signals, predicted_at, action_taken", {
    order: "risk_score",
    ascending: false,
    limit: 100,
  });
  const highRisk = churnPredictions.filter(p => p.risk_score > 70);
  const medRisk = churnPredictions.filter(p => p.risk_score > 40 && p.risk_score <= 70);

  // Growth actions
  const growthActions = await safeFrom(sb, "growth_actions", "id, action_type, status, title, target_user_id, created_at", {
    order: "created_at",
    limit: 100,
  });
  const proposed = growthActions.filter(a => a.status === "proposed");
  const approved = growthActions.filter(a => a.status === "approved");
  const sent = growthActions.filter(a => a.status === "sent");
  const failed = growthActions.filter(a => a.status === "failed");

  // Risk scores
  const riskScores = await safeFrom(sb, "growth_risk_scores", "id, user_id, score, label, signals_json, computed_at", {
    order: "score",
    ascending: false,
    limit: 50,
  });

  return {
    churn: {
      total: churnPredictions.length,
      high_risk: highRisk.length,
      medium_risk: medRisk.length,
      no_action_taken: churnPredictions.filter(p => !p.action_taken).length,
      top_risks: highRisk.slice(0, 5).map(p => ({
        user_id: p.user_id,
        score: p.risk_score,
        level: p.risk_level,
        action: p.recommended_action,
        signals: p.signals,
      })),
    },
    nudges: {
      proposed: proposed.length,
      approved: approved.length,
      sent: sent.length,
      failed: failed.length,
      pending_approval: proposed.length,
    },
    risk_scores: {
      total: riskScores.length,
      critical: riskScores.filter(r => r.score > 80).length,
    },
  };
}

/* ── Publish Readiness (Business Impact) ──
 * SSOT: v_admin_publish_readiness liefert kanonische publish_ready (Track-spezifisch:
 * approved_exam_questions ≥ Track-Min UND tutor_index_items > 0 UND integrity_passed
 * UND quality_council_status='done', plus Track-spezifische Pflichtartefakte).
 * "Bereit zur Veröffentlichung" = publish_ready = true UND is_published = false.
 * Frühere Heuristik (status='done' / status='quality_gate_failed') hat falsche Zahlen
 * geliefert weil diese Statuswerte gar nicht existieren — daher die Drift im Cockpit.
 */
async function computePublishReadiness(sb: SB) {
  const { data: readiness, error: readErr } = await sb
    .from("v_admin_publish_readiness")
    .select("package_id, curriculum_title, package_track, integrity_passed, primary_blocker, publish_ready, is_published, package_status")
    .limit(500);

  if (readErr) {
    console.error("publish-readiness view error", readErr);
  }

  const all = (readiness ?? []) as any[];
  const ready = all.filter(r => r.publish_ready === true && r.is_published !== true);
  const blocked = all.filter(r => r.publish_ready !== true && r.is_published !== true && r.primary_blocker);
  const publishedTotal = all.filter(r => r.is_published === true).length;

  const coursesMissingLanding = await safeFrom(sb, "courses", "id, title, slug, status", {
    filters: { status: "active" },
    limit: 200,
  });

  return {
    ready_to_publish: ready.length,
    blocked_packages: blocked.length,
    published_total: publishedTotal,
    ready_packages: ready.slice(0, 10).map(p => ({
      id: p.package_id,
      title: p.curriculum_title,
      track: p.package_track,
      integrity_passed: p.integrity_passed,
    })),
    blocked_details: blocked.slice(0, 10).map(p => ({
      id: p.package_id,
      title: p.curriculum_title,
      reason: p.primary_blocker,
      track: p.package_track,
    })),
    active_courses: coursesMissingLanding.length,
  };
}

/* ── Auto-Diagnosed Issues ── */
function diagnoseIssues(seo: any, growth: any, publish: any) {
  const issues: Array<{
    severity: "critical" | "high" | "medium" | "low";
    domain: "seo" | "growth" | "publish" | "content";
    title: string;
    detail: string;
    metric: number;
    recommendation: string;
  }> = [];

  // SEO issues
  if (seo.seo_gaps.missing_meta_title.length > 0) {
    issues.push({
      severity: seo.seo_gaps.missing_meta_title.length > 5 ? "high" : "medium",
      domain: "seo",
      title: "Fehlende Meta-Titles",
      detail: `${seo.seo_gaps.missing_meta_title.length} veröffentlichte Seiten ohne Meta-Title`,
      metric: seo.seo_gaps.missing_meta_title.length,
      recommendation: "Meta-Titles für alle veröffentlichten Seiten hinzufügen (< 60 Zeichen)",
    });
  }

  if (seo.seo_gaps.missing_meta_desc.length > 0) {
    issues.push({
      severity: seo.seo_gaps.missing_meta_desc.length > 5 ? "high" : "medium",
      domain: "seo",
      title: "Fehlende Meta-Descriptions",
      detail: `${seo.seo_gaps.missing_meta_desc.length} veröffentlichte Seiten ohne Meta-Description`,
      metric: seo.seo_gaps.missing_meta_desc.length,
      recommendation: "Meta-Descriptions für alle veröffentlichten Seiten hinzufügen (< 160 Zeichen)",
    });
  }

  if (seo.seo_gaps.noindex_published.length > 0) {
    issues.push({
      severity: "high",
      domain: "seo",
      title: "Noindex auf veröffentlichten Seiten",
      detail: `${seo.seo_gaps.noindex_published.length} Seiten sind published aber noindex`,
      metric: seo.seo_gaps.noindex_published.length,
      recommendation: "Noindex-Flag entfernen oder Seiten depublizieren",
    });
  }

  if (seo.redirects.broken > 0) {
    issues.push({
      severity: "critical",
      domain: "seo",
      title: "Kaputte Redirects",
      detail: `${seo.redirects.broken} Redirects ohne gültiges Ziel`,
      metric: seo.redirects.broken,
      recommendation: "Redirects mit fehlendem Ziel-Pfad korrigieren oder deaktivieren",
    });
  }

  if (seo.blogs.missing_meta > 0) {
    issues.push({
      severity: "medium",
      domain: "content",
      title: "Blog-Posts ohne SEO-Meta",
      detail: `${seo.blogs.missing_meta} veröffentlichte Blog-Posts ohne Meta-Title oder -Description`,
      metric: seo.blogs.missing_meta,
      recommendation: "SEO-Metadaten für alle veröffentlichten Blog-Posts ergänzen",
    });
  }

  if (seo.pages.draft > 3) {
    issues.push({
      severity: "low",
      domain: "content",
      title: "Stale Drafts",
      detail: `${seo.pages.draft} Seiten im Entwurf-Status`,
      metric: seo.pages.draft,
      recommendation: "Entwürfe überprüfen: veröffentlichen oder archivieren",
    });
  }

  // Growth issues
  if (growth.churn.high_risk > 0) {
    issues.push({
      severity: growth.churn.high_risk > 10 ? "critical" : "high",
      domain: "growth",
      title: "Hohes Churn-Risiko",
      detail: `${growth.churn.high_risk} Nutzer mit Abwanderungsrisiko > 70%`,
      metric: growth.churn.high_risk,
      recommendation: "Sofortige Nudge-Intervention für Hochrisiko-Nutzer starten",
    });
  }

  if (growth.nudges.failed > 0) {
    issues.push({
      severity: "medium",
      domain: "growth",
      title: "Fehlgeschlagene Nudges",
      detail: `${growth.nudges.failed} Nudges konnten nicht zugestellt werden`,
      metric: growth.nudges.failed,
      recommendation: "Fehlgeschlagene Nudges überprüfen und erneut versuchen",
    });
  }

  if (growth.nudges.pending_approval > 5) {
    issues.push({
      severity: "medium",
      domain: "growth",
      title: "Nudges warten auf Freigabe",
      detail: `${growth.nudges.pending_approval} Nudges warten auf Admin-Freigabe`,
      metric: growth.nudges.pending_approval,
      recommendation: "Vorgeschlagene Nudges in der Nudge Engine freigeben oder ablehnen",
    });
  }

  // Publish issues
  if (publish.ready_to_publish > 0) {
    issues.push({
      severity: "high",
      domain: "publish",
      title: "Kurse bereit zur Veröffentlichung",
      detail: `${publish.ready_to_publish} Pakete sind fertig aber nicht veröffentlicht (entgangener SEO-/Umsatz-Impact)`,
      metric: publish.ready_to_publish,
      recommendation: "Fertige Pakete zeitnah veröffentlichen für SEO-Indexierung und Umsatz",
    });
  }

  if (publish.blocked_packages > 0) {
    issues.push({
      severity: "high",
      domain: "publish",
      title: "Publish-Blocker",
      detail: `${publish.blocked_packages} Pakete blockiert durch Quality Gate`,
      metric: publish.blocked_packages,
      recommendation: "Quality-Gate-Fails analysieren und Inhalte nachbessern",
    });
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return issues;
}

/* ── Main handler ── */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify user
    const userSb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userSb.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    await assertAdmin(sb, user.id);

    const { action } = await req.json();

    switch (action) {
      case "overview": {
        const [seo, growth, publish] = await Promise.all([
          computeSeoHealth(sb),
          computeGrowthIntel(sb),
          computePublishReadiness(sb),
        ]);

        const issues = diagnoseIssues(seo, growth, publish);

        // Health bar items
        const health = [
          {
            key: "seo_score",
            label: "SEO Score",
            tone: seo.health_score >= 80 ? "green" : seo.health_score >= 50 ? "yellow" : "red",
            value: seo.health_score,
            hint: `${seo.health_score}% SEO-Abdeckung`,
          },
          {
            key: "pages_published",
            label: "Seiten Live",
            tone: seo.pages.published > 0 ? "green" : "yellow",
            value: seo.pages.published,
            hint: `${seo.pages.total} gesamt`,
          },
          {
            key: "blogs_published",
            label: "Blog Live",
            tone: seo.blogs.published > 0 ? "green" : "yellow",
            value: seo.blogs.published,
            hint: `${seo.blogs.total} gesamt`,
          },
          {
            key: "backlinks",
            label: "Backlinks",
            tone: seo.backlinks.high_da > 5 ? "green" : seo.backlinks.high_da > 0 ? "yellow" : "neutral",
            value: seo.backlinks.active,
            hint: `${seo.backlinks.high_da} mit DA ≥ 40`,
          },
          {
            key: "churn_risk",
            label: "Churn-Risiko",
            tone: growth.churn.high_risk > 10 ? "red" : growth.churn.high_risk > 0 ? "yellow" : "green",
            value: growth.churn.high_risk,
            hint: `${growth.churn.total} überwacht`,
          },
          {
            key: "publish_ready",
            label: "Publish-Ready",
            tone: publish.ready_to_publish > 0 ? "yellow" : "green",
            value: publish.ready_to_publish,
            hint: publish.ready_to_publish > 0 ? "Kurse warten auf Veröffentlichung" : "Alles veröffentlicht",
          },
          {
            key: "nudges",
            label: "Nudges",
            tone: growth.nudges.failed > 0 ? "red" : growth.nudges.pending_approval > 3 ? "yellow" : "green",
            value: growth.nudges.sent,
            hint: `${growth.nudges.pending_approval} warten auf Freigabe`,
          },
        ];

        return json({
          health,
          seo,
          growth,
          publish,
          issues,
          generated_at: new Date().toISOString(),
        });
      }

      case "approve_nudge": {
        const body = await req.json().catch(() => ({}));
        const actionId = body.action_id;
        if (!actionId) return json({ error: "action_id required" }, 400);
        await sb.rpc("admin_approve_growth_action", { p_action_id: actionId });
        return json({ ok: true });
      }

      case "dismiss_nudge": {
        const body = await req.json().catch(() => ({}));
        const actionId = body.action_id;
        if (!actionId) return json({ error: "action_id required" }, 400);
        await sb.rpc("admin_dismiss_growth_action", { p_action_id: actionId });
        return json({ ok: true });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    if (err.message === "FORBIDDEN") return json({ error: "Forbidden" }, 403);
    console.error("admin-growth-seo-tower error:", err);
    return json({ error: err.message }, 500);
  }
});
