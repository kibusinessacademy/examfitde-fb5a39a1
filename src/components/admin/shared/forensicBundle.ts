/**
 * Forensic-Bundle Builder — sammelt komplette package-state-Snapshot:
 *   - course_packages (basis + feature_flags)
 *   - package_steps (alle steps + status + last_error)
 *   - job_queue (last 20)
 *   - auto_heal_log (last 10)
 *   - ops_guard_reason (latest)
 * Liefert JSON-String, ready zum Paste in Slack/Issue/AI-Chat.
 */
import { supabase } from "@/integrations/supabase/client";

export interface ForensicBundle {
  generated_at: string;
  package_id: string;
  package: any;
  steps: any[];
  recent_jobs: any[];
  recent_heal_log: any[];
  guard_reason: any;
  repro_sql: string[];
}

export async function buildForensicBundle(packageId: string): Promise<ForensicBundle> {
  const [pkg, steps, jobs, log] = await Promise.all([
    supabase.from("course_packages").select("id,package_key,title,status,feature_flags,created_at,updated_at").eq("id", packageId).maybeSingle(),
    supabase.from("package_steps").select("step_key,status,attempt,last_error,started_at,completed_at,updated_at").eq("package_id", packageId).order("step_key"),
    supabase.from("job_queue").select("id,job_type,job_name,status,attempts,last_error,enqueue_source,created_at,updated_at,started_at").eq("package_id", packageId).order("created_at", { ascending: false }).limit(20),
    supabase.from("auto_heal_log").select("action_type,result_status,details,created_at").eq("target_id", packageId).order("created_at", { ascending: false }).limit(10),
  ]);

  const flags: any = (pkg.data as any)?.feature_flags ?? {};
  const guardReason = flags?.bronze ?? flags?.ops_guard_reason ?? null;

  const repro_sql = [
    `-- Inspect package state`,
    `SELECT id, package_key, status, feature_flags FROM course_packages WHERE id = '${packageId}';`,
    `-- Inspect steps`,
    `SELECT step_key, status, attempt, last_error FROM package_steps WHERE package_id = '${packageId}' ORDER BY step_key;`,
    `-- Inspect last 20 jobs`,
    `SELECT id, job_type, status, attempts, last_error, created_at FROM job_queue WHERE package_id = '${packageId}' ORDER BY created_at DESC LIMIT 20;`,
    `-- Heal log`,
    `SELECT action_type, result_status, details, created_at FROM auto_heal_log WHERE target_id = '${packageId}' ORDER BY created_at DESC LIMIT 10;`,
  ];

  return {
    generated_at: new Date().toISOString(),
    package_id: packageId,
    package: pkg.data,
    steps: steps.data ?? [],
    recent_jobs: jobs.data ?? [],
    recent_heal_log: log.data ?? [],
    guard_reason: guardReason,
    repro_sql,
  };
}

export async function copyForensicBundle(packageId: string): Promise<string> {
  const b = await buildForensicBundle(packageId);
  return JSON.stringify(b, null, 2);
}
