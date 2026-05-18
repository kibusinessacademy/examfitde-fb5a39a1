import type { ResultMeta } from "./types";

// Token-Hygiene: kein `danger`-Token im Tailwind-Theme — nutze `destructive`.
const TONE_CLASS: Record<ResultMeta["tone"], string> = {
  danger: "bg-destructive-bg-subtle text-destructive border-destructive-border",
  warning: "bg-warning-bg-subtle text-warning border-warning-border",
  info: "bg-info-bg-subtle text-info border-info-border",
  success: "bg-success-bg-subtle text-success border-success-border",
};

export function QuizRiskBadge({ meta }: { meta: ResultMeta }) {
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-semibold ${TONE_CLASS[meta.tone]}`}
    >
      {meta.badge}
    </span>
  );
}
