// supabase/functions/post-publish-growth-worker/index.ts
//
// Post-Publish Growth Worker — Welle 2 / Loop 2
// Drains the 6 post-publish growth job_types from job_queue:
//   - seo_indexnow_submit
//   - package_post_publish_blog
//   - package_distribution_plan
//   - package_campaign_assets_generate
//   - package_email_sequence_enroll
//   - package_og_image_generate
//
// Idempotent: idempotency_key already enforced at enqueue time.
// Per job: marks processing → runs handler → completed | failed | noop.
// Writes auto_heal_log on every outcome (incl. noop). NEVER silent-fails.
//
// Reuses existing tables/functions:
//   - seo_submission_logs (drained by seo-submit-indexnow cron tier)
//   - blog_articles
//   - campaign_launch_plans + campaign_assets
//   - distribution_targets
//   - email_delivery_queue

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SITE_URL = "https://examfit.de";
const MAX_JOBS_PER_RUN = 20;
const LEASE_MINUTES = 5;

const HANDLED_JOB_TYPES = [
  "seo_indexnow_submit",
  "package_post_publish_blog",
  "package_distribution_plan",
  "package_campaign_assets_generate",
  "package_email_sequence_enroll",
  "package_og_image_generate",
  // Post-Publish Commerce & Growth Orchestrator v1
  "commerce_product_visibility_check",
  "commerce_price_activation_check",
  "commerce_sellability_gate_check",
  "commerce_audit_snapshot",
  "package_seo_backlog_expand",
  "package_license_template_prepare",
  "package_post_publish_audit_snapshot",
];

// Generic RPC-backed handler factory: calls a SECURITY DEFINER fn(p_package_id uuid)
// and maps result jsonb {status,reason,details} → Outcome.
function rpcHandler(fnName: string, args: (pkg: any) => Record<string, unknown> = (p) => ({ p_package_id: p.id })) {
  return async (sb: ReturnType<typeof createClient>, pkg: any): Promise<Outcome> => {
    const { data, error } = await sb.rpc(fnName, args(pkg) as any);
    if (error) return { status: "failed", reason: `rpc_${fnName}: ${error.message}` };
    const r = (data ?? {}) as Record<string, unknown>;
    const status = (r.status as string) === "completed" || (r.status as string) === "noop" || (r.status as string) === "failed"
      ? (r.status as Outcome["status"])
      : "completed";
    return { status, reason: (r.reason as string) ?? undefined, details: (r.details as Record<string, unknown>) ?? r };
  };
}

