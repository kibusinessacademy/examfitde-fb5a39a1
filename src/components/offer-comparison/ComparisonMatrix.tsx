import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Filter } from "lucide-react";
import { CRITERIA, CRITERIA_BY_KEY } from "@/lib/offer-comparison/criteria";
import type { Project } from "@/lib/offer-comparison/types";
import type { ScoredOffer } from "@/lib/offer-comparison/scoring";
import { LABEL_META } from "@/lib/offer-comparison/scoring";

interface Props {
  project: Project;
  scored: ScoredOffer[];
}

export function ComparisonMatrix({ project, scored }: Props) {
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const activeCriteria = CRITERIA.filter((c) => project.activeCriteria.includes(c.key));

  const visible = onlyDiff
    ? activeCriteria.filter((c) => {
        const vals = scored
          .map((s) => s.offer.values.find((v) => v.key === c.key)?.value)
          .filter((v): v is number => typeof v === "number");
        return new Set(vals).size > 1;
      })
    : activeCriteria;

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between border-b p-4 gap-2">
          <div>
            <div className="font-semibold">Vergleichsmatrix</div>
            <div className="text-xs text-muted-foreground">{visible.length} Kriterien · {scored.length} Anbieter</div>
          </div>
          <Button
            size="sm"
            variant={onlyDiff ? "default" : "outline"}
            onClick={() => setOnlyDiff((p) => !p)}
          >
            <Filter className="h-3.5 w-3.5 mr-1.5" />
            Nur Unterschiede
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 sticky top-0">
              <tr>
                <th className="text-left p-3 font-medium sticky left-0 bg-muted/30 z-10 min-w-[180px]">Kriterium</th>
                {scored.map((s) => (
                  <th key={s.offer.id} className="text-left p-3 font-medium min-w-[200px]">
                    <div className="font-semibold">{s.offer.vendor}</div>
                    <div className="text-xs text-muted-foreground font-normal">{s.offer.productName}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.score.labels.slice(0, 2).map((l) => (
                        <Badge key={l} variant="outline" className="text-[10px]">{LABEL_META[l].label}</Badge>
                      ))}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const def = CRITERIA_BY_KEY[c.key];
                const vals = scored.map((s) => ({
                  scoredId: s.offer.id,
                  v: s.offer.values.find((x) => x.key === c.key),
                  contribution: s.score.breakdown.find((b) => b.key === c.key)?.normalized ?? 0,
                }));
                const best = vals.reduce((a, b) => (b.contribution > a.contribution ? b : a), vals[0]);
                const open = expanded === c.key;
                return (
                  <>
                    <tr key={c.key} className="border-t hover:bg-muted/30">
                      <td className="p-3 sticky left-0 bg-background z-10">
                        <button
                          className="flex items-center gap-1 text-left"
                          onClick={() => setExpanded(open ? null : c.key)}
                        >
                          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
                          <span className="font-medium">{def.label}</span>
                        </button>
                        <div className="text-xs text-muted-foreground pl-5">{def.unit ?? ""}</div>
                      </td>
                      {vals.map((cell) => {
                        const isBest = cell.scoredId === best.scoredId && best.contribution > 0;
                        const opacity = 0.05 + cell.contribution * 0.25;
                        return (
                          <td key={cell.scoredId} className="p-3 align-top relative">
                            <div
                              aria-hidden
                              className={`absolute inset-1 rounded ${isBest ? "ring-1 ring-primary/30" : ""}`}
                              style={{ background: `hsl(var(--primary) / ${opacity})` }}
                            />
                            <div className="relative">
                              <div className="font-medium tabular-nums">{cell.v?.display ?? "—"}</div>
                              {cell.v?.evidence && <div className="text-xs text-muted-foreground">{cell.v.evidence}</div>}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                    {open && (
                      <tr className="bg-muted/20">
                        <td colSpan={scored.length + 1} className="p-3 text-xs text-muted-foreground">
                          <div className="font-medium text-foreground mb-1">Begründung & Reasoning</div>
                          {scored.map((s) => {
                            const b = s.score.breakdown.find((bb) => bb.key === c.key);
                            if (!b) return null;
                            return (
                              <div key={s.offer.id} className="mb-1">
                                <span className="font-medium text-foreground">{s.offer.vendor}:</span> {b.reasoning}{" "}
                                <span className="text-foreground">· Gewicht {b.weight}</span>
                              </div>
                            );
                          })}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
