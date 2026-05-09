// S5b — First-Heartbeat-Contract helper.
// Workers MUST call markFirstHeartbeat(sb, jobId) as the very first action
// after parsing the job_id from the request, BEFORE any AI/heavy DB/external
// API call. Failure to do so risks PRE_HEARTBEAT_KILL by the reaper when
// the Edge runtime CPU-kills the function before its first tick.
//
// Idempotent: subsequent calls only refresh last_heartbeat_at; first_heartbeat_at
// stays pinned to the very first call.

// deno-lint-ignore no-explicit-any
export async function markFirstHeartbeat(sb: any, jobId: string | null | undefined): Promise<void> {
  if (!jobId) return;
  try {
    await sb.rpc("mark_job_first_heartbeat", { p_job_id: jobId });
  } catch (e) {
    // Never let heartbeat errors break the worker — log and continue.
    console.warn(`[first-heartbeat] mark failed job=${String(jobId).slice(0, 8)}: ${(e as Error).message}`);
  }
}
