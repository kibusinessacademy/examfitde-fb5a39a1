import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Elite Competency Enrichment v2 — Generic (supports any curriculum)
 * Body: { curriculum_id, profession_key?, offset?, batch_size? }
 */

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

function validateMisconception(m: unknown): boolean {
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

function validateTransferMarker(t: unknown): boolean {
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

const PROFESSION_PROMPTS: Record<string, string> = {
  PKA: `Du bist IHK-Prüfungsexperte für Pharmazeutisch-kaufmännische Angestellte (PKA).
BRANCHENSPEZIFISCH:
- Warenwirtschaft: EK/VK/Spannen-Berechnung, Lageroptimierung, Bestellpunktverfahren
- Arzneimittelrecht: Aut-idem, Rabattverträge, BtM-Dokumentation, ApBetrO
- Abrechnung: Retaxationsrisiken, Hilfsmittelversorgung, Rezeptprüfung
- QM: DIN EN ISO 9001 in der Apotheke, SOPs, CIRS
- Transfer: Öffentliche Apotheke vs. Krankenhausapotheke vs. Pharma-Großhandel`,

  MFA: `Du bist IHK-Prüfungsexperte für Medizinische Fachangestellte (MFA).
BRANCHENSPEZIFISCH:
- Abrechnung: GOÄ/EBM-Differenzierung, Ziffernlogik, IGeL
- Hygiene: RKI-Richtlinien, Aufbereitung, Kontaminationsszenarien
- Notfall: Synkope, Anaphylaxie, Hypoglykämie
- Recht: DSGVO, Strahlenschutz, Patientenrechtegesetz
- Transfer: Hausarztpraxis vs. Fachpraxis vs. MVZ`,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const body = await req.json().catch(() => ({}));
  const curriculumId = body.curriculum_id;
  const profKey = body.profession_key || "GENERIC";
  const offset = body.offset || 0;
  const BATCH = body.batch_size || 5;

  if (!curriculumId) return json({ error: "curriculum_id required" }, 400);

  try {
    const { data: comps, error: fetchErr } = await sb
      .from("competencies")
      .select("id, title, bloom_level, action_verb, exam_relevance_tier, typical_misconceptions, transfer_markers, context_conditions, learning_fields!inner(title, curriculum_id)")
      .eq("learning_fields.curriculum_id", curriculumId)
      .order("title")
      .range(offset, offset + 49);

    if (fetchErr) throw fetchErr;

    const needsWork = (comps || []).filter((c: any) => {
      const noMisc = !c.typical_misconceptions || (Array.isArray(c.typical_misconceptions) && c.typical_misconceptions.length === 0);
      const noTrans = !c.transfer_markers || (Array.isArray(c.transfer_markers) && c.transfer_markers.length === 0);
      const noCtx = !c.context_conditions;
      return noMisc || noTrans || noCtx;
    }).slice(0, BATCH);

    if (!needsWork.length) {
      return json({ ok: true, enriched: 0, done: true, message: "All competencies already enriched" });
    }

    const compList = needsWork.map((c: any) => ({
      id: c.id, title: c.title, bloom_level: c.bloom_level,
      action_verb: c.action_verb, tier: c.exam_relevance_tier,
      lf_title: c.learning_fields?.title || "",
    }));

    const profContext = PROFESSION_PROMPTS[profKey] || "Du bist IHK-Prüfungsexperte. Erstelle praxisnahe, branchenspezifische Enrichments.";

    const systemPrompt = `${profContext}

Erstelle für JEDE Kompetenz:
1. "context_conditions": Konkrete berufliche Handlungssituation (1-2 Sätze, min 30 Zeichen).
2. "misconceptions": Array von 3-5 typischen IHK-Prüfungsfehlern:
   {"claim":"...(min 10)","why_wrong":"...(min 10)","correct_principle":"...(min 10)","quick_fix":"...(min 5)","example_trap":"...(min 20)"}
3. "transfer_markers": Array von 2-3 Transfer-Kontexten:
   {"context":"...(min 10)","what_changes":"...(min 5)","what_stays":"...(min 5)","cue_words":["2-6 Wörter"]}

Antworte NUR als JSON: {"enrichments": [{id, context_conditions, misconceptions, transfer_markers}]}`;

    const aiResp = await callAIJSON({
      provider: "openai", model: "gpt-5.2",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Enriche diese ${needsWork.length} Kompetenzen:\n${JSON.stringify(compList)}` },
      ],
      max_tokens: 8000,
    });

    const parsed = safeParse(aiResp.content);
    if (!parsed) return json({ ok: false, error: "AI parse error", raw: aiResp.content.slice(0, 300) }, 422);

    const enrichments: any[] = Array.isArray(parsed) ? parsed : ((parsed as any).enrichments || []);
    let totalEnriched = 0, skipped = 0;

    for (const e of enrichments) {
      if (!e.id) continue;
      const update: Record<string, any> = {};
      let valid = false;

      if (typeof e.context_conditions === "string" && e.context_conditions.length >= 30) {
        update.context_conditions = e.context_conditions; valid = true;
      }
      if (Array.isArray(e.misconceptions)) {
        const good = e.misconceptions.filter(validateMisconception);
        if (good.length >= 2) { update.typical_misconceptions = good; valid = true; }
      }
      if (Array.isArray(e.transfer_markers)) {
        const good = e.transfer_markers.filter(validateTransferMarker);
        if (good.length >= 1) { update.transfer_markers = good; valid = true; }
      }

      if (valid) {
        update.enrichment_version = 2;
        update.enriched_at = new Date().toISOString();
        const { error: upErr } = await sb.from("competencies").update(update).eq("id", e.id);
        if (!upErr) totalEnriched++; else console.error(`Update failed ${e.id}: ${upErr.message}`);
      } else { skipped++; }
    }

    const totalRemaining = (comps || []).filter((c: any) => {
      const noMisc = !c.typical_misconceptions || (Array.isArray(c.typical_misconceptions) && c.typical_misconceptions.length === 0);
      const noTrans = !c.transfer_markers || (Array.isArray(c.transfer_markers) && c.transfer_markers.length === 0);
      const noCtx = !c.context_conditions;
      return noMisc || noTrans || noCtx;
    }).length - totalEnriched;

    return json({
      ok: true, enriched: totalEnriched, skipped, ai_returned: enrichments.length,
      remaining: Math.max(0, totalRemaining),
      next_offset: totalRemaining > BATCH ? offset : offset + 50,
      done: totalRemaining <= 0 && (comps || []).length < 50,
    });
  } catch (e) {
    console.error(`[Enrich] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
