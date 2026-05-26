// FördermittelOS Cut 3 — Hub-Preview: "Nächste Schritte" für Top-Matches.
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Zap } from "lucide-react";
import type { ProgramMatch } from "@/lib/foerdermittel/types";
import {
  buildNextBestActions,
  computeApplicationReadiness,
  PRIORITY_LABEL,
  VERDICT_LABEL,
  VERDICT_TONE,
} from "@/lib/foerdermittel/execution";

export function NextStepsPreview({ matches }: { matches: ProgramMatch[] }) {
  const top = matches.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Zap className="h-4 w-4 text-primary" />
        <h3 className="text-lg font-semibold">Nächste Schritte für Ihre Top-Matches</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Was Sie konkret tun müssen, um diese Programme zu beantragen.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {top.map((m) => {
          const readiness = computeApplicationReadiness(m.program);
          const actions = buildNextBestActions(m.program, readiness).slice(0, 2);
          return (
            <Card key={m.program.id} className="hover:shadow-elev-2 transition">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to={`/foerdermittel/programm/${m.program.slug}`}
                    className="text-sm font-semibold hover:underline line-clamp-2"
                  >
                    {m.program.name}
                  </Link>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${VERDICT_TONE[readiness.verdict]}`}
                  >
                    {VERDICT_LABEL[readiness.verdict]}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>
                    Readiness <strong className="tabular-nums text-foreground">{readiness.score}</strong>/100
                  </span>
                  {readiness.missingCriticalDocs > 0 && (
                    <span className="text-amber-600 dark:text-amber-500">
                      {readiness.missingCriticalDocs} Pflichtdoks fehlen
                    </span>
                  )}
                </div>
                {actions.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {actions.map((a) => (
                      <li key={a.key} className="flex items-start gap-2 text-xs">
                        <Badge
                          variant={a.priority === "now" ? "default" : "outline"}
                          className="text-[9px] shrink-0"
                        >
                          {PRIORITY_LABEL[a.priority]}
                        </Badge>
                        <span className="line-clamp-2">{a.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <Link
                  to={`/foerdermittel/programm/${m.program.slug}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Vollständigen Antragsfahrplan öffnen <ArrowRight className="h-3 w-3" />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
