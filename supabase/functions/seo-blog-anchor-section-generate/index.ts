// seo-blog-anchor-section-generate — backfills internal_links_json for a blog_article
// with 4-6 contextual sibling links from the same source_curriculum_id (or source_package_id).
// Pure SQL pick — no AI call needed. Self-finalizes the job_queue entry.
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

const TARGET_MIN = 4;
const TARGET_MAX = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);
  const startedAt = Date.now();


  let body: { job_id?: string } = {};
  try { body = await req.json(); } catch { /* tolerate */ }
  const jobId = body.job_id;
  if (!jobId) return json(400, { error: "missing_job_id" });

  const { data: jobRow, error: jobErr } = await supabase
    .from("job_queue").select("id, payload").eq("id", jobId).maybeSingle();
  if (jobErr || !jobRow) return json(404, { error: "job_not_found", detail: jobErr?.message });

  const blogId = (jobRow.payload as { blog_article_id?: string } | null)?.blog_article_id;
  if (!blogId) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: "missing_blog_article_id_in_payload",
    }).eq("id", jobRow.id);
    return json(400, { error: "missing_blog_article_id" });
  }

  const { data: blog, error: blogErr } = await supabase
    .from("blog_articles")
    .select("id, slug, title, source_curriculum_id, source_package_id, internal_links_json")
    .eq("id", blogId)
    .maybeSingle();
  if (blogErr || !blog) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: `blog_not_found:${blogErr?.message ?? "null"}`,
    }).eq("id", jobRow.id);
    return json(404, { error: "blog_not_found" });
  }

  // Idempotent: if already enough links, complete as noop
  const existing = Array.isArray(blog.internal_links_json) ? blog.internal_links_json : [];
  if (existing.length >= TARGET_MIN) {
    await supabase.from("job_queue").update({
      status: "completed",
      result: { skipped: "links_already_present", count: existing.length },
      completed_at: new Date().toISOString(),
    }).eq("id", jobRow.id);
    await supabase.rpc("fn_emit_audit", {
      _action_type: "seo_blog_anchor_section_generated",
      _target_type: "blog_article",
      _target_id: blogId,
      _result_status: "noop",
      _payload: {
        blog_article_id: blogId,
        blog_slug: blog.slug,
        links_added: 0,
        curriculum_id: blog.source_curriculum_id,
        duration_ms: Date.now() - startedAt,
        reason: "already_present",
        existing_count: existing.length,
      },
      _trigger_source: "seo-blog-anchor-section-generate",
    });

    return json(200, { ok: true, skipped: "already_present", count: existing.length });
  }

  // Candidate pick: same curriculum first, fall back to same package
  let candidates: Array<{ id: string; slug: string; title: string }> = [];
  if (blog.source_curriculum_id) {
    const { data } = await supabase
      .from("blog_articles")
      .select("id, slug, title")
      .eq("status", "published")
      .eq("source_curriculum_id", blog.source_curriculum_id)
      .neq("id", blog.id)
      .order("published_at", { ascending: false })
      .limit(TARGET_MAX * 2);
    candidates = data ?? [];
  }
  if (candidates.length < TARGET_MIN && blog.source_package_id) {
    const { data } = await supabase
      .from("blog_articles")
      .select("id, slug, title")
      .eq("status", "published")
      .eq("source_package_id", blog.source_package_id)
      .neq("id", blog.id)
      .order("published_at", { ascending: false })
      .limit(TARGET_MAX * 2);
    const seen = new Set(candidates.map((c) => c.id));
    for (const row of data ?? []) {
      if (!seen.has(row.id)) candidates.push(row);
    }
  }

  if (candidates.length < TARGET_MIN) {
    await supabase.from("job_queue").update({
      status: "failed",
      last_error: `insufficient_candidates:${candidates.length}<${TARGET_MIN}`,
    }).eq("id", jobRow.id);
    await supabase.rpc("fn_emit_audit", {
      _action_type: "seo_blog_anchor_section_generated",
      _target_type: "blog_article",
      _target_id: blogId,
      _result_status: "failed",
      _payload: {
        blog_article_id: blogId,
        blog_slug: blog.slug,
        links_added: 0,
        curriculum_id: blog.source_curriculum_id,
        duration_ms: Date.now() - startedAt,
        reason: "insufficient_candidates",
        candidates_found: candidates.length,
        threshold: TARGET_MIN,
      },
      _trigger_source: "seo-blog-anchor-section-generate",
    });

    return json(422, { error: "insufficient_candidates", count: candidates.length });
  }

  const picked = candidates.slice(0, TARGET_MAX).map((c) => ({
    slug: c.slug,
    title: c.title,
    url: `/blog/${c.slug}`,
    reason: "sibling_in_cluster",
  }));

  const { error: updErr } = await supabase
    .from("blog_articles")
    .update({ internal_links_json: picked })
    .eq("id", blog.id);
  if (updErr) {
    await supabase.from("job_queue").update({
      status: "failed", last_error: `blog_update_failed:${updErr.message}`,
    }).eq("id", jobRow.id);
    return json(500, { error: "blog_update_failed", detail: updErr.message });
  }

  await supabase.from("job_queue").update({
    status: "completed",
    result: { blog_article_id: blog.id, link_count: picked.length },
    completed_at: new Date().toISOString(),
  }).eq("id", jobRow.id);

  await supabase.rpc("fn_emit_audit", {
    _action_type: "seo_blog_anchor_section_generated",
    _target_type: "blog_article",
    _target_id: blog.id,
    _result_status: "success",
    _payload: { blog_slug: blog.slug, link_count: picked.length, sources: picked.map((p) => p.slug) },
    _trigger_source: "seo-blog-anchor-section-generate",
  });

  return json(200, { ok: true, blog_article_id: blog.id, link_count: picked.length });
});
