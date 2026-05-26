import { motion } from "framer-motion";

interface ScoreRingProps {
  value: number;
  size?: number;
  label?: string;
  tone?: "primary" | "success" | "warning" | "error";
}

const TONE_CLS: Record<NonNullable<ScoreRingProps["tone"]>, string> = {
  primary: "stroke-primary",
  success: "stroke-emerald-500",
  warning: "stroke-amber-500",
  error: "stroke-destructive",
};

function toneFor(v: number): NonNullable<ScoreRingProps["tone"]> {
  if (v >= 80) return "success";
  if (v >= 65) return "primary";
  if (v >= 50) return "warning";
  return "error";
}

export function ScoreRing({ value, size = 88, label, tone }: ScoreRingProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamped / 100) * c;
  const t = tone ?? toneFor(clamped);
  return (
    <div className="inline-flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="stroke-muted"
          strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={TONE_CLS[t]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: "easeOut" }}
        />
      </svg>
      <div className="-mt-[calc(50%+0.5rem)] flex flex-col items-center" style={{ transform: `translateY(${-size / 2 - 8}px)` }}>
        <div className="text-2xl font-semibold tabular-nums">{clamped}</div>
        {label && <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>}
      </div>
    </div>
  );
}
