// SEO Brief Generator — Lovable AI (gemini-3-flash-preview) with structured tool-call.
// Reads a seo_content_briefs row + cluster/keyword context, produces full brief structure,
// and updates the row in-place. Idempotent: re-runs overwrite generated_brief_md & H2/FAQ JSON.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const briefSchema = {
  type: "object",
  properties: {
    h1: { type: "string", description: "Primary headline, includes target keyword naturally" },
    meta_title: { type: "string", description: "<60 chars, includes keyword" },
    meta_description: { type: "string", description: "<160 chars, includes CTA" },
    primary_angle: { type: "string", description: "Unique angle / hook for this article" },
    h2_outline: {
      type: "array",
      items: {
        type: "object",
        properties: {
          h2: { type: "string" },
          purpose: { type: "string" },
          key_points: { type: "array", items: { type: "string" } },
        },
        required: ["h2", "purpose", "key_points"],
      },
    },
    faq_suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, answer_hint: { type: "string" } },
        required: ["question", "answer_hint"],
      },
    },
    secondary_keywords: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: { type: "string" }, description: "Named entities to mention (IHK, Berufe, etc.)" },
    internal_link_targets: {
      type: "array",
      items: {
        type: "object",
        properties: { anchor: { type: "string" }, target_slug: { type: "string" } },
        required: ["anchor", "target_slug"],
      },
    },
    cta_type: { type: "string", enum: ["lead_magnet", "free_quiz", "product_page", "newsletter"] },
    cta_text: { type: "string" },
    target_word_count: { type: "integer" },
    json_ld_recommendation: { type: "string", description: "Recommended schema.org type" },
    brief_md: { type: "string", description: "Full markdown brief, ready for content writer" },
  },
  required: [
    "h1", "meta_title", "meta_description", "primary_angle", "h2_outline",
    "faq_suggestions", "secondary_keywords", "internal_link_targets",
    "cta_type", "cta_text", "target_word_count", "brief_md",
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { brief_id } = await req.json();
    if (!brief_id) {
      return new Response(JSON.stringify({ error: "brief_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Auth check via JWT
    const auth = req.headers.get("Authorization");
    if (!auth) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: u } = await userClient.auth.getUser();
    if (!u?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: roleRows } = await supa.from("user_roles")
      .select("role").eq("user_id", u.user.id).eq("role", "admin");
    if (!roleRows || roleRows.length === 0) {
      return new Response(JSON.stringify({ error: "forbidden_admin_only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load brief + keyword + cluster context
    const { data: brief, error: bErr } = await supa
      .from("seo_content_briefs").select("*").eq("id", brief_id).single();
    if (bErr || !brief) {
      return new Response(JSON.stringify({ error: "brief_not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let kw: any = null;
    let cluster: any = null;
    if (brief.keyword_id) {
      const { data } = await supa.from("seo_keywords").select("*").eq("id", brief.keyword_id).single();
      kw = data;
      if (kw?.cluster_id) {
        const { data: c } = await supa.from("seo_keyword_clusters").select("*").eq("id", kw.cluster_id).single();
        cluster = c;
      }
    }

    // Pull related published packages (top 5 trigram-matched on title)
    const { data: pkgs } = await supa
      .from("course_packages").select("id, title, slug, persona_type, status")
      .eq("status", "published").limit(50);
    const target = (brief.title || kw?.keyword || "").toLowerCase();
    const relatedPkgs = (pkgs ?? [])
      .map((p: any) => ({ ...p, _sim: jaccard(target, (p.title || "").toLowerCase()) }))
      .sort((a: any, b: any) => b._sim - a._sim).slice(0, 5);

    // Build prompt
    const systemPrompt =
      "Du bist Senior SEO Content Strategist für ExamFit (IHK-Prüfungsvorbereitung, AEVO, FIAE, Bilanzbuchhalter, Prince2). " +
      "Du erstellst SEO-Briefs, die direkt an Content-Writer übergeben werden können. " +
      "Sprache: Deutsch. Ton: präzise, kompetenzorientiert, ohne Marketingfloskeln. " +
      "Berücksichtige immer: Search Intent, Funnel-Stage, interne Verlinkungen zu Paketen, klare CTA. " +
      "h2_outline: 5-9 Sektionen. faq_suggestions: 4-8 Q&A. brief_md: vollständige Markdown-Vorlage mit allen Sektionen, Notizen für den Writer und Beispielsätzen.";

    const userPrompt = JSON.stringify({
      target_keyword: kw?.keyword ?? brief.title,
      title_hint: brief.title,
      content_type: brief.content_type,
      search_intent: brief.search_intent ?? kw?.intent_type ?? "informational",
      funnel_stage: brief.funnel_stage ?? kw?.funnel_stage ?? "tofu",
      persona: brief.persona ?? kw?.persona ?? cluster?.persona ?? "azubi",
      cluster_context: cluster ? {
        cluster_name: cluster.cluster_name,
        parent_topic: cluster.parent_topic,
        pillar_url: cluster.pillar_page_url,
        funnel_stage: cluster.funnel_stage,
      } : null,
      keyword_signals: kw ? {
        search_volume: kw.search_volume,
        difficulty: kw.difficulty,
        opportunity_score: kw.opportunity_score,
        target_url: kw.target_url,
      } : null,
      related_packages: relatedPkgs.map((p: any) => ({
        title: p.title, slug: p.slug, persona: p.persona_type,
      })),
      existing_secondary_keywords: brief.secondary_keywords ?? [],
      target_word_count_hint: brief.target_word_count ?? 1500,
    });

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "emit_seo_brief",
            description: "Return the structured SEO content brief.",
            parameters: briefSchema,
          },
        }],
        tool_choice: { type: "function", function: { name: "emit_seo_brief" } },
      }),
    });

    if (aiResp.status === 429) {
      return new Response(JSON.stringify({ error: "rate_limited", message: "Lovable AI rate limit exceeded, please retry shortly." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiResp.status === 402) {
      return new Response(JSON.stringify({ error: "credits_exhausted", message: "Lovable AI credits exhausted. Add funds in Workspace Settings." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("AI gateway error", aiResp.status, t);
      return new Response(JSON.stringify({ error: "ai_gateway_error", status: aiResp.status }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      console.error("No tool call", aiJson);
      return new Response(JSON.stringify({ error: "no_structured_output" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const result = JSON.parse(toolCall.function.arguments);

    // Persist
    const { error: upErr } = await supa.from("seo_content_briefs").update({
      title: result.h1 || brief.title,
      primary_angle: result.primary_angle,
      recommended_headings: result.h2_outline ?? [],
      faq_suggestions: result.faq_suggestions ?? [],
      secondary_keywords: result.secondary_keywords ?? [],
      entities: result.entities ?? [],
      internal_link_targets: result.internal_link_targets ?? [],
      cta_type: result.cta_type,
      cta_text: result.cta_text,
      target_word_count: result.target_word_count ?? 1500,
      json_ld_recommendation: result.json_ld_recommendation,
      generated_brief_md: result.brief_md,
      status: "ready",
      updated_at: new Date().toISOString(),
    }).eq("id", brief_id);

    if (upErr) {
      console.error("Update failed", upErr);
      return new Response(JSON.stringify({ error: "persist_failed", details: upErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supa.from("auto_heal_log").insert({
      action_type: "seo_brief_generated",
      target_id: brief_id,
      target_type: "seo_content_brief",
      metadata: {
        keyword: kw?.keyword,
        h1: result.h1,
        word_count: result.target_word_count,
        h2_count: (result.h2_outline ?? []).length,
        faq_count: (result.faq_suggestions ?? []).length,
        caller: u.user.id,
      },
    });

    return new Response(JSON.stringify({ ok: true, brief_id, summary: {
      h1: result.h1,
      h2_count: (result.h2_outline ?? []).length,
      faq_count: (result.faq_suggestions ?? []).length,
      word_count: result.target_word_count,
    }}), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-seo-brief error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// Tiny jaccard for ranking related packages
function jaccard(a: string, b: string): number {
  const sa = new Set(a.split(/\W+/).filter(Boolean));
  const sb = new Set(b.split(/\W+/).filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}
