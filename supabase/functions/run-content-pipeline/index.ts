import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * run-content-pipeline
 * DAG orchestrator for AI content generation:
 * research_context → build_content_brief → generate_content_draft →
 * validate_ssot_alignment → enrich_seo → add_internal_links →
 * quality_check → publish_ready
 *
 * Uses: Perplexity (research), OpenAI (structure/SEO), Lovable AI (didactics)
 * All content is SSOT-validated against curriculum/blueprints.
 */

const PIPELINE_STEPS = [
  "research_context",
  "build_content_brief",
  "generate_content_draft",
  "validate_ssot_alignment",
  "enrich_seo",
  "add_internal_links",
  "quality_check",
  "publish_ready",
] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const jobId = body.job_id as string | undefined;
    const limit = Math.min(body.limit ?? 5, 20);

    // Get jobs to process
    let jobs: any[];
    if (jobId) {
      const { data } = await sb.from("content_generation_jobs").select("*").eq("id", jobId).single();
      jobs = data ? [data] : [];
    } else {
      const { data } = await sb.from("content_generation_jobs")
        .select("*")
        .in("status", ["queued", "researching", "generating", "validating"])
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(limit);
      jobs = data ?? [];
    }

    if (!jobs.length) {
      return json(200, { ok: true, processed: 0, message: "no_jobs" });
    }

    const results: any[] = [];

    for (const job of jobs) {
      try {
        const result = await processJob(sb, job);
        results.push({ id: job.id, status: result.status, step: result.step });
      } catch (e) {
        const err = e instanceof Error ? e.message : "unknown";
        await sb.from("content_generation_jobs").update({
          status: "failed",
          error: err,
          updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        results.push({ id: job.id, status: "failed", error: err });
      }
    }

    return json(200, { ok: true, processed: results.length, results });
  } catch (e) {
    console.error("run-content-pipeline error:", e);
    return json(500, { error: e instanceof Error ? e.message : "unknown" });
  }

  function json(status: number, data: any) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processJob(sb: any, job: any) {
  const stepIndex = PIPELINE_STEPS.indexOf(job.pipeline_step);
  const currentStep = job.pipeline_step;

  // Update status
  await sb.from("content_generation_jobs").update({
    status: stepToStatus(currentStep),
    started_at: job.started_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  let updates: any = {};

  switch (currentStep) {
    case "research_context":
      updates.research_context = await doResearch(job);
      updates.pipeline_step = "build_content_brief";
      updates.status = "researching";
      break;

    case "build_content_brief":
      updates.content_brief = await buildBrief(sb, job);
      updates.pipeline_step = "generate_content_draft";
      updates.status = "generating";
      break;

    case "generate_content_draft":
      updates.draft_content = await generateDraft(job);
      updates.pipeline_step = "validate_ssot_alignment";
      updates.status = "validating";
      break;

    case "validate_ssot_alignment":
      const validation = await validateSSOT(sb, job);
      updates.validation_result = validation;
      if (validation.passed) {
        updates.pipeline_step = "enrich_seo";
        updates.status = "generating";
      } else {
        updates.status = "failed";
        updates.error = "SSOT validation failed: " + (validation.reasons?.join(", ") ?? "unknown");
      }
      break;

    case "enrich_seo":
      updates.draft_content = await enrichSEO(job);
      updates.pipeline_step = "add_internal_links";
      break;

    case "add_internal_links":
      updates.draft_content = await addInternalLinks(sb, job);
      updates.pipeline_step = "quality_check";
      break;

    case "quality_check":
      const scores = await qualityCheck(job);
      updates.quality_scores = scores;
      if (scores.overall >= 60) {
        updates.pipeline_step = "publish_ready";
        updates.status = "done";
        updates.completed_at = new Date().toISOString();
      } else {
        updates.status = "failed";
        updates.error = `Quality check failed: overall=${scores.overall}`;
      }
      break;

    case "publish_ready":
      updates.status = "done";
      break;
  }

  await sb.from("content_generation_jobs").update({
    ...updates,
    updated_at: new Date().toISOString(),
  }).eq("id", job.id);

  return { status: updates.status || job.status, step: updates.pipeline_step || currentStep };
}

function stepToStatus(step: string): string {
  switch (step) {
    case "research_context": return "researching";
    case "build_content_brief":
    case "generate_content_draft":
    case "enrich_seo":
    case "add_internal_links": return "generating";
    case "validate_ssot_alignment":
    case "quality_check": return "validating";
    case "publish_ready": return "done";
    default: return "queued";
  }
}

// ── Research via Perplexity (optional) or Lovable AI ──
async function doResearch(job: any): Promise<any> {
  const keyword = job.input_payload?.keyword ?? "";
  const perplexityKey = Deno.env.get("PERPLEXITY_API_KEY");

  if (perplexityKey) {
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${perplexityKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "sonar",
          messages: [
            { role: "system", content: "Du bist ein SEO-Recherche-Assistent für Prüfungsvorbereitungs-Content. Analysiere die Suchintention, extrahiere relevante Begriffe und identifiziere Fragen. Antworte auf Deutsch als JSON." },
            { role: "user", content: `Recherchiere das Keyword "${keyword}" im Kontext von Prüfungsvorbereitung (IHK, HWK, Sachkunde). Liefere: intent_summary, related_terms[], questions[], entities[].` },
          ],
        }),
      });
      if (res.ok) {
        const data = await res.json();
        try {
          return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
        } catch {
          return { intent_summary: data.choices?.[0]?.message?.content, related_terms: [], questions: [], entities: [] };
        }
      }
    } catch (e) {
      console.error("Perplexity research failed, falling back:", e);
    }
  }

  // Fallback: Lovable AI
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) return { intent_summary: keyword, related_terms: [], questions: [], entities: [] };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Du bist ein SEO-Recherche-Assistent. Antworte als JSON mit: intent_summary, related_terms[], questions[], entities[]." },
        { role: "user", content: `Keyword: "${keyword}" – Kontext: Prüfungsvorbereitung Deutschland.` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "research_result",
          description: "SEO research result",
          parameters: {
            type: "object",
            properties: {
              intent_summary: { type: "string" },
              related_terms: { type: "array", items: { type: "string" } },
              questions: { type: "array", items: { type: "string" } },
              entities: { type: "array", items: { type: "string" } },
            },
            required: ["intent_summary", "related_terms", "questions", "entities"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "research_result" } },
    }),
  });

  if (res.ok) {
    const data = await res.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall) {
      try { return JSON.parse(toolCall.function.arguments); } catch {}
    }
  }
  return { intent_summary: keyword, related_terms: [], questions: [], entities: [] };
}

