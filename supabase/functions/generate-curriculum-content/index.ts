import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON, RateLimitError, logLLMCostEvent } from "../_shared/ai-client.ts";
import { resolveAvailableRoute } from "../_shared/llm/provider-load-balancer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const SYSTEM_PROMPT = `Du bist ein Experte für deutsche Berufsausbildung (IHK/HWK).
Erstelle für den genannten Ausbildungsberuf einen realistischen schulischen Rahmenlehrplan.

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt:
{
  "learningFields": [
    {
      "code": "LF01",
      "title": "Titel des Lernfelds",
      "description": "Kompetenzformulierung (2-4 Sätze)",
      "hours": 80,
      "competencies": [
        {
          "code": "LF01-K01",
          "title": "Kompetenz-Titel",
          "description": "Beschreibung (1-2 Sätze)",
          "taxonomyLevel": "Anwenden"
        }
      ]
    }
  ]
}

Regeln:
- 10-13 Lernfelder für 3-jährige Ausbildung, 8-10 für 2-jährige
- Pro Lernfeld 3-5 Kompetenzen
- Taxonomiestufen: Wissen, Verstehen, Anwenden, Analysieren, Synthese, Bewerten
- Gesamtstunden: ~880 (36 Mo.) oder ~960 (42 Mo.) oder ~560 (24 Mo.)
- Praxisnahe, berufsspezifische Inhalte
- Codes fortlaufend: LF01, LF02 und LF01-K01, LF01-K02`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id || body.curriculumId;
  const providerOverride = body.provider as "openai" | "google" | undefined;

  if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

  try {
    // 1) Load curriculum + beruf
    const { data: curr, error: currErr } = await sb
      .from("curricula")
      .select("id, title, beruf_id, status")
      .eq("id", curriculumId)
      .single();

    if (currErr || !curr) return json({ error: "Curriculum not found" }, 404);

    // Check if already frozen
    if (curr.status === "frozen") {
      return json({ message: "Already frozen", curriculumId, skipped: true });
    }

    // Check if learning fields already exist
    const { count: existingLF } = await sb
      .from("learning_fields")
      .select("id", { count: "exact", head: true })
      .eq("curriculum_id", curriculumId);

    if (existingLF && existingLF > 0) {
      // Just freeze
      await sb.from("curricula").update({ status: "frozen" }).eq("id", curriculumId);
      return json({ message: "Had LFs, now frozen", curriculumId, learningFields: existingLF });
    }

    // 2) Get beruf info
    const { data: beruf } = await sb
      .from("berufe")
      .select("bezeichnung_kurz, bezeichnung_lang, zustaendigkeit, ausbildungsdauer_monate, taetigkeitsprofil")
      .eq("id", curr.beruf_id)
      .single();

    if (!beruf) return json({ error: "Beruf not found" }, 404);

    console.log(`[GenContent] Generating LFs for: ${beruf.bezeichnung_kurz}`);

    // 3) AI generation
    const userPrompt = `Erstelle einen Rahmenlehrplan für: ${beruf.bezeichnung_kurz}${beruf.bezeichnung_lang ? ` (${beruf.bezeichnung_lang})` : ""}
Zuständigkeit: ${beruf.zustaendigkeit}
Ausbildungsdauer: ${beruf.ausbildungsdauer_monate} Monate`;

    let provider = providerOverride || "";
    let model = "";
    if (provider) {
      model = provider === "google" ? "google/gemini-2.5-flash" : "openai/gpt-5-mini"; // v11: gpt-4.1 → gpt-5-mini
    } else {
      const { getModelAsync } = await import("../_shared/model-routing.ts");
      const routed = await getModelAsync("curriculum_import");
      provider = routed.provider;
      model = routed.model;
    }
    console.log(`[GenContent] Using ${provider}/${model}`);

    const aiResult = await callAIJSON({
      provider,
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 8000,
    });

    // Log cost event (success)
    await logLLMCostEvent(sb, {
      job_type: "generate_curriculum_content",
      provider,
      model,
      tokens_in: aiResult.usage?.input_tokens ?? 0,
      tokens_out: aiResult.usage?.output_tokens ?? 0,
      certification_id: curr.beruf_id,
      status: "success",
      estimatedUsage: aiResult.estimatedUsage,
    });

    // 4) Parse
    let parsed;
    try {
      const clean = aiResult.content
        .replace(/```json\n?/g, "")
        .replace(/```\n?/g, "")
        .trim();
      parsed = JSON.parse(clean);
    } catch {
      return json({ error: "AI JSON parse failed", raw: aiResult.content.slice(0, 200) }, 500);
    }

    const learningFields = parsed.learningFields || [];
    if (learningFields.length === 0) {
      return json({ error: "No learning fields generated" }, 500);
    }

    // 5) Insert learning fields + competencies
    let totalComps = 0;
    for (let i = 0; i < learningFields.length; i++) {
      const lf = learningFields[i];
      const { data: insertedLF, error: lfErr } = await sb
        .from("learning_fields")
        .insert({
          curriculum_id: curriculumId,
          code: lf.code || `LF${String(i + 1).padStart(2, "0")}`,
          title: lf.title,
          description: lf.description || "",
          hours: lf.hours || 80,
          sort_order: i,
        })
        .select("id")
        .single();

      if (lfErr) {
        console.error(`  LF insert error: ${lfErr.message}`);
        continue;
      }

      const comps = lf.competencies || [];
      if (comps.length > 0) {
        const compRows = comps.map((comp: any, j: number) => ({
          learning_field_id: insertedLF.id,
          code: comp.code || `LF${String(i + 1).padStart(2, "0")}-K${String(j + 1).padStart(2, "0")}`,
          title: comp.title,
          description: comp.description || "",
          taxonomy_level: comp.taxonomyLevel || "Anwenden",
        }));
        await sb.from("competencies").insert(compRows);
        totalComps += comps.length;
      }
    }

    // 6) Freeze
    await sb.from("curricula").update({ status: "frozen" }).eq("id", curriculumId);

    console.log(`[GenContent] Done: ${learningFields.length} LFs, ${totalComps} comps → frozen`);

    return json({
      success: true,
      curriculumId,
      beruf: beruf.bezeichnung_kurz,
      learningFields: learningFields.length,
      competencies: totalComps,
    });
  } catch (err) {
    if (err instanceof RateLimitError) {
      await logLLMCostEvent(sb, {
        job_type: "generate_curriculum_content",
        provider: "openai",
        model: "unknown",
        tokens_in: 0, tokens_out: 0, cost_usd: 0,
        certification_id: curriculumId,
        status: "fail",
        error_message: "rate_limit",
      });
      return json({ error: "Rate limit", retry: true }, 429);
    }
    const msg = err instanceof Error ? err.message : String(err);
    await logLLMCostEvent(sb, {
      job_type: "generate_curriculum_content",
      provider: "openai",
      model: "unknown",
      tokens_in: 0, tokens_out: 0, cost_usd: 0,
      certification_id: curriculumId,
      status: "fail",
      error_message: msg.slice(0, 200),
    });
    console.error(`[GenContent] Error: ${msg}`);
    return json({ error: msg }, 500);
  }
});
