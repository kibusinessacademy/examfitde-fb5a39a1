// seo-blog-hero-generate — generates a hero image for a blog_article via Lovable AI Gateway
// (google/gemini-2.5-flash-image), uploads to public-assets/blog-heroes/, and updates
// hero_image_url + hero_image_alt. Self-finalizes the job_queue entry.
//
// Payload: { job_id: uuid }   (job_queue.payload.blog_article_id resolves the target)

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface Job {
  id: string;
  payload: { blog_article_id?: string; blog_slug?: string; snapshot_id?: string } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const aiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const startedAt = Date.now();


  let body: { job_id?: string } = {};
  try { body = await req.json(); } catch { /* tolerate */ }
  const jobId = body.job_id;
  if (!jobId) return json(400, { error: "missing_job_id" });

  // Load job
  const { data: jobRow, error: jobErr } = await supabase
    .from("job_queue").select("id, payload").eq("id", jobId).maybeSingle();
  if (jobErr || !jobRow) return json(404, { error: "job_not_found", detail: jobErr?.message });
  const job = jobRow as Job;

  const blogId = job.payload?.blog_article_id;
  if (!blogId) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: "missing_blog_article_id_in_payload",
    }).eq("id", job.id);
    return json(400, { error: "missing_blog_article_id" });
  }

  // Load blog article context for alt text & prompt
  const { data: blog, error: blogErr } = await supabase
    .from("blog_articles")
    .select("id, slug, title, target_keyword, meta_description, hero_image_url")
    .eq("id", blogId)
    .maybeSingle();
  if (blogErr || !blog) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: `blog_not_found:${blogErr?.message ?? "null"}`,
    }).eq("id", job.id);
    return json(404, { error: "blog_not_found" });
  }

  // Idempotent: if hero already exists, mark completed (cornerstone targets may be stale).
  if (blog.hero_image_url) {
    await supabase.from("job_queue").update({
      status: "completed",
      result: { skipped: "hero_already_set", url: blog.hero_image_url },
      completed_at: new Date().toISOString(),
    }).eq("id", job.id);
    await supabase.rpc("fn_emit_audit", {
      _action_type: "seo_blog_hero_generated",
      _target_type: "blog_article",
      _target_id: blogId,
      _result_status: "noop",
      _payload: {
        blog_article_id: blogId,
        blog_slug: blog.slug,
        hero_image_url: blog.hero_image_url,
        model: "google/gemini-2.5-flash-image",
        duration_ms: Date.now() - startedAt,
        reason: "already_set",
      },
      _trigger_source: "seo-blog-hero-generate",
    });

    return json(200, { ok: true, skipped: "already_set" });
  }

  const prompt = [
    "Editorial hero image for a German exam-prep blog article.",
    `Topic: ${blog.title}.`,
    blog.target_keyword ? `Keyword focus: ${blog.target_keyword}.` : "",
    "Modern, clean, professional, soft natural light, subtle teal/petrol accents,",
    "no text overlays, no watermarks, 16:9 composition, photographic realism with editorial polish.",
  ].filter(Boolean).join(" ");

  // Call Lovable AI Gateway — image model
  const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${aiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash-image",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!aiRes.ok) {
    const detail = (await aiRes.text()).slice(0, 400);
    await supabase.from("job_queue").update({
      status: "failed", last_error: `ai_image_failed:${aiRes.status}:${detail}`,
    }).eq("id", job.id);
    return json(502, { error: "ai_image_failed", status: aiRes.status, detail });
  }

  const aiJson = await aiRes.json();
  const imageUrl: string | undefined = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url
    ?? aiJson?.choices?.[0]?.message?.images?.[0]?.url;
  if (!imageUrl || !imageUrl.startsWith("data:")) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: "ai_image_no_data_url",
    }).eq("id", job.id);
    return json(502, { error: "ai_image_no_data_url" });
  }

  // Decode data URL → Uint8Array
  const [meta, b64] = imageUrl.split(",");
  const mime = (meta.match(/data:([^;]+)/)?.[1]) ?? "image/png";
  const ext = mime.includes("jpeg") ? "jpg" : "png";
  const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

  // Upload to public-assets/blog-heroes/<id>.<ext>
  const objectPath = `blog-heroes/${blog.id}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("public-assets")
    .upload(objectPath, bin, { contentType: mime, upsert: true });
  if (upErr) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: `upload_failed:${upErr.message}`,
    }).eq("id", job.id);
    return json(500, { error: "upload_failed", detail: upErr.message });
  }

  const { data: pub } = supabase.storage.from("public-assets").getPublicUrl(objectPath);
  const publicUrl = pub?.publicUrl;
  const alt = `${blog.title} – Titelbild`;

  const { error: updErr } = await supabase
    .from("blog_articles")
    .update({ hero_image_url: publicUrl, hero_image_alt: alt })
    .eq("id", blog.id);
  if (updErr) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: `blog_update_failed:${updErr.message}`,
    }).eq("id", job.id);
    return json(500, { error: "blog_update_failed", detail: updErr.message });
  }

  await supabase.from("job_queue").update({
    status: "completed",
    result: { blog_article_id: blog.id, hero_image_url: publicUrl },
    completed_at: new Date().toISOString(),
  }).eq("id", job.id);

  await supabase.rpc("fn_emit_audit", {
    _action_type: "seo_blog_hero_generated",
    _target_type: "blog_article",
    _target_id: blog.id,
    _result_status: "success",
    _payload: {
      blog_article_id: blog.id,
      blog_slug: blog.slug,
      hero_image_url: publicUrl,
      model: "google/gemini-2.5-flash-image",
      duration_ms: Date.now() - startedAt,
      mime,
      bytes: bin.byteLength,
    },
    _trigger_source: "seo-blog-hero-generate",
  });

  return json(200, { ok: true, blog_article_id: blog.id, hero_image_url: publicUrl });
});