type Outcome = {
  status: "completed" | "failed" | "noop";
  reason?: string;
  details?: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

function buildPackageUrl(pkg: { package_key: string | null; title: string }): string {
  // Conservative: prefer package_key (stable slug), else fall back to homepage.
  if (pkg.package_key) {
    // package_key is like "weintechnologe_in__exam_first" — strip __exam_first suffix for canonical SEO slug
    const base = pkg.package_key.replace(/__exam_first$/, "").replace(/_/g, "-");
    return `${SITE_URL}/pruefungstraining/${base}`;
  }
  return SITE_URL;
}

// ── Handler 1: seo_indexnow_submit ────────────────────────────────
async function handleSeoIndexNowSubmit(
  sb: ReturnType<typeof createClient>,
  pkg: any,
): Promise<Outcome> {
  const canonicalUrl = buildPackageUrl(pkg);
  const urls = [
    canonicalUrl,
    `${SITE_URL}/`,
    `${SITE_URL}/sitemap.xml`,
  ];

  // Insert pending submission rows; cron tier seo-indexnow drains them.
  const rows = urls.map((u) => ({
    provider: "indexnow",
    source_type: "course_package",
    source_id: pkg.id,
    url: u,
    canonical_url: u,
    action: "submit",
    status: "pending",
    priority: 50,
    request_payload: { triggered_by: "post_publish_growth", package_id: pkg.id },
  }));

  // De-dupe: skip URLs already pending/success in last 24h to avoid spam
  const { data: existing } = await sb
    .from("seo_submission_logs")
    .select("url,status")
    .in("url", urls)
    .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  const existingUrls = new Set(
    (existing ?? [])
      .filter((r: any) => r.status === "pending" || r.status === "success")
      .map((r: any) => r.url),
  );
  const fresh = rows.filter((r) => !existingUrls.has(r.url));
  if (fresh.length === 0) {
    return { status: "noop", reason: "all_urls_already_submitted_24h", details: { urls } };
  }

  const { error } = await sb.from("seo_submission_logs").insert(fresh);
  if (error) return { status: "failed", reason: error.message };
  return { status: "completed", details: { enqueued_urls: fresh.length, urls: fresh.map((r) => r.url) } };
}

// ── Handler 2: package_post_publish_blog ──────────────────────────
async function handlePostPublishBlog(
  sb: ReturnType<typeof createClient>,
  pkg: any,
): Promise<Outcome> {
  // Skip if already a blog exists for this package
  const { data: existing } = await sb
    .from("blog_articles")
    .select("id")
    .eq("source_package_id", pkg.id)
    .limit(1)
    .maybeSingle();
  if (existing) return { status: "noop", reason: "blog_already_exists", details: { id: existing.id } };

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { status: "noop", reason: "noop_missing_secret", details: { secret: "LOVABLE_API_KEY" } };
  }

  const titleBase = pkg.title || "Prüfungstraining";
  const prompt = `Schreibe einen kurzen, hilfreichen SEO-Blogartikel (ca. 600 Wörter, deutsch) zum Prüfungstraining für "${titleBase}". Zielgruppe: Auszubildende vor der IHK-Abschlussprüfung. Struktur: H1, 3-4 H2-Abschnitte, FAQ am Ende. Praxisnah, ohne Fluff. Liefere reines Markdown (kein Codeblock).`;

  let contentMd = "";
  try {
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Du bist ein erfahrener Bildungs-SEO-Redakteur." },
          { role: "user", content: prompt },
        ],
      }),
    });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      if (aiResp.status === 429 || aiResp.status === 402) {
        return { status: "noop", reason: `ai_gateway_${aiResp.status === 429 ? "rate_limited" : "credits_exhausted"}`, details: { body: t.slice(0, 300) } };
      }
      return { status: "failed", reason: `ai_gateway_${aiResp.status}`, details: { body: t.slice(0, 300) } };
    }
    const j = await aiResp.json();
    contentMd = j?.choices?.[0]?.message?.content?.trim() ?? "";
  } catch (e) {
    return { status: "failed", reason: "ai_gateway_exception", details: { error: (e as Error).message } };
  }

  if (!contentMd || contentMd.length < 200) {
    return { status: "failed", reason: "ai_returned_empty_content" };
  }

  const slug = `${(pkg.package_key ?? pkg.id).toString().replace(/_/g, "-")}-pruefungstraining-guide`;
  const wordCount = contentMd.split(/\s+/).length;

  const { data: inserted, error } = await sb
    .from("blog_articles")
    .insert({
      slug: slug.slice(0, 200),
      title: `${titleBase}: Prüfungstraining-Guide`,
      meta_description: `Praxisnaher Prüfungs-Guide für ${titleBase}. Tipps, Strategie und Übungsfragen.`,
      content_md: contentMd,
      source_curriculum_id: pkg.curriculum_id,
      source_package_id: pkg.id,
      status: "published",
      generated_by_model: "google/gemini-2.5-flash",
      word_count: wordCount,
      reading_time_min: Math.max(1, Math.round(wordCount / 200)),
      keywords: [titleBase, "Prüfungstraining", "IHK"],
    })
    .select("id, slug")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { status: "noop", reason: "blog_slug_collision", details: { slug } };
    }
    return { status: "failed", reason: error.message };
  }
  return { status: "completed", details: { blog_id: inserted.id, slug: inserted.slug, word_count: wordCount } };
}

