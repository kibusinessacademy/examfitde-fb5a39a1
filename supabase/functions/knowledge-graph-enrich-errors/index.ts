/**
 * knowledge-graph-enrich-errors — Phase 2 AI Enrichment for common_errors.
 *
 * Identifies competencies with low error_pattern coverage and generates
 * new common_errors via Lovable AI. Stores with provenance='ai_enriched'.
 *
 * POST { curriculum_id, max_competencies?: number, min_errors?: number }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  findCompetenciesNeedingErrors,
  insertEnrichedErrors,
  type EnrichmentError,
  type EnrichmentResult,
} from "../_shared/knowledge-graph/enrichment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { curriculum_id, max_competencies = 10, min_errors = 3 } = await req.json();

    if (!curriculum_id) {
      return new Response(
        JSON.stringify({ error: "curriculum_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Find competencies needing enrichment
    const candidates = await findCompetenciesNeedingErrors(sb, curriculum_id, min_errors);
    const selected = candidates.slice(0, max_competencies);

    console.log(
      `[kg-enrich] ${candidates.length} candidates, processing ${selected.length} (min_errors=${min_errors})`,
    );

    if (!selected.length) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "All competencies already have sufficient error patterns",
          candidates_total: candidates.length,
          processed: 0,
          results: [],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Generate common_errors for each competency via AI
    const results: EnrichmentResult[] = [];
    const aiErrors: string[] = [];

    for (const comp of selected) {
      try {
        const errors = await generateCommonErrors(
          LOVABLE_API_KEY,
          comp.label,
          comp.sourceId,
          sb,
        );

        if (errors.length) {
          const r = await insertEnrichedErrors(sb, comp.sourceId, comp.nodeId, errors);
          results.push(r);
          console.log(
            `[kg-enrich] ${comp.label}: +${r.nodesCreated} nodes, +${r.edgesCreated} edges, ${r.skipped} skipped`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        aiErrors.push(`${comp.label}: ${msg}`);
        console.error(`[kg-enrich] AI error for ${comp.label}: ${msg}`);
      }
    }

    const totalNodes = results.reduce((s, r) => s + r.nodesCreated, 0);
    const totalEdges = results.reduce((s, r) => s + r.edgesCreated, 0);
    const totalSkipped = results.reduce((s, r) => s + r.skipped, 0);

    return new Response(
      JSON.stringify({
        ok: true,
        candidates_total: candidates.length,
        processed: selected.length,
        nodes_created: totalNodes,
        edges_created: totalEdges,
        skipped: totalSkipped,
        ai_errors: aiErrors,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[kg-enrich] fatal:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── AI Generation ──────────────────────────────────────────────────────────

async function generateCommonErrors(
  apiKey: string,
  competencyLabel: string,
  competencySourceId: string,
  sb: any,
): Promise<EnrichmentError[]> {
  // Get competency context for better prompting
  const { data: comp } = await sb
    .from("competencies")
    .select("title, description, code, bloom_level, typical_misconceptions")
    .eq("id", competencySourceId)
    .maybeSingle();

  const existingMisconceptions = Array.isArray(comp?.typical_misconceptions)
    ? comp.typical_misconceptions
        .map((m: any) => (typeof m === "string" ? m : m?.label || m?.text || ""))
        .filter(Boolean)
    : [];

  const systemPrompt = `Du bist ein Experte für berufliche Ausbildung in Deutschland.
Deine Aufgabe: Identifiziere die häufigsten Fehler und Missverständnisse, die Auszubildende bei einer bestimmten Kompetenz typischerweise machen.

REGELN:
- Gib genau 3 bis 5 typische Fehler zurück
- Jeder Fehler muss fachlich konkret und prüfungsrelevant sein
- Keine allgemeinen Aussagen wie "mangelndes Verständnis"
- Formuliere als konkretes Fehlverhalten oder Missverständnis
- Auf Deutsch antworten
- Keine Duplikate zu bereits bekannten Fehlern`;

  const userPrompt = `Kompetenz: "${competencyLabel}"
${comp?.description ? `Beschreibung: ${comp.description}` : ""}
${comp?.bloom_level ? `Bloom-Level: ${comp.bloom_level}` : ""}
${existingMisconceptions.length ? `\nBereits bekannte Fehler (NICHT wiederholen):\n${existingMisconceptions.map((m: string) => `- ${m}`).join("\n")}` : ""}

Gib die typischen Fehler als JSON zurück.`;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "return_common_errors",
            description: "Return 3-5 common errors for the competency.",
            parameters: {
              type: "object",
              properties: {
                common_errors: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: {
                        type: "string",
                        description: "Concrete error/misconception in German",
                      },
                      confidence: {
                        type: "number",
                        description: "Confidence 0.0 to 1.0 how common this error is",
                      },
                    },
                    required: ["label", "confidence"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["common_errors"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "return_common_errors" } },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI gateway ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

  if (!toolCall?.function?.arguments) {
    throw new Error("No tool call in AI response");
  }

  const parsed = JSON.parse(toolCall.function.arguments);
  const errors: EnrichmentError[] = (parsed.common_errors || [])
    .filter((e: any) => e.label && typeof e.label === "string" && e.label.length >= 5)
    .slice(0, 5)
    .map((e: any) => ({
      label: e.label.trim(),
      confidence: Math.min(Math.max(Number(e.confidence) || 0.7, 0.1), 1.0),
    }));

  return errors;
}
