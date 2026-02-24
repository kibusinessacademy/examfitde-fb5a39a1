import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Phase 2: AI-powered misconceptions + transfer_markers enrichment
 * 
 * Only enriches exam-relevant competencies (tier: core/important).
 * Uses structured JSON output for misconceptions & transfer markers.
 * Runs in batches of 10 (heavy AI calls).
 */

const BATCH_SIZE = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id;
  const batchSize = body.batch_size || BATCH_SIZE;
  const maxBatches = body.max_batches || 3;

  try {
    // Load competencies needing misconceptions (only core/important)
    let query = sb
      .from("competencies")
      .select("id, title, description, bloom_level, action_verb, exam_relevance_tier, learning_field_id")
      .in("exam_relevance_tier", ["core", "important"])
      .or("typical_misconceptions.is.null,transfer_markers.is.null")
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
    if (!competencies?.length) {
      return json({ ok: true, enriched: 0, message: "All exam-relevant competencies enriched", batch_complete: true });
    }

    // Load LF + curriculum context
    const lfIds = [...new Set(competencies.map((c: any) => c.learning_field_id))];
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("id, title, exam_part, curriculum_id")
      .in("id", lfIds);
    const lfMap = new Map((lfs || []).map((lf: any) => [lf.id, lf]));

    const curIds = [...new Set((lfs || []).map((lf: any) => lf.curriculum_id))];
    const { data: curricula } = await sb
      .from("curricula")
      .select("id, title, berufe(bezeichnung_kurz)")
      .in("id", curIds);
    const curMap = new Map((curricula || []).map((c: any) => [c.id, c]));

    // Process in batches
    let totalEnriched = 0;
    const results: any[] = [];

    for (let i = 0; i < competencies.length; i += batchSize) {
      const batch = competencies.slice(i, i + batchSize);

      const compList = batch.map((c: any) => {
        const lf = lfMap.get(c.learning_field_id);
        const cur = lf ? curMap.get(lf.curriculum_id) : null;
        return {
          id: c.id,
          title: c.title,
          description: (c.description || "").slice(0, 300),
          bloom_level: c.bloom_level || "understand",
          action_verb: c.action_verb || "",
          tier: c.exam_relevance_tier,
          lf_title: lf?.title || "",
          exam_part: lf?.exam_part || "",
          profession: cur?.berufe?.bezeichnung_kurz || "Unbekannt",
        };
      });

      const systemPrompt = `Du bist ein IHK-Prüfungsexperte. Erstelle strukturierte Misconceptions und Transfer-Marker.

Für JEDE Kompetenz liefere:
1. "id": UUID (unverändert!)
2. "misconceptions": Array von Objekten, je ${batch[0]?.exam_relevance_tier === 'core' ? '3-5' : '2-3'}:
   {
     "claim": "Was der Prüfling fälschlicherweise glaubt",
     "why_wrong": "Warum es falsch ist (fachlich präzise)",
     "correct_principle": "Das korrekte Prinzip/Konzept",
     "quick_fix": "Merkspruch oder Eselsbrücke zum Merken",
     "example_trap": "Typische IHK-Prüfungsfrage, die auf diesen Fehler abzielt"
   }
3. "transfer_markers": Array von Objekten, je 1-3:
   {
     "context": "Konkreter beruflicher Anwendungskontext",
     "what_changes": "Was sich ändert bei Transfer in anderen Kontext",
     "what_stays": "Was gleich bleibt (das Prinzip)",
     "cue_words": ["Signalwörter", "die auf diesen Transfer hindeuten"]
   }

REGELN:
- Misconceptions müssen REALISTISCHE IHK-Prüfungsfehler sein
- Keine generischen Fehler ("vergisst den Kontext")
- Transfer-Marker müssen zum Bloom-Level passen
- Alles berufsspezifisch für den genannten Beruf

Antworte NUR als JSON: {"enrichments": [{...}]}`;

      try {
        const aiResp = await callAIJSON({
          provider: "lovable",
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Enriche diese ${batch.length} Kompetenzen:\n${JSON.stringify(compList, null, 2)}` },
          ],
          max_tokens: 4096,
        });

        let enrichments: any[];
        try {
          const raw = aiResp.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(raw);
          enrichments = Array.isArray(parsed) ? parsed : (parsed.enrichments || []);
        } catch {
          results.push({ batch: i / batchSize + 1, status: "parse_error", raw: aiResp.content.slice(0, 200) });
          continue;
        }

        let batchUpdated = 0;
        for (const e of enrichments) {
          if (!e.id) continue;
          const updateData: Record<string, any> = {};

          if (Array.isArray(e.misconceptions) && e.misconceptions.length >= 2) {
            updateData.typical_misconceptions = e.misconceptions;
          }
          if (Array.isArray(e.transfer_markers) && e.transfer_markers.length >= 1) {
            updateData.transfer_markers = e.transfer_markers;
          }

          if (Object.keys(updateData).length > 0) {
            const { error } = await sb.from("competencies").update(updateData).eq("id", e.id);
            if (!error) batchUpdated++;
          }
        }

        totalEnriched += batchUpdated;
        results.push({ batch: i / batchSize + 1, status: "ok", enriched: batchUpdated });
      } catch (e) {
        results.push({ batch: i / batchSize + 1, status: "error", error: (e as Error).message?.slice(0, 200) });
      }
    }

    // Count remaining
    const { count: remainingMisc } = await sb
      .from("competencies")
      .select("id", { count: "exact", head: true })
      .in("exam_relevance_tier", ["core", "important"])
      .is("typical_misconceptions", null);

    const { count: remainingTransfer } = await sb
      .from("competencies")
      .select("id", { count: "exact", head: true })
      .in("exam_relevance_tier", ["core", "important"])
      .is("transfer_markers", null);

    console.log(`[Phase2] +${totalEnriched} enriched | remaining: misc=${remainingMisc} transfer=${remainingTransfer}`);

    return json({
      ok: true,
      phase: 2,
      enriched: totalEnriched,
      remaining: { misconceptions: remainingMisc || 0, transfer_markers: remainingTransfer || 0 },
      batches: results,
      batch_complete: (remainingMisc || 0) === 0 && (remainingTransfer || 0) === 0,
    });

  } catch (e) {
    console.error(`[Phase2] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