// ── Handler 3: package_distribution_plan ──────────────────────────
async function handleDistributionPlan(
  sb: ReturnType<typeof createClient>,
  pkg: any,
): Promise<Outcome> {
  // Ensure launch plan + a seed asset exist; then create distribution_targets.
  const { data: existingPlan } = await sb
    .from("campaign_launch_plans")
    .select("id")
    .eq("curriculum_id", pkg.curriculum_id)
    .is("qualification_catalog_id", null)
    .maybeSingle();

  let planId = existingPlan?.id as string | undefined;
  if (!planId) {
    const { data: newPlan, error: planErr } = await sb
      .from("campaign_launch_plans")
      .insert({
        curriculum_id: pkg.curriculum_id,
        primary_channel: "b2c",
        offer_type: "standard_course",
        price_tier: "mid",
        seo_slug: pkg.package_key?.replace(/_/g, "-") ?? null,
        target_persona: pkg.persona_profile,
        meta: { source: "post_publish_growth", package_id: pkg.id },
      })
      .select("id")
      .single();
    if (planErr) return { status: "failed", reason: `plan_insert_${planErr.code}: ${planErr.message}` };
    planId = newPlan.id;
  }

  // Find or create a seed asset for distribution
  let { data: asset } = await sb
    .from("campaign_assets")
    .select("id")
    .eq("launch_plan_id", planId)
    .eq("asset_type", "landing_page")
    .maybeSingle();
  if (!asset) {
    const { data: newAsset, error: assetErr } = await sb
      .from("campaign_assets")
      .insert({
        launch_plan_id: planId,
        curriculum_id: pkg.curriculum_id,
        asset_type: "landing_page",
        asset_key: `landing_${pkg.id}`,
        channel: "web",
        title: pkg.title,
        slug: pkg.package_key?.replace(/_/g, "-") ?? null,
        publication_status: "published",
        publication_target: buildPackageUrl(pkg),
        performance_meta: { source: "post_publish_growth", package_id: pkg.id },
      })
      .select("id")
      .single();
    if (assetErr) return { status: "failed", reason: `asset_insert_${assetErr.code}: ${assetErr.message}` };
    asset = newAsset;
  }

  // Plan distribution across core channels
  const channels = ["seo_blog", "social_queue", "newsletter", "indexnow"];
  let inserted = 0;
  for (const ch of channels) {
    const { error: tErr } = await sb.from("distribution_targets").insert({
      asset_id: asset.id,
      launch_plan_id: planId,
      curriculum_id: pkg.curriculum_id,
      channel_key: ch,
      target_type: "package_url",
      target_identifier: buildPackageUrl(pkg),
      distribution_status: "planned",
      payload: { package_id: pkg.id, source: "post_publish_growth" },
    });
    if (!tErr) inserted++;
    else if (tErr.code !== "23505") {
      // Hard error other than uniq violation
      return { status: "failed", reason: `target_insert_${tErr.code}: ${tErr.message}` };
    }
  }

  if (inserted === 0) {
    return { status: "noop", reason: "all_targets_already_planned", details: { plan_id: planId, asset_id: asset.id } };
  }
  return { status: "completed", details: { plan_id: planId, asset_id: asset.id, targets_added: inserted } };
}

