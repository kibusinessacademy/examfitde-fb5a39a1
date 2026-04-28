import { Badge } from "@/components/ui/badge";

type Props = {
  priority: "critical" | "warning" | "healthy";
};

export function TestPriorityBadge({ priority }: Props) {
  const cfg =
    priority === "critical"
      ? { label: "🔴 kritisch", variant: "danger" as const }
      : priority === "warning"
      ? { label: "🟡 aufmerksam", variant: "warning" as const }
      : { label: "🟢 stabil", variant: "success" as const };

  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
