import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-job-runner-key",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

/**
 * generate-image — Async image generation via OpenAI gpt-image-1
 *
 * Generates an image from a text prompt, uploads it to Supabase Storage,
 * and updates the target DB row with the resulting URL.
 *
 * This is a SOFT-FAIL job: if it fails, the parent package/page is NOT blocked.
 *
 * Payload:
 *   prompt: string          — Image generation prompt
 *   target_table: string    — DB table to update (e.g. "certification_seo_pages", "courses")
 *   target_id: string       — UUID of the row to update
 *   target_column: string   — Column to set the URL on (e.g. "hero_image_url", "og_image_url")
 *   alt_text?: string       — Alt text for SEO
 *   size?: string           — "1024x1024" | "1536x1024" | "1024x1536" (default: "1536x1024")
 *   quality?: string        — "low" | "medium" | "high" (default: "medium")
 *   style?: string          — "natural" | "vivid" (default: "natural")
 *   bucket?: string         — Storage bucket (default: "course-media")
 *   folder?: string         — Storage folder (default: "generated-images")
 *   package_id?: string     — For cost tracking
 *   certification_id?: string
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not configured" }, 500);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  try {
    const body = await req.json();
    const {
      prompt,
      target_table,
      target_id,
      target_column,
      alt_text,
      size = "1536x1024",
      quality = "medium",
      style = "natural",
      bucket = "course-media",
      folder = "generated-images",
      package_id,
      certification_id,
      _job_id,
    } = body;

    // Validate required fields
    if (!prompt || !target_table || !target_id || !target_column) {
      return json({ error: "Missing required fields: prompt, target_table, target_id, target_column" }, 400);
    }

    // Allowlist of tables that can receive image URLs
    const ALLOWED_TABLES = [
      "certification_seo_pages",
      "seo_documents",
      "courses",
      "course_packages",
      "lessons",
      "blog_articles",
    ];
    if (!ALLOWED_TABLES.includes(target_table)) {
      return json({ error: `Table "${target_table}" not in allowlist` }, 400);
    }

    console.log(`[generate-image] Generating for ${target_table}.${target_id} → ${target_column}`);
    const startMs = Date.now();

    // ── 1. Call OpenAI Images API ──
    const imageResp = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        n: 1,
        size,
        quality,
        style,
      }),
    });

    if (!imageResp.ok) {
      const errText = await imageResp.text().catch(() => "");
      const latencyMs = Date.now() - startMs;

      // Log cost event even on failure
      await logCost(sb, {
        job_type: "generate_image",
        provider: "openai",
        model: "gpt-image-1",
        tokens_in: 0,
        tokens_out: 0,
        cost_usd: 0,
        package_id,
        certification_id,
        status: "fail",
        error_message: errText.slice(0, 500),
        latency_ms: latencyMs,
      });

      if (imageResp.status === 429) {
        return json({ error: "Rate limit exceeded", retry: true }, 429);
      }
      return json({ error: `OpenAI Images error ${imageResp.status}: ${errText.slice(0, 200)}` }, 502);
    }

    const imageData = await imageResp.json();
    const b64 = imageData.data?.[0]?.b64_json;
    const imageUrl = imageData.data?.[0]?.url;

    if (!b64 && !imageUrl) {
      return json({ error: "No image data returned from OpenAI" }, 502);
    }

    // ── 2. Upload to Supabase Storage ──
    const fileName = `${folder}/${target_id}_${Date.now()}.png`;
    let storagePath: string;

    if (b64) {
      // Base64 → binary
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

      const { error: uploadErr } = await sb.storage
        .from(bucket)
        .upload(fileName, bytes.buffer, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadErr) {
        return json({ error: `Storage upload failed: ${uploadErr.message}` }, 500);
      }
      storagePath = fileName;
    } else {
      // URL → download → upload
      const imgResp = await fetch(imageUrl);
      const imgBlob = await imgResp.blob();
      const imgBuffer = await imgBlob.arrayBuffer();

      const { error: uploadErr } = await sb.storage
        .from(bucket)
        .upload(fileName, imgBuffer, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadErr) {
        return json({ error: `Storage upload failed: ${uploadErr.message}` }, 500);
      }
      storagePath = fileName;
    }

    // ── 3. Get public URL ──
    const { data: publicUrlData } = sb.storage.from(bucket).getPublicUrl(storagePath);
    const publicUrl = publicUrlData?.publicUrl;

    if (!publicUrl) {
      return json({ error: "Failed to get public URL" }, 500);
    }

    // ── 4. Update target row ──
    const updateData: Record<string, unknown> = {
      [target_column]: publicUrl,
      updated_at: new Date().toISOString(),
    };

    // If alt_text column exists, set it too
    if (alt_text) {
      const altColumn = target_column.replace(/_url$/, "_alt") || "image_alt";
      updateData[altColumn] = alt_text;
    }

    const { error: updateErr } = await sb
      .from(target_table)
      .update(updateData)
      .eq("id", target_id);

    if (updateErr) {
      console.warn(`[generate-image] DB update failed: ${updateErr.message} (image still uploaded)`);
    }

    const latencyMs = Date.now() - startMs;

    // ── 5. Log cost ──
    // gpt-image-1 pricing: ~$0.04 per image (medium quality, 1024+)
    const estimatedCost = quality === "high" ? 0.08 : quality === "low" ? 0.02 : 0.04;
    await logCost(sb, {
      job_type: "generate_image",
      provider: "openai",
      model: "gpt-image-1",
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: estimatedCost,
      package_id,
      certification_id,
      status: "success",
      latency_ms: latencyMs,
    });

    console.log(`[generate-image] ✅ Done in ${latencyMs}ms → ${publicUrl.slice(0, 80)}...`);

    return json({
      ok: true,
      image_url: publicUrl,
      storage_path: storagePath,
      target: `${target_table}.${target_id}.${target_column}`,
      latency_ms: latencyMs,
      cost_usd: estimatedCost,
    });
  } catch (e) {
    console.error("[generate-image] Error:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

// ── Cost logging helper ──
async function logCost(
  sb: ReturnType<typeof createClient>,
  opts: {
    job_type: string;
    provider: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    package_id?: string;
    certification_id?: string;
    status: string;
    error_message?: string;
    latency_ms?: number;
  }
) {
  try {
    await sb.from("llm_cost_events").insert({
      job_type: opts.job_type,
      provider: opts.provider,
      model: opts.model,
      tokens_in: opts.tokens_in,
      tokens_out: opts.tokens_out,
      cost_usd: opts.cost_usd,
      package_id: opts.package_id || null,
      certification_id: opts.certification_id || null,
      meta: {
        status: opts.status,
        ...(opts.error_message ? { error: opts.error_message } : {}),
        ...(opts.latency_ms ? { latency_ms: opts.latency_ms } : {}),
      },
    });
  } catch { /* non-blocking */ }
}
