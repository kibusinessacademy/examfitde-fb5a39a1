import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIWithFailover } from "../_shared/ai-client.ts";
import { getModelChainAsync } from "../_shared/model-routing.ts";

/**
 * Legacy enrichment function (Phase 0 / general enrichment).
 * v2: CORS with x-examfit-job-key, tolerant JSON parsing, truncated payloads.
 */

const BATCH_SIZE = 15;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-examfit-job-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// Patch 7: Tolerant JSON parser
function safeJsonParse(raw: string): unknown | null {
  const cleaned = raw
    .replace(/```json\s*/g, "")
    .replace(/```/g, "")
    .trim();

  try { return JSON.parse(cleaned); } catch { /* noop */ }

  const m = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { /* noop */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id;
  const batchSize = body.batch_size || BATCH_SIZE;
  const maxBatches = body.max_batches || 5;

  try {
    // 1) Load unenriched competencies
    let query = sb
      .from("competencies")
      .select("id, title, description, taxonomy_level, bloom_level, code, learning_field_id")
      .is("action_verb", null)
      .order("created_at")
      .limit(batchSize * maxBatches);

    if (curriculumId) {
      const { data: lfIds } = await sb
        .from("learning_fields")
        .select("id")
        .eq("curriculum_id", curriculumId);
      if (lfIds?.length) {
        query = query.in("learning_field_id", lfIds.map((lf: any) => lf.id));
      }
    }

    const { data: competencies, error: compErr } = await query;
    if (compErr) throw compErr;
    if (!competencies?.length) return json({ ok: true, enriched: 0, message: "All competencies already enriched" });

    // 2) Load LF + curriculum context
    const lfIds = [...new Set(competencies.map((c: any) => c.learning_field_id))];
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("id, title, exam_part, curriculum_id")
      .in("id", lfIds);
    const lfMap = new Map((lfs || []).map((lf: any) => [lf.id, lf]));

    const curIds = [...new Set((lfs || []).map((lf: any) => lf.curriculum_id))];
    const { data: curricula } = await sb
      .from("curricula")
      .select("id, title")
      .in("id", curIds);
    const curMap = new Map((curricula || []).map((c: any) => [c.id, c.title]));

    // 3) Process in batches
    let totalEnriched = 0;
    const results: any[] = [];

    for (let i = 0; i < competencies.length; i += batchSize) {
      const batch = competencies.slice(i, i + batchSize);

      const compList = batch.map((c: any) => {
        const lf = lfMap.get(c.learning_field_id);
        const curTitle = lf ? curMap.get(lf.curriculum_id) : "Unbekannt";
        return {
          id: c.id,
          title: (c.title || "").slice(0, 80),
          description: (c.description || "").slice(0, 200),
          bloom_level: c.bloom_level || "understand",
          lf_title: (lf?.title || "").slice(0, 80),
          exam_part: lf?.exam_part || "",
          curriculum: (curTitle || "").slice(0, 40),
        };
      });

      const systemPrompt = `Du bist ein IHK-Prüfungsexperte und Didaktik-Spezialist.
Deine Aufgabe: Bestehende Kompetenzbeschreibungen auf Elite-Prüfungsniveau anheben.

Für JEDE Kompetenz lieferst du ein Objekt mit:
1. "id": Die übergebene UUID (unverändert!)
2. "action_verb": Das zentrale Handlungsverb (z.B. "konfiguriert", "berechnet", "bewertet")
3. "context_conditions": Rahmenbedingungen/Kontext
4. "typical_misconceptions": Array mit 3-5 typischen Denkfehlern
5. "exam_relevance_tier": "core" | "important" | "supplementary"
6. "transfer_markers": Array mit Transferbezügen
7. "enhanced_description": Verbesserte Beschreibung

REGELN:
- Handlungsorientiert formulieren
- Misconceptions müssen REALISTISCH sein
- Kontext BERUFSSPEZIFISCH
- Max 1200 Zeichen pro Kompetenz insgesamt

Antworte NUR als JSON: {"enrichments": [{...}, ...]}`;

      const userPrompt = `Enriche diese ${batch.length} Kompetenzen:\n${JSON.stringify(compList)}`;

      try {
        const enrichChain = await getModelChainAsync("blooms_classify");
        const aiResult = await callAIWithFailover(
          enrichChain.map(c => ({ provider: c.provider, model: c.model })),
          {
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.5,
          },
        );

        const content = aiResult.content || "";

        // Patch 7: Tolerant JSON parser
        const parsed = safeJsonParse(content);
        let enrichments: any[];
        if (!parsed) {
          results.push({ batch: i / batchSize + 1, status: "parse_error", raw: content.slice(0, 200) });
          continue;
        }
        enrichments = Array.isArray(parsed) ? parsed : ((parsed as any).enrichments || []);

        // 4) Update each competency with guards
        let batchUpdated = 0;
        for (const e of enrichments) {
          if (!e.id) continue;

          const updateData: Record<string, any> = {};
          // Patch 3+4: action_verb_source + guard
          if (e.action_verb && typeof e.action_verb === "string" && e.action_verb.length >= 4) {
            updateData.action_verb = e.action_verb;
            updateData.action_verb_source = "ai_legacy";
          }
          if (e.context_conditions && typeof e.context_conditions === "string")
            updateData.context_conditions = e.context_conditions;
          if (Array.isArray(e.typical_misconceptions) && e.typical_misconceptions.length >= 2)
            updateData.typical_misconceptions = e.typical_misconceptions;
          if (e.exam_relevance_tier && ["core", "important", "supplementary"].includes(e.exam_relevance_tier))
            updateData.exam_relevance_tier = e.exam_relevance_tier;
          if (Array.isArray(e.transfer_markers) && e.transfer_markers.length >= 1)
            updateData.transfer_markers = e.transfer_markers;
          if (e.enhanced_description && typeof e.enhanced_description === "string" && e.enhanced_description.length >= 20)
            updateData.description = e.enhanced_description;

          if (Object.keys(updateData).length > 0) {
            const { error: upErr } = await sb.from("competencies").update(updateData).eq("id", e.id);
            if (!upErr) batchUpdated++;
          }
        }

        totalEnriched += batchUpdated;
        results.push({ batch: i / batchSize + 1, status: "ok", enriched: batchUpdated, total: batch.length });
      } catch (aiErr: unknown) {
        results.push({ batch: i / batchSize + 1, status: "error", error: (aiErr as Error)?.message?.slice(0, 200) });
        continue;
      }
    }

    // 5) Count remaining (curriculum-scoped if applicable)
    let remaining: number | null = 0;
    if (curriculumId) {
      const { data: r } = await sb.rpc("get_phase1_remaining_counts", { p_curriculum_id: curriculumId });
      remaining = r?.missing_verb ?? 0;
    } else {
      const { count } = await sb
        .from("competencies")
        .select("id", { count: "exact", head: true })
        .is("action_verb", null);
      remaining = count;
    }

    console.log(`[CompEnrich] +${totalEnriched} enriched, ${remaining} remaining`);

    return json({
      ok: true,
      enriched: totalEnriched,
      total_processed: competencies.length,
      remaining: remaining || 0,
      batches: results,
    });
  } catch (e: unknown) {
    console.error(`[CompEnrich] Error: ${(e as Error)?.message}`);
    return json({ ok: false, error: (e as Error)?.message || String(e) }, 500);
  }
});
