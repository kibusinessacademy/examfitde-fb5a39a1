import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { Project, RiskFinding, RiskLevel } from "@/lib/offer-comparison/types";

const LEVELS: RiskLevel[] = ["critical", "high", "medium", "low", "info"];
const COLORS: Record<RiskLevel, string> = {
  critical: "bg-destructive/90",
  high: "bg-destructive/60",
  medium: "bg-amber-500/70",
  low: "bg-emerald-500/60",
  info: "bg-muted-foreground/30",
};

interface Props {
  project: Project;
  risks: RiskFinding[];
}

export function RiskHeatmap({ project, risks }: Props) {
  const matrix = useMemo(() => {
    return project.offers.map((o) => ({
      offer: o,
      counts: LEVELS.reduce<Record<RiskLevel, number>>((acc, lvl) => {
        acc[lvl] = risks.filter((r) => r.offerId === o.id && r.level === lvl).length;
        return acc;
      }, { critical: 0, high: 0, medium: 0, low: 0, info: 0 }),
    }));
  }, [project.offers, risks]);

  const max = Math.max(1, ...matrix.flatMap((r) => Object.values(r.counts)));

  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm font-medium mb-3">Risk Heatmap</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="text-left font-medium p-2">Anbieter</th>
                {LEVELS.map((l) => (
                  <th key={l} className="font-medium p-2 capitalize text-center">{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((row) => (
                <tr key={row.offer.id} className="border-t">
                  <td className="p-2 font-medium">{row.offer.vendor}</td>
                  {LEVELS.map((l) => {
                    const v = row.counts[l];
                    const intensity = v === 0 ? 0 : 0.4 + (v / max) * 0.6;
                    return (
                      <td key={l} className="p-1.5 text-center">
                        <div
                          className={`mx-auto rounded h-9 w-9 flex items-center justify-center text-xs font-semibold text-white ${COLORS[l]}`}
                          style={{ opacity: v === 0 ? 0.15 : intensity }}
                        >
                          {v || ""}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
