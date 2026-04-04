import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover, RateLimitError, logLLMCostEvent } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";
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

const VOCATIONAL_SYSTEM_PROMPT = `Du bist ein Experte für deutsche Berufsausbildung (IHK/HWK).
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

const HIGHER_ED_SYSTEM_PROMPT = `Du bist ein Hochschuldozent und Experte für akademische Studienprogramme.
Erstelle für den genannten Studiengang einen modularen Studienplan.

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt:
{
  "learningFields": [
    {
      "code": "M01",
      "title": "Modulbezeichnung",
      "description": "Qualifikationsziele und Kompetenzen (2-4 Sätze)",
      "hours": 150,
      "competencies": [
        {
          "code": "M01-K01",
          "title": "Kompetenz-Titel",
          "description": "Beschreibung (1-2 Sätze)",
          "taxonomyLevel": "Analysieren"
        }
      ]
    }
  ]
}

Regeln:
- 12-20 Module für einen Bachelor-Studiengang, 8-12 für Master
- Pro Modul 3-6 Kompetenzen
- Taxonomiestufen: Wissen, Verstehen, Anwenden, Analysieren, Transfer, Bewerten
- Höhere kognitive Stufen (Analysieren, Transfer) mit mindestens 40% Anteil
- Prüfungsformen: Klausur, Hausarbeit, Fallanalyse, Projektarbeit
- Akademische Terminologie und wissenschaftlicher Anspruch
- Codes fortlaufend: M01, M02 und M01-K01, M01-K02`;

const FORTBILDUNG_SYSTEM_PROMPT = `Du bist ein Experte für berufliche Fortbildung und IHK-Aufstiegsqualifikationen.
Erstelle für die genannte Fortbildung einen strukturierten Rahmenplan.

Antworte AUSSCHLIESSLICH mit einem validen JSON-Objekt:
{
  "learningFields": [
    {
      "code": "HQ01",
      "title": "Handlungsbereich / Qualifikationsfeld",
      "description": "Kompetenzformulierung (2-4 Sätze)",
      "hours": 100,
      "competencies": [
        {
          "code": "HQ01-K01",
          "title": "Kompetenz-Titel",
          "description": "Beschreibung (1-2 Sätze)",
          "taxonomyLevel": "Anwenden"
        }
      ]
    }
  ]
}

Regeln:
- 6-10 Handlungsbereiche/Qualifikationsfelder
- Pro Bereich 3-6 Kompetenzen
- Taxonomiestufen: Wissen, Verstehen, Anwenden, Analysieren, Synthese, Bewerten
- Fokus auf Transfer, Führung und betriebswirtschaftliche Handlungskompetenz
- Gesamtstunden: 600-1200 je nach Fortbildungsumfang
- Codes fortlaufend: HQ01, HQ02 und HQ01-K01, HQ01-K02`;

/**
 * Determine which system prompt and user prompt to use based on track/program_type.
 */
function resolvePrompts(curr: { title: string; program_type?: string; track?: string }, beruf: any | null): { systemPrompt: string; userPrompt: string } {
  const pt = curr.program_type?.toLowerCase() ?? "";
  const track = curr.track?.toUpperCase() ?? "";

  // Higher Education (Studium)
  if (pt === "higher_education" || track === "STUDIUM") {
    return {
      systemPrompt: HIGHER_ED_SYSTEM_PROMPT,
      userPrompt: `Erstelle einen modularen Studienplan für: ${curr.title}\nProgrammtyp: Hochschulstudium (Bachelor/Master)`,
    };
  }

  // Fortbildung
  if (track === "FORTBILDUNG" || ["fortbildung_ihk", "fortbildung_hwk", "aufstiegsfortbildung"].includes(pt)) {
    return {
      systemPrompt: FORTBILDUNG_SYSTEM_PROMPT,
      userPrompt: `Erstelle einen Rahmenplan für die Fortbildung: ${curr.title}`,
    };
  }

  // Vocational (default) — requires beruf
  if (beruf) {
    return {
      systemPrompt: VOCATIONAL_SYSTEM_PROMPT,
      userPrompt: `Erstelle einen Rahmenlehrplan für: ${beruf.bezeichnung_kurz}${beruf.bezeichnung_lang ? ` (${beruf.bezeichnung_lang})` : ""}\nZuständigkeit: ${beruf.zustaendigkeit}\nAusbildungsdauer: ${beruf.ausbildungsdauer_monate} Monate`,
    };
  }

  // Fallback: use title directly (e.g. Zertifikat without beruf)
  return {
    systemPrompt: VOCATIONAL_SYSTEM_PROMPT,
    userPrompt: `Erstelle einen Rahmenlehrplan für: ${curr.title}`,
  };
}

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
    // 1) Load curriculum (including track/program_type for routing)
    const { data: curr, error: currErr } = await sb
      .from("curricula")
      .select("id, title, beruf_id, status, program_type, track")
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

    // 2) Get beruf info (only for vocational tracks — nullable for Studium/Fortbildung/Zertifikat)
    let beruf: any = null;
    if (curr.beruf_id) {
      const { data } = await sb
        .from("berufe")
        .select("bezeichnung_kurz, bezeichnung_lang, zustaendigkeit, ausbildungsdauer_monate, taetigkeitsprofil")
        .eq("id", curr.beruf_id)
        .single();
      beruf = data;
    }

    // Resolve prompts based on track/program_type (no more hard 404 on missing beruf)
    const { systemPrompt, userPrompt } = resolvePrompts(curr, beruf);

    console.log(`[GenContent] Generating LFs for: ${curr.title} (track=${curr.track ?? "default"}, program_type=${curr.program_type ?? "vocational"})`);

    // v11: Failover chain — policy-first, then model-routing chain
    let chain: Array<{ provider: string; model: string }> = [];
    if (providerOverride) {
      const overrideModel = providerOverride === "anthropic" ? "claude-3-5-haiku-20241022" : "gpt-5-mini";
      chain.push({ provider: providerOverride, model: overrideModel });
    } else {
      const policyRoute = await resolveAvailableRoute("curriculum_enrichment");
      if (policyRoute.ok && policyRoute.provider && policyRoute.model) {
        chain.push({ provider: policyRoute.provider, model: policyRoute.model });
        console.log(`[GenContent] POLICY_ROUTE: curriculum_enrichment → ${policyRoute.provider}/${policyRoute.model}`);
      }
    }
    // Always append full model-routing chain as fallback
    const routingChain = await getModelChainAsync("curriculum_import");
    for (const c of routingChain) {
      if (!chain.some(x => x.provider === c.provider && x.model === c.model)) {
        chain.push({ provider: c.provider, model: c.model });
      }
    }
    console.log(`[GenContent] Chain: ${chain.map(c => `${c.provider}/${c.model}`).join(" → ")}`);

    const aiResult = await callAIWithFailover(
      chain.map(c => ({ provider: c.provider as any, model: c.model })),
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 8000,
      },
    );

    // Log cost event (success)
    await logLLMCostEvent(sb, {
      job_type: "generate_curriculum_content",
      provider: aiResult.provider,
      model: aiResult.model,
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
