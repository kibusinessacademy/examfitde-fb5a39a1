import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * MFA-specific Phase 2 Enrichment: misconceptions, transfer_markers, context_conditions
 * Callable via supabase.functions.invoke (auth header)
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const MFA_CURRICULUM_ID = "105dd602-ea07-478f-8593-fd149ec5b676";

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
  const o = m as Record<string, unknown>;
  return (
    typeof o.claim === "string" && o.claim.length >= 10 &&
    typeof o.why_wrong === "string" && o.why_wrong.length >= 10 &&
    typeof o.correct_principle === "string" && o.correct_principle.length >= 10 &&
    typeof o.quick_fix === "string" && o.quick_fix.length >= 5 &&
    typeof o.example_trap === "string" && o.example_trap.length >= 20
  );
}

function validateTransferMarker(t: unknown): t is TransferMarker {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  return (
    typeof o.context === "string" && o.context.length >= 10 &&
    typeof o.what_changes === "string" && o.what_changes.length >= 5 &&
    typeof o.what_stays === "string" && o.what_stays.length >= 5 &&
    Array.isArray(o.cue_words) && o.cue_words.length >= 2 &&
    o.cue_words.every((w: unknown) => typeof w === "string" && w.length >= 3)
  );
}

function safeParse(raw: string): unknown | null {
  const cleaned = raw.replace(/```json\s*/g, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* */ }
  const m = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const offset = body.offset || 0;
  const BATCH = body.batch_size || 6;

  try {
    // Fetch MFA competencies needing enrichment (paginated)
    const { data: comps, error: fetchErr } = await sb
      .from("competencies")
      .select("id, title, bloom_level, action_verb, exam_relevance_tier, typical_misconceptions, transfer_markers, context_conditions, learning_fields!inner(title, curriculum_id)")
      .eq("learning_fields.curriculum_id", MFA_CURRICULUM_ID)
      .order("title")
      .range(offset, offset + 49);

    if (fetchErr) throw fetchErr;

    // Filter to those needing enrichment
    const needsWork = (comps || []).filter((c: any) => {
      const noMisc = !c.typical_misconceptions || (Array.isArray(c.typical_misconceptions) && c.typical_misconceptions.length === 0);
      const noTrans = !c.transfer_markers || (Array.isArray(c.transfer_markers) && c.transfer_markers.length === 0);
      const noCtx = !c.context_conditions;
      return noMisc || noTrans || noCtx;
    }).slice(0, BATCH);

    if (!needsWork.length) {
      return json({ ok: true, enriched: 0, message: "All MFA competencies already enriched" });
    }

    // Process single batch (no loop - avoids timeout)
    const compList = needsWork.map((c: any) => ({
      id: c.id,
      title: c.title,
      bloom_level: c.bloom_level,
      action_verb: c.action_verb,
      tier: c.exam_relevance_tier,
      lf_title: c.learning_fields?.title || "",
    }));

    const systemPrompt = `Du bist IHK-Prüfungsexperte für Medizinische Fachangestellte (MFA).
Erstelle für JEDE Kompetenz:

1. "context_conditions": Konkrete berufliche Handlungssituation (1-2 Sätze, min 30 Zeichen).
   Beispiel: "In einer Hausarztpraxis bei der Durchführung von EKG-Ableitungen und Blutentnahmen unter Zeitdruck."

2. "misconceptions": Array von 3-5 MFA-typischen IHK-Prüfungsfehlern:
   {
     "claim": "Was Prüflinge fälschlicherweise glauben (min 10 Zeichen)",
     "why_wrong": "Warum es fachlich falsch ist (min 10 Zeichen)",
     "correct_principle": "Das korrekte Prinzip (min 10 Zeichen)",
     "quick_fix": "Merkspruch oder Eselsbrücke (min 5 Zeichen)",
     "example_trap": "Typische IHK-Prüfungsfrage die auf diesen Fehler abzielt (min 20 Zeichen)"
   }

3. "transfer_markers": Array von 2-3 Transfer-Kontexten:
   {
     "context": "Konkreter Anwendungskontext in der MFA-Praxis (min 10 Zeichen)",
     "what_changes": "Was sich im neuen Kontext ändert (min 5 Zeichen)",
     "what_stays": "Welches Prinzip gleich bleibt (min 5 Zeichen)",
     "cue_words": ["2-6 Signalwörter", "je 3-20 Zeichen"]
   }

WICHTIG - MFA-SPEZIFISCH:
- Misconceptions müssen MFA-Praxisrealität abbilden: Abrechnung (GOÄ/EBM), Hygiene (RKI-Richtlinien), Notfall, Patientenrecht, DSGVO, Strahlenschutz
- KEINE medizinischen Diagnose-Fehler oder Therapie-Entscheidungen (Safety-Standard!)
- Fokus auf: Organisation, Dokumentation, Abrechnung, Hygiene, Recht, Kommunikation
- Transfer-Marker müssen praxistypische Szenarien zeigen (Hausarztpraxis vs. Fachpraxis, Notaufnahme vs. Routine)

Antworte NUR als JSON: {"enrichments": [{id, context_conditions, misconceptions, transfer_markers}]}`;

    const aiResp = await callAIJSON({
      provider: "lovable",
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Enriche diese ${needsWork.length} MFA-Kompetenzen:\n${JSON.stringify(compList)}` },
      ],
      max_tokens: 8000,
    });

    const parsed = safeParse(aiResp.content);
    if (!parsed) {
      return json({ ok: false, error: "AI response parse error", raw: aiResp.content.slice(0, 300) }, 422);
    }

    const enrichments: any[] = Array.isArray(parsed) ? parsed : ((parsed as any).enrichments || []);
    let totalEnriched = 0;
    let skipped = 0;

    for (const e of enrichments) {
      if (!e.id) continue;

      const update: Record<string, any> = {};
      let valid = false;

      if (typeof e.context_conditions === "string" && e.context_conditions.length >= 30) {
        update.context_conditions = e.context_conditions;
        valid = true;
      }

      if (Array.isArray(e.misconceptions)) {
        const good = e.misconceptions.filter(validateMisconception);
        if (good.length >= 2) {
          update.typical_misconceptions = good;
          valid = true;
        }
      }

      if (Array.isArray(e.transfer_markers)) {
        const good = e.transfer_markers.filter(validateTransferMarker);
        if (good.length >= 1) {
          update.transfer_markers = good;
          valid = true;
        }
      }

      if (valid) {
        update.enrichment_version = 2;
        update.enriched_at = new Date().toISOString();

        const { error: upErr } = await sb
          .from("competencies")
          .update(update)
          .eq("id", e.id);

        if (!upErr) totalEnriched++;
        else console.error(`Update failed for ${e.id}: ${upErr.message}`);
      } else {
        skipped++;
      }
    }

    return json({
      ok: true,
      curriculum: "MFA",
      total_candidates: needsWork.length,
      enriched: totalEnriched,
      skipped,
      ai_returned: enrichments.length,
      next_offset: offset + 50,
    });

  } catch (e) {
    console.error(`[MFA-Enrich] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
