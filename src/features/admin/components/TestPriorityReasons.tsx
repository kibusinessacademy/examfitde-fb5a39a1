const labelMap: Record<string, string> = {
  integrity_failed: "Integrity fehlgeschlagen",
  council_not_approved: "Council nicht freigegeben",
  too_few_questions: "Zu wenige Fragen (< 40)",
  no_lessons: "Keine Lessons",
  low_question_buffer: "Wenig Fragen-Reserve (< 100)",
  low_lesson_count: "Wenig Lessons (< 5)",
  missing_tutor_index: "Tutor-Index fehlt",
};

export function TestPriorityReasons({ reasons }: { reasons?: string[] | null }) {
  if (!reasons || reasons.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((reason) => (
        <span
          key={reason}
          className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
        >
          {labelMap[reason] ?? reason}
        </span>
      ))}
    </div>
  );
}