// ── Handler 4: package_campaign_assets_generate ───────────────────
async function handleCampaignAssets(
  sb: ReturnType<typeof createClient>,
  pkg: any,
): Promise<Outcome> {
  const { data: plan } = await sb
    .from("campaign_launch_plans")
    .select("id")
    .eq("curriculum_id", pkg.curriculum_id)
    .is("qualification_catalog_id", null)
    .maybeSingle();

  let planId = plan?.id as string | undefined;
  if (!planId) {
    const { data: newPlan, error } = await sb
      .from("campaign_launch_plans")
      .insert({
        curriculum_id: pkg.curriculum_id,
        primary_channel: "b2c",
        offer_type: "standard_course",
        price_tier: "mid",
        target_persona: pkg.persona_profile,
        meta: { source: "post_publish_growth", package_id: pkg.id },
      })
      .select("id")
      .single();
    if (error) return { status: "failed", reason: `plan_insert_${error.code}: ${error.message}` };
    planId = newPlan.id;
  }

  // Seed three starter assets if missing
  const seeds = [
    { asset_type: "social_post", asset_key: `social_${pkg.id}`, channel: "linkedin",
      title: `Neu: Prüfungstraining ${pkg.title}`,
      content_markdown: `Frisch live: ein vollständiges Prüfungstraining für **${pkg.title}**. Vollständige Lernpfade, Prüfungssimulator, KI-Tutor. ${buildPackageUrl(pkg)}` },
    { asset_type: "email", asset_key: `email_${pkg.id}`, channel: "newsletter",
      title: `${pkg.title} — Prüfungstraining ist da`,
      content_markdown: `# Bereit für deine Prüfung?\n\nWir haben das vollständige Prüfungstraining für **${pkg.title}** veröffentlicht.\n\n[Jetzt starten](${buildPackageUrl(pkg)})` },
    { asset_type: "meta_snippet", asset_key: `meta_${pkg.id}`, channel: "seo",
      title: `${pkg.title} — Prüfungstraining mit KI`,
      content_markdown: `Lerne effizient für die Abschlussprüfung ${pkg.title}: vollständige Lernpfade, simulierte Prüfungen, KI-Tutor.` },
  ];

  let added = 0;
  for (const seed of seeds) {
    const { data: existing } = await sb
      .from("campaign_assets")
      .select("id")
      .eq("launch_plan_id", planId)
      .eq("asset_key", seed.asset_key)
      .maybeSingle();
    if (existing) continue;
    const { error } = await sb.from("campaign_assets").insert({
      launch_plan_id: planId,
      curriculum_id: pkg.curriculum_id,
      ...seed,
      publication_status: "draft",
      performance_meta: { source: "post_publish_growth", package_id: pkg.id },
    });
    if (!error) added++;
    else if (error.code !== "23505") {
      return { status: "failed", reason: `asset_insert_${error.code}: ${error.message}` };
    }
  }

  if (added === 0) return { status: "noop", reason: "all_assets_already_present", details: { plan_id: planId } };
  return { status: "completed", details: { plan_id: planId, assets_added: added } };
}

// ── Handler 5: package_email_sequence_enroll ──────────────────────
async function handleEmailSequenceEnroll(
  sb: ReturnType<typeof createClient>,
  pkg: any,
): Promise<Outcome> {
  // Find leads tied to this curriculum via leads table; enroll each into post_publish_announce.
  const { data: leads, error: leadsErr } = await sb
    .from("leads")
    .select("id, email, curriculum_id")
    .eq("curriculum_id", pkg.curriculum_id)
    .not("email", "is", null)
    .limit(500);
  if (leadsErr) return { status: "failed", reason: `leads_query_${leadsErr.code}: ${leadsErr.message}` };

  if (!leads || leads.length === 0) {
    return { status: "noop", reason: "no_leads_for_curriculum", details: { curriculum_id: pkg.curriculum_id } };
  }

  let enrolled = 0;
  for (const lead of leads) {
    const idempKey = `post_publish_announce:${pkg.id}:${lead.id}`;
    const { error } = await sb.from("email_delivery_queue").insert({
      lead_id: lead.id,
      sequence_type: "post_publish_announce",
      step_number: 1,
      scheduled_for: new Date().toISOString(),
      recipient_email: lead.email,
      audience: pkg.persona_profile,
      personalization: {
        package_id: pkg.id,
        package_title: pkg.title,
        package_url: buildPackageUrl(pkg),
      },
      idempotency_key: idempKey,
    });
    if (!error) enrolled++;
    else if (error.code !== "23505") {
      // hard error
      return { status: "failed", reason: `enroll_insert_${error.code}: ${error.message}`, details: { enrolled_so_far: enrolled } };
    }
  }

  if (enrolled === 0) {
    return { status: "noop", reason: "all_leads_already_enrolled", details: { lead_count: leads.length } };
  }
  return { status: "completed", details: { enrolled, total_leads: leads.length } };
}