// ── Build brief using SSOT context ──
async function buildBrief(sb: any, job: any): Promise<any> {
  // Get SSOT context
  let ssotCtx = job.ssot_context;
  if (!ssotCtx || Object.keys(ssotCtx).length === 0) {
    if (job.keyword_id) {
      const { data } = await sb.rpc("fn_build_ssot_context", { p_keyword_id: job.keyword_id });
      ssotCtx = data ?? {};
      await sb.from("content_generation_jobs").update({ ssot_context: ssotCtx }).eq("id", job.id);
    }
  }

  const keyword = job.input_payload?.keyword ?? "";
  const research = job.research_context ?? {};
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) return { headline: keyword, sections: [], faq: [], cta: "Prüfung starten" };

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: `Du erstellst Content-Briefs für ExamFit. Nutze NUR den bereitgestellten SSOT-Kontext. Erfinde KEINE Fakten. Content-Typ: ${job.content_type}. Persona: ${job.persona}.` },
        { role: "user", content: `Keyword: "${keyword}"\n\nSSOT-Kontext:\n${JSON.stringify(ssotCtx)}\n\nRecherche:\n${JSON.stringify(research)}\n\nErstelle einen Content-Brief.` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "content_brief",
          description: "Structured content brief",
          parameters: {
            type: "object",
            properties: {
              headline: { type: "string" },
              sections: { type: "array", items: { type: "object", properties: { heading: { type: "string" }, key_points: { type: "array", items: { type: "string" } } } } },
              faq: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } } } },
              cta: { type: "string" },
              internal_links: { type: "array", items: { type: "string" } },
              exam_traps: { type: "array", items: { type: "string" } },
            },
            required: ["headline", "sections", "faq", "cta"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "content_brief" } },
    }),
  });

  if (res.ok) {
    const data = await res.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (tc) { try { return JSON.parse(tc.function.arguments); } catch {} }
  }
  return { headline: keyword, sections: [], faq: [], cta: "Prüfung starten" };
}

