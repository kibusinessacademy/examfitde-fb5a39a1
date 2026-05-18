// Welcome Weakness Coach — Activation Cut 1b
// Liest die Top-Schwächen eines Nutzers (v_user_weakness_map) für ein Curriculum
// und erklärt sie kurz, motivierend, in einfachem Deutsch (Loop B: Aha-Moment).
//
// JWT-validated. Lovable AI Gateway (kein zusätzlicher API-Key).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!supabaseUrl || !anonKey) return json({ error: "missing_env" }, 500);
  if (!lovableApiKey) return json({ error: "ai_gateway_missing_key" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthenticated" }, 401);

  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u } = await sb.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return json({ error: "unauthenticated" }, 401);

  let body: { curriculum_id?: string; limit?: number } = {};
  try { body = await req.json(); } catch { /* noop */ }
  const curriculumId = body.curriculum_id;
  if (!curriculumId) return json({ error: "curriculum_id_required" }, 400);
  const limit = Math.min(Math.max(body.limit ?? 3, 1), 5);

  // 1) Top weaknesses
  const { data: weaknesses, error: wErr } = await sb
    .from("v_user_weakness_map" as any)
    .select("competency_id, competency_title, learning_field_title, score, mastery_level")
    .eq("user_id", userId)
    .eq("curriculum_id", curriculumId)
    .order("score", { ascending: true })
    .limit(limit);

  if (wErr) return json({ error: "weakness_query_failed", detail: wErr.message }, 500);

  const items = (weaknesses ?? []) as Array<{
    competency_id: string;
    competency_title: string;
    learning_field_title: string;
    score: number;
    mastery_level: string;
  }>;

  if (items.length === 0) {
    return json({
      ok: true,
      weaknesses: [],
      summary:
        "Stark — in deiner Diagnose ist noch keine klare Schwäche aufgetreten. Vertiefe jetzt mit dem Lernplan, um dein Niveau zu sichern.",
    });
  }

  // 2) Ask Lovable AI to summarize the 1–3 biggest weaknesses
  const prompt = `Du bist ein freundlicher Prüfungs-Coach für IHK-Azubis.
Erkläre dem Lernenden in maximal 4 Sätzen, knapp und motivierend, wo seine 1–3 größten Schwächen liegen UND welcher konkrete erste Lernschritt am sinnvollsten ist. Keine Listen, keine Aufzählungszeichen, keine Anrede.

Schwächen (sortiert nach Score, niedrig = schwach, 0..1):
${items
  .map(
    (w, i) =>
      `${i + 1}. ${w.competency_title} (Lernfeld: ${w.learning_field_title}, Score ${w.score.toFixed(2)}, ${w.mastery_level})`,
  )
  .join("\n")}`;

  let summary = "";
  try {
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Du bist ein präziser, motivierender Prüfungscoach." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 220,
      }),
    });
    if (aiRes.ok) {
      const j = await aiRes.json();
      summary = j?.choices?.[0]?.message?.content?.trim() ?? "";
    }
  } catch (_e) {
    /* fallback below */
  }

  if (!summary) {
    summary =
      `Deine größte Lücke liegt aktuell bei „${items[0].competency_title}" (Lernfeld ${items[0].learning_field_title}). Starte dort mit dem Lernplan — schon 10 Minuten dort verschieben deine Prüfungsreife spürbar.`;
  }

  return json({
    ok: true,
    weaknesses: items,
    summary,
  });
});
