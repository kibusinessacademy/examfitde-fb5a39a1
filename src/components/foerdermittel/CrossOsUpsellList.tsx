import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowUpRight } from "lucide-react";
import type { CrossOsRecommendation } from "@/lib/foerdermittel/conversion";

interface Props {
  recommendations: CrossOsRecommendation[];
  onClick?: (rec: CrossOsRecommendation) => void;
}

const PRIORITY_TONE: Record<CrossOsRecommendation["priority"], string> = {
  now: "border-emerald-500/50 text-emerald-700 dark:text-emerald-400",
  soon: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  later: "border-muted-foreground/30 text-muted-foreground",
};

export function CrossOsUpsellList({ recommendations, onClick }: Props) {
  if (recommendations.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">Cross-OS Empfehlungen</h3>
          <Badge variant="outline" className="text-[10px]">{recommendations.length}</Badge>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2">
          {recommendations.map((r) => (
            <li key={r.os + r.label} className="rounded-md border p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold">{r.os}</div>
                  <div className="text-sm font-medium truncate">{r.label}</div>
                </div>
                <Badge variant="outline" className={`text-[9px] uppercase ${PRIORITY_TONE[r.priority]}`}>
                  {r.priority === "now" ? "Jetzt" : r.priority === "soon" ? "Bald" : "Später"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{r.reason}</p>
              <Button variant="outline" size="sm" className="w-fit text-xs" onClick={() => onClick?.(r)}>
                {r.cta} <ArrowUpRight className="h-3 w-3 ml-1" />
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
