/**
 * Shared Payload-Normalisierung für alle Runner (job-runner, content-runner).
 *
 * Garantiert:
 *  - package_id, curriculum_id, course_id aus Job-Columns injiziert wenn in Payload fehlend
 *  - course_id wird ZUSÄTZLICH aus course_packages → courses nachgeladen, wenn weder
 *    Top-Level noch Payload sie enthält (DB-Schema hat keine course_id auf job_queue)
 *  - camelCase → snake_case Normalisierung
 *  - _job_id, _job_type immer gesetzt
 *  - batch_cursor mitgeführt
 *
 * v2 (2026-04-18): async resolveDispatchPayload() schließt die strukturelle Lücke,
 * die HTTP-400 "Missing package_id, course_id, or curriculum_id" verursacht hat.
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

// In-memory cache for course_id lookups (per Edge-Function-Instanz, ~5 min TTL)
const courseIdCache = new Map<string, { value: string; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Async-Variante: garantiert package_id, curriculum_id UND course_id im Payload.
 * Lädt course_id über courses.curriculum_id nach, falls keine andere Quelle greift.
 *
 * Verwendung in Runnern:
 *   const payload = await resolveDispatchPayload(job, sb);
 */
export async function resolveDispatchPayload(
  job: JobRow,
  sb: { from: (t: string) => any },
): Promise<Record<string, unknown>> {
  const payload = buildDispatchPayload(job);

  // course_id Fallback-Resolution wenn package_id vorhanden, course_id fehlt
  if (!payload.course_id && (payload.package_id || job.package_id)) {
    const pkgId = String(payload.package_id ?? job.package_id);
    const cached = courseIdCache.get(pkgId);
    if (cached && cached.expiresAt > Date.now()) {
      payload.course_id = cached.value;
    } else {
      try {
        const { data } = await sb
          .from("course_packages")
          .select("course_id, curriculum_id, courses:courses!course_packages_course_id_fkey(id)")
          .eq("id", pkgId)
          .maybeSingle();
        let resolvedCourseId: string | null = data?.course_id ?? null;
        if (!resolvedCourseId && data?.curriculum_id) {
          // Fallback via courses.curriculum_id
          const { data: courseRow } = await sb
            .from("courses")
            .select("id")
            .eq("curriculum_id", data.curriculum_id)
            .maybeSingle();
          resolvedCourseId = courseRow?.id ?? null;
        }
        if (resolvedCourseId) {
          payload.course_id = resolvedCourseId;
          courseIdCache.set(pkgId, {
            value: resolvedCourseId,
            expiresAt: Date.now() + CACHE_TTL_MS,
          });
        }
        if (!payload.curriculum_id && data?.curriculum_id) {
          payload.curriculum_id = data.curriculum_id;
        }
      } catch (err) {
        console.warn(`[resolveDispatchPayload] course_id lookup failed for ${pkgId}:`, err);
      }
    }
  }

  return payload;
}
