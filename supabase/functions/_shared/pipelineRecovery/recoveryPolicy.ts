/**
 * Thresholds & allowlists. Single source of truth.
 */
export const RECOVERY_POLICY = {
  planning_stuck_minutes: 60,
  done_pending_minutes: 30,
  lf_max_repair_cycles: 2,
  provider_fallback_model: "google/gemini-3.5-flash",
  provider_fallback_allowlist: [
    "lesson_generate_content",
    "package_finalize_learning_content",
    "package_finalize_minichecks",
    "package_finalize_oral_exam",
  ] as const,
  publish_reaudit_steps: ["run_integrity_check", "quality_council"] as const,
  worker_heartbeat_stale_minutes: 5,
} as const;

export const FORBIDDEN_FIELDS = [
  "integrity_passed",
  "council_approved",
  "is_published",
  "published_at",
] as const;
