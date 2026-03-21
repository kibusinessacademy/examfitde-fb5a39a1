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

async function invoke(url: string, key: string, fn: string, body: unknown): Promise<{ step: string; ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${url}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { step: fn, ok: res.ok, status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes(405, { error: "POST only" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const body = await req.json().catch(() => ({}));

  // ── Phase 1: Discovery (parallel) ──
  const phase1: Promise<any>[] = [];
  if (body.discovery !== false) {
    phase1.push(invoke(supabaseUrl, serviceKey, "qualification-search-discovery", {
      trigger_source: "cron", limit: 50,
    }).then(r => ({ ...r, step: "discovery_dual" })));
  }
  if (body.fortbildung_discovery !== false) {
    phase1.push(invoke(supabaseUrl, serviceKey, "qualification-discover-fortbildungen", {
      limit: 50,
    }).then(r => ({ ...r, step: "discovery_fortbildung" })));
  }
  const phase1Results = phase1.length > 0 ? await Promise.all(phase1) : [];

  // ── Phase 2: Fetch + Parse (parallel, both independent) ──
  const phase2: Promise<any>[] = [];
  if (body.fetch !== false) {
    phase2.push(invoke(supabaseUrl, serviceKey, "qualification-fetch-documents", {
      worker_id: "qualification-intake-cron", limit: 20,
    }).then(r => ({ ...r, step: "fetch" })));
  }
  if (body.parse !== false) {
    phase2.push(invoke(supabaseUrl, serviceKey, "qualification-pdf-parse", {
      limit: 20,
    }).then(r => ({ ...r, step: "parse" })));
  }
  const phase2Results = phase2.length > 0 ? await Promise.all(phase2) : [];

  // ── Phase 3: Draft + Materialize + Wave Sync (parallel) ──
  const phase3: Promise<any>[] = [];
  if (body.draft !== false) {
    phase3.push(invoke(supabaseUrl, serviceKey, "qualification-intake-admin", {
      action: "build_drafts", limit: 20,
    }).then(r => ({ ...r, step: "draft" })));
  }
  if (body.materialize !== false) {
    phase3.push(invoke(supabaseUrl, serviceKey, "qualification-materialize", {
      min_readiness: 70, per_competency: 6,
    }).then(r => ({ ...r, step: "materialize" })));
  }
  if (body.wave_sync !== false) {
    phase3.push(invoke(supabaseUrl, serviceKey, "qualification-wave-sync", {
      min_readiness: 70,
    }).then(r => ({ ...r, step: "wave_sync" })));
  }
  const phase3Results = phase3.length > 0 ? await Promise.all(phase3) : [];

  // ── Phase 4: Promote + Auto-Wave + Intelligence (parallel) ──
  const phase4: Promise<any>[] = [];
  if (body.promote_blueprint !== false) {
    phase4.push(invoke(supabaseUrl, serviceKey, "qualification-promote-and-blueprint", {
      limit: 10, per_competency: 6,
    }).then(r => ({ ...r, step: "promote_blueprint" })));
  }
  if (body.auto_wave !== false) {
    phase4.push(invoke(supabaseUrl, serviceKey, "qualification-auto-wave", {
      limit: 10,
    }).then(r => ({ ...r, step: "auto_wave" })));
  }
  if (body.intelligence !== false) {
    phase4.push(invoke(supabaseUrl, serviceKey, "curriculum-priority-sync", {
      limit: 100,
    }).then(r => ({ ...r, step: "intelligence" })));
  }
  const phase4Results = phase4.length > 0 ? await Promise.all(phase4) : [];

  // ── Phase 5: Revenue + Campaign + Distribution + Optimization + Control Plane (parallel) ──
  const phase5: Promise<any>[] = [];
  if (body.revenue !== false) {
    phase5.push(invoke(supabaseUrl, serviceKey, "curriculum-revenue-cron", {
      limit: 200,
    }).then(r => ({ ...r, step: "revenue_pipeline" })));
  }
  if (body.campaign !== false) {
    phase5.push(invoke(supabaseUrl, serviceKey, "campaign-automation-cron", {}).then(r => ({ ...r, step: "campaign_automation" })));
  }
  if (body.distribution !== false) {
    phase5.push(invoke(supabaseUrl, serviceKey, "distribution-cron", {}).then(r => ({ ...r, step: "distribution_pipeline" })));
  }
  if (body.optimization !== false) {
    phase5.push(invoke(supabaseUrl, serviceKey, "optimization-cron", {}).then(r => ({ ...r, step: "optimization_pipeline" })));
  }
  if (body.control_plane !== false) {
    phase5.push(invoke(supabaseUrl, serviceKey, "control-plane-cron", {}).then(r => ({ ...r, step: "control_plane" })));
  }
  const phase5Results = phase5.length > 0 ? await Promise.all(phase5) : [];

  const steps = [...phase1Results, ...phase2Results, ...phase3Results, ...phase4Results, ...phase5Results];

  return jsonRes(200, {
    ok: true,
    parallel: true,
    phases: 5,
    steps,
    ran_at: new Date().toISOString(),
  });
});
