const LABELS: Record<string, string> = {
  repair_exam_pool: "Exam-Pool reparieren",
  repair_exam_pool_quality: "Exam-Pool Qualität reparieren",
  repair_exam_pool_competency_coverage: "Kompetenz-Abdeckung reparieren",
  repair_learning_content: "Learning Content reparieren",
  repair_lessons: "Lektionen reparieren",
  repair_handbook: "Handbuch reparieren",
  repair_minichecks: "MiniChecks reparieren",
  repair_oral_exam: "Mündliche Prüfung reparieren",
  repair_tutor_index: "Tutor-Index reparieren",
  rerun_integrity: "Integrity neu laufen lassen",
  rerun_quality_council: "Quality Council neu laufen lassen",
  heal_finalization_stall: "Finalisierungs-Stall heilen",
  heal_non_building: "Non-Building heilen",
  retry_stalled_step: "Step-Retry",
  reset_stale_processing: "Stale Processing Reset",
  cancel_zombie_noop: "Zombie-Noop Cancel",
  manual_review: "Manuelle Prüfung",
};

export function AutoHealActionBadge({ action }: { action: string }) {
  return (
    <span className="inline-flex rounded-full border px-2 py-1 text-xs text-muted-foreground">
      {LABELS[action] ?? action}
    </span>
  );
}
