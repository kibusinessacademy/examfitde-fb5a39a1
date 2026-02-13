import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ProviderRow {
  provider: string;
  status: string;
  current_slots: number;
  max_slots: number;
  cooldown_seconds: number;
  priority: number;
  reliability_7d: number;
  error_streak: number;
  last_error_at: string | null;
}

interface WorkerPolicy {
  job_type: string;
  enabled: boolean;
  max_parallel: number;
  max_attempts: number;
  timeout_seconds: number;
  max_cost_eur_per_day: number;
  pause_on_error_rate: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const actions: string[] = [];
  const warnings: string[] = [];

  try {
    // ── 1. Job Queue Health ──────────────────────────────────────
    const { data: queueStats } = await sb.rpc("get_job_queue_stats").single();

    // Fallback: manual counts if RPC doesn't exist
    let pending = 0, processing = 0, failed = 0, stuck = 0;

    if (queueStats) {
      pending = queueStats.pending ?? 0;
      processing = queueStats.processing ?? 0;
      failed = queueStats.failed ?? 0;
      stuck = queueStats.stuck ?? 0;
    } else {
      // Manual counting
      const { count: pCount } = await sb
        .from("job_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      pending = pCount ?? 0;

      const { count: prCount } = await sb
        .from("job_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "processing");
      processing = prCount ?? 0;

      const { count: fCount } = await sb
        .from("job_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "failed");
      failed = fCount ?? 0;

      // Stuck = processing for > 15 min
      const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
      const { count: sCount } = await sb
        .from("job_queue")
        .select("*", { count: "exact", head: true })
        .eq("status", "processing")
        .lt("started_at", fifteenMinAgo);
      stuck = sCount ?? 0;
    }

    // ── 1a. Fix stuck jobs ──────────────────────────────────────
    if (stuck > 0) {
      const fifteenMinAgo = new Date(Date.now() - 15 * 60_000).toISOString();
      const { data: stuckJobs } = await sb
        .from("job_queue")
        .select("id, job_type, attempts, max_attempts")
        .eq("status", "processing")
        .lt("started_at", fifteenMinAgo)
        .limit(10);

      for (const job of stuckJobs ?? []) {
        const maxAttempts = job.max_attempts ?? 5;
        if ((job.attempts ?? 0) >= maxAttempts) {
          await sb
            .from("job_queue")
            .update({ status: "failed", error: "Guardian: max attempts reached after stuck" })
            .eq("id", job.id);
          actions.push(`Failed stuck job ${job.id} (${job.job_type}) - max attempts`);
        } else {
          await sb
            .from("job_queue")
            .update({ status: "pending", started_at: null })
            .eq("id", job.id);
          actions.push(`Reset stuck job ${job.id} (${job.job_type}) to pending`);
        }
      }
    }

    // ── 1b. Reset excessive-attempt pending jobs ─────────────────
    const { data: highAttemptJobs } = await sb
      .from("job_queue")
      .select("id, job_type, attempts")
      .eq("status", "pending")
      .gt("attempts", 10)
      .limit(20);

    for (const job of highAttemptJobs ?? []) {
      await sb
        .from("job_queue")
        .update({ attempts: 0 })
        .eq("id", job.id);
      actions.push(`Reset attempts for ${job.job_type} (${job.id}): ${job.attempts} → 0`);
    }

    // ── 2. Provider Health ──────────────────────────────────────
    const { data: providers } = await sb
      .from("provider_status")
      .select("*") as { data: ProviderRow[] | null };

    for (const p of providers ?? []) {
      // 2a. Degraded provider with high error streak → reduce slots
      if (p.error_streak >= 5 && p.current_slots > 1) {
        const newSlots = Math.max(1, Math.floor(p.current_slots / 2));
        await sb
          .from("provider_status")
          .update({
            current_slots: newSlots,
            cooldown_seconds: Math.min(300, p.cooldown_seconds + 30),
            status: "degraded",
          })
          .eq("provider", p.provider);
        actions.push(`Throttled ${p.provider}: slots ${p.current_slots}→${newSlots}, cooldown +30s`);
      }

      // 2b. Provider healthy but slots too low → recover
      if (
        p.status === "healthy" &&
        p.error_streak === 0 &&
        p.reliability_7d > 0.8 &&
        p.current_slots < p.max_slots
      ) {
        const newSlots = Math.min(p.max_slots, p.current_slots + 1);
        await sb
          .from("provider_status")
          .update({
            current_slots: newSlots,
            cooldown_seconds: Math.max(30, p.cooldown_seconds - 10),
          })
          .eq("provider", p.provider);
        actions.push(`Recovered ${p.provider}: slots ${p.current_slots}→${newSlots}`);
      }

      // 2c. Provider down → try reset if last error > 10 min ago
      if (p.status === "down" && p.last_error_at) {
        const lastErr = new Date(p.last_error_at).getTime();
        if (Date.now() - lastErr > 10 * 60_000) {
          await sb
            .from("provider_status")
            .update({
              status: "degraded",
              error_streak: 0,
              current_slots: 1,
              cooldown_seconds: 120,
            })
            .eq("provider", p.provider);
          actions.push(`Revived ${p.provider} from down → degraded (1 slot)`);
        }
      }
    }

    // ── 3. Rate-Limit / Cost Check ──────────────────────────────
    const { data: workerPolicies } = await sb
      .from("ai_worker_policies")
      .select("*") as { data: WorkerPolicy[] | null };

    const today = new Date().toISOString().slice(0, 10);
    const { data: usageToday } = await sb
      .from("ai_worker_usage_daily")
      .select("job_type, runs, errors, cost_eur, tokens_used")
      .eq("date", today);

    const usageMap = new Map(
      (usageToday ?? []).map((u: any) => [u.job_type, u])
    );

    for (const policy of workerPolicies ?? []) {
      const usage = usageMap.get(policy.job_type);
      if (!usage) continue;

      const errorRate = usage.runs > 4 ? usage.errors / usage.runs : 0;

      // 3a. Error rate too high → disable worker temporarily
      if (errorRate >= policy.pause_on_error_rate && policy.enabled) {
        await sb
          .from("ai_worker_policies")
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq("job_type", policy.job_type);
        warnings.push(
          `Paused ${policy.job_type}: error rate ${(errorRate * 100).toFixed(0)}% >= ${(policy.pause_on_error_rate * 100).toFixed(0)}%`
        );
      }

      // 3b. Cost budget exceeded → disable
      if (usage.cost_eur >= policy.max_cost_eur_per_day && policy.enabled) {
        await sb
          .from("ai_worker_policies")
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq("job_type", policy.job_type);
        warnings.push(
          `Paused ${policy.job_type}: cost €${usage.cost_eur.toFixed(2)} >= limit €${policy.max_cost_eur_per_day}`
        );
      }

      // 3c. Worker was paused but error rate recovered → re-enable
      if (
        !policy.enabled &&
        errorRate < policy.pause_on_error_rate * 0.5 &&
        usage.cost_eur < policy.max_cost_eur_per_day * 0.8
      ) {
        await sb
          .from("ai_worker_policies")
          .update({ enabled: true, updated_at: new Date().toISOString() })
          .eq("job_type", policy.job_type);
        actions.push(`Re-enabled ${policy.job_type}: error rate recovered`);
      }
    }

    // ── 4. Pipeline Lock Health ─────────────────────────────────
    const { data: lock } = await sb
      .from("pipeline_lock")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (lock && lock.locked_at) {
      const lockAge = Date.now() - new Date(lock.locked_at).getTime();
      // Stale lock > 15 min
      if (lockAge > 15 * 60_000) {
        await sb
          .from("pipeline_lock")
          .update({
            locked_by: null,
            locked_at: null,
            package_id: null,
          })
          .eq("id", lock.id);
        actions.push(`Cleared stale pipeline lock (age: ${Math.round(lockAge / 60_000)}min)`);
      }
    }

    // ── 5. Log results ──────────────────────────────────────────
    const summary = {
      timestamp: new Date().toISOString(),
      queue: { pending, processing, failed, stuck },
      providers: (providers ?? []).map((p: ProviderRow) => ({
        name: p.provider,
        status: p.status,
        slots: p.current_slots,
        reliability: p.reliability_7d,
      })),
      actions,
      warnings,
    };

    // Notify admin if critical issues
    if (warnings.length > 0 || stuck > 0) {
      await sb.from("admin_notifications").insert({
        title: `Guardian: ${warnings.length} Warnings, ${stuck} Stuck`,
        body: JSON.stringify({ actions, warnings, queue: summary.queue }),
        severity: warnings.length > 0 ? "warning" : "info",
        category: "system",
        entity_type: "production_guardian",
      });
    }

    // Auto-heal log entry
    await sb.from("auto_heal_log").insert({
      action_type: "production_guardian_cycle",
      trigger_source: "cron_20min",
      result_status: warnings.length > 0 ? "warning" : "ok",
      result_detail: `Actions: ${actions.length}, Warnings: ${warnings.length}`,
      metadata: summary,
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("production-guardian error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
