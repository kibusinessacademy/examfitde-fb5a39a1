import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldAlert } from "lucide-react";
import type { Project, RiskFinding } from "@/lib/offer-comparison/types";
import { LEVEL_META } from "@/lib/offer-comparison/risk-engine";

const ORDER = ["critical", "high", "medium", "low", "info"] as const;

const LEVEL_BG: Record<RiskFinding["level"], string> = {
  critical: "border-l-destructive",
  high: "border-l-destructive/70",
  medium: "border-l-amber-500",
  low: "border-l-emerald-500",
  info: "border-l-muted-foreground/30",
};

export function RiskList({ project, risks }: { project: Project; risks: RiskFinding[] }) {
  const grouped = useMemo(() => {
    return ORDER.map((lvl) => ({
      level: lvl,
      items: risks.filter((r) => r.level === lvl),
    })).filter((g) => g.items.length > 0);
  }, [risks]);

  if (risks.length === 0) {
    return (
      <Card>
        <CardContent className="p-10 text-center">
          <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground" />
          <div className="mt-2 font-medium">Noch keine Risiken erkannt.</div>
          <div className="text-sm text-muted-foreground">Laden Sie Angebote hoch, damit die Risk Engine analysieren kann.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map((g) => (
        <div key={g.level}>
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className="capitalize">{LEVEL_META[g.level].label}</Badge>
            <span className="text-xs text-muted-foreground">{g.items.length} Findings</span>
          </div>
          <div className="space-y-2">
            {g.items.map((r) => {
              const offer = project.offers.find((o) => o.id === r.offerId);
              return (
                <Card key={r.id} className={`border-l-4 ${LEVEL_BG[r.level]}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{r.title}</div>
                        <div className="text-sm text-muted-foreground">{offer?.vendor} · {r.detail}</div>
                      </div>
                      {r.evidence && <Badge variant="outline" className="text-xs">{r.evidence}</Badge>}
                    </div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider">Was bedeutet das?</div>
                        <div>{r.meaning}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground uppercase tracking-wider">Verhandlungs-Hebel</div>
                        <div>{r.negotiation}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
