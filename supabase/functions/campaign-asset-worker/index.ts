import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCorsPreflightRequest, json } from "../_shared/cors.ts";

function buildAssetContent(args: {
  qualificationTitle: string;
  assetType: string;
  channel: string;
  offerType: string;
  priceTier: string;
  launchAngle: string;
  targetPersona: string;
}) {
  const title = `${args.qualificationTitle} – ${args.assetType.replace(/_/g, " ")}`;
  const slug = `${args.assetType}-${args.qualificationTitle.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").replace(/-+$/, "")}`;

  const markdown = `# ${title}

## Kanal
${args.channel}

## Angebot
${args.offerType.replace(/_/g, " ")}

## Preisniveau
${args.priceTier}

## Angle
${args.launchAngle}

## Zielgruppe
${args.targetPersona}

## Draft
Auto-generierter Asset-Entwurf für ${args.qualificationTitle}.
Dieses Asset wurde automatisch durch die Campaign Automation Pipeline erstellt und muss vor Veröffentlichung redaktionell geprüft werden.`;

  return {
    title,
    slug,
    markdown,
    json: {
      qualification_title: args.qualificationTitle,
      asset_type: args.assetType,
      channel: args.channel,
      offer_type: args.offerType,
      price_tier: args.priceTier,
      launch_angle: args.launchAngle,
      target_persona: args.targetPersona,
    },
  };
}

Deno.serve(async (req) => {
  const cors = handleCorsPreflightRequest(req);
  if (cors) return cors;
  const origin = req.headers.get("origin");

  if (req.method !== "POST") return json(405, { error: "POST only" }, origin);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 10), 25);
  const workerId = body.worker_id || "campaign-asset-worker";

  // Create run record
  const { data: run } = await sb
    .from("campaign_automation_runs")
    .insert({ run_type: "asset_worker", status: "running" })
    .select("id")
    .single();
  const runId = run?.id;

  // Claim jobs
  const { data: jobs, error: claimErr } = await sb.rpc("claim_campaign_asset_jobs", {
    p_limit: limit,
    p_worker_id: workerId,
    p_lease_minutes: 10,
  });

  if (claimErr) {
    if (runId) await sb.from("campaign_automation_runs").update({ status: "failed", finished_at: new Date().toISOString(), meta: { error: claimErr.message } }).eq("id", runId);
    return json(500, { error: claimErr.message }, origin);
  }

  const results: any[] = [];
  let doneCount = 0;
  let errorCount = 0;

  for (const job of jobs || []) {
    try {
      // Get qualification title
      const { data: qc } = await sb
        .from("qualification_catalog")
        .select("canonical_title")
        .eq("id", job.qualification_catalog_id)
        .single();

      const qualificationTitle = qc?.canonical_title || "Unbekannte Qualifikation";
      const payload = job.payload || {};

      const asset = buildAssetContent({
        qualificationTitle,
        assetType: job.asset_type,
        channel: job.channel,
        offerType: payload.offer_type || "standard_course",
        priceTier: payload.price_tier || "mid",
        launchAngle: payload.launch_angle || "",
        targetPersona: payload.target_persona || "",
      });

      // Insert asset
      const { error: insertErr } = await sb.from("campaign_assets").insert({
        launch_plan_id: job.launch_plan_id,
        queue_id: job.id,
        qualification_catalog_id: job.qualification_catalog_id,
        curriculum_id: job.curriculum_id,
        asset_type: job.asset_type,
        asset_key: job.asset_key,
        channel: job.channel,
        title: asset.title,
        slug: asset.slug,
        content_markdown: asset.markdown,
        content_json: asset.json,
        publication_status: "draft",
      });

      if (insertErr) throw new Error(insertErr.message);

      // Mark job done
      await sb.from("campaign_asset_queue").update({
        status: "done",
        finished_at: new Date().toISOString(),
        result_meta: { title: asset.title, slug: asset.slug },
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);

      // Update plan timestamp
      await sb.from("campaign_launch_plans").update({
        updated_at: new Date().toISOString(),
      }).eq("id", job.launch_plan_id);

      doneCount++;
      results.push({ job_id: job.id, asset_key: job.asset_key, status: "done" });
    } catch (err: any) {
      errorCount++;
      const isDead = job.attempts >= job.max_attempts;
      await sb.from("campaign_asset_queue").update({
        status: isDead ? "dead" : "queued",
        last_error: err.message,
        run_after: isDead ? undefined : new Date(Date.now() + 60_000 * Math.pow(2, job.attempts)).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      results.push({ job_id: job.id, asset_key: job.asset_key, status: isDead ? "dead" : "retry", error: err.message });
    }
  }

  // Update generated_asset_count on affected plans
  const planIds = [...new Set((jobs || []).map((j: any) => j.launch_plan_id))];
  for (const planId of planIds) {
    const { count } = await sb
      .from("campaign_assets")
      .select("id", { count: "exact", head: true })
      .eq("launch_plan_id", planId);
    await sb.from("campaign_launch_plans").update({
      generated_asset_count: count ?? 0,
      updated_at: new Date().toISOString(),
    }).eq("id", planId);
  }

  if (runId) {
    await sb.from("campaign_automation_runs").update({
      status: "done",
      processed_count: (jobs || []).length,
      created_count: doneCount,
      error_count: errorCount,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  return json(200, { ok: true, claimed: (jobs || []).length, done: doneCount, errors: errorCount, results }, origin);
});
