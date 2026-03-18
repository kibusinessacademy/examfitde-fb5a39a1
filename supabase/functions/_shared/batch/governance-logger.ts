/**
 * batch/governance-logger.ts — Persistent governance event logging.
 *
 * Writes remap, canary, and rejection events to batch_governance_events
 * for forensic audit. Fire-and-forget: never blocks the hot path.
 */

export interface GovernanceEvent {
  event_type: "model_remapped" | "canary_submitted" | "canary_result" | "model_rejected";
  requested_model: string;
  effective_model: string;
  reason?: string;
  job_type?: string;
  package_id?: string;
  source_job_id?: string;
  batch_id?: string;
  custom_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Persist a governance event. Fire-and-forget — errors are logged but never thrown.
 */
export async function logGovernanceEvent(
  sb: { from: (table: string) => any },
  event: GovernanceEvent,
): Promise<void> {
  try {
    const { error } = await sb.from("batch_governance_events").insert({
      event_type: event.event_type,
      requested_model: event.requested_model,
      effective_model: event.effective_model,
      reason: event.reason ?? null,
      job_type: event.job_type ?? null,
      package_id: event.package_id ?? null,
      source_job_id: event.source_job_id ?? null,
      batch_id: event.batch_id ?? null,
      custom_id: event.custom_id ?? null,
      metadata: event.metadata ?? {},
    });
    if (error) console.error(`[governance-logger] Insert failed: ${error.message}`);
  } catch (e) {
    console.error(`[governance-logger] Unexpected error: ${(e as Error)?.message}`);
  }
}

/**
 * Log a model remap event (convenience wrapper).
 */
export async function logModelRemap(
  sb: { from: (table: string) => any },
  opts: {
    requested: string;
    effective: string;
    reason: string;
    jobType?: string;
    packageId?: string;
    sourceJobId?: string;
  },
): Promise<void> {
  await logGovernanceEvent(sb, {
    event_type: "model_remapped",
    requested_model: opts.requested,
    effective_model: opts.effective,
    reason: opts.reason,
    job_type: opts.jobType,
    package_id: opts.packageId,
    source_job_id: opts.sourceJobId,
  });
}
