import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function invokeSelf(url: string, serviceKey: string, fn: string, body: unknown) {
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes(405, { error: "POST only" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const body = await req.json().catch(() => ({}));
  const doDiscovery = body.discovery !== false;
  const doFortbildungDiscovery = body.fortbildung_discovery !== false;
  const doFetch = body.fetch !== false;
  const doParse = body.parse !== false;
  const doDraft = body.draft !== false;
  const doMaterialize = body.materialize !== false;
  const doWaveSync = body.wave_sync !== false;
  const doPromoteBlueprint = body.promote_blueprint !== false;
  const doAutoWave = body.auto_wave !== false;
  const doIntelligence = body.intelligence !== false;
  const doRevenue = body.revenue !== false;
  const doCampaign = body.campaign !== false;

  const steps: any[] = [];

  if (doDiscovery) {
    steps.push({
      step: "discovery_dual",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-search-discovery", {
        trigger_source: "cron", limit: 50,
      })),
    });
  }

  if (doFortbildungDiscovery) {
    steps.push({
      step: "discovery_fortbildung",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-discover-fortbildungen", {
        limit: 50,
      })),
    });
  }

  if (doFetch) {
    steps.push({
      step: "fetch",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-fetch-documents", {
        worker_id: "qualification-intake-cron", limit: 20,
      })),
    });
  }

  if (doParse) {
    steps.push({
      step: "parse",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-pdf-parse", {
        limit: 20,
      })),
    });
  }

  if (doDraft) {
    steps.push({
      step: "draft",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-intake-admin", {
        action: "build_drafts", limit: 20,
      })),
    });
  }

  if (doMaterialize) {
    steps.push({
      step: "materialize",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-materialize", {
        min_readiness: 70, per_competency: 6,
      })),
    });
  }

  if (doWaveSync) {
    steps.push({
      step: "wave_sync",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-wave-sync", {
        min_readiness: 70,
      })),
    });
  }

  // NEW: Promote ready drafts → curricula + exam_blueprints + question_blueprints
  if (doPromoteBlueprint) {
    steps.push({
      step: "promote_blueprint",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-promote-and-blueprint", {
        limit: 10, per_competency: 6,
      })),
    });
  }

  // NEW: Auto-seed production waves from ready candidates
  if (doAutoWave) {
    steps.push({
      step: "auto_wave",
      ...(await invokeSelf(supabaseUrl, serviceKey, "qualification-auto-wave", {
        limit: 10,
      })),
    });
  }

  // NEW: Intelligence scoring + priority sync
  if (doIntelligence) {
    steps.push({
      step: "intelligence",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-priority-sync", {
        limit: 100,
      })),
    });
  }

  // Revenue Intelligence: Signal Ingest → GTM Score → Launch Recommendations
  if (doRevenue) {
    steps.push({
      step: "revenue_pipeline",
      ...(await invokeSelf(supabaseUrl, serviceKey, "curriculum-revenue-cron", {
        limit: 200,
      })),
    });
  }

  // Campaign Automation: Plan Sync → Enqueue → Worker → Performance
  if (doCampaign) {
    steps.push({
      step: "campaign_automation",
      ...(await invokeSelf(supabaseUrl, serviceKey, "campaign-automation-cron", {})),
    });
  }

  return jsonRes(200, {
    ok: true,
    steps,
    ran_at: new Date().toISOString(),
  });
});
