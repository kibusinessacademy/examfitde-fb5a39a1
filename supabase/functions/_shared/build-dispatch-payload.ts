/**
 * Shared Payload-Normalisierung für alle Runner (job-runner, content-runner).
 *
 * Garantiert:
 *  - package_id, curriculum_id, course_id aus Job-Columns injiziert wenn in Payload fehlend
 *  - camelCase → snake_case Normalisierung
 *  - _job_id, _job_type immer gesetzt
 *  - batch_cursor mitgeführt
 */

export interface JobRow {
  id: string;
  job_type: string;
  package_id?: string | null;
  curriculum_id?: string | null;
  course_id?: string | null;
  payload?: Record<string, unknown> | null;
  batch_cursor?: unknown;
  attempts?: number | null;
  max_attempts?: number | null;
  meta?: Record<string, unknown> | null;
}

export function buildDispatchPayload(job: JobRow): Record<string, unknown> {
  const raw = (job.payload ?? {}) as Record<string, unknown>;
  const payload: Record<string, unknown> = { ...raw };

  // ── 1. Inject top-level DB columns if missing from payload ──
  if (job.package_id && !payload.package_id) payload.package_id = job.package_id;
  if (job.curriculum_id && !payload.curriculum_id) payload.curriculum_id = job.curriculum_id;
  if (job.course_id && !payload.course_id) payload.course_id = job.course_id;

  // ── 2. camelCase → snake_case safety net ──
  if (raw.packageId && !payload.package_id) payload.package_id = raw.packageId;
  if (raw.curriculumId && !payload.curriculum_id) payload.curriculum_id = raw.curriculumId;
  if (raw.courseId && !payload.course_id) payload.course_id = raw.courseId;

  // ── 3. Batch cursor ──
  if (job.batch_cursor) {
    payload._batch_cursor = job.batch_cursor;
    payload.batch_cursor = job.batch_cursor;
  }

  // ── 4. Job metadata ──
  payload._job_id = job.id;
  payload._job_type = job.job_type;

  return payload;
}
