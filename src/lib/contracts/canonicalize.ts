/**
 * SSOT Naming Contract — Canonicalizer
 *
 * Einzige Stelle, an der Legacy camelCase-Aliases akzeptiert werden.
 * Neue Producer dürfen NIEMALS camelCase-Keys emittieren.
 * Zielzustand: diese Aliases werden überflüssig.
 */

type UnknownRecord = Record<string, unknown>;

function asRecord(input: unknown): UnknownRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return input as UnknownRecord;
}

function pickAlias(obj: UnknownRecord, keys: string[]): unknown {
  for (const key of keys) {
    if (key in obj && obj[key] !== undefined) return obj[key];
  }
  return undefined;
}

/** Canonicalize package identity fields (snake_case SSOT) */
export function canonicalize_package_identity(input: unknown) {
  const raw = asRecord(input);
  return {
    package_id: pickAlias(raw, ["package_id", "packageId"]),
    curriculum_id: pickAlias(raw, ["curriculum_id", "curriculumId"]),
    course_id: pickAlias(raw, ["course_id", "courseId"]),
  };
}

/** Canonicalize full step payload (snake_case SSOT) */
export function canonicalize_package_step_payload(input: unknown) {
  const raw = asRecord(input);
  return {
    package_id: pickAlias(raw, ["package_id", "packageId"]),
    curriculum_id: pickAlias(raw, ["curriculum_id", "curriculumId"]),
    course_id: pickAlias(raw, ["course_id", "courseId"]),
    step_key: pickAlias(raw, ["step_key", "stepKey"]),
    job_type: pickAlias(raw, ["job_type", "jobType"]),
    blueprint_id: pickAlias(raw, ["blueprint_id", "blueprintId"]),
    competency_id: pickAlias(raw, ["competency_id", "competencyId"]),
    lesson_id: pickAlias(raw, ["lesson_id", "lessonId"]),
    learning_field_filter: pickAlias(raw, ["learning_field_filter", "learningFieldFilter"]),
    track: pickAlias(raw, ["track"]),
    program_type: pickAlias(raw, ["program_type", "programType"]),
  };
}

/** Canonicalize enqueue job input (snake_case SSOT) */
export function canonicalize_enqueue_job_input(input: unknown) {
  const raw = asRecord(input);
  return {
    package_id: pickAlias(raw, ["package_id", "packageId"]),
    curriculum_id: pickAlias(raw, ["curriculum_id", "curriculumId"]),
    course_id: pickAlias(raw, ["course_id", "courseId"]),
    job_type: pickAlias(raw, ["job_type", "jobType"]),
    step_key: pickAlias(raw, ["step_key", "stepKey"]),
    blueprint_id: pickAlias(raw, ["blueprint_id", "blueprintId"]),
    competency_id: pickAlias(raw, ["competency_id", "competencyId"]),
    lesson_id: pickAlias(raw, ["lesson_id", "lessonId"]),
    learning_field_filter: pickAlias(raw, ["learning_field_filter", "learningFieldFilter"]),
    priority: pickAlias(raw, ["priority"]),
    run_after: pickAlias(raw, ["run_after", "runAfter"]),
    payload_version: pickAlias(raw, ["payload_version", "payloadVersion"]) ?? 1,
  };
}

/** Canonicalize admin repair action (snake_case SSOT) */
export function canonicalize_admin_repair_action(input: unknown) {
  const raw = asRecord(input);
  return {
    package_id: pickAlias(raw, ["package_id", "packageId"]),
    repair_action: pickAlias(raw, ["repair_action", "repairAction"]),
    requested_by: pickAlias(raw, ["requested_by", "requestedBy"]),
    reason: pickAlias(raw, ["reason"]),
  };
}