// ── Handler 6: package_og_image_generate ──────────────────────────
async function handleOgImageGenerate(
  sb: ReturnType<typeof createClient>,
  pkg: any,
): Promise<Outcome> {
  // Idempotent: check feature_flags.og_image_url
  const { data: pkgRow } = await sb
    .from("course_packages")
    .select("feature_flags")
    .eq("id", pkg.id)
    .single();
  const flags = (pkgRow?.feature_flags ?? {}) as Record<string, unknown>;
  if (typeof flags.og_image_url === "string" && (flags.og_image_url as string).length > 0) {
    return { status: "noop", reason: "og_image_already_set", details: { url: flags.og_image_url } };
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    return { status: "noop", reason: "noop_missing_secret", details: { secret: "LOVABLE_API_KEY" } };
  }

  // Generate via Lovable AI image model
  let imageDataUrl = "";
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        modalities: ["image", "text"],
        messages: [{
          role: "user",
          content: `Erstelle ein modernes, klares Open-Graph-Bild (1200x630, professionell, IHK-Prüfungstraining) für: "${pkg.title}". Tonalität: vertrauenswürdig, motivierend, deutsch. Sehr wenig Text im Bild.`,
        }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 429 || r.status === 402) {
        return { status: "noop", reason: `ai_image_${r.status === 429 ? "rate_limited" : "credits_exhausted"}`, details: { body: t.slice(0, 300) } };
      }
      return { status: "failed", reason: `ai_image_${r.status}`, details: { body: t.slice(0, 300) } };
    }
    const j = await r.json();
    imageDataUrl = j?.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? "";
  } catch (e) {
    return { status: "failed", reason: "ai_image_exception", details: { error: (e as Error).message } };
  }

  if (!imageDataUrl.startsWith("data:image/")) {
    return { status: "failed", reason: "ai_image_no_data_url" };
  }

  // Upload to cms-media (public bucket)
  const m = imageDataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) return { status: "failed", reason: "ai_image_unparseable_data_url" };
  const mime = m[1];
  const ext = mime.split("/")[1] ?? "png";
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const path = `og-images/${pkg.id}.${ext}`;
  const { error: upErr } = await sb.storage.from("cms-media").upload(path, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (upErr) return { status: "failed", reason: `storage_upload: ${upErr.message}` };

  const { data: pub } = sb.storage.from("cms-media").getPublicUrl(path);
  const ogUrl = pub?.publicUrl ?? "";
  if (!ogUrl) return { status: "failed", reason: "no_public_url" };

  const { error: updErr } = await sb
    .from("course_packages")
    .update({ feature_flags: { ...flags, og_image_url: ogUrl, og_image_set_at: new Date().toISOString() } })
    .eq("id", pkg.id);
  if (updErr) return { status: "failed", reason: `feature_flags_update: ${updErr.message}` };

  return { status: "completed", details: { og_image_url: ogUrl } };
}

const HANDLERS: Record<string, (sb: any, pkg: any) => Promise<Outcome>> = {
  seo_indexnow_submit: handleSeoIndexNowSubmit,
  package_post_publish_blog: handlePostPublishBlog,
  package_distribution_plan: handleDistributionPlan,
  package_campaign_assets_generate: handleCampaignAssets,
  package_email_sequence_enroll: handleEmailSequenceEnroll,
  package_og_image_generate: handleOgImageGenerate,
  // Post-Publish Commerce & Growth Orchestrator v1 (RPC-backed)
  commerce_product_visibility_check: rpcHandler("fn_commerce_product_visibility_check"),
  commerce_price_activation_check: rpcHandler("fn_commerce_price_activation_check"),
  commerce_sellability_gate_check: rpcHandler("fn_commerce_sellability_gate_check"),
  commerce_audit_snapshot: rpcHandler("fn_commerce_audit_snapshot"),
  package_post_publish_audit_snapshot: rpcHandler("fn_commerce_audit_snapshot"),
  package_seo_backlog_expand: rpcHandler("fn_seo_backlog_expand_for_package"),
  // Signal-only placeholder until license_template SSOT exists.
  package_license_template_prepare: async (_sb, _pkg) => ({
    status: "noop",
    reason: "license_template_signal_only_v1",
    details: { note: "Placeholder handler — to be wired when license_template SSOT lands." },
  }),
};

