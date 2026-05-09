// S5b — First-Heartbeat-Contract helper.
// Workers MUST call markFirstHeartbeat(sb, jobId) as the very first action
// after parsing the job_id from the request, BEFORE any AI/heavy DB/external
// API call. Failure to do so risks PRE_HEARTBEAT_KILL by the reaper when
// the Edge runtime CPU-kills the function before its first tick.
//
// Idempotent: subsequent calls only refresh last_heartbeat_at + heartbeat_count;
// first_heartbeat_at + edge_invocation_id stay pinned to the very first call.

function deriveInvocationId(): string {
  // Deno deploys expose DENO_DEPLOYMENT_ID; we combine with a per-process random
  // so that two warm reuses of the same isolate get distinguishable invocation IDs.
  // deno-lint-ignore no-explicit-any
  const dep = (globalThis as any).Deno?.env?.get?.("DENO_DEPLOYMENT_ID") ?? "local";
  const r = Math.random().toString(36).slice(2, 10);
  return `${dep}:${Date.now().toString(36)}:${r}`;
}

// deno-lint-ignore no-explicit-any
export async function markFirstHeartbeat(
  sb: any,
  jobId: string | null | undefined,
  edgeInvocationId?: string,
): Promise<void> {
  if (!jobId) return;
  try {
    await sb.rpc("mark_job_first_heartbeat", {
      p_job_id: jobId,
      p_edge_invocation_id: edgeInvocationId ?? deriveInvocationId(),
    });
  } catch (e) {
    // Never let heartbeat errors break the worker — log and continue.
    console.warn(`[first-heartbeat] mark failed job=${String(jobId).slice(0, 8)}: ${(e as Error).message}`);
  }
}
