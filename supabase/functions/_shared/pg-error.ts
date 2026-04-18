export type GuardFailKind =
  | "ssot_guard"
  | "rls_denied"
  | "unique_violation"
  | "foreign_key_violation"
  | "not_null_violation"
  | "check_violation"
  | "serialization_retryable"
  | "timeout_retryable"
  | "unknown";

export type GuardFailClass = "permanent" | "retryable";

export interface ClassifiedDbError {
  class: GuardFailClass;
  kind: GuardFailKind;
  code?: string;
  message: string;
  hintKey?: string;
  details?: unknown;
}

/**
 * Classify Postgres/Supabase errors into retryable vs permanent.
 * Works with PostgREST and Supabase JS error shapes.
 */
export function classifyDbError(err: any): ClassifiedDbError {
  const code: string | undefined =
    err?.code || err?.details?.code || err?.cause?.code || err?.error?.code;

  const message: string =
    String(err?.message || err?.details || err?.hint || err?.error || "DB error");

  // 23514 check_violation  -> permanent (SSOT/guards)
  if (code === "23514") {
    return {
      class: "permanent",
      kind: "check_violation",
      code,
      message,
      hintKey: inferHintKey(message) ?? "pg_check_violation",
    };
  }
  // 23502 not_null_violation -> permanent
  if (code === "23502") {
    return {
      class: "permanent",
      kind: "not_null_violation",
      code,
      message,
      hintKey: inferHintKey(message) ?? "pg_not_null_violation",
    };
  }
  // 23503 foreign_key_violation -> permanent
  if (code === "23503") {
    return {
      class: "permanent",
      kind: "foreign_key_violation",
      code,
      message,
      hintKey: "pg_fk_violation",
    };
  }
  // 23505 unique_violation -> permanent
  if (code === "23505") {
    return {
      class: "permanent",
      kind: "unique_violation",
      code,
      message,
      hintKey: "pg_unique_violation",
    };
  }
  // 42501 insufficient_privilege (RLS) -> permanent
  if (code === "42501") {
    return {
      class: "permanent",
      kind: "rls_denied",
      code,
      message,
      hintKey: "pg_rls_denied",
    };
  }
  // 40001 serialization_failure -> retryable
  if (code === "40001") {
    return {
      class: "retryable",
      kind: "serialization_retryable",
      code,
      message,
      hintKey: "pg_serialization_retry",
    };
  }

  // Heuristic timeouts / cancels
  const m = message.toLowerCase();
  if (m.includes("timeout") || m.includes("timed out") || m.includes("canceling statement")) {
    return {
      class: "retryable",
      kind: "timeout_retryable",
      code,
      message,
      hintKey: "pg_timeout_retry",
    };
  }

  // ── Säule 4 (2026-04-18): Materialization-Guard exhausted = permanent ──
  // BLOCKED_BY_MATERIALIZATION mit "exhausted" bedeutet: Retry-Budget des Guards
  // ist aufgebraucht, weiter retryen würde nur Hot-Loops erzeugen. Permanent fail.
  if (
    (m.includes("blocked_by_materialization") && m.includes("exhausted")) ||
    m.includes("placeholder_lessons_present") ||
    m.includes("hollow_learning_content") ||
    m.includes("lesson_substance_below_threshold") ||
    (m.includes("threshold_fail") && m.includes("exhausted"))
  ) {
    return {
      class: "permanent",
      kind: "check_violation",
      code,
      message,
      hintKey: "materialization_guard_exhausted",
    };
  }

  return { class: "retryable", kind: "unknown", code, message, hintKey: "pg_unknown" };
}

function inferHintKey(message: string): string | undefined {
  const m = message.toLowerCase();

  if (m.includes("ssot_guard_immutable") && m.includes("competency_id")) return "immutable_competency_after_approved";
  if (m.includes("ssot_guard_immutable") && m.includes("learning_field_id")) return "immutable_lf_after_approved";
  if (m.includes("approved_requires_competency")) return "approved_requires_competency";
  if (m.includes("approved_requires_curriculum")) return "approved_requires_curriculum";
  if (m.includes("approved_requires_lf")) return "approved_requires_lf";
  if (m.includes("approved_requires_difficulty")) return "approved_requires_difficulty";
  if (m.includes("approved_requires_bloom")) return "approved_requires_bloom";
  if (m.includes("approved_requires_text")) return "approved_requires_text";
  if (m.includes("approved_requires_answer")) return "approved_requires_answer";
  if (m.includes("competencies") && m.includes("learning_field_id")) return "competency_requires_lf";

  return undefined;
}
