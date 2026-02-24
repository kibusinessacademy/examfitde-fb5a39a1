import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Phase 2: AI-powered misconceptions + transfer_markers enrichment
 * v2: write-if-empty via RPC, tolerant JSON parsing, ai_validations persist,
 *     CORS with x-examfit-job-key, truncated payloads.
 */

const BATCH_SIZE = 10;

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

// ═══════════════════════════════════════
// Schema Validation
// ═══════════════════════════════════════

interface Misconception {
  claim: string;
  why_wrong: string;
  correct_principle: string;
  quick_fix: string;
  example_trap: string;
}

interface TransferMarker {
  context: string;
  what_changes: string;
  what_stays: string;
  cue_words: string[];
}

function validateMisconception(m: unknown): m is Misconception {
  if (!m || typeof m !== "object") return false;
  const obj = m as Record<string, unknown>;
  return (
    typeof obj.claim === "string" && obj.claim.length >= 10 && obj.claim.length <= 500 &&
    typeof obj.why_wrong === "string" && obj.why_wrong.length >= 10 &&
    typeof obj.correct_principle === "string" && obj.correct_principle.length >= 10 &&
    typeof obj.quick_fix === "string" && obj.quick_fix.length >= 5 &&
    typeof obj.example_trap === "string" && obj.example_trap.length >= 20
  );
}

