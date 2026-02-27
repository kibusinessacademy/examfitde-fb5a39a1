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
    const formData = await req.formData();
    const songId = formData.get("song_id") as string | null;
    const exportToken = formData.get("export_token") as string | null;
    const audioFile = formData.get("audio") as File | null;

    if (!audioFile) return json({ error: "audio file required" }, 400);
    if (!songId && !exportToken) return json({ error: "song_id or export_token required" }, 400);

    // Validate file type
    const validTypes = ["audio/mpeg", "audio/wav", "audio/mp3", "audio/x-wav", "audio/ogg", "audio/webm"];
    if (!validTypes.includes(audioFile.type) && !audioFile.name.match(/\.(mp3|wav|ogg|webm)$/i)) {
      return json({ error: "Invalid audio format. Supported: MP3, WAV, OGG, WebM" }, 400);
    }

    // Find song record
    let query = sb.from("learning_field_songs").select("id, curriculum_id, learning_field_id, export_token");
    if (songId) {
      query = query.eq("id", songId);
    } else {
      query = query.eq("export_token", exportToken!);
    }
    const { data: song, error: songErr } = await query.maybeSingle();

    if (songErr || !song) return json({ error: "Song not found" }, 404);

    // Build storage path
    const ext = audioFile.name.split(".").pop()?.toLowerCase() || "mp3";
    const storagePath = `curricula/${song.curriculum_id}/learning_fields/${song.learning_field_id}/${song.export_token}.${ext}`;

    // Upload to storage
    const arrayBuffer = await audioFile.arrayBuffer();
    const { error: uploadErr } = await sb.storage
      .from("bonus-songs")
      .upload(storagePath, arrayBuffer, {
        contentType: audioFile.type || "audio/mpeg",
        upsert: true,
      });

    if (uploadErr) {
      console.error("[SongUpload] Storage error:", uploadErr);
      return json({ error: "Upload failed: " + uploadErr.message }, 500);
    }

    // Update song record
    await sb
      .from("learning_field_songs")
      .update({
        audio_storage_path: storagePath,
        audio_uploaded_at: new Date().toISOString(),
        status: "audio_uploaded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", song.id);

    return json({
      ok: true,
      song_id: song.id,
      export_token: song.export_token,
      storage_path: storagePath,
    });
  } catch (e) {
    console.error("[SongUpload] Error:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
