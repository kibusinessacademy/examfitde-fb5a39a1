import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface ReadinessBarProps {
  value: number; // 0–100
  label?: string;
  showPercent?: boolean;
  className?: string;
  size?: "sm" | "md";
}

function getColor(value: number): string {
  if (value >= 75) return "bg-success";
  if (value >= 50) return "bg-warning";
  if (value >= 30) return "bg-[hsl(25,95%,53%)]";
  return "bg-destructive";
}

export default function ReadinessBar({ value, label, showPercent = true, className, size = "md" }: ReadinessBarProps) {
  const pct = Math.round(Math.min(100, Math.max(0, value)));
  const height = size === "sm" ? "h-1.5" : "h-2.5";

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {(label || showPercent) && (
        <div className="flex items-center justify-between text-xs">
          {label && <span className="text-muted-foreground">{label}</span>}
          {showPercent && <span className="font-medium tabular-nums">{pct}%</span>}
        </div>
      )}
      <div className={cn("w-full rounded-full bg-muted overflow-hidden", height)}>
        <div
          className={cn("h-full rounded-full transition-all duration-500", getColor(pct))}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