function validateTransferMarker(t: unknown): t is TransferMarker {
  if (!t || typeof t !== "object") return false;
  const obj = t as Record<string, unknown>;
  return (
    typeof obj.context === "string" && obj.context.length >= 10 &&
    typeof obj.what_changes === "string" && obj.what_changes.length >= 5 &&
    typeof obj.what_stays === "string" && obj.what_stays.length >= 5 &&
    Array.isArray(obj.cue_words) && obj.cue_words.length >= 2 && obj.cue_words.length <= 6 &&
    obj.cue_words.every((w: unknown) => typeof w === "string" && w.length >= 3 && w.length <= 20)
  );
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

  // Security gate
  const jobKey = req.headers.get("x-examfit-job-key");
  const expectedKey = Deno.env.get("CRON_SECRET");
  if (!expectedKey || jobKey !== expectedKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id || null;
  const batchSize = body.batch_size || BATCH_SIZE;
  const maxBatches = body.max_batches || 3;

  try {
    // Patch 5: RPC with proper JSONB length checks
    const { data: candidates, error: rpcErr } = await sb.rpc("get_phase2_candidates", {
      p_curriculum_id: curriculumId,
      p_limit: batchSize * maxBatches,
    });
    if (rpcErr) throw rpcErr;
    if (!candidates?.length) {
      return json({ ok: true, enriched: 0, message: "All exam-relevant competencies enriched", batch_complete: true });
    }

    let totalEnriched = 0;
    let totalSkipped = 0;
    const results: any[] = [];

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);

      // Patch 9: Truncated payloads to reduce token cost
      const compList = batch.map((c: any) => ({
        id: c.id,
        title: (c.title || "").slice(0, 80),
        description: (c.description || "").slice(0, 200),
        bloom_level: c.bloom_level || "understand",
        action_verb: c.action_verb || "",
        tier: c.exam_relevance_tier,
        target_misconceptions: c.exam_relevance_tier === "core" ? "3-5" : "2-3",
        target_transfer: c.exam_relevance_tier === "core" ? "2-3" : "1-2",
        lf_title: (c.lf_title || "").slice(0, 80),
        profession: (c.profession_name || "Unbekannt").slice(0, 40),
        needs_misconceptions: c.needs_misconceptions,
        needs_transfer: c.needs_transfer,
      }));

      const systemPrompt = `Du bist ein IHK-Prüfungsexperte. Erstelle strukturierte Misconceptions und Transfer-Marker.

Für JEDE Kompetenz liefere:
1. "id": UUID (unverändert!)
2. "misconceptions": Array von Objekten (Anzahl: siehe target_misconceptions):
   {
     "claim": "Was der Prüfling fälschlicherweise glaubt (min 10 Zeichen)",
     "why_wrong": "Warum es falsch ist, fachlich präzise (min 10 Zeichen)",
     "correct_principle": "Das korrekte Prinzip/Konzept (min 10 Zeichen)",
     "quick_fix": "Merkspruch oder Eselsbrücke (min 5 Zeichen)",
     "example_trap": "Typische IHK-Prüfungsfrage, die auf diesen Fehler abzielt (min 20 Zeichen)"
   }
3. "transfer_markers": Array von Objekten (Anzahl: siehe target_transfer):
   {
     "context": "Konkreter beruflicher Anwendungskontext (min 10 Zeichen)",
     "what_changes": "Was sich ändert bei Transfer (min 5 Zeichen)",
     "what_stays": "Was gleich bleibt / das Prinzip (min 5 Zeichen)",
     "cue_words": ["Signalwörter", "2-6 Stück, je 3-20 Zeichen"]
   }

REGELN:
- Misconceptions müssen REALISTISCHE IHK-Prüfungsfehler sein
- Keine generischen Fehler
- Transfer-Marker müssen zum Bloom-Level passen
- Max 1200 Zeichen pro Kompetenz insgesamt

Antworte NUR als JSON: {"enrichments": [{...}]}`;

      try {
        const aiResp = await callAIJSON({
          provider: "lovable",
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Enriche diese ${batch.length} Kompetenzen:\n${JSON.stringify(compList)}` },
          ],
          max_tokens: 4096,
        });

        // Patch 7: Tolerant JSON parsing
        const parsed = safeJsonParse(aiResp.content);
        if (!parsed) {
          // Patch 10: Persist parse errors to ai_validations
          await sb.from("ai_validations").insert({
            generation_id: crypto.randomUUID(),
            validation_mode: "elite_enrichment_phase2",
            decision: "fail",
            overall_score: 0,
            dimension_scores: {},
            critical_issues: [{ type: "parse_error", sample: aiResp.content.slice(0, 300) }],
            validator_model: "system",
            validated_at: new Date().toISOString(),
          }).catch(() => { /* best-effort persist */ });

          results.push({ batch: i / batchSize + 1, status: "parse_error", raw: aiResp.content.slice(0, 200) });
          continue;
        }

        const enrichments: any[] = Array.isArray(parsed) ? parsed : ((parsed as any).enrichments || []);

        // Patch 6: Validate before building update payload; only write valid fields
        const rpcUpdates: any[] = [];
        let batchSkipped = 0;

        for (const e of enrichments) {
          if (!e.id) continue;
          const item: Record<string, any> = { id: e.id };
          let ok = false;

          if (Array.isArray(e.misconceptions)) {
            const good = e.misconceptions.filter(validateMisconception);
            if (good.length >= 2) { item.typical_misconceptions = good; ok = true; }
          }

          if (Array.isArray(e.transfer_markers)) {
            const good = e.transfer_markers.filter(validateTransferMarker);
            if (good.length >= 1) { item.transfer_markers = good; ok = true; }
          }

          if (ok) {
            rpcUpdates.push(item);
          } else {
            batchSkipped++;
            console.warn(`[Phase2] Skipped ${e.id}: validation failed`);
          }
        }

        // Patch 8: Write-if-empty via server-side RPC (race-safe)
        let batchUpdated = 0;
        if (rpcUpdates.length) {
          const { data: rpcResult, error: rpcErr } = await sb.rpc("apply_phase2_enrichment", {
            p_updates: rpcUpdates,
          });
          if (rpcErr) {
            console.error(`[Phase2] RPC apply error: ${rpcErr.message}`);
            // Fallback: individual updates (non-race-safe but functional)
            for (const item of rpcUpdates) {
              const updateData: Record<string, any> = {};
              if (item.typical_misconceptions) updateData.typical_misconceptions = item.typical_misconceptions;
              if (item.transfer_markers) updateData.transfer_markers = item.transfer_markers;
              updateData.enrichment_version = 2;
              updateData.enriched_at = new Date().toISOString();
              const { error } = await sb.from("competencies").update(updateData).eq("id", item.id);
              if (!error) batchUpdated++;
            }
          } else {
            batchUpdated = rpcResult?.updated ?? rpcUpdates.length;
          }
        }

        totalEnriched += batchUpdated;
        totalSkipped += batchSkipped;
        results.push({ batch: i / batchSize + 1, status: "ok", enriched: batchUpdated, skipped: batchSkipped });
      } catch (e) {
        results.push({ batch: i / batchSize + 1, status: "error", error: (e as Error).message?.slice(0, 200) });
      }
    }

    // Remaining counts (JSONB-aware)
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

    console.log(`[Phase2] +${totalEnriched} enriched, ${totalSkipped} skipped | remaining: misc=${remainingMisc} transfer=${remainingTransfer}`);

    return json({
      ok: true,
      phase: 2,
      enriched: totalEnriched,
      skipped: totalSkipped,
      remaining: { misconceptions: remainingMisc || 0, transfer_markers: remainingTransfer || 0 },
      batches: results,
      batch_complete: (remainingMisc || 0) === 0 && (remainingTransfer || 0) === 0,
    });

  } catch (e) {
    console.error(`[Phase2] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
