import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

/**
 * seo-discovery-engine – Centralized SEO intelligence
 * 
 * Actions:
 *   keyword_opportunity_score  – Recalculate scores for all keywords
 *   content_gap_analysis       – Find gaps in keyword → content coverage
 *   cannibalization_detect     – Find keyword cannibalization issues
 *   generate_content_brief     – AI-powered brief generation for a keyword
 *   refresh_discovery_state    – Sync discovery state for all published content
 *   health_scores              – Calculate discovery health scores
 */

const SITE_URL = "https://examfit.de";

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });
  }

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const action = body.action || "keyword_opportunity_score";

  try {
    // ═══════════════════════════════════════════════════════
    // 1. Keyword Opportunity Score Recalculation
    // ═══════════════════════════════════════════════════════
    if (action === "keyword_opportunity_score") {
      const { data: keywords } = await sb
        .from("seo_keywords")
        .select("id, search_volume, conversion_value, curriculum_fit, difficulty, content_gap_score, persona, business_value")
        .order("updated_at", { ascending: true })
        .limit(500);

      let updated = 0;
      for (const kw of keywords || []) {
        const sv = Math.min((kw.search_volume || 0) / 1000, 10);
        const cv = kw.conversion_value || 5;
        const cf = kw.curriculum_fit || 5;
        const pf = kw.persona ? 8 : 5;
        const cg = kw.content_gap_score || 0;
        const lc = kw.difficulty ? Math.max(0, 10 - kw.difficulty / 10) : 5;
        const score = Math.round(((sv * 0.20) + (cv * 0.25) + (cf * 0.20) + (pf * 0.15) + (cg * 0.10) + (lc * 0.10)) * 10) / 10;

        await sb.from("seo_keywords").update({
          opportunity_score: score,
          updated_at: new Date().toISOString(),
        }).eq("id", kw.id);
        updated++;
      }

      return new Response(JSON.stringify({ ok: true, action, updated }), { headers });
    }

    // ═══════════════════════════════════════════════════════
    // 2. Content Gap Analysis
    // ═══════════════════════════════════════════════════════
    if (action === "content_gap_analysis") {
      const { data: keywords } = await sb
        .from("seo_keywords")
        .select("id, keyword, intent_type, target_page_type, target_url, cluster_id, status")
        .in("status", ["new", "active"])
        .order("opportunity_score", { ascending: false })
        .limit(200);

      const { data: blogs } = await sb
        .from("blog_articles")
        .select("slug, title, keywords")
        .eq("status", "published");

      const { data: seoDocs } = await sb
        .from("seo_documents")
        .select("slug, title, doc_type")
        .eq("status", "published");

      const existingSlugs = new Set([
        ...(blogs || []).map(b => b.slug),
        ...(seoDocs || []).map(d => d.slug),
      ]);
      const existingTitles = new Set([
        ...(blogs || []).map(b => b.title?.toLowerCase()),
        ...(seoDocs || []).map(d => d.title?.toLowerCase()),
      ]);

      const gaps: Array<{ keyword_id: string; keyword: string; gap_type: string; recommendation: string }> = [];

      for (const kw of keywords || []) {
        const kwLower = kw.keyword.toLowerCase();
        const hasContent = [...existingTitles].some(t => t?.includes(kwLower) || kwLower.includes(t || ""));

        if (!hasContent) {
          gaps.push({
            keyword_id: kw.id,
            keyword: kw.keyword,
            gap_type: "no_content",
            recommendation: `Erstelle ${kw.target_page_type || "content"} für "${kw.keyword}"`,
          });
        }

        // Check if transactional keyword lacks a landing page
        if (kw.intent_type === "transactional" && !kw.target_url) {
          gaps.push({
            keyword_id: kw.id,
            keyword: kw.keyword,
            gap_type: "missing_landing_page",
            recommendation: `Transaktionales Keyword ohne Landingpage: "${kw.keyword}"`,
          });
        }
      }

      // Update content_gap_score for keywords without content
      for (const gap of gaps.filter(g => g.gap_type === "no_content")) {
        await sb.from("seo_keywords").update({ content_gap_score: 8 }).eq("id", gap.keyword_id);
      }

      return new Response(JSON.stringify({ ok: true, action, gaps_found: gaps.length, gaps: gaps.slice(0, 50) }), { headers });
    }

    // ═══════════════════════════════════════════════════════
    // 3. Cannibalization Detection
    // ═══════════════════════════════════════════════════════
    if (action === "cannibalization_detect") {
      const { data: keywords } = await sb
        .from("seo_keywords")
        .select("id, keyword, target_url")
        .in("status", ["active", "new"])
        .order("opportunity_score", { ascending: false });

      const issues: Array<{ keyword: string; urls: string[]; severity: string }> = [];
      const kwMap = new Map<string, string[]>();

      for (const kw of keywords || []) {
        const key = kw.keyword.toLowerCase().trim();
        if (!kwMap.has(key)) kwMap.set(key, []);
        if (kw.target_url) kwMap.get(key)!.push(kw.target_url);
      }

      for (const [keyword, urls] of kwMap) {
        const unique = [...new Set(urls)];
        if (unique.length > 1) {
          issues.push({
            keyword,
            urls: unique,
            severity: unique.length > 2 ? "high" : "medium",
          });
        }
      }

      return new Response(JSON.stringify({ ok: true, action, issues_found: issues.length, issues }), { headers });
    }

    // ═══════════════════════════════════════════════════════
    // 4. Refresh Discovery State
    // ═══════════════════════════════════════════════════════
    if (action === "refresh_discovery_state") {
      let synced = 0;

      // Blog articles
      const { data: blogs } = await sb
        .from("blog_articles")
        .select("id, slug, status, updated_at")
        .eq("status", "published")
        .not("slug", "is", null);

      for (const b of blogs || []) {
        await sb.from("seo_discovery_state").upsert({
          source_type: "blog_post",
          source_id: b.id,
          canonical_url: `${SITE_URL}/blog/${b.slug}`,
          is_indexable: true,
          in_sitemap: true,
          in_feed: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "source_type,source_id" });
        synced++;
      }

      // SEO documents
      const { data: seoDocs } = await sb
        .from("seo_documents")
        .select("id, slug, doc_type, status, updated_at")
        .eq("status", "published")
        .not("slug", "is", null);

      const docTypeUrlMap: Record<string, string> = {
        blog: "/wissen", landing: "/pruefungstraining", faq: "/faq",
        glossary: "/glossar", product: "/produkt", cluster: "/wissen",
      };

      for (const d of seoDocs || []) {
        const basePath = docTypeUrlMap[d.doc_type] || "/wissen";
        await sb.from("seo_discovery_state").upsert({
          source_type: "seo_document",
          source_id: d.id,
          canonical_url: `${SITE_URL}${basePath}/${d.slug}`,
          is_indexable: true,
          in_sitemap: true,
          in_feed: d.doc_type === "blog" || d.doc_type === "landing",
          updated_at: new Date().toISOString(),
        }, { onConflict: "source_type,source_id" });
        synced++;
      }

      return new Response(JSON.stringify({ ok: true, action, synced }), { headers });
    }

    // ═══════════════════════════════════════════════════════
    // 5. Discovery Health Scores
    // ═══════════════════════════════════════════════════════
    if (action === "health_scores") {
      const { data: states } = await sb
        .from("seo_discovery_state")
        .select("*")
        .eq("is_indexable", true);

      let healthy = 0;
      let issues = 0;
      const problems: Array<{ url: string; issue: string }> = [];

      for (const s of states || []) {
        let score = 0;
        if (s.is_indexable) score++;
        if (s.canonical_url) score++;
        if (s.in_sitemap) score++;
        if (s.in_feed) score++;
        if (s.last_submitted_via_indexnow_at) score++;

        if (score >= 4) {
          healthy++;
        } else {
          issues++;
          if (!s.in_sitemap) problems.push({ url: s.canonical_url, issue: "not_in_sitemap" });
          if (!s.last_submitted_via_indexnow_at) problems.push({ url: s.canonical_url, issue: "never_submitted_indexnow" });
        }
      }

      return new Response(JSON.stringify({
        ok: true,
        action,
        total: (states || []).length,
        healthy,
        issues,
        problems: problems.slice(0, 20),
      }), { headers });
    }

    // ═══════════════════════════════════════════════════════
    // 6. Internal Link Suggestions
    // ═══════════════════════════════════════════════════════
    if (action === "suggest_internal_links") {
      const { data: pages } = await sb
        .from("blog_articles")
        .select("id, slug, title, keywords")
        .eq("status", "published")
        .limit(100);

      const { data: seoDocs } = await sb
        .from("seo_documents")
        .select("id, slug, title, doc_type")
        .eq("status", "published")
        .limit(100);

      const suggestions: Array<{
        source_url: string;
        target_url: string;
        anchor_text: string;
        relevance_score: number;
      }> = [];

      // Simple keyword-overlap based linking
      const allPages = [
        ...(pages || []).map(p => ({ ...p, url: `/blog/${p.slug}`, type: "blog" })),
        ...(seoDocs || []).map(d => ({
          ...d, url: `/${d.doc_type === "landing" ? "pruefungstraining" : "wissen"}/${d.slug}`,
          type: d.doc_type, keywords: [],
        })),
      ];

      for (let i = 0; i < allPages.length; i++) {
        for (let j = i + 1; j < allPages.length; j++) {
          const a = allPages[i];
          const b = allPages[j];
          // Title overlap check
          const aWords = new Set(a.title.toLowerCase().split(/\s+/));
          const bWords = new Set(b.title.toLowerCase().split(/\s+/));
          const overlap = [...aWords].filter(w => bWords.has(w) && w.length > 3).length;
          if (overlap >= 2) {
            suggestions.push({
              source_url: a.url,
              target_url: b.url,
              anchor_text: b.title,
              relevance_score: Math.min(overlap * 2, 10),
            });
          }
        }
      }

      // Store top suggestions
      const topSuggestions = suggestions
        .sort((a, b) => b.relevance_score - a.relevance_score)
        .slice(0, 50);

      for (const s of topSuggestions) {
        await sb.from("seo_internal_link_suggestions").upsert({
          source_url: s.source_url,
          target_url: s.target_url,
          anchor_text: s.anchor_text,
          relevance_score: s.relevance_score,
          status: "suggested",
        }, { onConflict: "source_url,target_url" }).then(() => {});
      }

      return new Response(JSON.stringify({
        ok: true,
        action,
        suggestions_generated: topSuggestions.length,
      }), { headers });
    }

    return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers });
  } catch (err) {
    console.error("[seo-discovery-engine] Error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers });
  }
});
