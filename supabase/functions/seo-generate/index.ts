import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";

serve(async (req) => {
  const corsResponse = handleCorsPreflightRequest(req);
  if (corsResponse) return corsResponse;
  const origin = req.headers.get("origin");
  const headers = { ...getCorsHeaders(origin), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { template_key, beruf_id, curriculum_id, competency_id, product_key, tone_variant, extra_context } = body;

    if (!template_key) {
      return new Response(JSON.stringify({ error: "template_key required" }), { status: 400, headers });
    }

    // 1) Load template
    const { data: template, error: tplErr } = await admin
      .from("seo_templates")
      .select("*")
      .eq("template_key", template_key)
      .eq("is_active", true)
      .single();

    if (tplErr || !template) {
      return new Response(JSON.stringify({ error: `Template not found: ${template_key}` }), { status: 404, headers });
    }

    // 2) Load SSOT references
    let berufData: Record<string, unknown> | null = null;
    let curriculumData: Record<string, unknown> | null = null;
    let competencyData: Record<string, unknown> | null = null;

    if (beruf_id) {
      const { data } = await admin.from("berufe").select("*").eq("id", beruf_id).single();
      berufData = data;
    }
    if (curriculum_id) {
      const { data } = await admin.from("curricula").select("id, title, description").eq("id", curriculum_id).single();
      curriculumData = data;
    }
    if (competency_id) {
      const { data } = await admin.from("competencies").select("*").eq("id", competency_id).single();
      competencyData = data;
    }

    // SSOT Gate S1: at least one reference
    if (!beruf_id && !curriculum_id && !competency_id && !product_key) {
      return new Response(JSON.stringify({ error: "SSOT Gate S1: mindestens eine Referenz (beruf_id, curriculum_id, competency_id, product_key) erforderlich" }), { status: 400, headers });
    }

    // 3) Build prompt with template variables
    const variables: Record<string, string> = {
      beruf: berufData ? String((berufData as any).bezeichnung_kurz) : "Allgemein",
      dauer: berufData ? String((berufData as any).ausbildungsdauer_monate) : "36",
      dqr: berufData ? String((berufData as any).dqr_niveau || 4) : "4",
      curriculum: curriculumData ? String((curriculumData as any).title) : "",
      competency: competencyData ? String((competencyData as any).title) : "",
      product_key: product_key || "",
      thema: extra_context?.thema || "",
      begriff: extra_context?.begriff || "",
      ...(extra_context || {}),
    };

    let systemPrompt = template.prompt_system || "";
    let userPrompt = template.prompt_user || "";

    // Replace template variables
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
      systemPrompt = systemPrompt.replace(regex, value);
      userPrompt = userPrompt.replace(regex, value);
    }

    if (tone_variant) {
      systemPrompt += `\n\nTon-Variante: ${tone_variant}`;
    }

    const styleRules = template.style_rules_json as Record<string, unknown> || {};
    if (styleRules.banned_phrases) {
      systemPrompt += `\n\nVerbotene Phrasen (NIEMALS verwenden): ${(styleRules.banned_phrases as string[]).join(", ")}`;
    }

    // Create generation job
    const { data: job, error: jobErr } = await admin
      .from("seo_generation_jobs")
      .insert({
        job_type: "generate",
        template_key,
        target_ref: { beruf_id, curriculum_id, competency_id, product_key },
        status: "running",
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (jobErr) throw jobErr;

    // 4) Call Lovable AI Gateway
    let contentMd = "";
    let title = "";
    let metaTitle = "";
    let metaDescription = "";
    let excerpt = "";
    let tokensUsed = 0;
    let model = "google/gemini-2.5-flash";

    const fullPrompt = `${userPrompt}\n\nAntworte mit einem JSON-Objekt:\n{\n  "title": "Seitentitel",\n  "meta_title": "SEO Title (max 60 Zeichen)",\n  "meta_description": "SEO Description (max 160 Zeichen)",\n  "excerpt": "Kurze Zusammenfassung (max 200 Zeichen)",\n  "content_md": "Der gesamte Inhalt in Markdown"\n}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: fullPrompt },
        ],
        temperature: 0.8,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      if (aiResponse.status === 429) {
        await admin.from("seo_generation_jobs").update({ status: "failed", error: "Rate limited", completed_at: new Date().toISOString() }).eq("id", job.id);
        return new Response(JSON.stringify({ error: "Rate limited – bitte später erneut versuchen" }), { status: 429, headers });
      }
      if (aiResponse.status === 402) {
        await admin.from("seo_generation_jobs").update({ status: "failed", error: "Credits exhausted", completed_at: new Date().toISOString() }).eq("id", job.id);
        return new Response(JSON.stringify({ error: "AI Credits aufgebraucht" }), { status: 402, headers });
      }
      throw new Error(`AI API error: ${aiResponse.status} ${errText.slice(0, 200)}`);
    }

    const result = await aiResponse.json();
    const raw = result.choices?.[0]?.message?.content || "";
    tokensUsed = result.usage?.total_tokens || 0;

    // Parse JSON from response
    try {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      title = parsed.title || variables.beruf;
      metaTitle = (parsed.meta_title || title).substring(0, 60);
      metaDescription = (parsed.meta_description || "").substring(0, 160);
      excerpt = (parsed.excerpt || "").substring(0, 250);
      contentMd = parsed.content_md || raw;
    } catch {
      contentMd = raw;
      title = `${variables.beruf} – ${template.display_name}`;
      metaTitle = title.substring(0, 60);
    }

    // 5) Generate slug
    const slug = generateSlug(title);

    // 6) Compute content hash
    const contentHash = await computeHash(contentMd);

    // 7) Check uniqueness (Gate S2)
    const { data: existing } = await admin
      .from("seo_documents")
      .select("id, slug")
      .eq("content_hash", contentHash)
      .limit(1);

    if (existing && existing.length > 0) {
      await admin.from("seo_generation_jobs").update({
        status: "failed",
        error: `Duplicate content detected (hash matches doc ${existing[0].id})`,
        completed_at: new Date().toISOString(),
      }).eq("id", job.id);

      return new Response(JSON.stringify({
        error: "UNIQUE_GATE_S2: Duplicate content hash",
        existing_doc_id: existing[0].id,
      }), { status: 409, headers });
    }

    // 8) Ensure unique slug
    let finalSlug = slug;
    const { data: slugCheck } = await admin
      .from("seo_documents")
      .select("id")
      .eq("doc_type", template.doc_type)
      .eq("slug", slug)
      .limit(1);

    if (slugCheck && slugCheck.length > 0) {
      finalSlug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    }

    // 9) Insert document
    const { data: doc, error: docErr } = await admin
      .from("seo_documents")
      .insert({
        doc_type: template.doc_type,
        slug: finalSlug,
        title,
        meta_title: metaTitle,
        meta_description: metaDescription,
        content_md: contentMd,
        excerpt,
        status: "draft",
        beruf_id: beruf_id || null,
        curriculum_id: curriculum_id || null,
        competency_id: competency_id || null,
        product_key: product_key || null,
        content_hash: contentHash,
      })
      .select("id, slug")
      .single();

    if (docErr) throw docErr;

    // 10) Update job
    await admin.from("seo_generation_jobs").update({
      status: "done",
      result_doc_id: doc.id,
      tokens_used: tokensUsed,
      model,
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);

    // 11) Trigger QC check (fire-and-forget)
    const qcUrl = `${supabaseUrl}/functions/v1/seo-qc-check`;
    fetch(qcUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ document_id: doc.id }),
    }).catch(err => console.error("[seo-generate] QC trigger failed:", err));

    return new Response(JSON.stringify({
      success: true,
      document_id: doc.id,
      slug: finalSlug,
      title,
      job_id: job.id,
    }), { status: 200, headers });
  } catch (error) {
    console.error("[seo-generate] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});

function generateSlug(text: string): string {
  const charMap: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "ae", Ö: "oe", Ü: "ue" };
  return text.toLowerCase().split("").map(c => charMap[c] || c).join("")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").substring(0, 80);
}

async function computeHash(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text.trim().toLowerCase().replace(/\s+/g, " "));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
