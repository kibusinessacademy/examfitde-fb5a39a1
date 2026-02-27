import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

function generateToken(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "EF-";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const { curriculum_id, learning_field_ids } = body;

    if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

    // Fetch learning fields (optionally filtered)
    let query = sb
      .from("learning_fields")
      .select("id, code, title, description, weight_percent, hours, ihk_focus_areas")
      .eq("curriculum_id", curriculum_id)
      .order("sort_order");

    if (learning_field_ids?.length) {
      query = query.in("id", learning_field_ids);
    }

    const { data: lfs, error: lfErr } = await query;
    if (lfErr || !lfs?.length) return json({ error: "No learning fields found", detail: lfErr?.message }, 404);

    // Fetch competencies for context
    const lfIds = lfs.map((lf) => lf.id);
    const { data: comps } = await sb
      .from("competencies")
      .select("learning_field_id, title, action_verb")
      .in("learning_field_id", lfIds)
      .limit(200);

    const compsByLf: Record<string, string[]> = {};
    for (const c of comps || []) {
      const key = c.learning_field_id;
      if (!compsByLf[key]) compsByLf[key] = [];
      compsByLf[key].push(`${c.action_verb || ""} ${c.title}`.trim());
    }

    // Fetch curriculum name for context
    const { data: curriculum } = await sb
      .from("curricula")
      .select("title")
      .eq("id", curriculum_id)
      .maybeSingle();

    const created: string[] = [];
    const skipped: string[] = [];

    for (const lf of lfs) {
      // Check if song already exists
      const { data: existing } = await sb
        .from("learning_field_songs")
        .select("id")
        .eq("curriculum_id", curriculum_id)
        .eq("learning_field_id", lf.id)
        .eq("song_key", "lf-summary-v1")
        .maybeSingle();

      if (existing) {
        skipped.push(lf.code || lf.id);
        continue;
      }

      // Build prompt for LLM
      const competencyList = (compsByLf[lf.id] || []).slice(0, 8).join("\n- ");
      const focusAreas = lf.ihk_focus_areas
        ? JSON.stringify(lf.ihk_focus_areas).slice(0, 300)
        : "";

      const prompt = `Du bist ein kreativer Songtexter für Bildungsinhalte. Erstelle einen eingängigen Lernsong für Auszubildende.

Beruf/Kurs: ${curriculum?.title || "Ausbildung"}
Lernfeld: ${lf.code} – ${lf.title}
Beschreibung: ${lf.description || "—"}
Gewichtung: ${lf.weight_percent || "?"}%
${competencyList ? `Kompetenzen:\n- ${competencyList}` : ""}
${focusAreas ? `IHK-Schwerpunkte: ${focusAreas}` : ""}

REGELN:
1. Struktur EXAKT so (mit Tags in eckigen Klammern):
   [Hook] (2 Zeilen)
   [Chorus] (Kerninhalt zusammenfassen)
   [Verse 1] (Fachbegriffe einführen)
   [Verse 2] (Ablauf/Prozess erklären)
   [Bridge] (typische Prüfungsfalle benennen)
   [Chorus] (Wiederholung)
   [Outro] (1 Zeile Abschluss)
2. Sprache: Deutsch, verständlich, jugendfreundlich
3. Länge: STRIKT 150–220 Wörter (60–90 Sekunden Zielspielzeit)
4. Fachbegriffe korrekt verwenden
5. NUR Songtext ausgeben, KEINE Erklärungen, KEINE Einleitung
6. Jede Section mit dem Tag [Hook], [Chorus], [Verse 1] etc. beginnen

Antworte NUR mit dem Songtext.`;

      let lyrics = "";
      // Heuristic style based on LF weight
      const weight = lf.weight_percent || 0;
      let stylePrompt: string;
      if (weight >= 15) {
        stylePrompt = "German Rap, educational, clear vocals, punchy beat, 95 BPM, motivational, clean production, focus on intelligibility";
      } else if (weight >= 8) {
        stylePrompt = "Educational Pop, German lyrics, catchy chorus, medium tempo 90 BPM, acoustic guitar, natural voice, clean production";
      } else {
        stylePrompt = "LoFi Study Beat, German vocals, calm, 75 BPM, soft piano, minimal production, relaxing, focus on memorization";
      }

      if (LOVABLE_API_KEY) {
        try {
          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: "Du erstellst Lernsongs für deutsche Auszubildende. Antworte nur mit dem Songtext." },
                { role: "user", content: prompt },
              ],
            }),
          });

          if (aiRes.ok) {
            const aiData = await aiRes.json();
            lyrics = aiData.choices?.[0]?.message?.content?.trim() || "";
          } else {
            console.warn(`[SongGen] AI error ${aiRes.status} for LF ${lf.code}`);
          }
        } catch (aiErr) {
          console.warn(`[SongGen] AI call failed for LF ${lf.code}:`, aiErr);
        }
      }

      if (!lyrics) {
        lyrics = `[Hook]\n${lf.title} – merk dir das!\n\n[Chorus]\n${lf.title}\n${lf.description || "Lernfeld verstehen"}\n\n[Verse 1]\nBegriffe lernen, Schritt für Schritt\n\n[Bridge]\nAchtung Prüfungsfalle!\n\n[Outro]\n${lf.code} – geschafft!`;
      }

      const token = generateToken();
      const title = `Lernsong: ${lf.code} – ${lf.title}`.slice(0, 200);

      await sb.from("learning_field_songs").insert({
        curriculum_id,
        learning_field_id: lf.id,
        song_key: "lf-summary-v1",
        title,
        style_prompt: stylePrompt,
        lyrics,
        export_token: token,
        status: "draft",
      });

      created.push(lf.code || lf.id);
    }

    return json({
      ok: true,
      created: created.length,
      skipped: skipped.length,
      created_lfs: created,
      skipped_lfs: skipped,
    });
  } catch (e) {
    console.error("[SongGen] Error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
