/**
 * PIPELINE.RECOVERY.OS.3 — Planning Dispatcher Diagnosis (Pure SSOT)
 *
 * Determines WHY a stuck planning job has not been picked up.
 * Restart is only safe for CLAIM_LOST or HEALTHY_BUT_PENDING.
 */

export type PlanningDiagnosisCause =
  | "WORKER_HEARTBEAT_STALE"
  | "JOB_TYPE_QUARANTINED"
  | "POOL_MISMATCH"
  | "CLAIM_LOST"
  | "DISPATCHER_OFF"
  | "HEALTHY_BUT_PENDING";

export interface PlanningJobRow {
  id: string;
  package_id: string;
  job_type: string;
  status: string; // 'pending' | 'processing' | ...
  worker_pool: string | null;
  started_at: string | null;
  last_heartbeat_at: string | null;
  updated_at: string;
}

export interface WorkerHeartbeatRow {
  worker_id: string;
  job_types: string[];
  worker_pool: string | null;
  last_heartbeat_at: string;
}

export interface JobTypePolicyRow {
  job_type: string;
  worker_pool: string | null;
}

export interface JobTypeQuarantineRow {
  job_type: string;
  status: string; // 'quarantined' | 'cleared'
}

export interface PlanningDiagnosis {
  package_id: string;
  job_id: string | null;
  cause: PlanningDiagnosisCause;
  restart_safe: boolean;
  detail: string;
}

const SAFE_FOR_RESTART: ReadonlySet<PlanningDiagnosisCause> = new Set([
  "CLAIM_LOST",
  "HEALTHY_BUT_PENDING",
]);

const HEARTBEAT_STALE_MS = 10 * 60 * 1000;
const CLAIM_STALE_MS = 30 * 60 * 1000;

export function diagnosePlanningJob(input: {
  now: string;
  job: PlanningJobRow;
  workers: WorkerHeartbeatRow[];
  policy: JobTypePolicyRow | null;
  quarantine: JobTypeQuarantineRow | null;
}): PlanningDiagnosis {
  const { now, job, workers, policy, quarantine } = input;
  const nowMs = Date.parse(now);

  if (quarantine && quarantine.status === "quarantined") {
    return {
      package_id: job.package_id,
      job_id: job.id,
      cause: "JOB_TYPE_QUARANTINED",
      restart_safe: false,
      detail: `job_type ${job.job_type} is quarantined`,
    };
  }

  const expectedPool = policy?.worker_pool ?? "default";
  const queuePool = job.worker_pool ?? "default";
  if (queuePool !== expectedPool) {
    return {
      package_id: job.package_id,
      job_id: job.id,
      cause: "POOL_MISMATCH",
      restart_safe: false,
      detail: `queue.worker_pool=${queuePool} ≠ policy.worker_pool=${expectedPool}`,
    };
  }

  // claim lost: processing + no heartbeat update for >30m
  if (job.status === "processing") {
    const hb = job.last_heartbeat_at ? Date.parse(job.last_heartbeat_at) : 0;
    if (nowMs - hb > CLAIM_STALE_MS) {
      return {
        package_id: job.package_id,
        job_id: job.id,
        cause: "CLAIM_LOST",
        restart_safe: true,
        detail: `processing without heartbeat for >${CLAIM_STALE_MS / 60000}m`,
      };
    }
  }

  const eligibleWorkers = workers.filter(
    (w) =>
      Array.isArray(w.job_types) &&
      w.job_types.includes(job.job_type) &&
      (w.worker_pool ?? "default") === expectedPool,
  );

  if (eligibleWorkers.length === 0) {
    return {
      package_id: job.package_id,
      job_id: job.id,
      cause: "DISPATCHER_OFF",
      restart_safe: false,
      detail: `no worker registered for ${job.job_type} in pool ${expectedPool}`,
    };
  }

  const freshWorker = eligibleWorkers.find(
    (w) => nowMs - Date.parse(w.last_heartbeat_at) <= HEARTBEAT_STALE_MS,
  );
  if (!freshWorker) {
    return {
      package_id: job.package_id,
      job_id: job.id,
      cause: "WORKER_HEARTBEAT_STALE",
      restart_safe: false,
      detail: `all eligible workers stale (>${HEARTBEAT_STALE_MS / 60000}m)`,
    };
  }

  return {
    package_id: job.package_id,
    job_id: job.id,
    cause: "HEALTHY_BUT_PENDING",
    restart_safe: true,
    detail: `worker ${freshWorker.worker_id} is healthy; job still pending`,
  };
}

export function isRestartSafe(cause: PlanningDiagnosisCause): boolean {
  return SAFE_FOR_RESTART.has(cause);
}
