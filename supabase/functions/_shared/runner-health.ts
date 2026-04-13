/**
 * Runner Health Heartbeat — shared helper
 * 
 * Each runner emits a heartbeat after every invocation cycle.
 * The control-plane reads v_runner_health_latest to detect dead runners.
 */

export interface RunnerHeartbeat {
  runner_name: string;
  worker_id: string;
  lanes: string[];
  status: "ok" | "crash" | "circuit_breaker" | "boot_guard_fail";
  passes: number;
  claimed: number;
  succeeded: number;
  failed: number;
  runtime_ms: number;
  error_message?: string;
  /** Completions per minute (rolling window) */
  completion_rate?: number;
  /** Claims per minute (rolling window) */
  claim_rate?: number;
}

// deno-lint-ignore no-explicit-any
export async function emitRunnerHeartbeat(sb: any, hb: RunnerHeartbeat): Promise<void> {
  try {
    await sb.from("runner_health_log").insert({
      runner_name: hb.runner_name,
      worker_id: hb.worker_id,
      lanes: hb.lanes,
      status: hb.status,
      passes: hb.passes,
      claimed: hb.claimed,
      succeeded: hb.succeeded,
      failed: hb.failed,
      runtime_ms: hb.runtime_ms,
      error_message: hb.error_message ?? null,
      completion_rate: hb.completion_rate ?? null,
      claim_rate: hb.claim_rate ?? null,
    });
  } catch (e) {
    // Non-fatal — never let health logging crash the runner
    console.warn(`[runner-health] Failed to emit heartbeat for ${hb.runner_name}: ${(e as Error).message}`);
  }
}

/**
 * Check lane health — returns runners that are dead or stale.
 * Also detects "alive but idle" (runner lives but produces 0 completions).
 * Used by control-plane-cron for alerting.
 */
// deno-lint-ignore no-explicit-any
export async function checkRunnerHealth(sb: any): Promise<{
  runners: Array<{ runner_name: string; health_status: string; seconds_ago: number; last_error?: string; completion_rate?: number; claim_rate?: number }>;
  dead_lanes: string[];
  idle_lanes: string[];
  alerts: string[];
}> {
  const { data: runners, error } = await sb
    .from("v_runner_health_latest")
    .select("runner_name, health_status, seconds_ago, lanes, error_message, completion_rate, claim_rate, succeeded, claimed");

  if (error || !runners) {
    return { runners: [], dead_lanes: [], idle_lanes: [], alerts: ["Failed to query runner health"] };
  }

  const alerts: string[] = [];
  const deadLanes = new Set<string>();
  const idleLanes = new Set<string>();

  for (const r of runners) {
    if (r.health_status === "dead") {
      alerts.push(`🔴 RUNNER_DEAD: ${r.runner_name} — last seen ${r.seconds_ago}s ago`);
      for (const lane of (r.lanes ?? [])) deadLanes.add(lane);
    } else if (r.health_status === "crash") {
      alerts.push(`🔴 RUNNER_CRASH: ${r.runner_name} — ${r.error_message?.slice(0, 200)}`);
      for (const lane of (r.lanes ?? [])) deadLanes.add(lane);
    } else if (r.health_status === "stale") {
      alerts.push(`🟡 RUNNER_STALE: ${r.runner_name} — last seen ${r.seconds_ago}s ago`);
    }

    // Alive but idle detection: runner is alive but 0 completions over recent window
    if (r.health_status === "alive" && (r.succeeded ?? 0) === 0 && (r.claimed ?? 0) > 0) {
      alerts.push(`🟠 RUNNER_IDLE: ${r.runner_name} — alive & claiming but 0 completions (all failing?)`);
      for (const lane of (r.lanes ?? [])) idleLanes.add(lane);
    } else if (r.health_status === "alive" && (r.claimed ?? 0) === 0 && r.seconds_ago < 300) {
      // Alive but not claiming anything — possible queue mismatch or filter issue
      alerts.push(`🟡 RUNNER_NO_CLAIMS: ${r.runner_name} — alive but 0 claims (queue empty or filter mismatch?)`);
    }
  }

  // Check for expected runners that have NEVER reported
  const expectedRunners = ["content-runner", "job-runner"];
  const reportedNames = new Set(runners.map((r: { runner_name: string }) => r.runner_name));
  for (const expected of expectedRunners) {
    if (!reportedNames.has(expected)) {
      alerts.push(`🔴 RUNNER_NEVER_SEEN: ${expected} — no health heartbeat ever recorded`);
    }
  }

  return {
    runners: runners.map((r: any) => ({
      runner_name: r.runner_name,
      health_status: r.health_status,
      seconds_ago: r.seconds_ago,
      last_error: r.error_message,
      completion_rate: r.completion_rate ?? null,
      claim_rate: r.claim_rate ?? null,
    })),
    dead_lanes: [...deadLanes],
    idle_lanes: [...idleLanes],
    alerts,
  };
}
