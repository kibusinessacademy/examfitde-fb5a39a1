import { Badge } from "@/components/ui/badge";

type Props = {
  status?: "tested" | "issue_found" | "approved" | null;
};

export function CourseTestStatusBadge({ status }: Props) {
  if (!status) {
    return <Badge variant="muted">Nicht getestet</Badge>;
  }

  const cfg =
    status === "approved"
      ? { label: "✅ Freigegeben", variant: "success" as const }
      : status === "issue_found"
      ? { label: "❌ Problem", variant: "danger" as const }
      : { label: "🧪 Getestet", variant: "warning" as const };

  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
