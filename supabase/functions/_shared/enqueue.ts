/**
 * SSOT Enqueue Helper
 *
 * All job insertions SHOULD use this helper to guarantee:
 * 1. worker_pool is set deterministically via poolForJobType()
 * 2. Consistent defaults for max_attempts, status, timestamps
 *
 * Usage:
 *   import { enqueueJob } from "../_shared/enqueue.ts";
 *   await enqueueJob(sb, { job_type: "package_generate_glossary", payload: { package_id: "..." } });
 */

import { poolForJobType, type WorkerPool } from "./job-map.ts";

export interface EnqueueOpts {
  job_type: string;
  payload: Record<string, unknown>;
  package_id?: string;
  max_attempts?: number;
  priority?: number;
  run_after?: string | null;
  batch_cursor?: Record<string, unknown> | null;
  worker_pool?: WorkerPool; // override only if explicitly needed
}

export async function enqueueJob(
  // deno-lint-ignore no-explicit-any
  sb: any,
  opts: EnqueueOpts,
) {
  const worker_pool = opts.worker_pool ?? poolForJobType(opts.job_type);
  const now = new Date().toISOString();

  const row = {
    id: crypto.randomUUID(),
    job_type: opts.job_type,
    status: "pending",
    payload: opts.payload ?? {},
    package_id: opts.package_id ?? (opts.payload?.package_id as string) ?? null,
    max_attempts: opts.max_attempts ?? 8,
    priority: opts.priority ?? 10,
    worker_pool,
    run_after: opts.run_after ?? null,
    batch_cursor: opts.batch_cursor ?? null,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await sb
    .from("job_queue")
    .insert(row)
    .select("id, job_type, worker_pool, status")
    .single();

  if (error) throw error;
  return data;
}
