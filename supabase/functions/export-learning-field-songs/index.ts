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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    const { curriculum_id, format } = body;

    if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

    const { data: songs, error } = await sb
      .from("learning_field_songs")
      .select(`
        id, title, style_prompt, lyrics, export_token, status, duration_target_seconds,
        learning_field_id, curriculum_id, song_key
      `)
      .eq("curriculum_id", curriculum_id)
      .in("status", ["draft", "exported"])
      .order("created_at");

    if (error) return json({ error: error.message }, 500);
    if (!songs?.length) return json({ error: "No songs found for export" }, 404);

    // Fetch LF names for enrichment
    const lfIds = [...new Set(songs.map((s) => s.learning_field_id))];
    const { data: lfs } = await sb
      .from("learning_fields")
      .select("id, code, title")
      .in("id", lfIds);

    const lfMap: Record<string, { code: string; title: string }> = {};
    for (const lf of lfs || []) lfMap[lf.id] = { code: lf.code, title: lf.title };

    // Mark as exported
    const songIds = songs.map((s) => s.id);
    await sb
      .from("learning_field_songs")
      .update({ status: "exported", updated_at: new Date().toISOString() })
      .in("id", songIds)
      .eq("status", "draft");

    if (format === "csv") {
      // CSV export
      const header = "export_token;lf_code;lf_title;song_title;style_prompt;lyrics";
      const rows = songs.map((s) => {
        const lf = lfMap[s.learning_field_id] || { code: "?", title: "?" };
        const esc = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
        return [s.export_token, lf.code, esc(lf.title), esc(s.title), esc(s.style_prompt), esc(s.lyrics)].join(";");
      });

      return new Response([header, ...rows].join("\n"), {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="songs-${curriculum_id.slice(0, 8)}.csv"`,
        },
      });
    }

    // JSON (default) — Suno-ready format
    const exportData = songs.map((s) => {
      const lf = lfMap[s.learning_field_id] || { code: "?", title: "?" };
      return {
        export_token: s.export_token,
        lf_code: lf.code,
        lf_title: lf.title,
        song_title: s.title,
        style_prompt: s.style_prompt,
        lyrics: s.lyrics,
        duration_target: s.duration_target_seconds,
      };
    });

    return json({ ok: true, count: exportData.length, songs: exportData });
  } catch (e) {
    console.error("[SongExport] Error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