// ── Drain loop ────────────────────────────────────────────────────
async function drainOnce(sb: any) {
  // Step 1: select pending job IDs
  const { data: candidates, error: selErr } = await sb
    .from("job_queue")
    .select("id")
    .in("job_type", HANDLED_JOB_TYPES)
    .eq("status", "pending")
    .lte("run_after", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_JOBS_PER_RUN);

  if (selErr) {
    console.error("[post-publish-growth-worker] select error:", selErr);
    return { claimed: 0, results: [] as any[] };
  }
  if (!candidates || candidates.length === 0) {
    return { claimed: 0, results: [] as any[] };
  }
  const ids = candidates.map((r: any) => r.id);

  // Step 2: claim them (status=processing). Re-check status to avoid lost-race double-claim.
  // PRE_HEARTBEAT_KILL fix: stamp last_heartbeat_at at claim time so the reaper
  // (which kills jobs with started_at set but no heartbeat within 3min) does not
  // terminal-fail jobs that sit in the synchronous for-loop below.
  const nowIso = new Date().toISOString();
  const { data: claimed, error: claimErr } = await sb
    .from("job_queue")
    .update({
      status: "processing",
      started_at: nowIso,
      locked_at: nowIso,
      last_heartbeat_at: nowIso,
      locked_by: "post-publish-growth-worker",
    })
    .in("id", ids)
    .eq("status", "pending")
    .select("id, job_type, payload");

  if (claimErr) {
    console.error("[post-publish-growth-worker] claim error:", claimErr);
    return { claimed: 0, results: [] as any[] };
  }
  if (!claimed || claimed.length === 0) return { claimed: 0, results: [] };

  const results: any[] = [];
  for (const job of claimed) {
    const handler = HANDLERS[job.job_type];
    const pkgId = job.payload?.package_id;
    let outcome: Outcome;

    if (!handler) {
      outcome = { status: "failed", reason: `unknown_job_type_${job.job_type}` };
    } else if (!pkgId) {
      outcome = { status: "failed", reason: "missing_package_id_in_payload" };
    } else {
      const { data: pkg, error: pkgErr } = await sb
        .from("course_packages")
        .select("id, title, curriculum_id, package_key, persona_profile, status, is_published, feature_flags")
        .eq("id", pkgId)
        .single();
      if (pkgErr || !pkg) {
        outcome = { status: "failed", reason: `package_not_found: ${pkgErr?.message ?? "null"}` };
      } else if (pkg.status !== "published" || pkg.is_published !== true) {
        outcome = { status: "noop", reason: "package_no_longer_published", details: { status: pkg.status } };
      } else {
        try {
          outcome = await handler(sb, pkg);
        } catch (e) {
          outcome = { status: "failed", reason: "handler_exception", details: { error: (e as Error).message } };
        }
      }
    }

    // Persist outcome to job_queue
    const dbStatus = outcome.status === "completed" || outcome.status === "noop" ? "completed" : "failed";
    await sb
      .from("job_queue")
      .update({
        status: dbStatus,
        completed_at: new Date().toISOString(),
        last_error: outcome.status === "failed" ? (outcome.reason ?? null) : null,
        result: { outcome: outcome.status, reason: outcome.reason ?? null, details: outcome.details ?? null },
      })
      .eq("id", job.id);

    // Audit
    await sb.from("auto_heal_log").insert({
      action_type: `post_publish_growth_worker:${job.job_type}`,
      trigger_source: "cron:post-publish-growth-worker",
      target_type: "course_package",
      target_id: pkgId ?? null,
      result_status: outcome.status === "failed" ? "failed" : (outcome.status === "noop" ? "skipped" : "success"),
      metadata: {
        job_id: job.id,
        job_type: job.job_type,
        outcome: outcome.status,
        reason: outcome.reason ?? null,
        details: outcome.details ?? null,
      },
    });

    results.push({ job_id: job.id, job_type: job.job_type, ...outcome });
  }

  return { claimed: claimed.length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Schema-gate (best-effort)
  try {
    const r = await drainOnce(sb);
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("[post-publish-growth-worker] fatal:", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
