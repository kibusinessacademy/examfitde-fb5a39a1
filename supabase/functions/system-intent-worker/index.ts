// Phase 2a: System-Intent-Worker
// Claimed pending intents from system_intents and dispatches them
// to the corresponding legacy edge function — exactly once per intent.
// Runs every minute via cron. Idempotency is guaranteed by system_intents.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Mapping: intent_type -> downstream edge function path
const INTENT_ROUTES: Record<string, string> = {
  auto_heal_runner_tick: "auto-heal-runner",
  pipeline_watchdog_tick: "pipeline-watchdog",
  gate_history_export: "gate-history-export-worker",
  // Phase 2b — migrated 2026-05-21
  production_guardian_tick: "production-guardian",
  exam_pool_loop_breaker_tick: "exam-pool-loop-breaker",
};

const WORKER_ID = `system-intent-worker:${crypto.randomUUID().slice(0, 8)}`;
const MAX_INTENTS_PER_RUN = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const processed: any[] = [];
  const intentTypes = Object.keys(INTENT_ROUTES);

  for (let i = 0; i < MAX_INTENTS_PER_RUN; i++) {
    const { data: intent, error: claimErr } = await supabase.rpc(
      "system_intent_claim_next",
      { p_worker_id: WORKER_ID, p_intent_types: intentTypes },
    );

    if (claimErr) {
      console.error("[system-intent-worker] claim error", claimErr);
      break;
    }
    if (!intent || (Array.isArray(intent) && intent.length === 0)) {
      break; // queue empty
    }

    const claimed = Array.isArray(intent) ? intent[0] : intent;
    if (!claimed?.id) break;

    const route = INTENT_ROUTES[claimed.intent_type];
    let result: any = { dispatched: false };

    if (!route) {
      result = { dispatched: false, reason: "no_route_for_intent_type" };
    } else {
      try {
        const url = `${SUPABASE_URL}/functions/v1/${route}`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ANON_KEY}`,
          },
          body: JSON.stringify({
            triggered_by: "system-intent-worker",
            intent_id: claimed.id,
            payload: claimed.payload ?? {},
            // legacy convenience fields used by existing handlers
            bucket: claimed.payload?.bucket,
            job_id: claimed.payload?.job_id,
          }),
        });
        result = {
          dispatched: true,
          route,
          status: resp.status,
          ok: resp.ok,
        };
      } catch (e) {
        result = { dispatched: false, error: String(e) };
      }
    }

    await supabase.rpc("system_intent_complete", {
      p_intent_id: claimed.id,
      p_result: result,
    });

    processed.push({
      intent_id: claimed.id,
      intent_type: claimed.intent_type,
      result,
    });
  }

  return new Response(
    JSON.stringify({
      worker_id: WORKER_ID,
      processed_count: processed.length,
      processed,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    },
  );
});
