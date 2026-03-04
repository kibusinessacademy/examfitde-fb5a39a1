import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

const EXAMFIT_STYLE_STANDARD =
  "Educational pop, German lyrics, very clear articulation, medium tempo, natural voice, minimal autotune, simple melody, motivational, clean production, focus on intelligibility";

function safeStr(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function buildSunoCopyBlock(args: {
  lyrics: string;
  style: string;
  token: string;
  title?: string;
  lfCode?: string;
  lfTitle?: string;
}): string {
  const { lyrics, style, token, title, lfCode, lfTitle } = args;
  const metaLine = [
    lfCode ? `[${lfCode}]` : null,
    lfTitle || null,
    title ? `— ${title}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    metaLine || "ExamFit Bonus Song",
    "",
    "=== SONGTEXT ===",
    lyrics.trim(),
    "",
    "=== STYLE ===",
    (style || EXAMFIT_STYLE_STANDARD).trim(),
    "",
    "=== TOKEN ===",
    token.trim(),
    "",
  ].join("\n");
}

function escapeCsvValue(v: string): string {
  const s = v.replace(/"/g, '""');
  return `"${s}"`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const body = await req.json().catch(() => ({}));
    const curriculum_id = body?.curriculum_id as string | undefined;
    const format = (body?.format as string | undefined) || "json";

    if (!curriculum_id) return json({ error: "curriculum_id required" }, 400);

    const { data: songs, error } = await sb
      .from("learning_field_songs")
      .select(`
        id, title, style_prompt, lyrics, export_token, status, duration_target_seconds,
        learning_field_id, curriculum_id, song_key, audio_uploaded_at
      `)
      .eq("curriculum_id", curriculum_id)
      .in("status", ["draft", "exported", "audio_uploaded"])
      .order("created_at");

    if (error) return json({ error: error.message }, 500);
    if (!songs?.length) return json({ error: "No songs found for export" }, 404);

    const lfIds = [...new Set(songs.map((s: any) => s.learning_field_id))];
    const { data: lfs, error: lfErr } = await sb
      .from("learning_fields")
      .select("id, code, title")
      .in("id", lfIds);

    if (lfErr) return json({ error: lfErr.message }, 500);

    const lfMap: Record<string, { code?: string; title?: string }> = {};
    for (const lf of lfs || []) lfMap[lf.id] = { code: lf.code, title: lf.title };

    // Mark draft → exported
    const songIdsDraft = songs.filter((s: any) => s.status === "draft").map((s: any) => s.id);
    if (songIdsDraft.length) {
      await sb
        .from("learning_field_songs")
        .update({ status: "exported", updated_at: new Date().toISOString() })
        .in("id", songIdsDraft);
    }

    const exportRows = songs.map((s: any) => {
      const lf = lfMap[s.learning_field_id] || {};
      const style = safeStr(s.style_prompt) || EXAMFIT_STYLE_STANDARD;
      const lyrics = safeStr(s.lyrics);
      const token = safeStr(s.export_token);
      const needs_audio_upload = s.status !== "audio_uploaded";

      const suno_copy_block = buildSunoCopyBlock({
        lyrics,
        style,
        token,
        title: safeStr(s.title),
        lfCode: lf.code,
        lfTitle: lf.title,
      });

      return {
        export_token: token,
        lf_code: lf.code || "?",
        lf_title: lf.title || "?",
        song_title: safeStr(s.title),
        song_key: safeStr(s.song_key),
        status: safeStr(s.status),
        needs_audio_upload,
        audio_uploaded_at: s.audio_uploaded_at || null,
        duration_target: s.duration_target_seconds,
        style_prompt: style,
        lyrics,
        suno_copy_block,
      };
    });

    // Suno TXT format
    if (format === "suno_txt") {
      const blocks = exportRows.map((r) => r.suno_copy_block).join("\n\n---\n\n");
      return new Response(blocks, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="suno-pack-${curriculum_id.slice(0, 8)}.txt"`,
        },
      });
    }

    // CSV format
    if (format === "csv") {
      const header = [
        "export_token", "lf_code", "lf_title", "song_title", "song_key",
        "status", "needs_audio_upload", "style_prompt", "lyrics", "suno_copy_block",
      ].join(";");

      const rows = exportRows.map((r) =>
        [
          r.export_token, r.lf_code, escapeCsvValue(r.lf_title), escapeCsvValue(r.song_title),
          r.song_key, r.status, r.needs_audio_upload ? "true" : "false",
          escapeCsvValue(r.style_prompt), escapeCsvValue(r.lyrics), escapeCsvValue(r.suno_copy_block),
        ].join(";")
      );

      return new Response([header, ...rows].join("\n"), {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="songs-${curriculum_id.slice(0, 8)}.csv"`,
        },
      });
    }

    // JSON (default)
    return json({ ok: true, count: exportRows.length, songs: exportRows });
  } catch (e) {
    console.error("[SongExport] Error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
