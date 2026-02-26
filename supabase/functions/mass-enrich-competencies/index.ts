import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Mass Competency Enrichment — Auto-iterates ALL unenriched curricula
 * 
 * Adds profession-specific:
 *   - typical_misconceptions (3-5 IHK exam traps)
 *   - transfer_markers (2-3 transfer contexts)
 *   - context_conditions (professional action situations)
 *
 * Body: { batch_size?, max_curricula? }
 * Called repeatedly (via cron or manual) until all done.
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
    o.cue_words.every((w: unknown) => typeof w === "string" && w.length >= 2)
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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => ({}));
  const COMP_BATCH = body.batch_size || 5;
  const MAX_CURRICULA = body.max_curricula || 3; // process up to N curricula per invocation
  const TIME_BUDGET_MS = 80_000; // 80s budget within 90s edge function limit
  const startTime = Date.now();

  try {
    // ── Find next unenriched curricula via simple query ──
    const { data: unenrichedComps } = await sb
      .from("competencies")
      .select("learning_field_id")
      .or("enrichment_version.is.null,enrichment_version.lt.2")
      .limit(200);

    if (!unenrichedComps?.length) {
      return json({ ok: true, done: true, message: "All competencies enriched!" });
    }

    // Get unique curriculum IDs from learning fields
    const lfIds = [...new Set(unenrichedComps.map((c: any) => c.learning_field_id))];
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("curriculum_id")
      .in("id", lfIds.slice(0, 50));

    const curIds = [...new Set((lfs || []).map((l: any) => l.curriculum_id))].slice(0, MAX_CURRICULA);
    
    // Get curriculum + beruf details
    const { data: curData } = await sb
      .from("curricula")
      .select("id, title, berufe!inner(bezeichnung_kurz, bezeichnung_lang, zustaendigkeit, taetigkeitsprofil)")
      .in("id", curIds);

    const curricula = (curData || []).map((c: any) => ({
      curriculum_id: c.id,
      curriculum_title: c.title,
      beruf_kurz: c.berufe?.bezeichnung_kurz || "",
      beruf_lang: c.berufe?.bezeichnung_lang || null,
      zustaendigkeit: c.berufe?.zustaendigkeit || "",
      taetigkeitsprofil: c.berufe?.taetigkeitsprofil || null,
    }));

    if (!curricula.length) {
      return json({ ok: true, done: true, message: "All competencies enriched!" });
    }

    const results: Array<{
      curriculum_id: string;
      beruf: string;
      enriched: number;
      skipped: number;
      remaining: number;
    }> = [];

    for (const cur of curricula) {
      if (Date.now() - startTime > TIME_BUDGET_MS) break;

      // Fetch unenriched competencies for this curriculum
      const { data: comps } = await sb
        .from("competencies")
        .select("id, title, bloom_level, action_verb, exam_relevance_tier, typical_misconceptions, transfer_markers, context_conditions, learning_fields!inner(title, curriculum_id)")
        .eq("learning_fields.curriculum_id", cur.curriculum_id)
        .or("enrichment_version.is.null,enrichment_version.lt.2")
        .limit(COMP_BATCH);

      if (!comps?.length) {
        results.push({ curriculum_id: cur.curriculum_id, beruf: cur.beruf_kurz, enriched: 0, skipped: 0, remaining: 0 });
        continue;
      }

      // Build profession-specific system prompt from beruf data
      const profContext = buildProfessionPrompt(cur.beruf_kurz, cur.beruf_lang, cur.taetigkeitsprofil, cur.zustaendigkeit);

      const compList = comps.map((c: any) => ({
        id: c.id, title: c.title, bloom_level: c.bloom_level,
        action_verb: c.action_verb, tier: c.exam_relevance_tier,
        lf_title: c.learning_fields?.title || "",
      }));

      const systemPrompt = `${profContext}

Erstelle für JEDE Kompetenz:
1. "context_conditions": Konkrete berufliche Handlungssituation (1-2 Sätze, min 30 Zeichen).
2. "misconceptions": Array von 3-5 typischen IHK-Prüfungsfehlern:
   {"claim":"...(min 10)","why_wrong":"...(min 10)","correct_principle":"...(min 10)","quick_fix":"...(min 5)","example_trap":"...(min 20)"}
3. "transfer_markers": Array von 2-3 Transfer-Kontexten:
   {"context":"...(min 10)","what_changes":"...(min 5)","what_stays":"...(min 5)","cue_words":["2-6 Wörter"]}

Antworte NUR als JSON: {"enrichments": [{id, context_conditions, misconceptions, transfer_markers}]}`;

      try {
        const aiResp = await callAIJSON({
          provider: "lovable", model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Enriche diese ${comps.length} Kompetenzen für den Beruf "${cur.beruf_kurz}":\n${JSON.stringify(compList)}` },
          ],
          max_tokens: 8000,
        });

        const parsed = safeParse(aiResp.content);
        if (!parsed) {
          results.push({ curriculum_id: cur.curriculum_id, beruf: cur.beruf_kurz, enriched: 0, skipped: comps.length, remaining: comps.length });
          continue;
        }

        const enrichments: any[] = Array.isArray(parsed) ? parsed : ((parsed as any).enrichments || []);
        let enriched = 0, skipped = 0;

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
            if (!upErr) enriched++; else skipped++;
          } else { skipped++; }
        }

        // Count remaining for this curriculum
        const { count: remaining } = await sb
          .from("competencies")
          .select("id", { count: "exact", head: true })
          .eq("learning_fields.curriculum_id" as any, cur.curriculum_id)
          .or("enrichment_version.is.null,enrichment_version.lt.2");

        results.push({
          curriculum_id: cur.curriculum_id,
          beruf: cur.beruf_kurz,
          enriched,
          skipped,
          remaining: remaining || 0,
        });
      } catch (aiErr) {
        console.error(`[MassEnrich] AI error for ${cur.beruf_kurz}: ${(aiErr as Error).message}`);
        results.push({ curriculum_id: cur.curriculum_id, beruf: cur.beruf_kurz, enriched: 0, skipped: comps.length, remaining: comps.length });
      }
    }

    const totalEnriched = results.reduce((s, r) => s + r.enriched, 0);
    const allDone = results.every(r => r.remaining === 0) && curricula.length < MAX_CURRICULA;

    return json({
      ok: true,
      enriched_total: totalEnriched,
      curricula_processed: results.length,
      results,
      done: allDone,
      elapsed_ms: Date.now() - startTime,
    });
  } catch (e) {
    console.error(`[MassEnrich] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});

/**
 * Build a profession-specific system prompt from beruf metadata.
 * Dynamically creates IHK exam context based on the profession's field.
 */
function buildProfessionPrompt(
  berufKurz: string,
  berufLang: string | null,
  taetigkeitsprofil: string | null,
  zustaendigkeit: string,
): string {
  const berufName = berufLang || berufKurz;
  
  // Map zustaendigkeit to exam context
  const examContext: Record<string, string> = {
    "IHK": "IHK-Abschlussprüfung",
    "HWK": "Gesellenprüfung (Handwerkskammer)",
    "LWK": "Prüfung der Landwirtschaftskammer",
  };
  const examType = examContext[zustaendigkeit] || `${zustaendigkeit}-Abschlussprüfung`;

  const profil = taetigkeitsprofil 
    ? `\nTÄTIGKEITSPROFIL: ${taetigkeitsprofil}`
    : "";

  return `Du bist Prüfungsexperte für den Ausbildungsberuf "${berufName}" (${examType}).${profil}

DEINE AUFGABE:
- Erstelle berufsspezifische Prüfungsfallen (Misconceptions), die EXAKT zum Berufsalltag von ${berufKurz} passen
- Transfer-Kontexte müssen reale Einsatzgebiete dieses Berufs widerspiegeln
- Handlungssituationen müssen authentische betriebliche Szenarien des Berufsfelds darstellen
- Verwende die korrekte Fachsprache des Berufsfelds
- Prüfungsfallen sollen typische Denkfehler widerspiegeln, die in der ${examType} vorkommen

WICHTIG:
- KEINE generischen Beispiele, JEDES Element muss spezifisch für "${berufKurz}" sein
- Misconceptions: Was glauben Azubis fälschlich? Wo verwechseln sie Konzepte?
- Transfer: In welchen verschiedenen betrieblichen Kontexten wird die Kompetenz angewendet?
- Context: Beschreibe eine konkrete Arbeitssituation aus dem Alltag eines/einer ${berufKurz}`;
}
