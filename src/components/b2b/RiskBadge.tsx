import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Verdict = "exam_ready" | "almost_ready" | "needs_work" | "not_ready" | "inactive";

const VERDICT_CONFIG: Record<Verdict, { label: string; className: string }> = {
  exam_ready:   { label: "Prüfungsreif",  className: "bg-success/15 text-success border-success/30" },
  almost_ready: { label: "Fast bereit",   className: "bg-warning/15 text-warning border-warning/30" },
  needs_work:   { label: "Aufholbedarf",  className: "bg-[hsl(25,95%,53%)]/15 text-[hsl(25,95%,53%)] border-[hsl(25,95%,53%)]/30" },
  not_ready:    { label: "Nicht bereit",   className: "bg-destructive/15 text-destructive border-destructive/30" },
  inactive:     { label: "Inaktiv",        className: "bg-muted text-muted-foreground border-border" },
};

interface RiskBadgeProps {
  verdict: string;
  className?: string;
}

export default function RiskBadge({ verdict, className }: RiskBadgeProps) {
  const config = VERDICT_CONFIG[verdict as Verdict] ?? {
    label: verdict,
    className: "bg-muted text-muted-foreground border-border",
  };

  return (
    <Badge variant="outline" className={cn("text-xs font-medium", config.className, className)}>
      {config.label}
    </Badge>
  );
}
