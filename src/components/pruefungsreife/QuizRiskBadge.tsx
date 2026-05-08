import type { ResultMeta } from "./types";

const TONE_CLASS: Record<ResultMeta["tone"], string> = {
  danger: "bg-danger-bg-subtle text-danger border-danger/30",
  warning: "bg-warning-bg-subtle text-warning border-warning/30",
  info: "bg-info-bg-subtle text-info border-info/30",
  success: "bg-success-bg-subtle text-success border-success/30",
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
