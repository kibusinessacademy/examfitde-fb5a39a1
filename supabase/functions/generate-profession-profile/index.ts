import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { callAIJSON } from "../_shared/ai-client.ts";

/**
 * Phase 3b: Generate PROFESSION_PROFILE v1 per beruf
 * 
 * Creates structured profiles with:
 * - Typical task types
 * - Common error patterns  
 * - Term strictness levels
 * - Preferred scenario types
 * - Assessment focus areas
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const maxItems = body.max_items || 5;

  try {
    // Find berufe without profiles
    const { data: allBerufe } = await sb
      .from("berufe")
      .select("id, bezeichnung_kurz, bezeichnung_lang, zustaendigkeit, ausbildungsdauer_monate, taetigkeitsprofil")
      .eq("ist_aktiv", true)
      .order("bezeichnung_kurz");

    if (!allBerufe?.length) return json({ ok: true, generated: 0, message: "No berufe found" });

    // Get existing profiles
    const { data: existing } = await sb
      .from("profession_profiles")
      .select("beruf_id");

    const existingIds = new Set((existing || []).map(p => p.beruf_id));
    const missing = allBerufe.filter(b => !existingIds.has(b.id)).slice(0, maxItems);

    if (!missing.length) {
      return json({ ok: true, generated: 0, batch_complete: true, message: "All professions have profiles" });
    }

    let generated = 0;
    const results: any[] = [];

    for (const beruf of missing) {
      // Load curriculum context
      const { data: curricula } = await sb
        .from("curricula")
        .select("id, title")
        .eq("beruf_id", beruf.id)
        .limit(1);

      let lfContext = "";
      if (curricula?.[0]) {
        const { data: lfs } = await sb
          .from("learning_fields")
          .select("code, title, exam_part")
          .eq("curriculum_id", curricula[0].id)
          .order("code")
          .limit(15);
        if (lfs?.length) {
          lfContext = `\nLernfelder: ${lfs.map(lf => `${lf.code}: ${lf.title} (${lf.exam_part || 'k.A.'})`).join("; ")}`;
        }
      }

      try {
        const aiResp = await callAIJSON({
          provider: "lovable",
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Du bist ein IHK-Prüfungsexperte. Erstelle ein PROFESSION_PROFILE für "${beruf.bezeichnung_kurz}".
${beruf.taetigkeitsprofil ? `Tätigkeitsprofil: ${beruf.taetigkeitsprofil.slice(0, 500)}` : ""}
${lfContext}

Liefere ein JSON-Objekt:
{
  "typical_task_types": ["Berechnung", "Fehleranalyse", "Best-Option", "Compliance", "Fallstudie", "Risikobewertung"],
  "common_error_patterns": [
    {"error": "Beschreibung des typischen Fehlers", "domain": "Lernfeld/Bereich", "severity": "high|medium|low"}
  ],
  "term_strictness": "strict|medium|relaxed",
  "term_strictness_rationale": "Warum diese Strenge",
  "preferred_scenario_types": [
    {"type": "Kundenberatung|Wartung|Kalkulation|...", "description": "Kurze Erklärung", "frequency": "high|medium"}
  ],
  "assessment_focus_areas": [
    {"area": "Bereich", "weight": "high|medium|low", "exam_part": "AP1|AP2|beide"}
  ],
  "industry_context": {
    "typical_employers": ["..."],
    "work_environments": ["..."],
    "key_regulations": ["..."],
    "digital_tools": ["..."]
  },
  "exam_style_hints": [
    "Spezifische Hinweise zum IHK-Prüfungsstil für diesen Beruf"
  ]
}

Sei SPEZIFISCH für den Beruf. Keine generischen Antworten.`,
            },
            { role: "user", content: `Profession Profile für: ${beruf.bezeichnung_kurz} (${beruf.zustaendigkeit}, ${beruf.ausbildungsdauer_monate} Monate)` },
          ],
          max_tokens: 2048,
        });

        let profile: any;
        try {
          const raw = aiResp.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const jsonStart = raw.indexOf("{");
          const jsonEnd = raw.lastIndexOf("}");
          profile = JSON.parse(raw.slice(jsonStart, jsonEnd + 1).replace(/,\s*([\]}])/g, "$1"));
        } catch {
          results.push({ beruf: beruf.bezeichnung_kurz, status: "parse_error" });
          continue;
        }

        const { error } = await sb.from("profession_profiles").insert({
          beruf_id: beruf.id,
          profession_name: beruf.bezeichnung_kurz,
          profile,
        });

        if (!error) {
          generated++;
          results.push({ beruf: beruf.bezeichnung_kurz, status: "ok" });
        } else {
          results.push({ beruf: beruf.bezeichnung_kurz, status: "db_error", error: error.message });
        }
      } catch (e) {
        results.push({ beruf: beruf.bezeichnung_kurz, status: "error", error: (e as Error).message?.slice(0, 200) });
      }
    }

    const totalMissing = allBerufe.length - existingIds.size - generated;
    console.log(`[Phase3-Profile] +${generated} profiles | ${totalMissing} remaining`);

    return json({
      ok: true,
      phase: 3,
      generated,
      remaining: totalMissing,
      results,
      batch_complete: totalMissing <= 0,
    });

  } catch (e) {
    console.error(`[Phase3-Profile] Error: ${(e as Error).message}`);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