// ── Generate draft via OpenAI ──
async function generateDraft(job: any): Promise<any> {
  const brief = job.content_brief ?? {};
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const apiKey = openaiKey || Deno.env.get("LOVABLE_API_KEY");
  const baseUrl = openaiKey
    ? "https://api.openai.com/v1/chat/completions"
    : "https://ai.gateway.lovable.dev/v1/chat/completions";
  const model = openaiKey ? "gpt-4o" : "google/gemini-2.5-flash";

  if (!apiKey) return { title: brief.headline, content_md: "", meta_title: "", meta_description: "" };

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: `Du schreibst SEO-optimierten ${job.content_type}-Content für ExamFit. Prüfungsvorbereitung Deutschland. Nutze NUR den Brief. Erfinde KEINE Fakten. Stil: klar, direkt, prüfungsrelevant. Markdown-Format.` },
        { role: "user", content: `Brief:\n${JSON.stringify(brief)}\n\nSSOT-Kontext:\n${JSON.stringify(job.ssot_context)}\n\nSchreibe den vollständigen Artikel.` },
      ],
      tools: [{
        type: "function",
        function: {
          name: "article",
          description: "Generated article",
          parameters: {
            type: "object",
            properties: {
              title: { type: "string" },
              content_md: { type: "string" },
              meta_title: { type: "string" },
              meta_description: { type: "string" },
              faq_section: { type: "array", items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } } } },
              cta_block: { type: "string" },
            },
            required: ["title", "content_md", "meta_title", "meta_description"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "article" } },
    }),
  });

  if (res.ok) {
    const data = await res.json();
    const tc = data.choices?.[0]?.message?.tool_calls?.[0];
    if (tc) { try { return JSON.parse(tc.function.arguments); } catch {} }
  }
  return { title: brief.headline ?? "", content_md: "", meta_title: "", meta_description: "" };
}

// ── SSOT Validation ──
async function validateSSOT(sb: any, job: any): Promise<any> {
  const draft = job.draft_content ?? {};
  const ssot = job.ssot_context ?? {};
  const content = (draft.content_md ?? "").toLowerCase();
  const reasons: string[] = [];

  // Check: content references curriculum concepts
  const competencies = ssot.competencies ?? [];
  let matchCount = 0;
  for (const c of competencies) {
    if (c.title && content.includes(c.title.toLowerCase())) matchCount++;
  }
  if (competencies.length > 0 && matchCount === 0) {
    reasons.push("no_competency_reference");
  }

  // Check: no empty content
  if (content.length < 200) {
    reasons.push("content_too_short");
  }

  // Check: has FAQ if brief had FAQ
  const briefFaq = job.content_brief?.faq ?? [];
  if (briefFaq.length > 0 && !(draft.faq_section?.length > 0)) {
    reasons.push("missing_faq");
  }

  return { passed: reasons.length === 0, reasons, checked_at: new Date().toISOString() };
}

// ── SEO Enrichment ──
async function enrichSEO(job: any): Promise<any> {
  const draft = { ...job.draft_content };
  // Add schema.org FAQ markup hint
  if (draft.faq_section?.length) {
    draft.schema_faq = {
      "@type": "FAQPage",
      mainEntity: draft.faq_section.map((f: any) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    };
  }
  // Ensure meta fields
  if (!draft.meta_title) draft.meta_title = draft.title;
  if (!draft.meta_description) draft.meta_description = (draft.content_md ?? "").substring(0, 155);
  return draft;
}

// ── Internal Links ──
async function addInternalLinks(sb: any, job: any): Promise<any> {
  const draft = { ...job.draft_content };
  // Get published blog posts for potential linking
  const { data: posts } = await sb.from("blog_posts")
    .select("slug, title")
    .eq("status", "published")
    .limit(20);

  if (posts?.length) {
    const links = posts.slice(0, 5).map((p: any) => ({
      url: `/blog/${p.slug}`,
      anchor: p.title,
    }));
    draft.internal_links = links;
  }
  return draft;
}

// ── Quality Check ──
async function qualityCheck(job: any): Promise<any> {
  const draft = job.draft_content ?? {};
  const content = draft.content_md ?? "";

  const seoScore = Math.min(100, (
    (draft.meta_title ? 20 : 0) +
    (draft.meta_description ? 20 : 0) +
    (content.length > 500 ? 20 : content.length > 200 ? 10 : 0) +
    (content.includes("##") ? 15 : 0) +
    (draft.faq_section?.length ? 15 : 0) +
    (draft.internal_links?.length ? 10 : 0)
  ));

  const didaktikScore = Math.min(100, (
    (content.includes("Prüfung") ? 20 : 0) +
    (content.includes("Fehler") || content.includes("Falle") ? 20 : 0) +
    (content.length > 800 ? 20 : 10) +
    (draft.faq_section?.length >= 3 ? 20 : draft.faq_section?.length ? 10 : 0) +
    (content.includes("Beispiel") ? 20 : 0)
  ));

  const conversionScore = Math.min(100, (
    (draft.cta_block ? 30 : 0) +
    (content.includes("testen") || content.includes("starten") ? 20 : 0) +
    (content.includes("ExamFit") ? 20 : 0) +
    (draft.internal_links?.length ? 30 : 0)
  ));

  const overall = Math.round(seoScore * 0.4 + didaktikScore * 0.35 + conversionScore * 0.25);

  return { seo: seoScore, didaktik: didaktikScore, conversion: conversionScore, overall };
}
