const LABELS: Record<string, string> = {
  repair_exam_pool: "Exam-Pool reparieren",
  repair_learning_content: "Learning Content reparieren",
  repair_tutor_index: "Tutor-Index reparieren",
  rerun_integrity: "Integrity neu laufen lassen",
  rerun_quality_council: "Quality Council neu laufen lassen",
  manual_review: "Manuelle Prüfung",
};

export function AutoHealActionBadge({ action }: { action: string }) {
  return (
    <span className="inline-flex rounded-full border px-2 py-1 text-xs text-muted-foreground">
      {LABELS[action] ?? action}
    </span>
  );
}
